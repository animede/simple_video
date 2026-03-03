from __future__ import annotations

import asyncio
import base64
import json
import mimetypes
import os
import random
import re
import shutil
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
# openai_chat.py はこのディレクトリ内にバンドル（独立動作のため）
sys.path.insert(0, str(BASE_DIR))
from openai_chat import chat_req, vlm_req

INPUT_DIR   = BASE_DIR / "input"      # アプリ自身の一時入出力フォルダ
OUTPUT_DIR  = BASE_DIR / "output"
WORKFLOWS_DIR = BASE_DIR / "workflows"  # ワークフローは自前フォルダで管理
TEMP_DIR    = BASE_DIR / "temp"
APP_DATA_DIR = BASE_DIR / "data"
STATE_FILE = APP_DATA_DIR / "simple_video_state.json"
REF_IMAGES_DIR = APP_DATA_DIR / "ref_images"
REF_IMAGES_INDEX = APP_DATA_DIR / "ref_images.json"
SIMPLE_VIDEO_DOCS_DIR = BASE_DIR / "docs"
SIMPLE_VIDEO_HELP_DOCS: Dict[str, Dict[str, str]] = {
    "tutorial": {
        "title": "クイックヘルプ",
        "file": "HELP_JP.md",
        "description": "画面を開いた後の基本操作（画像準備→シーン生成→動画化）",
    },
    "guide": {
        "title": "ユーザーズガイド",
        "file": "USAGE_JP.md",
        "description": "画面全体の使い方、運用時の確認ポイント",
    },
    "technical": {
        "title": "テクニカルガイド",
        "file": "TECHNICAL_JP.md",
        "description": "Standalone版のAPI・アーキテクチャ・実装詳細",
    },
}

def _find_comfyui_dir() -> Optional[Path]:
    """ComfyUI ルートを自動検出する。

    優先順:
      1. COMFYUI_DIR 環境変数
      2. BASE_DIR から上位ディレクトリを最大8段階探索
         (マーカー: comfyui_version.py  または  main.py + comfy/ サブディレクトリ)
    """
    env_val = str(os.environ.get("COMFYUI_DIR", "")).strip()
    if env_val:
        p = Path(env_val).expanduser()
        if p.is_dir():
            return p.resolve()
    candidate = BASE_DIR.parent
    for _ in range(8):
        if (candidate / "comfyui_version.py").exists() or (
            (candidate / "main.py").exists() and (candidate / "comfy").is_dir()
        ):
            return candidate.resolve()
        parent = candidate.parent
        if parent == candidate:
            break
        candidate = parent
    return None


_comfyui_dir = _find_comfyui_dir()

# --- COMFY_INPUT_DIR: 環境変数 > 自動検出 > アプリ自身の input/ ---
_comfy_input_env = str(os.environ.get("COMFYUI_INPUT_DIR", "")).strip()
if _comfy_input_env:
    COMFY_INPUT_DIR = Path(_comfy_input_env).expanduser().resolve()
elif _comfyui_dir:
    COMFY_INPUT_DIR = _comfyui_dir / "input"
else:
    COMFY_INPUT_DIR = INPUT_DIR  # フォールバック: アプリ自身の input/

# --- COMFY_OUTPUT_DIR: 環境変数 > 自動検出 > アプリ自身の output/ ---
_comfy_output_env = str(os.environ.get("COMFYUI_OUTPUT_DIR", "")).strip()
if _comfy_output_env:
    COMFY_OUTPUT_DIR = Path(_comfy_output_env).expanduser().resolve()
elif _comfyui_dir:
    COMFY_OUTPUT_DIR = _comfyui_dir / "output"
else:
    COMFY_OUTPUT_DIR = OUTPUT_DIR  # フォールバック: アプリ自身の output/

_legacy_output_dir = OUTPUT_DIR  # legacy 参照先を自前 output/ に統一


def _dedupe_paths(paths: list[Path]) -> list[Path]:
    unique: list[Path] = []
    seen: set[str] = set()
    for path in paths:
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        unique.append(path)
    return unique


EXTERNAL_OUTPUT_DIRS = _dedupe_paths([_legacy_output_dir, COMFY_OUTPUT_DIR])

COMFYUI_SERVER = os.environ.get("COMFYUI_SERVER", "127.0.0.1:8188").strip()
REQUEST_TIMEOUT_SEC = float(os.environ.get("SIMPLE_VIDEO_HTTP_TIMEOUT", "60"))
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "http://127.0.0.1:1/v1")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "dummy")
VLM_BASE_URL = os.environ.get("VLM_BASE_URL", OPENAI_BASE_URL)
VLM_API_KEY = os.environ.get("VLM_API_KEY", OPENAI_API_KEY)
VLM_MODEL = os.environ.get("VLM_MODEL", "gemma-3-27b-it")

WORKFLOW_NAMES: Dict[str, str] = {
    "qwen_t2i_2512_lightning4": "t2i_qwen_image_2512_lightning_api.json",
    "qwen22_t2v_4step": "video_wan2_2_14B_t2v_gguf_lightning4_api.json",
    "wan22_t2v_gguf_lightning4": "video_wan2_2_14B_t2v_gguf_lightning4_api.json",
    "wan22_i2v_lightning": "Wan2.2-I2V-A14B-4steps-lora-rank64-Seko-V1-NativeComfy_api.json",
    "wan22_smooth_first2last": "video_wan2_2_14B_flf2v_s_api.json",
    "qwen_i2i_2511_bf16_lightning4": "i2i_qwen_image_edit_2511_bf16_lightning4_api.json",
    "qwen_i2i_2511_bf16_lightning4_1img": "i2i_qwen_image_edit_2511_bf16_lightning4_1img_api.json",
    "qwen_i2i_2511_bf16_lightning4_2img": "i2i_qwen_image_edit_2511_bf16_lightning4_2img_api.json",
    "qwen_i2i_2511_bf16_lightning4_3img": "i2i_qwen_image_edit_2511_bf16_lightning4_3img_api.json",
    "qwen_i2i_2512_lightning4": "i2i_qwen_image_2512_lightning_api.json",
    "i2i_qwen_image_edit_2511": "i2i_qwen_image_edit_2511_bf16_api.json",
    "ace_step_1_5_t2a": "audio_ace_step_1_5_api.json",
}


class WorkflowRequest(BaseModel):
    workflow: str | Dict[str, Any]
    parameters: Dict[str, Any] = Field(default_factory=dict)
    prompt: Optional[str] = None
    negative_prompt: Optional[str] = None
    input_image: Optional[str] = None
    input_image_2: Optional[str] = None
    input_image_3: Optional[str] = None
    input_image_4: Optional[str] = None
    input_image_5: Optional[str] = None
    input_image_6: Optional[str] = None
    input_image_7: Optional[str] = None
    input_image_8: Optional[str] = None
    input_image_9: Optional[str] = None
    input_image_start: Optional[str] = None
    input_image_end: Optional[str] = None
    input_video: Optional[str] = None
    input_audio: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    fps: Optional[int] = None
    frames: Optional[int] = None
    steps: Optional[int] = None
    cfg: Optional[float] = None
    denoise: Optional[float] = None
    seed: Optional[int] = None
    sampler: Optional[str] = None
    scheduler: Optional[str] = None
    tags: Optional[str] = None
    lyrics: Optional[str] = None
    language: Optional[str] = None
    duration: Optional[int] = None
    bpm: Optional[int] = None
    timesignature: Optional[str] = None
    keyscale: Optional[str] = None
    guidance_lyric: Optional[float] = None
    lyrics_strength: Optional[float] = None
    strip_audio: Optional[bool] = None
    response_type: str = "url"
    client_session_id: Optional[str] = None
    session_mode: Optional[str] = None


class UtilityRequest(BaseModel):
    workflow: str
    client_session_id: Optional[str] = None
    session_mode: Optional[str] = None
    videos: Optional[list[str]] = None
    video: Optional[str] = None
    audio: Optional[str] = None
    fps: Optional[int] = 16
    keep_audio: Optional[bool] = None
    user_prompt: Optional[str] = None
    scene_count: Optional[int] = None
    output_type: Optional[str] = None
    scene_variation: Optional[str] = None
    prompt_complexity: Optional[str] = None
    translation_mode: Optional[bool] = None
    edit_context: Optional[str] = None
    flf_motion_level: Optional[str] = None
    target_workflow: Optional[str] = None
    scenario: Optional[str] = None
    genre: Optional[str] = None
    language: Optional[str] = None
    lyrics: Optional[str] = None
    lyrics_target_duration: Optional[int] = None
    spec_mode: Optional[str] = None
    scene_prompts: Optional[List[str]] = None
    scene_durations_sec: Optional[List[float]] = None
    target_duration_sec: Optional[float] = None
    prompt: Optional[str] = None


class TranslateRequest(BaseModel):
    text: str
    target_language: str = "auto"


class TranslateResponse(BaseModel):
    original_text: str
    translated_text: str
    source_language: str
    target_language: str


class VLMAnalyzeRequest(BaseModel):
    image_base64: str
    mode: str = "image"
    language: str = "en"
    custom_prompt: Optional[str] = None
    focus_area: Optional[str] = None


class VLMAnalyzeResponse(BaseModel):
    success: bool
    description: str
    mode: str
    language: str
    elapsed_time: float


class SimpleVideoStateRequest(BaseModel):
    client_session_id: Optional[str] = None
    session_mode: Optional[str] = None
    state: Dict[str, Any] = Field(default_factory=dict)


class OutputFilesDeleteRequest(BaseModel):
    files: List[str] = Field(default_factory=list)


class UploadBase64Request(BaseModel):
    filename: str
    data_base64: str
    mime_type: Optional[str] = None
    client_session_id: Optional[str] = None


@dataclass
class Job:
    job_id: str
    workflow: str
    request_payload: Dict[str, Any]
    status: str = "queued"
    progress: float = 0.0
    message: str = "Queued"
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    prompt_id: Optional[str] = None
    error: Optional[str] = None
    result: Dict[str, Any] = field(default_factory=dict)
    subscribers: set[asyncio.Queue] = field(default_factory=set)

    def snapshot(self) -> Dict[str, Any]:
        payload = {
            "job_id": self.job_id,
            "status": self.status,
            "progress": self.progress,
            "message": self.message,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "workflow": self.workflow,
        }
        if self.error:
            payload["error"] = self.error
        if self.result:
            payload["result"] = self.result
        return payload


class JobManager:
    def __init__(self) -> None:
        self.jobs: Dict[str, Job] = {}
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.lock = asyncio.Lock()
        self.worker_task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        if self.worker_task and not self.worker_task.done():
            return
        self.worker_task = asyncio.create_task(self._worker_loop())

    async def add_job(self, job: Job) -> None:
        async with self.lock:
            self.jobs[job.job_id] = job
        await self.queue.put(job.job_id)
        await self.broadcast(job)

    async def get(self, job_id: str) -> Optional[Job]:
        async with self.lock:
            return self.jobs.get(job_id)

    async def update(self, job: Job, **kwargs: Any) -> None:
        for key, value in kwargs.items():
            setattr(job, key, value)
        job.updated_at = time.time()
        await self.broadcast(job)

    async def subscribe(self, job_id: str, queue_obj: asyncio.Queue) -> Optional[Job]:
        job = await self.get(job_id)
        if not job:
            return None
        job.subscribers.add(queue_obj)
        return job

    async def unsubscribe(self, job: Job, queue_obj: asyncio.Queue) -> None:
        job.subscribers.discard(queue_obj)

    async def broadcast(self, job: Job) -> None:
        dead: list[asyncio.Queue] = []
        message = job.snapshot()
        for queue_obj in list(job.subscribers):
            try:
                queue_obj.put_nowait(message)
            except Exception:
                dead.append(queue_obj)
        for queue_obj in dead:
            job.subscribers.discard(queue_obj)

    async def _worker_loop(self) -> None:
        while True:
            job_id = await self.queue.get()
            job = await self.get(job_id)
            if not job:
                self.queue.task_done()
                continue
            if str(job.status) == "cancelled":
                self.queue.task_done()
                continue
            try:
                await self.update(job, status="processing", progress=0.05, message="Submitting to ComfyUI")
                if str(job.workflow).startswith("utility:"):
                    result = await execute_utility_job(job)
                else:
                    result = await execute_generate_job(job)
                await self.update(
                    job,
                    status="completed",
                    progress=1.0,
                    message="Completed",
                    result=result,
                )
            except Exception as exc:
                await self.update(
                    job,
                    status="failed",
                    progress=0.0,
                    message="Failed",
                    error=str(exc),
                )
            finally:
                self.queue.task_done()


job_manager = JobManager()


def _workflow_file_from_name(name: str) -> Path:
    candidate = WORKFLOW_NAMES.get(name, name)
    if isinstance(candidate, str) and candidate.endswith(".json"):
        workflow_file = WORKFLOWS_DIR / candidate
        if workflow_file.exists():
            return workflow_file
    raise HTTPException(status_code=400, detail=f"Unknown workflow: {name}")


def _load_workflow(workflow: str | Dict[str, Any]) -> Dict[str, Any]:
    if isinstance(workflow, dict):
        return workflow
    workflow_file = _workflow_file_from_name(str(workflow).strip())
    with open(workflow_file, "r", encoding="utf-8") as file_obj:
        return json.load(file_obj)


def _set_if_present(inputs: Dict[str, Any], keys: list[str], value: Any) -> None:
    if value is None:
        return
    for key in keys:
        if key in inputs:
            inputs[key] = value


def _to_positive_int(value: Any) -> Optional[int]:
    try:
        n = int(value)
    except Exception:
        return None
    return n if n > 0 else None


def _apply_basic_parameters(workflow: Dict[str, Any], payload: WorkflowRequest) -> None:
    params = dict(payload.parameters or {})
    if payload.prompt is not None:
        params["prompt"] = payload.prompt
    if payload.negative_prompt is not None:
        params["negative_prompt"] = payload.negative_prompt
    if payload.input_image is not None:
        params["input_image"] = payload.input_image
    if payload.input_image_2 is not None:
        params["input_image_2"] = payload.input_image_2
    if payload.input_image_3 is not None:
        params["input_image_3"] = payload.input_image_3
    if payload.input_image_4 is not None:
        params["input_image_4"] = payload.input_image_4
    if payload.input_image_5 is not None:
        params["input_image_5"] = payload.input_image_5
    if payload.input_image_6 is not None:
        params["input_image_6"] = payload.input_image_6
    if payload.input_image_7 is not None:
        params["input_image_7"] = payload.input_image_7
    if payload.input_image_8 is not None:
        params["input_image_8"] = payload.input_image_8
    if payload.input_image_9 is not None:
        params["input_image_9"] = payload.input_image_9
    if payload.input_image_start is not None:
        params["input_image_start"] = payload.input_image_start
    if payload.input_image_end is not None:
        params["input_image_end"] = payload.input_image_end
    if payload.input_video is not None:
        params["input_video"] = payload.input_video
    if payload.input_audio is not None:
        params["input_audio"] = payload.input_audio
    if payload.width is not None:
        params["width"] = payload.width
    if payload.height is not None:
        params["height"] = payload.height
    if payload.fps is not None:
        params["fps"] = payload.fps
    if payload.frames is not None:
        params["frames"] = payload.frames
    if payload.steps is not None:
        params["steps"] = payload.steps
    if payload.cfg is not None:
        params["cfg"] = payload.cfg
    if payload.denoise is not None:
        params["denoise"] = payload.denoise
    if payload.seed is not None:
        params["seed"] = payload.seed
    if payload.sampler is not None:
        params["sampler"] = payload.sampler
    if payload.scheduler is not None:
        params["scheduler"] = payload.scheduler
    if payload.tags is not None:
        params["tags"] = payload.tags
    if payload.lyrics is not None:
        params["lyrics"] = payload.lyrics
    if payload.language is not None:
        params["language"] = payload.language
    if payload.duration is not None:
        params["audio_duration"] = payload.duration
        params["duration"] = payload.duration
    if payload.bpm is not None:
        params["bpm"] = payload.bpm
    if payload.timesignature is not None:
        params["timesignature"] = payload.timesignature
    if payload.keyscale is not None:
        params["keyscale"] = payload.keyscale
    if payload.guidance_lyric is not None:
        params["guidance_lyric"] = payload.guidance_lyric
    if payload.lyrics_strength is not None:
        params["lyrics_strength"] = payload.lyrics_strength
    if payload.strip_audio is not None:
        params["strip_audio"] = payload.strip_audio

    # ComfyUI may SKIP nodes when all inputs are identical to previous runs.
    # If caller did not provide a valid positive seed, auto-assign one so
    # sampler/noise inputs change between runs.
    raw_seed = params.get("seed")
    resolved_seed: Optional[int] = None
    if raw_seed is not None:
        try:
            parsed_seed = int(str(raw_seed).strip())
            if parsed_seed > 0:
                resolved_seed = parsed_seed
        except Exception:
            resolved_seed = None
    if resolved_seed is None:
        resolved_seed = random.SystemRandom().randint(1, 2_147_483_647)
    params["seed"] = resolved_seed

    image_values = [
        params.get("input_image"),
        params.get("input_image_2"),
        params.get("input_image_3"),
        params.get("input_image_4"),
        params.get("input_image_5"),
        params.get("input_image_6"),
        params.get("input_image_7"),
        params.get("input_image_8"),
        params.get("input_image_9"),
    ]
    image_index = 0

    load_image_nodes: list[tuple[str, Dict[str, Any]]] = []
    for node_id, node in workflow.items():
        if isinstance(node, dict) and str(node.get("class_type", "")) == "LoadImage":
            load_image_nodes.append((str(node_id), node))

    start_target_ids: set[str] = set()
    end_target_ids: set[str] = set()
    if params.get("input_image_start") or params.get("input_image_end"):
        for node_id, node in load_image_nodes:
            title = str((node.get("_meta") or {}).get("title", "")).lower()
            if any(token in title for token in ("start", "first", "begin")):
                start_target_ids.add(node_id)
            if any(token in title for token in ("end", "last", "final")):
                end_target_ids.add(node_id)
        if not start_target_ids and len(load_image_nodes) >= 1:
            start_target_ids.add(load_image_nodes[0][0])
        if not end_target_ids and len(load_image_nodes) >= 2:
            end_target_ids.add(load_image_nodes[1][0])

    for node_id, node in workflow.items():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue

        _set_if_present(inputs, ["text", "prompt", "caption", "tags"], params.get("prompt"))
        _set_if_present(inputs, ["negative_prompt", "negative_text"], params.get("negative_prompt"))
        if "negative" in inputs and isinstance(inputs.get("negative"), str):
            inputs["negative"] = params.get("negative_prompt") if params.get("negative_prompt") is not None else inputs.get("negative")
        _set_if_present(inputs, ["seed", "noise_seed"], params.get("seed"))
        _set_if_present(inputs, ["steps"], params.get("steps"))
        _set_if_present(inputs, ["cfg", "cfg_scale", "guidance"], params.get("cfg"))
        _set_if_present(inputs, ["denoise", "strength"], params.get("denoise"))
        _set_if_present(inputs, ["width"], params.get("width"))
        _set_if_present(inputs, ["height"], params.get("height"))
        _set_if_present(inputs, ["fps", "frame_rate"], params.get("fps"))
        _set_if_present(inputs, ["frames", "length", "num_frames"], params.get("frames"))
        _set_if_present(inputs, ["sampler_name", "sampler"], params.get("sampler"))
        _set_if_present(inputs, ["scheduler"], params.get("scheduler"))
        _set_if_present(inputs, ["lyrics"], params.get("lyrics"))
        _set_if_present(inputs, ["tags", "caption"], params.get("tags"))
        _set_if_present(inputs, ["language"], params.get("language"))
        _set_if_present(inputs, ["audio_duration", "duration", "seconds"], params.get("audio_duration"))
        _set_if_present(inputs, ["bpm"], params.get("bpm"))
        _set_if_present(inputs, ["timesignature"], params.get("timesignature"))
        _set_if_present(inputs, ["keyscale"], params.get("keyscale"))
        _set_if_present(inputs, ["guidance_lyric"], params.get("guidance_lyric"))
        _set_if_present(inputs, ["lyrics_strength"], params.get("lyrics_strength"))

        class_type = str(node.get("class_type", ""))
        if class_type == "WanFirstLastFrameToVideo":
            width = _to_positive_int(params.get("width"))
            height = _to_positive_int(params.get("height"))
            length = _to_positive_int(params.get("frames"))
            fps = _to_positive_int(params.get("fps")) or 16
            if length is None:
                # Default clip length used by many video workflows: fps * 5sec + 1
                length = max(1, fps * 5 + 1)

            if _to_positive_int(inputs.get("width")) is None:
                inputs["width"] = width or 832
            if _to_positive_int(inputs.get("height")) is None:
                inputs["height"] = height or 480
            if _to_positive_int(inputs.get("length")) is None:
                inputs["length"] = length
            if _to_positive_int(inputs.get("batch_size")) is None:
                inputs["batch_size"] = 1

        if class_type == "LoadImage":
            if params.get("input_image_start") and str(node_id) in start_target_ids:
                inputs["image"] = params.get("input_image_start")
                continue
            if params.get("input_image_end") and str(node_id) in end_target_ids:
                inputs["image"] = params.get("input_image_end")
                continue
            while image_index < len(image_values) and not image_values[image_index]:
                image_index += 1
            if image_index < len(image_values):
                inputs["image"] = image_values[image_index]
                image_index += 1
        elif class_type == "LoadVideo" and params.get("input_video"):
            if "video" in inputs:
                inputs["video"] = params.get("input_video")
            if "file" in inputs:
                inputs["file"] = params.get("input_video")
        elif class_type == "LoadAudio" and params.get("input_audio"):
            if "audio" in inputs:
                inputs["audio"] = params.get("input_audio")
        elif class_type in {"VHS_LoadVideo", "VHS_LoadVideoPath"} and params.get("input_video"):
            if "video" in inputs:
                inputs["video"] = params.get("input_video")
            if "path" in inputs:
                inputs["path"] = params.get("input_video")


def _queue_prompt_to_comfyui(workflow: Dict[str, Any]) -> str:
    url = f"http://{COMFYUI_SERVER}/prompt"
    resp = requests.post(url, json={"prompt": workflow}, timeout=REQUEST_TIMEOUT_SEC)
    if not resp.ok:
        detail = ""
        try:
            detail = str(resp.text or "").strip()
        except Exception:
            detail = ""
        if detail:
            detail = f" | response={detail[:1000]}"
        raise RuntimeError(f"ComfyUI /prompt failed: HTTP {resp.status_code}{detail}")
    data = resp.json()
    prompt_id = data.get("prompt_id")
    if not prompt_id:
        raise RuntimeError("ComfyUI did not return prompt_id")
    return str(prompt_id)


def _fetch_history(prompt_id: str) -> Dict[str, Any]:
    url = f"http://{COMFYUI_SERVER}/history/{prompt_id}"
    resp = requests.get(url, timeout=REQUEST_TIMEOUT_SEC)
    resp.raise_for_status()
    return resp.json() if resp.content else {}


def _fetch_history_all() -> Dict[str, Any]:
    url = f"http://{COMFYUI_SERVER}/history"
    resp = requests.get(url, timeout=REQUEST_TIMEOUT_SEC)
    resp.raise_for_status()
    return resp.json() if resp.content else {}


def _fetch_progress() -> Dict[str, Any]:
    url = f"http://{COMFYUI_SERVER}/progress"
    resp = requests.get(url, timeout=REQUEST_TIMEOUT_SEC)
    resp.raise_for_status()
    return resp.json() if resp.content else {}


def _resolve_history_entry(history_payload: Dict[str, Any], prompt_id: str) -> Optional[Dict[str, Any]]:
    if not isinstance(history_payload, dict) or not history_payload:
        return None

    # Typical shape: {"<prompt_id>": {"outputs": {...}, ...}}
    direct = history_payload.get(prompt_id)
    if isinstance(direct, dict):
        return direct

    # Some environments may return the entry itself for /history/{prompt_id}.
    if "outputs" in history_payload and isinstance(history_payload.get("outputs"), dict):
        return history_payload

    # Fallback: if only one entry exists and it looks like a history entry, use it.
    if len(history_payload) == 1:
        only_value = next(iter(history_payload.values()))
        if isinstance(only_value, dict) and isinstance(only_value.get("outputs"), dict):
            return only_value

    # Fallback: scan all entries and match by prompt_id field when available.
    for value in history_payload.values():
        if not isinstance(value, dict):
            continue
        value_prompt_id = value.get("prompt_id")
        if value_prompt_id is not None and str(value_prompt_id) == str(prompt_id):
            return value

    return None


def _extract_outputs(history_payload: Dict[str, Any], prompt_id: str) -> list[Dict[str, Any]]:
    outputs: list[Dict[str, Any]] = []
    entry = _resolve_history_entry(history_payload, prompt_id) or {}
    node_outputs = entry.get("outputs", {}) if isinstance(entry, dict) else {}

    for node_data in node_outputs.values():
        if not isinstance(node_data, dict):
            continue
        for key, media_type in (("images", "image"), ("videos", "video"), ("audio", "audio")):
            for item in node_data.get(key, []) or []:
                if not isinstance(item, dict):
                    continue
                filename = item.get("filename")
                if not filename:
                    continue
                subfolder = item.get("subfolder", "")
                outputs.append(
                    {
                        "filename": str(filename),
                        "subfolder": str(subfolder or ""),
                        "type": str(item.get("type") or "output"),
                        "media_type": media_type,
                    }
                )
    return outputs


def _output_roots_for_item(item_type: str) -> list[Path]:
    kind = str(item_type or "output").strip().lower()
    if kind == "input":
        return _dedupe_paths([INPUT_DIR, COMFY_INPUT_DIR])
    if kind == "temp":
        return _dedupe_paths([TEMP_DIR])
    return _dedupe_paths([OUTPUT_DIR, *EXTERNAL_OUTPUT_DIRS])


def _find_existing_media_file(filename: str, subfolder: str = "", item_type: str = "output") -> Optional[Path]:
    safe_name = _safe_name(filename)
    safe_sub = str(subfolder or "").strip("/")
    for root in _output_roots_for_item(item_type):
        candidates = [root / safe_sub / safe_name] if safe_sub else []
        candidates.append(root / safe_name)
        if not safe_sub and str(item_type or "output").strip().lower() == "output":
            candidates.append(root / "image" / safe_name)
            candidates.append(root / "video" / safe_name)
            candidates.append(root / "movie" / safe_name)
            candidates.append(root / "audio" / safe_name)
        for candidate in candidates:
            if candidate.exists() and candidate.is_file():
                return candidate
    return None


def _classify_output_media_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}:
        return "image"
    if suffix in {".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v"}:
        return "video"
    if suffix in {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac"}:
        return "audio"
    return "other"


def _resolve_output_file_from_relative_path(path_value: str) -> Optional[Path]:
    raw = str(path_value or "").replace("\\", "/").strip("/")
    if not raw:
        return None
    if ".." in Path(raw).parts:
        return None
    candidate = (OUTPUT_DIR / raw).resolve()
    root = OUTPUT_DIR.resolve()
    try:
        candidate.relative_to(root)
    except Exception:
        return None
    if not candidate.exists() or not candidate.is_file():
        return None
    return candidate


def _materialize_outputs_to_local_dir(outputs: list[Dict[str, Any]]) -> list[Dict[str, Any]]:
    normalized: list[Dict[str, Any]] = []
    for item in outputs:
        filename = str(item.get("filename") or "").strip()
        if not filename:
            continue
        subfolder = str(item.get("subfolder") or "").strip("/")
        item_type = str(item.get("type") or "output")
        source = _find_existing_media_file(filename, subfolder, item_type)
        if source is not None:
            target = OUTPUT_DIR / subfolder / filename if subfolder else OUTPUT_DIR / filename
            target.parent.mkdir(parents=True, exist_ok=True)
            if source.resolve() != target.resolve():
                shutil.copy2(source, target)
        normalized.append(item)
    return normalized


def _to_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on", "enable", "enabled"}
    return False


def _strip_audio_from_outputs(outputs: list[Dict[str, Any]]) -> list[Dict[str, Any]]:
    updated: list[Dict[str, Any]] = []
    for item in outputs:
        if str(item.get("media_type")) != "video":
            updated.append(item)
            continue
        filename = str(item.get("filename") or "")
        if not filename:
            updated.append(item)
            continue
        subfolder = str(item.get("subfolder") or "")
        video_path = OUTPUT_DIR / subfolder / filename if subfolder else OUTPUT_DIR / filename
        if not video_path.exists():
            updated.append(item)
            continue

        stripped_name = f"{video_path.stem}_noaudio{video_path.suffix}"
        stripped_path = video_path.with_name(stripped_name)
        cmd = ["ffmpeg", "-y", "-i", str(video_path), "-c:v", "copy", "-an", str(stripped_path)]
        _run_ffmpeg(cmd)

        next_item = dict(item)
        next_item["filename"] = stripped_name
        updated.append(next_item)
    return updated


async def execute_generate_job(job: Job) -> Dict[str, Any]:
    payload = WorkflowRequest(**job.request_payload)
    workflow = _load_workflow(payload.workflow)
    _apply_basic_parameters(workflow, payload)
    await asyncio.to_thread(_sync_workflow_input_images_to_comfy_input, workflow)

    prompt_id = await asyncio.to_thread(_queue_prompt_to_comfyui, workflow)
    await job_manager.update(job, prompt_id=prompt_id, progress=0.1, message="Queued in ComfyUI")

    deadline = time.time() + 60 * 20
    while time.time() < deadline:
        history = await asyncio.to_thread(_fetch_history, prompt_id)
        history_entry = _resolve_history_entry(history, prompt_id)
        if not isinstance(history_entry, dict):
            # ComfyUI variants may expose completed items only on /history.
            history_all = await asyncio.to_thread(_fetch_history_all)
            all_entry = _resolve_history_entry(history_all, prompt_id)
            if isinstance(all_entry, dict):
                history = history_all
                history_entry = all_entry
        if isinstance(history_entry, dict):
            outputs = _extract_outputs(history, prompt_id)
            outputs = await asyncio.to_thread(_materialize_outputs_to_local_dir, outputs)
            if _to_bool(payload.strip_audio or payload.parameters.get("strip_audio")):
                outputs = await asyncio.to_thread(_strip_audio_from_outputs, outputs)
            return {
                "prompt_id": prompt_id,
                "outputs": outputs,
            }

        try:
            progress_payload = await asyncio.to_thread(_fetch_progress)
            value = float(progress_payload.get("value", 0.0))
            maximum = float(progress_payload.get("max", 1.0))
            progress01 = max(0.0, min(1.0, value / maximum if maximum > 0 else 0.0))
            await job_manager.update(job, progress=max(job.progress, 0.1 + 0.85 * progress01), message="Processing")
        except Exception:
            await job_manager.update(job, progress=max(job.progress, 0.2), message="Processing")

        await asyncio.sleep(0.8)

    raise RuntimeError("Timed out waiting for ComfyUI job completion")


async def _interrupt_comfyui(prompt_id: Optional[str]) -> None:
    url = f"http://{COMFYUI_SERVER}/interrupt"
    try:
        payload: Optional[Dict[str, Any]] = None
        if prompt_id:
            payload = {"prompt_id": prompt_id}
        requests.post(url, json=payload, timeout=10)
    except Exception:
        pass


openai_client: Optional[AsyncOpenAI] = None
vlm_client: Optional[AsyncOpenAI] = None


def _normalize_openai_compatible_base_url(url: str) -> str:
    base = str(url or "").strip()
    if not base:
        return "http://127.0.0.1:1/v1"
    return base.rstrip("/")


def get_openai_client() -> AsyncOpenAI:
    global openai_client
    if openai_client is None:
        openai_client = AsyncOpenAI(
            base_url=_normalize_openai_compatible_base_url(OPENAI_BASE_URL),
            api_key=OPENAI_API_KEY,
        )
    return openai_client


def get_vlm_client() -> AsyncOpenAI:
    global vlm_client
    if vlm_client is None:
        vlm_client = AsyncOpenAI(
            base_url=_normalize_openai_compatible_base_url(VLM_BASE_URL),
            api_key=VLM_API_KEY,
        )
    return vlm_client


def _resolve_media_path(file_ref: str, kind: str = "any") -> Path:
    raw = str(file_ref or "").strip()
    if not raw:
        raise FileNotFoundError("Empty file reference")

    cleaned = re.sub(r"\s*\[(output|input|temp)\]\s*$", "", raw, flags=re.IGNORECASE).strip()
    rel = cleaned.strip("/")
    basename = Path(rel).name

    search_dirs: list[Path] = [
        INPUT_DIR,
        OUTPUT_DIR,
        *EXTERNAL_OUTPUT_DIRS,
        OUTPUT_DIR / "video",
        OUTPUT_DIR / "movie",
        OUTPUT_DIR / "audio",
        OUTPUT_DIR / "image",
        TEMP_DIR,
    ]

    if kind == "video":
        search_dirs = [OUTPUT_DIR / "movie", OUTPUT_DIR / "video", OUTPUT_DIR, *EXTERNAL_OUTPUT_DIRS, INPUT_DIR, TEMP_DIR]
    elif kind == "audio":
        search_dirs = [OUTPUT_DIR / "audio", OUTPUT_DIR, *EXTERNAL_OUTPUT_DIRS, INPUT_DIR, TEMP_DIR]
    elif kind == "image":
        search_dirs = [INPUT_DIR, OUTPUT_DIR / "image", OUTPUT_DIR, *EXTERNAL_OUTPUT_DIRS, TEMP_DIR]

    search_dirs = _dedupe_paths(search_dirs)

    candidates: list[Path] = []
    p = Path(rel)
    if p.is_absolute():
        candidates.append(p)
    else:
        candidates.append(BASE_DIR / rel)
        for root in search_dirs:
            candidates.append(root / rel)
            if basename:
                candidates.append(root / basename)

    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        if candidate.exists() and candidate.is_file():
            return candidate

    raise FileNotFoundError(f"File not found: {file_ref}")


def _build_output_item(filename: str, subfolder: str, media_type: str, out_type: str = "output") -> Dict[str, Any]:
    return {
        "filename": filename,
        "subfolder": subfolder,
        "type": out_type,
        "media_type": media_type,
    }


def _sync_workflow_input_images_to_comfy_input(workflow: Dict[str, Any]) -> None:
    try:
        COMFY_INPUT_DIR.mkdir(parents=True, exist_ok=True)
    except Exception:
        return

    if not isinstance(workflow, dict):
        return

    for node in workflow.values():
        if not isinstance(node, dict):
            continue
        if str(node.get("class_type", "")) != "LoadImage":
            continue
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        image_value = inputs.get("image")
        if not isinstance(image_value, str) or not image_value.strip():
            continue

        raw_name = image_value.strip()
        safe_name = _safe_name(raw_name)
        # Prefer generated outputs first (e.g. CONTINUE/FLF intermediate images),
        # then fall back to uploaded inputs.
        source = _find_existing_media_file(safe_name, "", "output")
        if source is None:
            source = _find_existing_media_file(safe_name, "", "input")
        if source is None:
            source = REF_IMAGES_DIR / safe_name
            if not source.exists() or not source.is_file():
                source = None
        if source is None:
            continue

        target = COMFY_INPUT_DIR / safe_name
        if source.resolve() != target.resolve():
            shutil.copy2(source, target)
        inputs["image"] = safe_name


def _run_ffmpeg(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or "ffmpeg failed")


def _extract_last_frame_from_video(video_path: Path, output_dir: Path) -> str:
    output_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_name = f"last_frame_{ts}_{uuid.uuid4().hex[:6]}.png"
    output_path = output_dir / output_name
    cmd = [
        "ffmpeg", "-y",
        "-sseof", "-0.1",
        "-i", str(video_path),
        "-update", "1",
        "-q:v", "2",
        str(output_path),
    ]
    _run_ffmpeg(cmd)
    if not output_path.exists():
        raise RuntimeError("Failed to extract last frame")
    return output_name


def _clean_prompt_line(s: str) -> str:
    """Remove leading '#N:' double-numbering and markdown **Bold:** headers from a prompt line."""
    # Strip leading '#N:' or 'N:' that some models echo back inside the body
    s = re.sub(r"^#?\d+\s*[:.)\uff1a]\s*", "", s.strip())
    # Strip **Foreground:** / **Camera behavior:** style markdown headers, keep only the value after
    s = re.sub(r"\*{1,2}[^*]+\*{1,2}\s*:?\s*", "", s)
    return s.strip()


def _parse_numbered_prompts(text: str, desired_count: Optional[int] = None) -> list[Dict[str, Any]]:
    # Pre-process: insert newline before any inline #N: markers so they are on their own line
    text = re.sub(r"\s+(#\d+\s*[:.)\uff1a])", r"\n\1", str(text or ""))
    prompts: list[Dict[str, Any]] = []
    current_num: Optional[int] = None
    current_text = ""
    for line in str(text or "").splitlines():
        match = re.match(r"^(?:#|Scene\s*|Prompt\s*)?(\d+)\s*[:\.\)：]\s*(.*)$", line.strip(), re.IGNORECASE)
        if match:
            if current_num is not None and current_text.strip():
                prompts.append({"scene": current_num, "prompt": current_text.strip()})
            current_num = int(match.group(1))
            current_text = _clean_prompt_line(match.group(2))
        elif current_num is not None and line.strip():
            cleaned = _clean_prompt_line(line.strip())
            if cleaned:
                current_text = f"{current_text} {cleaned}".strip()
    if current_num is not None and current_text.strip():
        prompts.append({"scene": current_num, "prompt": current_text.strip()})
    if not prompts:
        raw = str(text or "").strip()
        if raw:
            paragraphs = [p.strip() for p in re.split(r"\n\s*\n+", raw) if p and p.strip()]
            if paragraphs:
                if desired_count and desired_count > 0:
                    paragraphs = paragraphs[:desired_count]
                prompts = [{"scene": i + 1, "prompt": para} for i, para in enumerate(paragraphs)]
            else:
                prompts.append({"scene": 1, "prompt": raw})

    if desired_count and desired_count > 0 and prompts:
        prompts = prompts[:desired_count]
        while len(prompts) < desired_count:
            fallback = prompts[-1]["prompt"] if prompts else ""
            prompts.append({"scene": len(prompts) + 1, "prompt": fallback})

    prompts.sort(key=lambda x: int(x.get("scene", 0)))
    return prompts


def _parse_genre_tags_response(text: str) -> tuple[str, str]:
    genre = ""
    tags = ""
    for line in str(text or "").splitlines():
        s = line.strip()
        if s.upper().startswith("GENRE:"):
            genre = s[6:].strip()
        elif s.upper().startswith("TAGS:"):
            tags = s[5:].strip()
    return genre, tags


def _normalize_caption_tags(tags_text: str) -> str:
    raw = str(tags_text or "").strip()
    if not raw:
        return ""

    tokens = [t.strip() for t in raw.split(",") if t and t.strip()]
    if not tokens:
        return ""

    banned_patterns = [
        r"\b\d{2,3}\s*bpm\b",
        r"\btempo\b",
        r"\b(?:2/4|3/4|4/4|5/4|6/8|7/8)\b",
        r"\btime\s*signature\b",
        r"\bkey\s*(?:of)?\s*[A-G](?:#|b)?\b",
        r"^[A-G](?:#|b)?\s*(major|minor)$",
    ]

    contradiction_groups = [
        {"bright", "dark"},
        {"uplifting", "sad"},
        {"happy", "melancholic"},
        {"energetic", "calm"},
        {"warm", "cold"},
    ]

    dedup: list[str] = []
    seen: set[str] = set()
    for token in tokens:
        low = token.lower()
        if any(re.search(pat, low, re.IGNORECASE) for pat in banned_patterns):
            continue
        if low in seen:
            continue
        seen.add(low)
        dedup.append(token)

    filtered = dedup
    for group in contradiction_groups:
        selected: list[str] = []
        kept_one = False
        for token in filtered:
            low = token.lower()
            if low in group:
                if kept_one:
                    continue
                kept_one = True
            selected.append(token)
        filtered = selected

    return ", ".join(filtered[:14])


def _fallback_genre_tags_from_lyrics(lyrics: str) -> tuple[str, str]:
    text = str(lyrics or "").lower()

    genre_keywords: list[tuple[str, set[str]]] = [
        ("rock", {"guitar", "drum", "band", "distortion", "scream", "ロック", "ギター", "ドラム"}),
        ("electronic", {"synth", "neon", "digital", "edm", "club", "electro", "シンセ", "電子"}),
        ("hip-hop", {"rap", "flow", "beat", "street", "hiphop", "ヒップホップ", "ラップ"}),
        ("folk", {"acoustic", "campfire", "story", "旅", "木漏れ日", "アコースティック"}),
        ("ballad", {"tears", "lonely", "memory", "promise", "涙", "孤独", "記憶", "約束"}),
        ("pop", {"dream", "light", "smile", "dance", "future", "希望", "光", "笑顔"}),
    ]

    mood_tags: list[tuple[str, set[str]]] = [
        ("uplifting", {"hope", "bright", "sunrise", "未来", "希望", "光", "夜明け"}),
        ("emotional", {"heart", "tears", "memory", "心", "涙", "想い", "記憶"}),
        ("melancholic", {"lonely", "rain", "farewell", "孤独", "雨", "別れ"}),
        ("energetic", {"run", "jump", "burn", "疾走", "駆け", "燃える"}),
        ("calm", {"breeze", "quiet", "gentle", "静か", "そよ風", "やさしい"}),
    ]

    score: dict[str, int] = {}
    for genre, keys in genre_keywords:
        score[genre] = sum(1 for keyword in keys if keyword in text)

    ranked = sorted(score.items(), key=lambda item: item[1], reverse=True)
    primary = ranked[0][0] if ranked and ranked[0][1] > 0 else "pop"
    secondary = ranked[1][0] if len(ranked) > 1 and ranked[1][1] > 0 and ranked[1][0] != primary else None

    tags: list[str] = []
    for tag, keys in mood_tags:
        if any(keyword in text for keyword in keys):
            tags.append(tag)

    if any(k in text for k in ["piano", "ピアノ"]):
        tags.append("piano")
    if any(k in text for k in ["guitar", "ギター"]):
        tags.append("guitar")
    if any(k in text for k in ["night", "moon", "夜", "月"]):
        tags.append("night")
    if any(k in text for k in ["sky", "star", "空", "星"]):
        tags.append("cinematic")

    if not tags:
        tags = ["emotional", "cinematic", "warm"]

    # keep order + dedup
    seen: set[str] = set()
    ordered = []
    for tag in tags:
        low = tag.lower().strip()
        if not low or low in seen:
            continue
        seen.add(low)
        ordered.append(tag)

    genre = primary if not secondary else f"{primary}, {secondary}"
    return genre, _normalize_caption_tags(", ".join(ordered))


def _split_text_units(text: str) -> list[str]:
    raw = str(text or "").strip()
    if not raw:
        return []
    units = [line.strip() for line in raw.splitlines() if line and line.strip()]
    if len(units) >= 2:
        cleaned: list[str] = []
        for unit in units:
            cleaned.append(re.sub(r"^#?\d+\s*[:：\.)-]?\s*", "", unit).strip())
        return [u for u in cleaned if u]
    parts = [p.strip() for p in re.split(r"[。！？.!?]+", raw) if p and p.strip()]
    return parts if parts else [raw]


def _fallback_prompt_generate(
    user_prompt: str,
    scene_count: int,
    output_type: str,
    complexity: str,
    translation_mode: bool,
) -> tuple[list[Dict[str, Any]], str]:
    count = max(1, min(24, int(scene_count or 1)))
    source_units = _split_text_units(user_prompt)
    if not source_units:
        source_units = ["A coherent visual scene with clear subject and environment"]

    has_japanese = bool(re.search(r"[\u3040-\u30FF\u4E00-\u9FFF]", str(user_prompt or "")))

    def pad_to_count(units: list[str], n: int) -> list[str]:
        if not units:
            return []
        out = list(units[:n])
        while len(out) < n:
            out.append(units[len(out) % len(units)])
        return out

    if translation_mode:
        translated = pad_to_count(source_units, count)
        prompts = [{"scene": i + 1, "prompt": translated[i]} for i in range(count)]
        return prompts, "fallback: translation passthrough"

    style_suffix_en = {
        "basic": "Clear composition, coherent lighting, practical details.",
        "standard": "Add richer scene detail, motion continuity, and camera framing cues.",
        "rich": "Include foreground/midground/background behavior, camera path, and atmosphere evolution.",
    }.get((complexity or "basic").strip().lower(), "Clear composition and coherent detail.")
    style_suffix_ja = {
        "basic": "構図を明確にし、ライティングと質感を自然に統一。",
        "standard": "ディテールを増やし、動きとカメラのつながりを明確化。",
        "rich": "前景・中景・背景の振る舞い、カメラ動線、空気感の変化まで具体化。",
    }.get((complexity or "basic").strip().lower(), "構図とディテールを自然に統一。")

    target = (output_type or "video").strip().lower()
    base = pad_to_count(source_units, count)
    prompts: list[Dict[str, Any]] = []
    for idx in range(count):
        text = base[idx]
        if target == "video_frame":
            if has_japanese:
                text = f"静止開始フレーム: {text}。{style_suffix_ja}"
            else:
                text = f"Static starting frame: {text}. {style_suffix_en}"
        elif target == "flf_sequence":
            if has_japanese:
                text = f"キーフレーム{idx + 1}: {text}。前後フレームとの連続性を保つ。{style_suffix_ja}"
            else:
                text = f"Keyframe {idx + 1}: {text}. Keep continuity with adjacent frames. {style_suffix_en}"
        elif target == "image":
            if has_japanese:
                text = f"画像プロンプト: {text}。{style_suffix_ja}"
            else:
                text = f"Image prompt: {text}. {style_suffix_en}"
        else:
            if has_japanese:
                text = f"動画シーン{idx + 1}: {text}。{style_suffix_ja}"
            else:
                text = f"Video scene {idx + 1}: {text}. {style_suffix_en}"
        prompts.append({"scene": idx + 1, "prompt": text})

    return prompts, "fallback: rule-based prompt generation"


def _fallback_lyrics_generate(
    scenario: str,
    genre: str,
    language: str,
    target_duration: Optional[int],
) -> tuple[str, int, Dict[str, Any]]:
    lang = str(language or "English").lower()
    duration = int(target_duration) if target_duration is not None else 60
    duration = max(20, min(300, duration))

    parts: Dict[str, Any] = {
        "intro": max(4, round(duration * 0.08)),
        "verse1": max(10, round(duration * 0.28)),
        "chorus1": max(10, round(duration * 0.28)),
        "verse2": max(8, round(duration * 0.22)),
        "outro": max(4, duration - (max(4, round(duration * 0.08)) + max(10, round(duration * 0.28)) + max(10, round(duration * 0.28)) + max(8, round(duration * 0.22)))),
    }

    theme = str(scenario or "A hopeful journey").strip()
    mood = str(genre or "pop").strip() or "pop"

    if "japanese" in lang or lang in {"ja", "jp", "日本語"}:
        lyrics_body = "\n".join([
            "[intro]",
            "[inst]",
            "",
            "[verse]",
            f"{theme} を胸に、静かに歩き出す",
            "夜を越えて、光のほうへ",
            "揺れる鼓動が、道しるべになる",
            "",
            "[chorus]",
            "君と描く未来を信じて",
            "何度でも歌う、この想いを",
            "涙のあとに、朝はくるから",
            "希望の空へ、飛び立とう",
            "",
            "[outro]",
            "[inst]",
        ])
    elif "chinese" in lang or lang in {"zh", "中文"}:
        lyrics_body = "\n".join([
            "[intro]",
            "[inst]",
            "",
            "[verse]",
            f"带着 {theme} 的心愿慢慢前行",
            "穿过黑夜，迎向晨光",
            "心跳像灯火，照亮方向",
            "",
            "[chorus]",
            "我相信我们描绘的未来",
            "把所有思念唱成勇气",
            "风雨之后总会有晴天",
            "向着希望的天空飞去",
            "",
            "[outro]",
            "[inst]",
        ])
    else:
        lyrics_body = "\n".join([
            "[intro]",
            "[inst]",
            "",
            "[verse]",
            f"With {theme} in my chest, I take the first step",
            "Through the night, I move toward the light",
            "Every heartbeat draws a clearer road",
            "",
            "[chorus]",
            "I believe in the future we can write",
            "I sing this feeling into open skies",
            "After the rain, a brighter dawn arrives",
            "We rise, we rise, we rise",
            "",
            "[outro]",
            "[inst]",
        ])

    _ = mood
    return lyrics_body, duration, parts


def _fallback_prompt_expand(prompt: str, output_type: str, target_workflow: str) -> str:
    raw = str(prompt or "").strip()
    if not raw:
        return ""
    target = str(output_type or "image").strip().lower()
    wf = str(target_workflow or "auto").strip()
    if target == "video":
        return f"{raw}. Cinematic continuity, clear subject motion, stable composition, practical camera direction. [workflow={wf}]"
    return f"{raw}. High-detail visual composition, coherent lighting, clean subject-background separation. [workflow={wf}]"


def _fallback_translate_text(text: str, target_lang: str) -> str:
    src = str(text or "")
    if not src.strip():
        return ""

    # Minimal phrase-level maps for graceful offline behavior.
    ja_to_en = {
        "こんにちは": "hello",
        "ありがとう": "thank you",
        "さようなら": "goodbye",
        "おはよう": "good morning",
        "こんばんは": "good evening",
        "希望": "hope",
        "光": "light",
        "夜": "night",
        "朝": "morning",
        "空": "sky",
        "心": "heart",
    }
    en_to_ja = {
        "hello": "こんにちは",
        "thank you": "ありがとう",
        "goodbye": "さようなら",
        "good morning": "おはよう",
        "good evening": "こんばんは",
        "hope": "希望",
        "light": "光",
        "night": "夜",
        "morning": "朝",
        "sky": "空",
        "heart": "心",
    }

    out = src
    if str(target_lang or "").lower() == "en":
        for ja, en in sorted(ja_to_en.items(), key=lambda item: len(item[0]), reverse=True):
            out = out.replace(ja, en)
        out = out.replace("、", ", ").replace("。", ". ")
        out = re.sub(r"\s+", " ", out).strip()
    else:
        # lower-case matching for predictable replacement without heavy NLP.
        lowered = out.lower()
        for en, ja in sorted(en_to_ja.items(), key=lambda item: len(item[0]), reverse=True):
            lowered = lowered.replace(en, ja)
        out = lowered.replace(",", "、").replace(".", "。")
        out = re.sub(r"\s+", " ", out).strip()

    # If no effective conversion happened, return the original text to avoid breaking UX.
    return out if out else src


def _fallback_vlm_description(image_base64: str, mode: str, language: str, focus_area: Optional[str] = None) -> str:
    raw = str(image_base64 or "")
    mime = "image"
    est_size = 0

    m = re.match(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.*)$", raw, re.DOTALL)
    if m:
        mime = m.group(1)
        b64 = m.group(2)
    else:
        b64 = raw

    try:
        est_size = len(base64.b64decode(b64, validate=False))
    except Exception:
        est_size = 0

    focus_note = f" Focus area: {focus_area.strip()}." if focus_area and str(focus_area).strip() else ""
    mode_norm = str(mode or "image").strip().lower()
    lang_norm = str(language or "en").strip().lower()

    if mode_norm == "video":
        desc_en = (
            f"Detailed {mime} reference (about {est_size} bytes). "
            "Generate a coherent cinematic scene with stable subject identity, clear foreground/midground/background structure, "
            "and practical camera direction (slow push-in or lateral tracking)."
            f"{focus_note}"
        )
        desc_ja = (
            f"{mime} 参照画像（約{est_size}バイト）を基にした動画向け説明。"
            "被写体の一貫性を保ち、前景・中景・背景を分けて、ゆるやかなカメラ移動で自然なシーンを構成してください。"
            f"{focus_note}"
        )
    else:
        desc_en = (
            f"Detailed {mime} reference (about {est_size} bytes). "
            "Generate a high-quality still image prompt with clear subject, composition, lighting direction, and mood consistency."
            f"{focus_note}"
        )
        desc_ja = (
            f"{mime} 参照画像（約{est_size}バイト）を基にした静止画向け説明。"
            "主題、構図、光の向き、雰囲気の一貫性がわかる高品質プロンプトを生成してください。"
            f"{focus_note}"
        )

    return desc_ja if lang_norm.startswith("ja") else desc_en


def _parse_lyrics_response(raw_response: str) -> tuple[Optional[int], Optional[Dict[str, Any]], str]:
    recommended: Optional[int] = None
    parts: Optional[Dict[str, Any]] = None
    lyrics = str(raw_response or "").strip()

    code_match = re.search(r"```(?:json)?\s*\n?(\{.*?\})\s*\n?```", lyrics, re.DOTALL)
    if code_match:
        json_str = code_match.group(1).strip()
        try:
            meta = json.loads(json_str)
            if isinstance(meta, dict):
                if meta.get("recommended_duration") is not None:
                    recommended = int(meta.get("recommended_duration"))
                if isinstance(meta.get("parts"), dict):
                    parts = meta.get("parts")
                lyrics = re.sub(r"```(?:json)?\s*\n?\{.*?\}\s*\n?```", "", lyrics, count=1, flags=re.DOTALL).strip()
        except Exception:
            pass
    else:
        first_line = lyrics.splitlines()[0].strip() if lyrics else ""
        if first_line.startswith("{"):
            try:
                meta = json.loads(first_line)
                if isinstance(meta, dict):
                    if meta.get("recommended_duration") is not None:
                        recommended = int(meta.get("recommended_duration"))
                    if isinstance(meta.get("parts"), dict):
                        parts = meta.get("parts")
                    lyrics = "\n".join(lyrics.splitlines()[1:]).strip()
            except Exception:
                pass

    lyrics = re.sub(r"^```\w*\n?", "", lyrics)
    lyrics = re.sub(r"\n?```$", "", lyrics).strip()
    return recommended, parts, lyrics


def _generate_spec(
    mode: str,
    scenario: str,
    lyrics: str,
    scene_prompts: List[str],
    scene_durations_sec: List[float],
    target_duration_sec: Optional[float],
    language: str,
) -> Dict[str, Any]:
    def clean_lines(text: str) -> List[str]:
        lines = [str(x or "").strip() for x in str(text or "").split("\n")]
        out: List[str] = []
        for line in lines:
            if not line:
                continue
            if re.match(r"^\[[^\]]+\]$", line):
                continue
            line = re.sub(r"^#\d+\s*[:：]?\s*", "", line).strip()
            if line:
                out.append(line)
        return out

    def normalize_durations(values: List[float]) -> List[int]:
        out: List[int] = []
        for value in values or []:
            try:
                n = int(round(float(value)))
            except Exception:
                continue
            out.append(max(1, min(30, n)))
        return out

    def build_curve(count: int) -> List[str]:
        if count <= 0:
            return []
        if count == 1:
            return ["steady"]
        labels: List[str] = []
        for i in range(count):
            t = i / max(1, count - 1)
            if t < 0.25:
                labels.append("intro")
            elif t < 0.6:
                labels.append("build")
            elif t < 0.9:
                labels.append("peak")
            else:
                labels.append("resolve")
        return labels

    scene_units = clean_lines("\n".join(scene_prompts or []))
    lyrics_units = clean_lines(lyrics)
    durations = normalize_durations(scene_durations_sec)

    if mode == "m2v":
        count = len(durations) or max(1, len(scene_units) or 3)
        base_units = lyrics_units or scene_units or ["cinematic scene with coherent action and mood"]
        beats = [base_units[i % len(base_units)] for i in range(count)]
        return {
            "spec_type": "music_to_video_spec",
            "story_summary": (str(scenario or "").strip() or "music-driven visual narrative")[:500],
            "scene_beats": beats,
            "scene_durations_sec": durations if durations else [5] * count,
            "mood_curve": build_curve(count),
            "characters": [],
            "locations": clean_lines(scenario)[:3],
            "actions": lyrics_units[:6],
            "visual_motifs": beats[:5],
            "tempo_hint": None,
            "target_duration_sec": float(target_duration_sec) if target_duration_sec else None,
            "language": language,
        }

    beats = scene_units or clean_lines(scenario) or ["scene-consistent mood progression"]
    return {
        "spec_type": "video_to_music_spec",
        "story_summary": (str(scenario or "").strip() or "video-driven musical narrative")[:500],
        "scene_beats": beats,
        "emotion_curve": build_curve(len(beats)),
        "keywords_keep": [b[:64] for b in beats[:6]],
        "avoid_tokens": [
            "masterpiece", "best quality", "8k", "ultra detailed",
            "camera angle", "wide shot", "close-up", "lens", "fps",
        ],
        "target_duration_sec": float(target_duration_sec) if target_duration_sec else None,
        "language": language,
    }


async def execute_utility_job(job: Job) -> Dict[str, Any]:
    req = UtilityRequest(**job.request_payload)
    workflow = str(req.workflow or "").strip().lower()

    if workflow == "extract_last_frame":
        if not req.video:
            raise RuntimeError("extract_last_frame requires 'video'")
        await job_manager.update(job, progress=0.2, message="Resolving input video")
        video_path = await asyncio.to_thread(_resolve_media_path, req.video, "video")
        await job_manager.update(job, progress=0.5, message="Extracting last frame")
        out_name = await asyncio.to_thread(_extract_last_frame_from_video, video_path, INPUT_DIR)
        return {"outputs": [_build_output_item(out_name, "", "image", "input")]}

    if workflow == "video_concat":
        videos = req.videos or []
        if len(videos) < 2:
            raise RuntimeError("video_concat requires at least 2 videos")
        await job_manager.update(job, progress=0.15, message=f"Resolving {len(videos)} videos")
        video_paths = [await asyncio.to_thread(_resolve_media_path, item, "video") for item in videos]
        OUTPUT_DIR.joinpath("video").mkdir(parents=True, exist_ok=True)
        list_path = OUTPUT_DIR / "video" / f"concat_{job.job_id}.txt"
        content = "".join([f"file '{str(p)}'\n" for p in video_paths])
        list_path.write_text(content, encoding="utf-8")

        fps = int(req.fps or 16)
        out_name = f"concat_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp4"
        out_path = OUTPUT_DIR / "video" / out_name
        await job_manager.update(job, progress=0.45, message="Running ffmpeg concat")
        cmd = [
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0",
            "-i", str(list_path),
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-r", str(max(1, fps)),
            "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        ]
        if req.keep_audio is False:
            cmd += ["-an"]
        else:
            cmd += ["-c:a", "aac", "-b:a", "128k"]
        cmd.append(str(out_path))
        try:
            await asyncio.to_thread(_run_ffmpeg, cmd)
        finally:
            list_path.unlink(missing_ok=True)
        return {"outputs": [_build_output_item(out_name, "video", "video")]}

    if workflow == "video_audio_merge":
        if not req.video or not req.audio:
            raise RuntimeError("video_audio_merge requires 'video' and 'audio'")
        await job_manager.update(job, progress=0.2, message="Resolving media files")
        video_path = await asyncio.to_thread(_resolve_media_path, req.video, "video")
        audio_path = await asyncio.to_thread(_resolve_media_path, req.audio, "audio")
        OUTPUT_DIR.joinpath("movie").mkdir(parents=True, exist_ok=True)
        out_name = f"merged_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp4"
        out_path = OUTPUT_DIR / "movie" / out_name
        await job_manager.update(job, progress=0.55, message="Merging video and audio")
        cmd = [
            "ffmpeg", "-y",
            "-i", str(video_path),
            "-i", str(audio_path),
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            "-c:a", "aac", "-b:a", "192k",
            "-map", "0:v:0", "-map", "1:a:0", "-shortest",
            str(out_path),
        ]
        await asyncio.to_thread(_run_ffmpeg, cmd)
        return {"outputs": [_build_output_item(out_name, "movie", "video")]}

    if workflow == "prompt_generate":
        if not req.user_prompt:
            raise RuntimeError("prompt_generate requires 'user_prompt'")
        scene_count = max(1, min(24, int(req.scene_count or 1)))
        await job_manager.update(job, progress=0.25, message="Calling LLM")
        client = get_openai_client()
        output_type = str(req.output_type or "video").strip().lower()
        target_workflow = str(req.target_workflow or "").strip().lower()
        complexity = str(req.prompt_complexity or "basic").strip().lower()
        if complexity not in {"basic", "standard", "rich"}:
            complexity = "basic"
        translation_mode = bool(req.translation_mode)
        motion_level = str(req.flf_motion_level or "medium").strip().lower()

        if translation_mode:
            system_role = (
                "You are a direct translator. Translate input to English only, preserving meaning exactly. "
                "Do not embellish. Output numbered lines with #N:."
            )
            user_message = (
                f"Translate the following text to English as {scene_count} line(s).\n"
                f"Text:\n{req.user_prompt}\n\nOutput format: #1:, #2:, ..."
            )
        else:
            if output_type == "flf_sequence":
                system_role = (
                    "You are a prompt engineer for FLF keyframe sequences. "
                    "Output exactly N prompts with #N:. Keep continuity across scenes."
                )
            elif output_type == "video_frame":
                system_role = (
                    "You are a prompt engineer for static starting frames. "
                    "Remove camera/motion instructions and output still-image prompts with #N:."
                )
            elif output_type == "video":
                if target_workflow.startswith("ltx2_"):
                    system_role = (
                        "You are a prompt engineer for LTX-2 video generation. "
                        "Output practical cinematic prompts, one scene per line, #N:."
                    )
                elif target_workflow.startswith("wan22_"):
                    system_role = (
                        "You are a prompt engineer for Wan2.2 video generation. "
                        "Include action, camera movement, and look details. Output #N:."
                    )
                else:
                    system_role = (
                        "You are an expert prompt engineer for AI video generation. "
                        "Output exactly N scene prompts with #N:."
                    )
            else:
                system_role = (
                    "You are a prompt engineer for AI image generation. "
                    "Output exactly N detailed prompts with #N:."
                )

            # Always enforce English output regardless of input language
            system_role += " Always write all prompts in English only, regardless of the input language."

            complexity_rules = {
                "basic": "Keep each scene concise (2-3 clear sentences).",
                "standard": "Use 4-6 coherent sentences with clearer action progression.",
                "rich": "Use 6-9 detailed sentences with explicit foreground/midground/background motion and camera behavior.",
            }

            motion_hint = ""
            if output_type == "flf_sequence":
                if motion_level in {"small", "low", "s"}:
                    motion_hint = "Use very small frame-to-frame changes for smooth interpolation."
                elif motion_level in {"large", "high", "l"}:
                    motion_hint = "Allow moderate progression while keeping identity and scene coherent."
                else:
                    motion_hint = "Use small-to-moderate incremental keyframe progression."

            user_message = (
                f"Create exactly {scene_count} prompts for output_type={output_type}.\n"
                f"User request:\n{req.user_prompt}\n\n"
                f"Complexity: {complexity}. {complexity_rules[complexity]}\n"
                f"{motion_hint}\n"
                "Output format: #1: <text>, #2: <text>, ... "
                "Plain text only. No markdown, no bold, no headers, no explanations. "
                "Each prompt on one line starting with #N:."
            )

        try:
            response = await chat_req(
                client, user_message, system_role,
                temperature=0.5, max_tokens=4500, repeat_penalty=1.15,
            )
            prompts = _parse_numbered_prompts(response, desired_count=scene_count)
            if not prompts:
                prompts, response = _fallback_prompt_generate(
                    user_prompt=str(req.user_prompt or ""),
                    scene_count=scene_count,
                    output_type=output_type,
                    complexity=complexity,
                    translation_mode=translation_mode,
                )
        except Exception as exc:
            await job_manager.update(job, progress=0.75, message="LLM unavailable; using rule-based prompts")
            prompts, fallback_note = _fallback_prompt_generate(
                user_prompt=str(req.user_prompt or ""),
                scene_count=scene_count,
                output_type=output_type,
                complexity=complexity,
                translation_mode=translation_mode,
            )
            response = f"{fallback_note}: {type(exc).__name__}: {str(exc)}"
        return {
            "prompts": prompts,
            "raw_response": response,
            "output_type": output_type,
            "scene_count": scene_count,
        }

    if workflow == "lyrics_generate":
        scenario = str(req.scenario or "").strip()
        if not scenario:
            raise RuntimeError("lyrics_generate requires 'scenario'")
        await job_manager.update(job, progress=0.25, message="Generating lyrics")
        client = get_openai_client()
        system_role = (
            "You are a professional lyricist for AI music generation (ACE-Step). "
            "Return first-line JSON metadata and then lyrics with section tags."
        )
        target_duration = int(req.lyrics_target_duration) if req.lyrics_target_duration else None
        if target_duration is not None:
            target_duration = max(5, min(300, target_duration))
        user_message = (
            f"THEME: {scenario}\n"
            f"GENRE: {str(req.genre or 'pop').strip()}\n"
            f"LANGUAGE: {str(req.language or 'English').strip()}\n"
            f"TARGET_DURATION_SECONDS: {target_duration if target_duration is not None else 'auto'}\n"
            "Output format:\n"
            "1) First line JSON: {\"recommended_duration\": <int>, \"parts\": {...}}\n"
            "2) Lyrics with [intro]/[verse]/[chorus]/[bridge]/[outro]/[inst] tags\n"
            "No explanations."
        )
        try:
            response = await chat_req(client, user_message, system_role, temperature=0.8, max_tokens=4000)
            recommended_duration, parts_timing, lyrics_text = _parse_lyrics_response(response)
            if not lyrics_text:
                lyrics_text = str(response or "").strip()
            if not lyrics_text:
                lyrics_text, rec_fb, parts_fb = _fallback_lyrics_generate(
                    scenario=scenario,
                    genre=str(req.genre or ""),
                    language=str(req.language or "English"),
                    target_duration=target_duration,
                )
                recommended_duration = rec_fb
                parts_timing = parts_fb
                response = "fallback: empty lyrics from llm"
        except Exception as exc:
            await job_manager.update(job, progress=0.75, message="LLM unavailable; using template lyrics")
            lyrics_text, rec_fb, parts_fb = _fallback_lyrics_generate(
                scenario=scenario,
                genre=str(req.genre or ""),
                language=str(req.language or "English"),
                target_duration=target_duration,
            )
            recommended_duration = rec_fb
            parts_timing = parts_fb
            response = f"fallback: {type(exc).__name__}: {str(exc)}"
        return {
            "lyrics": lyrics_text,
            "scenario": scenario,
            "genre": str(req.genre or ""),
            "language": str(req.language or "English"),
            "target_duration_sec": target_duration,
            "recommended_duration": recommended_duration if recommended_duration is not None else target_duration,
            "parts_timing": parts_timing,
            "raw_response": response,
        }

    if workflow == "lyrics_to_tags":
        lyrics = str(req.lyrics or "").strip()
        if not lyrics:
            raise RuntimeError("lyrics_to_tags requires 'lyrics'")
        await job_manager.update(job, progress=0.25, message="Analyzing lyrics")
        client = get_openai_client()
        system_role = (
            "You are a music genre and style expert. "
            "Output exactly:\nGENRE: ...\nTAGS: ..."
        )

        try:
            response = await chat_req(
                client,
                f"Analyze these lyrics and suggest genre/tags:\n\n{lyrics[:2000]}",
                system_role,
                temperature=0.3,
                max_tokens=1000,
            )
            genre, tags = _parse_genre_tags_response(response)
            tags = _normalize_caption_tags(tags)
            if not genre:
                genre = "pop"
            if not tags:
                _genre_fb, tags_fb = _fallback_genre_tags_from_lyrics(lyrics)
                tags = tags_fb
            return {"genre": genre, "tags": tags, "raw_response": response}
        except Exception as exc:
            await job_manager.update(job, progress=0.75, message="LLM unavailable; using rule-based tags")
            genre, tags = _fallback_genre_tags_from_lyrics(lyrics)
            return {
                "genre": genre,
                "tags": tags,
                "raw_response": f"fallback: {type(exc).__name__}: {str(exc)}",
            }

    if workflow == "spec_generate":
        mode = str(req.spec_mode or "m2v").strip().lower()
        await job_manager.update(job, progress=0.35, message=f"Generating {mode} spec")
        spec = _generate_spec(
            mode=mode,
            scenario=str(req.scenario or ""),
            lyrics=str(req.lyrics or ""),
            scene_prompts=list(req.scene_prompts or []),
            scene_durations_sec=list(req.scene_durations_sec or []),
            target_duration_sec=req.target_duration_sec,
            language=str(req.language or "English"),
        )
        return {"mode": mode, "spec": spec}

    if workflow == "prompt_expand":
        prompt = str(req.prompt or "").strip()
        if not prompt:
            raise RuntimeError("prompt_expand requires 'prompt'")
        await job_manager.update(job, progress=0.25, message="Expanding prompt")
        client = get_openai_client()
        output_type = str(req.output_type or "image").strip().lower()
        target_workflow = str(req.target_workflow or "").strip()
        system_role = (
            "You expand user prompts into richer practical prompts while preserving all explicit references/tokens. "
            "Do not remove or rename special tokens like image1/movie1/audio1/ref1/Picture 1."
        )
        user_message = (
            f"Expand the following {output_type} prompt with concrete visual details while preserving intent.\n"
            f"Target workflow: {target_workflow or 'auto'}\n\n"
            f"{prompt}"
        )
        try:
            expanded = await chat_req(client, user_message, system_role, temperature=0.55, max_tokens=2200)
            expanded_text = str(expanded or "").strip()
            if not expanded_text:
                expanded_text = _fallback_prompt_expand(prompt, output_type, target_workflow)
            return {"expanded_prompt": expanded_text, "output_type": output_type}
        except Exception as exc:
            await job_manager.update(job, progress=0.75, message="LLM unavailable; using deterministic expansion")
            expanded_text = _fallback_prompt_expand(prompt, output_type, target_workflow)
            return {
                "expanded_prompt": expanded_text,
                "output_type": output_type,
                "raw_response": f"fallback: {type(exc).__name__}: {str(exc)}",
            }

    raise RuntimeError(f"Unknown utility workflow: {workflow}")


app = FastAPI(title="Simple Video Standalone + API", version="0.2.0")

# Allow cross-origin requests (needed for VS Code port forwarding, reverse proxies, etc.)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def disable_browser_cache(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@app.on_event("startup")
async def on_startup() -> None:
    INPUT_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    REF_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    await job_manager.start()


def _safe_name(filename: str) -> str:
    raw = Path(str(filename or "upload.bin")).name
    raw = raw.replace("..", "_").replace("/", "_").replace("\\", "_")
    return raw or "upload.bin"


def _read_ref_index() -> Dict[str, Dict[str, Any]]:
    if not REF_IMAGES_INDEX.exists():
        return {}
    try:
        return json.loads(REF_IMAGES_INDEX.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_ref_index(data: Dict[str, Dict[str, Any]]) -> None:
    REF_IMAGES_INDEX.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "ok": True,
        "mode": "single-node-single-user",
        "comfyui_server": COMFYUI_SERVER,
        "comfyui_dir": str(_comfyui_dir) if _comfyui_dir else "(not detected)",
        "comfy_input_dir": str(COMFY_INPUT_DIR),
        "comfy_output_dir": str(COMFY_OUTPUT_DIR),
        "workflows_dir": str(WORKFLOWS_DIR),
    }


@app.post("/api/v1/generate")
async def generate(request: WorkflowRequest) -> Dict[str, Any]:
    job_id = str(uuid.uuid4())
    workflow_name = request.workflow if isinstance(request.workflow, str) else "inline-json"
    job = Job(job_id=job_id, workflow=str(workflow_name), request_payload=request.model_dump())
    await job_manager.add_job(job)
    return job.snapshot()


@app.get("/api/v1/status/{job_id}")
async def get_status(job_id: str) -> Dict[str, Any]:
    job = await job_manager.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job.snapshot()


@app.get("/api/v1/jobs/{job_id}")
async def get_job(job_id: str) -> Dict[str, Any]:
    return await get_status(job_id)


@app.delete("/api/v1/jobs/{job_id}")
async def cancel_job(job_id: str) -> Dict[str, Any]:
    job = await job_manager.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    status = str(job.status)
    if status == "queued":
        await job_manager.update(job, status="cancelled", message="Cancelled", progress=0.0)
        return {"job_id": job_id, "status": "cancelled", "message": "Job cancelled"}
    if status == "processing":
        raise HTTPException(status_code=400, detail="Job is processing; use interrupt endpoint")

    return {"job_id": job_id, "status": status, "message": f"Job already {status}"}


@app.post("/api/v1/jobs/{job_id}/interrupt")
async def interrupt_job(job_id: str) -> Dict[str, Any]:
    job = await job_manager.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    status = str(job.status or "")
    if status in {"completed", "failed", "cancelled"}:
        return {"job_id": job_id, "status": status, "message": f"Job already {status}"}

    await _interrupt_comfyui(job.prompt_id)
    await job_manager.update(job, status="cancelled", message="Interrupted", progress=0.0)
    return {"job_id": job_id, "status": "cancelled", "message": "Interrupt requested"}


@app.post("/api/v1/interrupt")
async def interrupt_active_jobs() -> Dict[str, Any]:
    jobs = list(job_manager.jobs.values())
    processing_jobs = [job for job in jobs if str(job.status or "") == "processing"]

    if not processing_jobs:
        await _interrupt_comfyui(None)
        return {"status": "ok", "interrupted_jobs": [], "message": "No processing jobs"}

    interrupted_ids: list[str] = []
    for job in processing_jobs:
        await _interrupt_comfyui(job.prompt_id)
        await job_manager.update(job, status="cancelled", message="Interrupted", progress=0.0)
        interrupted_ids.append(str(job.job_id))

    return {"status": "ok", "interrupted_jobs": interrupted_ids, "message": "Interrupt requested"}


@app.get("/api/v1/outputs/{job_id}")
async def get_outputs(job_id: str) -> Dict[str, Any]:
    job = await job_manager.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    outputs = list((job.result or {}).get("outputs", []))
    for item in outputs:
        filename = str(item.get("filename") or "")
        subfolder = str(item.get("subfolder") or "")
        path = f"{subfolder}/{filename}" if subfolder else filename
        item["download_url"] = f"/api/v1/download/{job_id}/{path}"
    return {"job_id": job_id, "status": job.status, "outputs": outputs}


@app.get("/api/v1/download/{job_id}/{filename:path}")
async def download(job_id: str, filename: str):
    req_basename = Path(filename).name
    req_subfolder = str(Path(filename).parent).strip(".")

    job = await job_manager.get(job_id)
    if not job:
        # Startup/state-restore compatibility:
        # if old job_id is not in memory but file still exists, serve by filename.
        fallback_path = _find_existing_media_file(req_basename, req_subfolder, "output")
        if fallback_path is None:
            fallback_path = _find_existing_media_file(req_basename, "", "output")
        if fallback_path is None:
            raise HTTPException(status_code=404, detail="Job not found")
        media_type, _ = mimetypes.guess_type(str(fallback_path))
        return FileResponse(path=str(fallback_path), filename=fallback_path.name, media_type=media_type or "application/octet-stream")

    outputs = list((job.result or {}).get("outputs", []))

    selected: Optional[Dict[str, Any]] = None
    for item in outputs:
        if str(item.get("filename") or "") != req_basename:
            continue
        subfolder = str(item.get("subfolder") or "")
        if req_subfolder and subfolder != req_subfolder:
            continue
        selected = item
        break

    if not selected:
        # Be permissive for restored UI state where output metadata may be missing.
        file_path = _find_existing_media_file(req_basename, req_subfolder, "output")
        if file_path is None:
            file_path = _find_existing_media_file(req_basename, "", "output")
        if file_path is None:
            raise HTTPException(status_code=404, detail="Output file not found in job outputs")
        media_type, _ = mimetypes.guess_type(str(file_path))
        return FileResponse(path=str(file_path), filename=file_path.name, media_type=media_type or "application/octet-stream")

    subfolder = str(selected.get("subfolder") or "")
    item_type = str(selected.get("type") or "output")
    file_path = _find_existing_media_file(req_basename, subfolder, item_type)
    if file_path is None:
        raise HTTPException(status_code=404, detail=f"File not found on disk: {req_basename}")

    # Keep standalone outputs under simple_video_app/output even if source came from legacy/comfy dirs.
    local_target = OUTPUT_DIR / subfolder / req_basename if subfolder else OUTPUT_DIR / req_basename
    local_target.parent.mkdir(parents=True, exist_ok=True)
    if file_path.resolve() != local_target.resolve():
        shutil.copy2(file_path, local_target)
        file_path = local_target

    media_type, _ = mimetypes.guess_type(str(file_path))
    return FileResponse(path=str(file_path), filename=file_path.name, media_type=media_type or "application/octet-stream")


@app.post("/api/v1/utility")
async def utility(request: UtilityRequest):
    workflow = str(request.workflow or "").strip().lower()
    supported = {
        "video_concat",
        "video_audio_merge",
        "prompt_generate",
        "lyrics_generate",
        "lyrics_to_tags",
        "spec_generate",
        "extract_last_frame",
        "prompt_expand",
    }
    if workflow not in supported:
        raise HTTPException(status_code=400, detail=f"Unknown utility workflow: {workflow}")

    job_id = str(uuid.uuid4())
    job = Job(
        job_id=job_id,
        workflow=f"utility:{workflow}",
        request_payload=request.model_dump(),
    )
    await job_manager.add_job(job)
    return job.snapshot()


@app.post("/api/v1/translate", response_model=TranslateResponse)
async def translate(request: TranslateRequest):
    text = str(request.text or "")
    has_japanese = bool(re.search(r"[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]", text))

    if request.target_language == "auto":
        source_lang = "ja" if has_japanese else "en"
        target_lang = "en" if has_japanese else "ja"
    else:
        source_lang = "ja" if has_japanese else "en"
        target_lang = str(request.target_language or "en").lower()

    if target_lang == "en":
        system_prompt = (
            "You are a translator. Output ONLY the translated text in English. "
            "No explanations, no notes, no preamble, no markdown. Just the translation."
        )
        user_prompt = f"Translate to English (output translation only):\n{text}"
    else:
        system_prompt = (
            "You are a translator. Output ONLY the translated text in Japanese. "
            "No explanations, no notes, no preamble, no markdown. Just the translation."
        )
        user_prompt = f"Translate to Japanese (output translation only):\n{text}"

    try:
        client = get_openai_client()
        translated_text = (await chat_req(
            client, user_prompt, system_prompt,
            temperature=0.3, max_tokens=1500, repeat_penalty=1.15,
        )).strip()
        # Strip trailing notes/disclaimers that some reasoning models append
        translated_text = re.sub(
            r"\s*\(Note:[^)]*\)\s*$", "", translated_text, flags=re.IGNORECASE
        ).strip()
        translated_text = re.sub(
            r"\s*Note:\s*.+$", "", translated_text, flags=re.IGNORECASE | re.MULTILINE
        ).strip()
        if not translated_text:
            translated_text = _fallback_translate_text(text, target_lang)
    except Exception:
        translated_text = _fallback_translate_text(text, target_lang)

    return TranslateResponse(
        original_text=text,
        translated_text=translated_text,
        source_language=source_lang,
        target_language=target_lang,
    )


@app.post("/api/v1/vlm/analyze", response_model=VLMAnalyzeResponse)
async def vlm_analyze(request: VLMAnalyzeRequest):
    started = time.time()
    try:
        client = get_vlm_client()
        focus_instruction = ""
        if request.focus_area and request.focus_area.strip():
            focus_instruction = f"\n\nPay extra attention to: {request.focus_area.strip()}"

        if str(request.mode or "image").strip().lower() == "video":
            system_role = "You are an expert video prompt generator from image analysis."
            base_prompt = "Analyze the image and generate a detailed video prompt in English."
        else:
            system_role = "You are an expert image prompt generator from image analysis."
            base_prompt = "Analyze the image and generate a detailed image prompt in English."

        user_prompt = str(request.custom_prompt or (base_prompt + focus_instruction))
        description = await vlm_req(
            client=client,
            user_msg=user_prompt,
            image_base64=request.image_base64,
            role=system_role,
            model=VLM_MODEL,
            max_tokens=2048,
            temperature=0.3,
        )
        elapsed = time.time() - started
        description_text = str(description or "").strip()
        if not description_text:
            description_text = _fallback_vlm_description(
                image_base64=request.image_base64,
                mode=request.mode,
                language=request.language,
                focus_area=request.focus_area,
            )
        return VLMAnalyzeResponse(
            success=True,
            description=description_text,
            mode=request.mode,
            language=request.language,
            elapsed_time=round(elapsed, 2),
        )
    except Exception as exc:
        elapsed = time.time() - started
        fallback_description = _fallback_vlm_description(
            image_base64=request.image_base64,
            mode=request.mode,
            language=request.language,
            focus_area=request.focus_area,
        )
        return VLMAnalyzeResponse(
            success=True,
            description=f"{fallback_description}\n\n[fallback reason: {type(exc).__name__}: {str(exc)}]",
            mode=request.mode,
            language=request.language,
            elapsed_time=round(elapsed, 2),
        )


@app.post("/api/v1/upload")
async def upload_file(file: UploadFile = File(...), client_session_id: Optional[str] = Form(None)):
    _ = client_session_id
    safe = _safe_name(file.filename or "upload.bin")
    stem = Path(safe).stem
    suffix = Path(safe).suffix
    unique = f"{stem}_{int(time.time())}_{uuid.uuid4().hex[:6]}{suffix}"
    out = INPUT_DIR / unique
    content = await file.read()
    out.write_bytes(content)
    return {
        "success": True,
        "filename": unique,
        "size": len(content),
        "path": str(out),
    }


@app.post("/api/v1/upload/base64")
async def upload_file_base64(request: UploadBase64Request):
    _ = request.client_session_id
    safe = _safe_name(request.filename or "upload.bin")
    stem = Path(safe).stem
    suffix = Path(safe).suffix
    unique = f"{stem}_{int(time.time())}_{uuid.uuid4().hex[:6]}{suffix}"
    out = INPUT_DIR / unique

    raw = str(request.data_base64 or "")
    if not raw:
        raise HTTPException(status_code=400, detail="data_base64 is required")

    # Accept either plain base64 or data URL format: data:<mime>;base64,<payload>
    if "," in raw and raw.strip().lower().startswith("data:"):
        raw = raw.split(",", 1)[1]

    try:
        content = base64.b64decode(raw, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 payload")

    out.write_bytes(content)
    return {
        "success": True,
        "filename": unique,
        "size": len(content),
        "path": str(out),
        "via": "base64",
    }


@app.get("/api/v1/auth-check")
def auth_check(next: Optional[str] = None):
    target = str(next or "/").strip()
    # Prevent open redirect: only allow app-local absolute paths.
    if not target.startswith("/"):
        target = "/"
    return RedirectResponse(url=target, status_code=302)


@app.get("/api/v1/files/{filename:path}")
async def get_file(filename: str):
    safe = filename.strip("/")
    search = _dedupe_paths([
        INPUT_DIR / safe,
        OUTPUT_DIR / safe,
        *[(root / safe) for root in EXTERNAL_OUTPUT_DIRS],
        OUTPUT_DIR / "video" / safe,
        OUTPUT_DIR / "movie" / safe,
        OUTPUT_DIR / "audio" / safe,
        OUTPUT_DIR / "image" / safe,
        TEMP_DIR / safe,
    ])
    for path in search:
        if path.exists() and path.is_file():
            media_type, _ = mimetypes.guess_type(str(path))
            return FileResponse(path=str(path), media_type=media_type or "application/octet-stream", filename=path.name)
    raise HTTPException(status_code=404, detail=f"File not found: {filename}")


@app.get("/api/v1/output-files")
async def list_output_files(
    media_type: str = "all",
    sort_by: str = "mtime",
    sort_order: str = "desc",
    offset: int = 0,
    limit: int = 200,
):
    wanted = str(media_type or "all").strip().lower()
    if wanted not in {"all", "image", "video", "audio", "other", "movie"}:
        raise HTTPException(status_code=400, detail=f"Unsupported media_type: {media_type}")

    key = str(sort_by or "mtime").strip().lower()
    if key not in {"mtime", "name", "size"}:
        key = "mtime"

    desc = str(sort_order or "desc").strip().lower() != "asc"
    safe_offset = max(0, int(offset or 0))
    safe_limit = max(1, min(int(limit or 200), 1000))

    items: List[Dict[str, Any]] = []
    if OUTPUT_DIR.exists() and OUTPUT_DIR.is_dir():
        for path in OUTPUT_DIR.rglob("*"):
            if not path.is_file():
                continue
            detected = _classify_output_media_type(path)
            stat = path.stat()
            rel = path.relative_to(OUTPUT_DIR).as_posix()
            subfolder = str(Path(rel).parent).strip(".")
            if subfolder == ".":
                subfolder = ""

            if wanted == "movie":
                if detected != "video" or subfolder != "movie":
                    continue
            elif wanted != "all" and detected != wanted:
                continue

            items.append(
                {
                    "path": rel,
                    "filename": path.name,
                    "subfolder": subfolder,
                    "media_type": detected,
                    "size": int(stat.st_size),
                    "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "file_url": f"/api/v1/files/{rel}",
                }
            )

    if key == "name":
        items.sort(key=lambda x: str(x.get("path") or "").lower(), reverse=desc)
    elif key == "size":
        items.sort(key=lambda x: int(x.get("size") or 0), reverse=desc)
    else:
        items.sort(key=lambda x: str(x.get("modified_at") or ""), reverse=desc)

    total = len(items)
    sliced = items[safe_offset : safe_offset + safe_limit]

    return {
        "files": sliced,
        "total": total,
        "offset": safe_offset,
        "limit": safe_limit,
        "has_more": (safe_offset + len(sliced)) < total,
    }


@app.delete("/api/v1/output-files/{file_path:path}")
async def delete_output_file(file_path: str):
    target = _resolve_output_file_from_relative_path(file_path)
    if target is None:
        raise HTTPException(status_code=404, detail=f"Output file not found: {file_path}")

    target.unlink(missing_ok=True)

    root = OUTPUT_DIR.resolve()
    parent = target.parent
    while parent != root:
        try:
            parent.rmdir()
        except OSError:
            break
        parent = parent.parent

    return {"success": True, "deleted": file_path}


@app.delete("/api/v1/output-files")
async def delete_output_files(req: OutputFilesDeleteRequest):
    files = [str(v).strip() for v in (req.files or []) if str(v).strip()]
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    deleted: List[str] = []
    not_found: List[str] = []

    for rel in files:
        target = _resolve_output_file_from_relative_path(rel)
        if target is None:
            not_found.append(rel)
            continue
        target.unlink(missing_ok=True)
        deleted.append(rel)

    root = OUTPUT_DIR.resolve()
    for rel in deleted:
        current = (OUTPUT_DIR / rel).resolve().parent
        while current != root:
            try:
                current.rmdir()
            except OSError:
                break
            current = current.parent

    return {
        "success": True,
        "deleted": deleted,
        "deleted_count": len(deleted),
        "not_found": not_found,
        "not_found_count": len(not_found),
    }


@app.get("/view")
async def view_file(request: Request, filename: str, subfolder: str = "", type: str = "output"):
    _ = request
    safe_name = _safe_name(filename)
    safe_sub = subfolder.strip("/")
    path = _find_existing_media_file(safe_name, safe_sub, type)
    if path is None:
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")
    media_type, _ = mimetypes.guess_type(str(path))
    return FileResponse(path=str(path), media_type=media_type or "application/octet-stream")


@app.get("/api/v1/simple-video/state")
async def get_simple_video_state(client_session_id: Optional[str] = None, session_mode: Optional[str] = None):
    _ = client_session_id
    _ = session_mode
    if not STATE_FILE.exists():
        return {"success": True, "state": None}
    try:
        payload = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        payload = {}
    state = payload.get("state") if isinstance(payload, dict) else None
    return {"success": True, "state": state, "updated_at": payload.get("updated_at")}


@app.post("/api/v1/simple-video/state")
async def save_simple_video_state(req: SimpleVideoStateRequest):
    _ = req.client_session_id
    _ = req.session_mode
    wrapped = {
        "updated_at": time.time(),
        "state": req.state if isinstance(req.state, dict) else {},
    }
    STATE_FILE.write_text(json.dumps(wrapped, ensure_ascii=False), encoding="utf-8")
    return {"success": True, "updated_at": wrapped["updated_at"]}


@app.get("/api/v1/ref-images")
async def list_ref_images(client_session_id: Optional[str] = None, session_mode: Optional[str] = None):
    _ = client_session_id
    _ = session_mode
    idx = _read_ref_index()
    items = []
    for name, data in idx.items():
        if not isinstance(data, dict):
            continue
        items.append(
            {
                "name": name,
                "token": f"@{name}",
                "filename": data.get("filename"),
                "original_filename": data.get("original_filename") or data.get("filename"),
                "created_at": data.get("created_at"),
                "preview_url": f"/api/v1/ref-images/file/{name}",
            }
        )
    return {"success": True, "items": items}


@app.post("/api/v1/ref-images")
async def register_ref_image(
    name: str = Form(...),
    client_session_id: Optional[str] = Form(None),
    session_mode: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    filename: Optional[str] = Form(None),
    original_filename: Optional[str] = Form(None),
):
    _ = client_session_id
    _ = session_mode
    normalized_name = name.strip().lstrip("@")
    if not normalized_name:
        raise HTTPException(status_code=400, detail="name is required")

    stored_name: Optional[str] = None
    orig_name: Optional[str] = original_filename

    if file is not None:
        safe = _safe_name(file.filename or "ref_image.png")
        stem = Path(safe).stem
        suffix = Path(safe).suffix
        stored_name = f"{stem}_{uuid.uuid4().hex[:8]}{suffix}"
        out = REF_IMAGES_DIR / stored_name
        out.write_bytes(await file.read())
        if not orig_name:
            orig_name = file.filename or stored_name
    else:
        if not filename:
            raise HTTPException(status_code=400, detail="Either file or filename is required")
        candidate = INPUT_DIR / _safe_name(filename)
        if not candidate.exists():
            resolved = _find_existing_media_file(_safe_name(filename), "", "output")
            candidate = resolved if resolved is not None else OUTPUT_DIR / _safe_name(filename)
        if not candidate.exists():
            raise HTTPException(status_code=404, detail=f"Source file not found: {filename}")
        stored_name = f"{candidate.stem}_{uuid.uuid4().hex[:8]}{candidate.suffix}"
        out = REF_IMAGES_DIR / stored_name
        out.write_bytes(candidate.read_bytes())
        if not orig_name:
            orig_name = filename

    idx = _read_ref_index()
    idx[normalized_name] = {
        "filename": stored_name,
        "original_filename": orig_name or stored_name,
        "created_at": time.time(),
    }
    _write_ref_index(idx)

    return {
        "success": True,
        "name": normalized_name,
        "token": f"@{normalized_name}",
        "filename": stored_name,
        "original_filename": orig_name or stored_name,
        "preview_url": f"/api/v1/ref-images/file/{normalized_name}",
    }


@app.delete("/api/v1/ref-images/{name}")
async def delete_ref_image(name: str, client_session_id: Optional[str] = None, session_mode: Optional[str] = None):
    _ = client_session_id
    _ = session_mode
    normalized_name = name.strip().lstrip("@")
    idx = _read_ref_index()
    if normalized_name not in idx:
        return {"success": True, "name": normalized_name}
    idx.pop(normalized_name, None)
    _write_ref_index(idx)
    return {"success": True, "name": normalized_name}


@app.get("/api/v1/ref-images/file/{name}")
async def ref_image_file(name: str, client_session_id: Optional[str] = None):
    _ = client_session_id
    normalized_name = name.strip().lstrip("@")
    idx = _read_ref_index()
    row = idx.get(normalized_name)
    if not isinstance(row, dict):
        raise HTTPException(status_code=404, detail=f"Unknown ref image: {normalized_name}")
    filename = str(row.get("filename") or "").strip()
    if not filename:
        raise HTTPException(status_code=404, detail="Ref image has no file")
    path = REF_IMAGES_DIR / _safe_name(filename)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail=f"Ref image file not found: {filename}")
    media_type, _ = mimetypes.guess_type(str(path))
    return FileResponse(path=str(path), media_type=media_type or "application/octet-stream", filename=path.name)


@app.websocket("/ws/jobs/{job_id}")
async def ws_job(websocket: WebSocket, job_id: str):
    await websocket.accept()
    queue_obj: asyncio.Queue = asyncio.Queue()

    job = await job_manager.subscribe(job_id, queue_obj)
    if not job:
        await websocket.send_json({"error": "Job not found"})
        await websocket.close()
        return

    await websocket.send_json(job.snapshot())

    try:
        while True:
            message = await queue_obj.get()
            await websocket.send_json(message)
            if message.get("status") in {"completed", "failed", "cancelled"}:
                break
    except WebSocketDisconnect:
        pass
    finally:
        await job_manager.unsubscribe(job, queue_obj)


@app.get("/")
def root():
    resp = FileResponse(STATIC_DIR / "index.html")
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp


@app.get("/index.html")
def index_file():
    resp = FileResponse(STATIC_DIR / "index.html")
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp


@app.get("/api/v1/simple-video/help", response_class=HTMLResponse)
def simple_video_help_index() -> str:
    rows: list[str] = []
    for key, meta in SIMPLE_VIDEO_HELP_DOCS.items():
        title = str(meta.get("title") or key)
        desc = str(meta.get("description") or "")
        rows.append(
            f'<li><a href="/api/v1/simple-video/help/{key}" target="_blank" rel="noopener">{title}</a>'
            + (f"<div style=\"font-size:12px;color:#666;margin-top:4px;\">{desc}</div>" if desc else "")
            + "</li>"
        )

    return (
        "<!doctype html><html lang='ja'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width, initial-scale=1'>"
        "<title>かんたん動画 Help</title>"
        "<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:24px;line-height:1.6;}"
        "h1{font-size:22px;margin:0 0 12px;} ul{padding-left:20px;} li{margin:12px 0;}"
        "a{font-weight:600;text-decoration:none;} a:hover{text-decoration:underline;}</style></head><body>"
        "<h1>❓ かんたん動画 Help</h1>"
        "<p>参照したいドキュメントを選択してください。</p>"
        f"<ul>{''.join(rows)}</ul>"
        "</body></html>"
    )


@app.get("/api/v1/simple-video/help/{doc_key}")
def simple_video_help_doc(doc_key: str):
    key = str(doc_key or "").strip().lower()
    meta = SIMPLE_VIDEO_HELP_DOCS.get(key)
    if not meta:
        raise HTTPException(status_code=404, detail=f"Unknown help document: {doc_key}")

    filename = str(meta.get("file") or "").strip()
    doc_path = SIMPLE_VIDEO_DOCS_DIR / filename
    if not doc_path.exists() or not doc_path.is_file():
        raise HTTPException(status_code=404, detail=f"Help document not found: {filename}")

    return FileResponse(path=str(doc_path), filename=doc_path.name, media_type="text/markdown; charset=utf-8")


app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
