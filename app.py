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

# Auto-load .env files so that Windows users (who lack start.sh) get the same
# environment variables.  python-dotenv is optional; if not installed we simply
# skip.  On Linux with start.sh the .env is already sourced by the shell, so
# calling load_dotenv() again is harmless (existing env vars take precedence).
try:
    from dotenv import load_dotenv as _load_dotenv
    _env_file = Path(__file__).resolve().parent / ".env"
    _parent_env = Path(__file__).resolve().parent.parent / ".env"
    if _env_file.is_file():
        _load_dotenv(_env_file, override=False)
    if _parent_env.is_file():
        _load_dotenv(_parent_env, override=False)
except ImportError:
    pass  # python-dotenv not installed – rely on shell/.env sourcing

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
        "file_en": "HELP_EN.md",
        "description": "画面を開いた後の基本操作（画像準備→シーン生成→動画化）",
        "title_en": "Quick Help",
        "description_en": "Basic operations after opening the app (prepare image -> generate scenes -> generate video)",
    },
    "tutorial_full": {
        "title": "チュートリアル",
        "file": "TUTORIAL_JP.md",
        "file_en": "TUTORIAL_EN.md",
        "description": "機能別の実践手順を順番に試すためのガイド",
        "title_en": "Tutorial",
        "description_en": "Step-by-step practical guide by feature",
    },
    "guide": {
        "title": "ユーザーズガイド",
        "file": "USAGE_JP.md",
        "file_en": "USAGE_EN.md",
        "description": "画面全体の使い方、運用時の確認ポイント",
        "title_en": "User Guide",
        "description_en": "Full-screen usage and operation checkpoints",
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
      3. 各階層の兄弟ディレクトリも探索
         (名前が ComfyUI* / comfyui* にマッチするものを優先チェック)
    """
    def _is_comfyui(p: Path) -> bool:
        return p.is_dir() and (
            (p / "comfyui_version.py").exists()
            or ((p / "main.py").exists() and (p / "comfy").is_dir())
        )

    env_val = str(os.environ.get("COMFYUI_DIR", "")).strip()
    if env_val:
        p = Path(env_val).expanduser()
        if p.is_dir():
            return p.resolve()

    candidate = BASE_DIR.parent
    for _ in range(8):
        # 自分自身（親ディレクトリ）を確認
        if _is_comfyui(candidate):
            return candidate.resolve()
        # 兄弟ディレクトリを探索（ComfyUI* 優先、その後全部）
        try:
            siblings = sorted(candidate.iterdir())
            named = [d for d in siblings if d.is_dir() and d.name.lower().startswith("comfyui")]
            others = [d for d in siblings if d.is_dir() and not d.name.lower().startswith("comfyui")]
            for sibling in named + others:
                if _is_comfyui(sibling):
                    return sibling.resolve()
        except PermissionError:
            pass
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
LOCAL_LLM_ENABLED = os.environ.get("SIMPLE_VIDEO_LOCAL_LLM", "").strip().lower() in ("1", "true", "yes", "on")
ACE_STEP_URL = os.environ.get("ACE_STEP_API_URL", "").strip().rstrip("/") or None
MULTI_USER = os.environ.get("SIMPLE_VIDEO_MULTI_USER", "").strip().lower() in ("1", "true", "yes", "on")

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
    "character_sheet_card_v1_0": "character_sheet_card_v1.0_api.json",
    "character_sheet_card_v1_0_nobg": "character_sheet_card_v1.0_nobg_api.json",
    "character_sheet_v1_0_nobg": "character_sheet_v1.0_nobg_api.json",
    "character_sheet_card_v1_0_rmbg_nobg": "character_sheet_card_v1.0_rmbg_nobg_api.json",
    "character_sheet_v1_0_rmbg_nobg": "character_sheet_v1.0_rmbg_nobg_api.json",
    "remove_bg_v1_0": "remove_bg_v1.0_api.json",
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
    thinking: Optional[bool] = None
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
    xfade_transition: Optional[str] = None   # e.g. 'fade', 'dissolve', 'wipeleft', etc.
    xfade_duration: Optional[float] = None   # transition duration in seconds (default 0.5)
    xfade_transitions: Optional[List[str]] = None  # per-boundary xfade types, e.g. ['none','dissolve','fadeblack','none']
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
    session_id: Optional[str] = None

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
                elif ACE_STEP_URL and str(job.workflow) == "ace_step_1_5_t2a":
                    await self.update(job, status="processing", progress=0.05, message="ACE-Step API: 準備中")
                    result = await execute_ace_step_api_job(job)
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
        # -1 means "auto" (ACE-Step API only). ComfyUI nodes require positive values.
        _dur = payload.duration if payload.duration is not None and payload.duration > 0 else 60
        params["audio_duration"] = _dur
        params["duration"] = _dur
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
    safe_sub = str(subfolder or "").strip("/\\")
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
        subfolder = str(item.get("subfolder") or "").strip("/\\")
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
    await asyncio.to_thread(_sync_workflow_input_images_to_comfy_input, workflow, job.session_id)

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


async def execute_ace_step_api_job(job: Job) -> Dict[str, Any]:
    """Execute T2A generation via ACE-Step API server instead of ComfyUI.

    When ``ACE_STEP_URL`` is set and the requested workflow is
    ``ace_step_1_5_t2a``, the job manager routes here instead of
    ``execute_generate_job``.  This function:
      1. POST /release_task  – create task
      2. POST /query_result  – poll until done
      3. Download audio to output/audio/
    Returns the same output format as ``execute_generate_job``.
    """
    payload = WorkflowRequest(**job.request_payload)
    params = dict(payload.parameters or {})

    tags = payload.tags or params.get("tags", "")
    lyrics = payload.lyrics or params.get("lyrics", "")
    language = payload.language or params.get("language", "en")
    duration_val = payload.duration or params.get("duration") or params.get("audio_duration") or 30
    bpm_val = payload.bpm or params.get("bpm")
    keyscale_val = payload.keyscale or params.get("keyscale")
    timesig_val = payload.timesignature or params.get("timesignature", "4")
    steps_val = payload.steps or params.get("steps") or 8  # Turbo default: 8, Base/SFT: 50
    cfg_val = payload.cfg or params.get("cfg") or 3.0
    seed_val = payload.seed or params.get("seed")
    thinking = payload.thinking if payload.thinking is not None else params.get("thinking", True)

    ace_payload: Dict[str, Any] = {
        "prompt": str(tags),
        "lyrics": str(lyrics),
        "thinking": bool(thinking),
        "vocal_language": str(language),
        "audio_duration": int(duration_val),
        "time_signature": str(timesig_val),
        "batch_size": 1,
        "audio_format": "mp3",
        "inference_steps": int(steps_val),
        "guidance_scale": float(cfg_val),
    }
    if bpm_val is not None:
        ace_payload["bpm"] = int(bpm_val)
    if keyscale_val is not None:
        ace_payload["key_scale"] = str(keyscale_val)
    if seed_val is not None:
        ace_payload["seed"] = int(seed_val)

    # 1. Submit task
    await job_manager.update(job, progress=0.05, message="ACE-Step API: タスク送信中")
    try:
        resp = await asyncio.to_thread(
            requests.post,
            f"{ACE_STEP_URL}/release_task",
            json=ace_payload,
            timeout=REQUEST_TIMEOUT_SEC,
        )
    except Exception as exc:
        raise RuntimeError(f"ACE-Step API 接続エラー ({ACE_STEP_URL}): {exc}") from exc
    if not resp.ok:
        raise RuntimeError(f"ACE-Step API release_task 失敗: {resp.status_code} {resp.text[:500]}")

    result_data = resp.json()
    task_id = (result_data.get("data") or {}).get("task_id", "")
    if not task_id:
        raise RuntimeError(f"ACE-Step API: task_id が返されませんでした: {result_data}")

    # 2. Poll for completion
    await job_manager.update(job, progress=0.10, message="ACE-Step API: 生成中...")
    timeout_sec = 60 * 15  # 15 min (thinking mode can be slow)
    deadline = time.time() + timeout_sec
    poll_interval = 3.0
    start_time = time.time()

    while time.time() < deadline:
        try:
            poll_resp = await asyncio.to_thread(
                requests.post,
                f"{ACE_STEP_URL}/query_result",
                json={"task_id_list": [task_id]},
                timeout=30,
            )
        except Exception:
            # Transient connection error – retry on next poll
            await asyncio.sleep(poll_interval)
            continue

        if poll_resp.ok:
            poll_data = poll_resp.json()
            data_list = poll_data.get("data", [])
            if data_list:
                task_data = data_list[0]
                status = task_data.get("status", 0)

                if status == 1:  # succeeded
                    result_json = task_data.get("result", "[]")
                    if isinstance(result_json, str):
                        results = json.loads(result_json)
                    else:
                        results = result_json

                    # Download audio files to local output/audio/
                    audio_dir = OUTPUT_DIR / "audio"
                    audio_dir.mkdir(parents=True, exist_ok=True)
                    outputs: List[Dict[str, Any]] = []
                    for r in (results if isinstance(results, list) else [results]):
                        file_path = r.get("file", "")
                        if not file_path:
                            continue
                        audio_url = f"{ACE_STEP_URL}{file_path}"
                        local_name = f"ace_step_{task_id}_{Path(file_path).name}"
                        local_path = audio_dir / local_name
                        try:
                            dl_resp = await asyncio.to_thread(requests.get, audio_url, timeout=60)
                            if dl_resp.ok:
                                local_path.write_bytes(dl_resp.content)
                                outputs.append({
                                    "filename": local_name,
                                    "subfolder": "audio",
                                    "type": "output",
                                })
                        except Exception as dl_exc:
                            print(f"[ace-step] ⚠️ 音声ダウンロード失敗: {audio_url}: {dl_exc}", file=sys.stderr)

                    if not outputs:
                        raise RuntimeError("ACE-Step API: 生成完了したがオーディオファイルを取得できませんでした")

                    return {"prompt_id": task_id, "outputs": outputs}

                elif status == 2:  # failed
                    error_msg = task_data.get("result", "Unknown error")
                    if isinstance(error_msg, (list, dict)):
                        error_msg = json.dumps(error_msg, ensure_ascii=False)[:300]
                    raise RuntimeError(f"ACE-Step API 生成失敗: {error_msg}")

        # Progress estimation
        elapsed = time.time() - start_time
        expected_duration = 600.0 if thinking else 60.0  # rough estimate
        progress = min(0.95, 0.10 + 0.85 * (elapsed / expected_duration))
        await job_manager.update(job, progress=max(job.progress, progress), message="ACE-Step API: 生成中...")
        await asyncio.sleep(poll_interval)

    raise RuntimeError("ACE-Step API: タイムアウト (15分)")


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
    rel = cleaned.strip("/\\")
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


def _sync_workflow_input_images_to_comfy_input(workflow: Dict[str, Any], session_id: Optional[str] = None) -> None:
    try:
        COMFY_INPUT_DIR.mkdir(parents=True, exist_ok=True)
    except Exception:
        return

    if not isinstance(workflow, dict):
        return

    # Determine ref_images directory (session-aware)
    ref_dir = _session_ref_images_dir(session_id)

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
            # Check session-specific ref_images first, then global
            candidate = ref_dir / safe_name
            if candidate.exists() and candidate.is_file():
                source = candidate
            elif ref_dir != REF_IMAGES_DIR:
                candidate = REF_IMAGES_DIR / safe_name
                if candidate.exists() and candidate.is_file():
                    source = candidate
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


# Regex to extract [transition=TYPE] inline tags from prompt text
_TRANSITION_TAG_RE = re.compile(r"\[transition\s*=\s*(\w+)\]\s*", re.IGNORECASE)
_VALID_TRANSITIONS = {"flf", "cut", "crossfade", "fade_black", "none"}


def _extract_transition_tag(text: str) -> tuple[str, Optional[str]]:
    """Strip [transition=TYPE] tag from text, return (clean_text, transition_or_None)."""
    m = _TRANSITION_TAG_RE.search(text)
    if not m:
        return text, None
    tag_value = m.group(1).lower()
    clean = text[:m.start()] + text[m.end():]
    return clean.strip(), tag_value if tag_value in _VALID_TRANSITIONS else None


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

    # Extract [transition=TYPE] tags from prompt text (Phase 2 support)
    for entry in prompts:
        clean_text, transition = _extract_transition_tag(entry["prompt"])
        entry["prompt"] = clean_text
        if transition:
            entry["transition"] = transition

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
    # Dimension 2: instruments
    if any(k in text for k in ["piano", "ピアノ"]):
        tags.append("piano")
    if any(k in text for k in ["guitar", "ギター"]):
        tags.append("acoustic guitar")
    if any(k in text for k in ["synth", "シンセ", "electronic", "電子"]):
        tags.append("synth")

    # Dimension 3: mood
    for tag, keys in mood_tags:
        if any(keyword in text for keyword in keys):
            tags.append(tag)

    # Dimension 5: vocal hint (detect language from lyrics text)
    has_jp = bool(re.search(r"[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]", str(lyrics or "")))
    if has_jp:
        tags.append("vocal")
    elif any(k in text for k in ["she", "her", "girl", "彼女", "女"]):
        tags.append("female vocal")
    elif any(k in text for k in ["he ", "his ", "him ", "boy", "彼", "男"]):
        tags.append("male vocal")
    else:
        tags.append("vocal")

    # Additional atmosphere
    if any(k in text for k in ["night", "moon", "夜", "月"]):
        tags.append("night atmosphere")
    if any(k in text for k in ["sky", "star", "空", "星"]):
        tags.append("cinematic")

    if not tags:
        tags = ["emotional", "cinematic", "warm", "vocal"]

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
    scene_variation: str = "normal",
    motion_level: str = "medium",
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

    variation = str(scene_variation or "normal").strip().lower()
    if variation not in {"stable", "normal", "dynamic"}:
        variation = "normal"
    motion = str(motion_level or "medium").strip().lower()

    if has_japanese:
        if variation == "stable":
            variation_suffix = "シーン間差分は最小限にし、同一被写体・同一画調・同一構図軸を維持。"
        elif variation == "dynamic":
            variation_suffix = "シーンごとの差分を明確にしつつ、被写体同一性は維持。"
        else:
            variation_suffix = "シーン間の連続性を保ちつつ自然に変化。"
    else:
        if variation == "stable":
            variation_suffix = "Keep inter-scene deltas minimal; maintain the same subject identity, visual style, and composition axis."
        elif variation == "dynamic":
            variation_suffix = "Allow clearer inter-scene variation while preserving subject identity."
        else:
            variation_suffix = "Keep continuity while allowing natural scene progression."

    target = (output_type or "video").strip().lower()
    # Treat mixed_sequence like flf_sequence for fallback prompt generation
    if target == "mixed_sequence":
        target = "flf_sequence"
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
                motion_suffix = "フレーム間の変化は極小。" if motion in {"tiny", "micro", "xs"} else ("フレーム間の変化は小さく。" if motion in {"small", "low", "s"} else ("フレーム間は中程度の変化。" if motion in {"medium", "m"} else "フレーム間は適度に大きめの変化。"))
                text = f"キーフレーム{idx + 1}: {text}。前後フレームとの連続性を保つ。{motion_suffix}{variation_suffix}{style_suffix_ja}"
            else:
                motion_suffix = "Use tiny frame-to-frame change." if motion in {"tiny", "micro", "xs"} else ("Use small frame-to-frame change." if motion in {"small", "low", "s"} else ("Use moderate frame-to-frame change." if motion in {"medium", "m"} else "Allow moderately larger frame-to-frame change."))
                text = f"Keyframe {idx + 1}: {text}. Keep continuity with adjacent frames. {motion_suffix} {variation_suffix} {style_suffix_en}"
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


def _fallback_scenario_generate(user_prompt: str, complexity: str = "standard") -> str:
    seed = str(user_prompt or "").strip()
    if not seed:
        seed = "A coherent video concept with clear mood and progression"

    level = str(complexity or "standard").strip().lower()
    if level not in {"basic", "standard", "rich"}:
        level = "standard"

    has_japanese = bool(re.search(r"[\u3040-\u30FF\u4E00-\u9FFF]", seed))
    timeline_hint = bool(re.search(
        r"(日|週|月|季節|年|昔|今|未来|これから|過去|若い頃|年を取|day|week|month|season|year|past|present|future)",
        seed,
        flags=re.IGNORECASE,
    ))

    base_count = {"basic": 4, "standard": 5, "rich": 6}[level]
    section_count = max(3, min(7, base_count + (1 if timeline_hint and level != "basic" else 0)))

    def build_section_lines(lang_ja: bool) -> list[str]:
        lines: list[str] = []
        if lang_ja:
            if timeline_hint:
                labels = ["起点", "初期", "変化", "転換", "到達", "余韻", "展望"]
                for idx in range(section_count):
                    lines.append(f"{idx + 1}) {labels[idx]}: 時間経過がわかる出来事と感情変化を記述")
            else:
                for idx in range(section_count):
                    lines.append(f"{idx + 1}) シーン{idx + 1}: 主要動作・環境・カメラ意図を記述")
        else:
            if timeline_hint:
                labels = ["Origin", "Early phase", "Shift", "Turning point", "Arrival", "Afterglow", "Outlook"]
                for idx in range(section_count):
                    lines.append(f"{idx + 1}) {labels[idx]}: describe event progression and emotional change")
            else:
                for idx in range(section_count):
                    lines.append(f"{idx + 1}) Scene {idx + 1}: describe key action, environment, and camera intent")
        return lines

    if has_japanese:
        detail_hint = {
            "basic": "要点を簡潔にまとめる。",
            "standard": "描写を具体化し、場面や時間のつながりを明確にする。",
            "rich": "視覚演出・感情の起伏・連続性を詳細に記述する。",
        }[level]
        lines = [
            f"テーマ: {seed}",
            f"方針: {detail_hint}",
            "注記: ユーザー意図を優先し、対立構造は必要な場合のみ採用する。",
            f"構成案（{section_count}パート）:",
        ]
        lines.extend(build_section_lines(True))
        lines.append("連続性メモ: 被写体の外見・衣装・主要小道具は必要に応じて統一する。")
        return "\n".join(lines)

    detail_hint = {
        "basic": "Keep it concise.",
        "standard": "Add concrete scene/time continuity and visual details.",
        "rich": "Include richer visual motifs, emotional arc, and camera rhythm.",
    }[level]
    lines = [
        f"Theme: {seed}",
        f"Direction: {detail_hint}",
        "Note: prioritize user intent; include conflict only when it fits the concept.",
        f"Outline ({section_count} parts):",
    ]
    lines.extend(build_section_lines(False))
    lines.append("Continuity note: keep identity/costume/key props consistent when required.")
    return "\n".join(lines)


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
            "[Intro]",
            "[Instrumental]",
            "",
            "[Verse 1]",
            f"{theme} を胸に、静かに歩き出す",
            "夜を越えて、光のほうへ",
            "揺れる鼓動が、道しるべになる",
            "",
            "[Chorus]",
            "君と描く未来を信じて",
            "何度でも歌う、この想いを",
            "涙のあとに、朝はくるから",
            "希望の空へ、飛び立とう",
            "",
            "[Outro]",
            "[Instrumental]",
        ])
    elif "chinese" in lang or lang in {"zh", "中文"}:
        lyrics_body = "\n".join([
            "[Intro]",
            "[Instrumental]",
            "",
            "[Verse 1]",
            f"带着 {theme} 的心愿慢慢前行",
            "穿过黑夜，迎向晨光",
            "心跳像灯火，照亮方向",
            "",
            "[Chorus]",
            "我相信我们描绘的未来",
            "把所有思念唱成勇气",
            "风雨之后总会有晴天",
            "向着希望的天空飞去",
            "",
            "[Outro]",
            "[Instrumental]",
        ])
    else:
        lyrics_body = "\n".join([
            "[Intro]",
            "[Instrumental]",
            "",
            "[Verse 1]",
            f"With {theme} in my chest, I take the first step",
            "Through the night, I move toward the light",
            "Every heartbeat draws a clearer road",
            "",
            "[Chorus]",
            "I believe in the future we can write",
            "I sing this feeling into open skies",
            "After the rain, a brighter dawn arrives",
            "We rise, we rise, we rise",
            "",
            "[Outro]",
            "[Instrumental]",
        ])

    _ = mood
    return lyrics_body, duration, parts


def _split_scenario_sentences(text: str) -> List[str]:
    raw = str(text or "").strip()
    if not raw:
        return []
    chunks = re.split(r"(?<=[。．.!?！？])\s+|\n+", raw)
    return [c.strip() for c in chunks if c and c.strip()]


async def _maybe_summarize_lyrics_scenario(
    client: AsyncOpenAI,
    scenario: str,
    language: str,
) -> tuple[str, Dict[str, Any]]:
    original = str(scenario or "").strip()
    if not original:
        return "", {
            "applied": False,
            "reason": "empty",
            "stats": {"chars": 0, "sentences": 0, "avg_sentence_chars": 0.0},
        }

    sentences = _split_scenario_sentences(original)
    chars = len(original)
    sentence_count = max(1, len(sentences))
    avg_sentence_chars = round(chars / sentence_count, 1)

    should_summarize = (
        chars >= 900
        or len(sentences) >= 12
        or (chars >= 600 and avg_sentence_chars >= 70)
        or avg_sentence_chars >= 120
    )
    if not should_summarize:
        return original, {
            "applied": False,
            "reason": "length_not_large",
            "stats": {
                "chars": chars,
                "sentences": len(sentences),
                "avg_sentence_chars": avg_sentence_chars,
            },
        }

    system_role = (
        "You are a scenario editor for lyrics generation. "
        "Summarize only when source text is long. Keep core intent, emotional arc, key scene flow, and ending image. "
        "Do not add new facts. Keep names/entities consistent."
    )
    user_message = (
        f"INPUT_LANGUAGE_HINT: {str(language or 'auto').strip()}\n"
        "Task: Summarize this scenario for lyric writing while preserving meaning.\n"
        "Constraints:\n"
        "- Keep the same language as the input text\n"
        "- Prefer 5-10 compact sentences\n"
        "- Keep: theme, emotion progression, scene progression, ending image\n"
        "- Remove repetitive details and over-specific side information\n"
        "- Plain text only, no markdown\n\n"
        f"SCENARIO:\n{original}"
    )

    try:
        response = await chat_req(client, user_message, system_role, temperature=0.2, max_tokens=1600)
        summarized = str(response or "").strip()
        summarized = re.sub(r"^```\w*\n?", "", summarized)
        summarized = re.sub(r"\n?```$", "", summarized).strip()
        if summarized and len(summarized) >= 80:
            return summarized, {
                "applied": True,
                "reason": "length_based",
                "stats": {
                    "chars": chars,
                    "sentences": len(sentences),
                    "avg_sentence_chars": avg_sentence_chars,
                    "summarized_chars": len(summarized),
                },
            }
    except Exception:
        pass

    return original, {
        "applied": False,
        "reason": "summary_failed",
        "stats": {
            "chars": chars,
            "sentences": len(sentences),
            "avg_sentence_chars": avg_sentence_chars,
        },
    }


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
    lyrics = _strip_romaji_lines(lyrics)
    return recommended, parts, lyrics


def _strip_romaji_lines(text: str) -> str:
    """Remove parenthesized romaji transliteration lines from Japanese lyrics.

    LLMs sometimes add lines like ``(Sabita tetsu no nioi ga hana o sasu)``
    after each Japanese line.  These are not singable and break ACE-Step.
    We detect them as lines that:
      - are wrapped in parentheses ``(...)``
      - contain only ASCII letters, spaces, basic punctuation, and
        common romaji tokens (no CJK / kana / hangul).
    Lines with ``[inst]``, ``[intro]``, stage directions containing
    non-romaji musical terms (e.g. ``(Piano & fading music box)``) are
    preserved by a heuristic: if the line looks like a stage/instrument
    direction (contains common music keywords) we keep it.
    """
    if not text:
        return text

    _MUSIC_DIRECTION_RE = re.compile(
        r"(?i)\b(?:guitar|bass|drum|drums|piano|synth|strings|orchestra|violin|cello|"
        r"sax|saxophone|trumpet|flute|organ|harp|bell|chime|choir|vocal|voice|"
        r"melody|riff|solo|fade|fading|intro|outro|bridge|break|clap|snap|"
        r"beat|rhythm|ambient|atmospheric|distort|acoustic|electric|music|box|"
        r"instrumental|interlude|harmonics|whistle|percussion)\b"
    )

    # A romaji line: wrapped in parens, content is purely ASCII-range
    # (latin letters, spaces, punctuation, digits — no CJK/kana/hangul).
    _ROMAJI_PAREN_RE = re.compile(
        r"^\(\s*[A-Za-z][A-Za-z0-9\s,.'\-!?ōūēāīôûêâîō]+\s*\)$"
    )

    out_lines: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            out_lines.append(line)
            continue
        if _ROMAJI_PAREN_RE.match(stripped):
            # Keep music/instrument stage directions
            if _MUSIC_DIRECTION_RE.search(stripped):
                out_lines.append(line)
            # else: drop the romaji transliteration line
        else:
            out_lines.append(line)

    result = "\n".join(out_lines)
    # Collapse 3+ consecutive blank lines into 2
    result = re.sub(r"\n{3,}", "\n\n", result)
    return result.strip()


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

        fps = int(req.fps or 16)
        out_name = f"concat_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}.mp4"
        out_path = OUTPUT_DIR / "video" / out_name

        xfade_type = (req.xfade_transition or "").strip().lower()
        xfade_dur = float(req.xfade_duration or 0.5)
        VALID_XFADE = {"fade", "dissolve", "wipeleft", "wiperight", "wipeup", "wipedown", "slideleft", "slideright", "circlecrop", "rectcrop", "distance", "fadeblack", "fadewhite", "radial", "smoothleft", "smoothright", "smoothup", "smoothdown"}

        # Per-boundary xfade types: list of transition types for each boundary (N-1 entries for N videos)
        per_boundary = req.xfade_transitions if isinstance(req.xfade_transitions, list) else None
        has_per_boundary = per_boundary and len(per_boundary) >= 1 and any(
            (t or "").strip().lower() in VALID_XFADE for t in per_boundary
        )
        # Decide if we need xfade filter_complex
        use_xfade = len(video_paths) >= 2 and (
            has_per_boundary
            or (xfade_type and xfade_type in VALID_XFADE)
        )

        print(f"[video_concat] videos={len(videos)}, xfade_type={xfade_type!r}, per_boundary={per_boundary}, has_per_boundary={has_per_boundary}, use_xfade={use_xfade}")

        if use_xfade:
            # --- xfade mode: use filter_complex to apply transitions ---
            await job_manager.update(job, progress=0.30, message=f"Probing {len(video_paths)} videos")

            def _probe_duration(path: Path) -> float:
                """Get video duration in seconds via ffprobe."""
                result = subprocess.run(
                    ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                     "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
                    capture_output=True, text=True
                )
                try:
                    return float(result.stdout.strip())
                except (ValueError, AttributeError):
                    return 5.0  # fallback

            durations = [await asyncio.to_thread(_probe_duration, p) for p in video_paths]
            # Clamp xfade_dur so it doesn't exceed any clip length
            min_dur = min(durations) if durations else 5.0
            xfade_dur = min(xfade_dur, min_dur * 0.8)  # at most 80% of shortest clip
            xfade_dur = max(0.1, xfade_dur)

            # Resolve per-boundary transition types
            n = len(video_paths)
            boundary_types: list[str] = []
            if has_per_boundary and per_boundary:
                for idx in range(n - 1):
                    raw = (per_boundary[idx] if idx < len(per_boundary) else "").strip().lower()
                    boundary_types.append(raw if raw in VALID_XFADE else "")
            else:
                boundary_types = [xfade_type] * (n - 1)

            xfade_label = ", ".join(set(t for t in boundary_types if t) or {xfade_type or "xfade"})
            await job_manager.update(job, progress=0.45, message=f"Running ffmpeg xfade ({xfade_label}, {xfade_dur:.1f}s)")

            inputs = []
            for p in video_paths:
                inputs += ["-i", str(p)]

            # Build xfade filter chain: apply xfade between consecutive pairs
            # For boundaries with no xfade type (empty/"none"), use a 1-frame xfade as hard cut.
            # NOTE: duration=0.001 causes ffmpeg to drop frames due to timestamp rounding issues.
            #       Using 1/fps (one frame) produces a visually imperceptible cut and correct output.
            min_xfade_dur = round(1.0 / max(1, fps), 4)  # 1 frame duration for hard cuts
            filter_parts = []
            cumulative = durations[0]
            prev_label = "[0:v]"
            for i in range(1, n):
                bt = boundary_types[i - 1] if (i - 1) < len(boundary_types) else ""
                out_label = f"[v{i}]" if i < n - 1 else "[vout]"
                if bt and bt in VALID_XFADE:
                    offset = max(0, cumulative - xfade_dur)
                    filter_parts.append(
                        f"{prev_label}[{i}:v]xfade=transition={bt}:duration={xfade_dur:.3f}:offset={offset:.3f}{out_label}"
                    )
                    cumulative = offset + durations[i]
                else:
                    # Hard cut: use 1-frame xfade (visually identical to a cut)
                    offset = max(0, cumulative - min_xfade_dur)
                    filter_parts.append(
                        f"{prev_label}[{i}:v]xfade=transition=fade:duration={min_xfade_dur:.4f}:offset={offset:.4f}{out_label}"
                    )
                    cumulative = offset + durations[i]
                prev_label = out_label

            # Audio: concat all audio streams (if available and not disabled)
            audio_filter = ""
            audio_map = []
            if req.keep_audio is not False:
                # Check if any input has audio; if not, skip audio concat to avoid ffmpeg errors
                def _has_audio(path: Path) -> bool:
                    result = subprocess.run(
                        ["ffprobe", "-v", "error", "-select_streams", "a",
                         "-show_entries", "stream=codec_type",
                         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
                        capture_output=True, text=True
                    )
                    return "audio" in (result.stdout or "")
                has_any_audio = any(await asyncio.to_thread(_has_audio, p) for p in video_paths)
                if has_any_audio:
                    a_inputs = "".join(f"[{i}:a]" for i in range(n))
                    audio_filter = f";{a_inputs}concat=n={n}:v=0:a=1[aout]"
                    audio_map = ["-map", "[aout]"]

            filter_complex = ";".join(filter_parts) + audio_filter if audio_filter else ";".join(filter_parts)

            print(f"[video_concat] filter_complex={filter_complex}")
            print(f"[video_concat] boundary_types={boundary_types}, durations={durations}")

            cmd = [
                "ffmpeg", "-y",
                *inputs,
                "-filter_complex", filter_complex,
                "-map", "[vout]",
                *audio_map,
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-r", str(max(1, fps)),
                "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            ]
            if req.keep_audio is False:
                cmd += ["-an"]
            elif audio_map:
                cmd += ["-c:a", "aac", "-b:a", "128k"]
            cmd.append(str(out_path))
            await asyncio.to_thread(_run_ffmpeg, cmd)
        else:
            # --- Standard concat mode (no xfade) ---
            list_path = OUTPUT_DIR / "video" / f"concat_{job.job_id}.txt"
            content = "".join([f"file '{p.as_posix()}'\n" for p in video_paths])
            list_path.write_text(content, encoding="utf-8")

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
        out_name = f"merged_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}.mp4"
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

    if workflow == "scenario_generate":
        if not req.user_prompt:
            raise RuntimeError("scenario_generate requires 'user_prompt'")
        await job_manager.update(job, progress=0.25, message="Generating scenario/world setting")

        complexity = str(req.prompt_complexity or "standard").strip().lower()
        if complexity not in {"basic", "standard", "rich"}:
            complexity = "standard"
        scene_variation = str(req.scene_variation or "normal").strip().lower()
        if scene_variation not in {"stable", "normal", "dynamic"}:
            scene_variation = "normal"

        system_role = (
            "You are a scenario writer for AI video generation. "
            "Expand a short user idea into a practical, scene-consistent scenario text for downstream prompt generation. "
            "Respect user intent and do not force a fixed template. "
            "Keep the same language as the user's input. "
            "Do not invent named characters, age, profession, or biography unless explicitly provided by the user. "
            "Do not override or replace the user's intended main subject. "
            "Output plain text only. No markdown, no extra explanations."
        )
        user_message = (
            "Expand the following short idea into a detailed scenario/world setting.\n"
            "Use a flexible structure. If the input implies a timeline (past->present->future, days/weeks/months/years, seasons), "
            "organize by time phases. Otherwise, organize by scenes.\n"
            "Section count should be adaptive (typically 4-7, but choose what best fits the idea).\n"
            "Include only relevant elements among: world setting, key subjects, relationships, tension/conflict (optional), visual tone, progression.\n"
            "Keep it practical for scene prompt generation: avoid overlong biography blocks and avoid adding unrelated lore.\n"
            f"Detail level: {complexity}.\n"
            f"Scene variation preference: {scene_variation} (stable=minimal inter-scene change, normal=balanced, dynamic=larger change).\n"
            f"Idea:\n{str(req.user_prompt or '').strip()}"
        )

        try:
            client = get_openai_client()
            response = await chat_req(
                client, user_message, system_role,
                temperature=0.5, max_tokens=2200, repeat_penalty=1.12,
            )
            scenario_text = str(response or "").strip()
            scenario_text = re.sub(r"^```\w*\n?", "", scenario_text)
            scenario_text = re.sub(r"\n?```$", "", scenario_text).strip()
            if not scenario_text:
                scenario_text = _fallback_scenario_generate(str(req.user_prompt or ""), complexity)
        except Exception as exc:
            scenario_text = _fallback_scenario_generate(str(req.user_prompt or ""), complexity)
            response = f"fallback: {type(exc).__name__}: {str(exc)}"

        return {
            "scenario": scenario_text,
            "raw_response": response,
            "complexity": complexity,
            "scene_variation": scene_variation,
        }

    if workflow == "prompt_generate":
        if not req.user_prompt:
            raise RuntimeError("prompt_generate requires 'user_prompt'")
        scene_count = max(1, min(24, int(req.scene_count or 1)))
        await job_manager.update(job, progress=0.25, message="Calling LLM")
        client = get_openai_client()
        output_type = str(req.output_type or "video").strip().lower()
        target_workflow = str(req.target_workflow or "").strip().lower()
        complexity = str(req.prompt_complexity or "standard").strip().lower()
        if complexity not in {"basic", "standard", "rich"}:
            complexity = "standard"
        translation_mode = bool(req.translation_mode)
        motion_level = str(req.flf_motion_level or "medium").strip().lower()
        scene_variation = str(req.scene_variation or "normal").strip().lower()
        if scene_variation not in {"stable", "normal", "dynamic"}:
            scene_variation = "normal"

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
                    "You are a prompt engineer for FLF keyframe sequences with scene transition control. "
                    "Output exactly N prompts with #N:. Keep strict continuity across scenes. "
                    "For each scene, specify the recommended transition type from the PREVIOUS scene "
                    "using an inline tag at the start: [transition=TYPE]. "
                    "Valid transition types: "
                    "flf = smooth First-Last-Frame transition (use for continuous action, same location), "
                    "cut = hard cut (use for dramatic scene change, time skip, location change), "
                    "crossfade = gradual blend (use for mood shift, dream sequence), "
                    "fade_black = fade through black (use for time passage, act break). "
                    "Scene #1 always uses [transition=none] (it is the first scene)."
                )
            elif output_type == "mixed_sequence":
                system_role = (
                    "You are an expert video editor choosing transition types between scenes. "
                    "Output exactly N prompts with #N:. "
                    "CRITICAL: You MUST choose DIVERSE transition types based on scene relationships. "
                    "Do NOT default to all-flf. Analyze the narrative context between each pair of adjacent scenes. "
                    "For each scene, add [transition=TYPE] at the start of the line. "
                    "Rules for choosing transitions: "
                    "- flf: ONLY when scenes share the same location AND continuous action (e.g. character continues walking in same room). "
                    "- cut: When there is a clear scene change, different location, or time skip. This is the most common transition in real films. "
                    "- crossfade: For mood shifts, flashback/dream sequences, or emotional transitions. "
                    "- fade_black: For major time passage, act breaks, or dramatic pauses. "
                    "- none: Only for scene #1. "
                    "A typical 5-scene video should have 2-3 different transition types. "
                    "Scene #1 always uses [transition=none]."
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
                "basic": "Keep each scene concise (2-3 clear sentences) while preserving subject identity.",
                "standard": "Use 4-6 coherent sentences with explicit action progression, camera movement, and scene continuity.",
                "rich": "Use 6-9 detailed sentences with foreground/midground/background motion layers, camera rhythm, lighting transitions, and continuity locks.",
            }

            video_structure_hint = (
                "For each scene, include these aspects in natural prose: "
                "subject identity (consistent), environment/time/weather, key action, camera direction, "
                "lighting/color mood, texture/style keywords, and continuity note from previous scene. "
                "Avoid logos, subtitles, watermark text, broken anatomy, and abrupt identity changes. "
                "Use ONE full-frame composition per scene only. "
                "Never use split-screen, collage, diptych/triptych, comic-panel, storyboard grid, or multi-panel layout. "
                "Avoid montage-like packed descriptions that imply multiple simultaneous subframes. "
                "Keep exactly one primary instance of the main subject in each frame unless the user explicitly requests a crowd/group. "
                "Do not duplicate or clone the same character in one frame."
            )

            image_structure_hint = (
                "For each scene, include: subject, composition, environment, lighting direction, color palette, "
                "material/texture, and mood. Keep identity and costume consistent if scenes are related. "
                "Single full-frame image only; no split-screen/collage/comic-panel/multi-panel composition. "
                "Exactly one primary subject instance per frame unless group composition is explicitly requested; avoid cloned duplicates."
            )

            motion_hint = ""
            if output_type in {"flf_sequence", "mixed_sequence"}:
                if motion_level in {"tiny", "micro", "xs"}:
                    motion_hint = "Use tiny frame-to-frame changes with near-static progression."
                elif motion_level in {"small", "low", "s"}:
                    motion_hint = "Use very small frame-to-frame changes for smooth interpolation."
                elif motion_level in {"large", "high", "l"}:
                    motion_hint = "Allow moderate progression while keeping identity and scene coherent."
                else:
                    motion_hint = "Use small-to-moderate incremental keyframe progression."

            variation_hint = {
                "stable": "Keep inter-scene changes minimal. Preserve same subject identity, framing axis, and look across adjacent prompts.",
                "normal": "Keep balanced scene progression with continuity.",
                "dynamic": "Allow larger inter-scene differences while preserving identity continuity.",
            }[scene_variation]

            user_message = (
                f"Create exactly {scene_count} prompts for output_type={output_type}.\n"
                f"User request:\n{req.user_prompt}\n\n"
                f"Complexity: {complexity}. {complexity_rules[complexity]}\n"
                f"Guidance: {(video_structure_hint if output_type in {'video', 'flf_sequence', 'mixed_sequence'} else image_structure_hint)}\n"
                f"Variation preference: {variation_hint}\n"
                f"{motion_hint}\n"
                "Output format: #1: [transition=none] <text>, #2: [transition=TYPE] <text>, ... "
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
                    scene_variation=scene_variation,
                    motion_level=motion_level,
                )
        except Exception as exc:
            await job_manager.update(job, progress=0.75, message="LLM unavailable; using rule-based prompts")
            prompts, fallback_note = _fallback_prompt_generate(
                user_prompt=str(req.user_prompt or ""),
                scene_count=scene_count,
                output_type=output_type,
                complexity=complexity,
                translation_mode=translation_mode,
                scene_variation=scene_variation,
                motion_level=motion_level,
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
        await job_manager.update(job, progress=0.33, message="Checking scenario length")
        scenario_for_lyrics, scenario_summary_meta = await _maybe_summarize_lyrics_scenario(
            client=client,
            scenario=scenario,
            language=str(req.language or "English"),
        )
        system_role = (
            "You are a professional lyricist for AI music generation (ACE-Step 1.5). "
            "You understand ACE-Step section tags and vocal control tags deeply.\n"
            "Return first-line JSON metadata and then lyrics with section tags."
        )
        target_duration = int(req.lyrics_target_duration) if req.lyrics_target_duration else None
        if target_duration is not None:
            target_duration = max(5, min(300, target_duration))
        lyrics_lang = str(req.language or 'English').strip()
        # Word-count guideline based on ACE-Step docs (English: ~2-3 words/sec, Japanese: fewer chars)
        is_ja = lyrics_lang.lower() in {'ja', 'jp', 'japanese', '日本語'}
        is_zh = lyrics_lang.lower() in {'zh', 'chinese', '中文'}
        if target_duration is not None:
            if is_ja:
                word_hint = f"Aim for roughly {max(20, round(target_duration * 1.0))}–{max(40, round(target_duration * 1.7))} characters of Japanese lyrics (excluding section tags)."
            elif is_zh:
                word_hint = f"Aim for roughly {max(20, round(target_duration * 1.0))}–{max(40, round(target_duration * 1.7))} characters of Chinese lyrics (excluding section tags)."
            else:
                word_hint = f"Aim for roughly {max(40, round(target_duration * 2.0))}–{max(70, round(target_duration * 3.0))} English words (excluding section tags)."
        else:
            word_hint = "Adjust lyrics length to fit the recommended duration."
        user_message = (
            f"THEME: {scenario_for_lyrics}\n"
            f"GENRE: {str(req.genre or 'pop').strip()}\n"
            f"LANGUAGE: {lyrics_lang}\n"
            f"TARGET_DURATION_SECONDS: {target_duration if target_duration is not None else 'auto'}\n"
            f"{word_hint}\n"
            "\n"
            "=== OUTPUT FORMAT ===\n"
            "1) First line JSON: {\"recommended_duration\": <int>, \"parts\": {...}}\n"
            "2) Lyrics with section tags (see rules below)\n"
            "\n"
            "=== SECTION TAG RULES (ACE-Step 1.5) ===\n"
            "- Use capitalized tags: [Intro], [Verse 1], [Verse 2], [Pre-Chorus], [Chorus], [Bridge], [Outro]\n"
            "- Use [Instrumental] for instrument-only sections (NOT [inst] or [Inst])\n"
            "- You may add a style hint with dash: [Chorus - anthemic], [Bridge - whispered]\n"
            "- Separate sections with blank lines for breathing room\n"
            "- Keep each line singable: 4-8 words (English) or 6-15 characters (Japanese) per line\n"
            "- Use (parentheses) for backing vocals/echo: 'We are the light (the light)'\n"
            "\n"
            "=== IMPORTANT ===\n"
            "- Do NOT add romaji/romanization lines. Write lyrics in the target language only.\n"
            "- For Japanese, write only Japanese text — no parenthesized romanized readings.\n"
            "- No explanations. Output JSON + lyrics only.\n"
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
            "scenario_for_lyrics": scenario_for_lyrics,
            "scenario_summary_meta": scenario_summary_meta,
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
            "You are a music style/caption expert for ACE-Step 1.5 AI music generation.\n"
            "Your task is to generate a Caption (comma-separated tags) that will be used as the \"prompt\" "
            "field when generating music with ACE-Step 1.5.\n"
            "\n"
            "Output exactly two lines:\n"
            "GENRE: <primary genre, e.g. pop / rock / jazz / electronic / ...>\n"
            "TAGS: <3-7 comma-separated tags covering the 5 dimensions below>\n"
            "\n"
            "=== 5 CAPTION DIMENSIONS (include in this order) ===\n"
            "1. Genre / Era: e.g. J-POP, 80s synth pop, jazz ballad, cinematic orchestral\n"
            "2. Key instruments: e.g. piano, acoustic guitar, synth, strings, brass\n"
            "3. Mood / adjective: e.g. emotional, uplifting, dark, dreamy, energetic\n"
            "4. Tempo feel: e.g. slow tempo, mid-tempo, fast-paced, groovy (optional if obvious)\n"
            "5. Vocal type: e.g. female vocal, male vocal, powerful, whisper, no vocals (optional)\n"
            "\n"
            "=== RULES ===\n"
            "- 3-7 tags is the sweet spot. Never exceed 10.\n"
            "- Do NOT include BPM numbers, key signatures, or time signatures in TAGS (those are set separately).\n"
            "- Avoid contradictions: don't combine 'upbeat' + 'melancholic', or 'ambient' + 'metal'.\n"
            "- Write tags in English for best ACE-Step compatibility.\n"
            "- No explanations. Output GENRE and TAGS lines only."
        )

        try:
            response = await chat_req(
                client,
                f"Analyze these lyrics and suggest the best Caption tags for ACE-Step 1.5 music generation:\n\n{lyrics[:2000]}",
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


app = FastAPI(title="Simple Video Standalone + API", version="0.95.1")

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

    # --- ローカル LLM の初期化 ---
    if LOCAL_LLM_ENABLED:
        try:
            import local_llm
            _llm_model_spec = os.environ.get("SIMPLE_VIDEO_LOCAL_LLM_MODEL", "").strip()
            if _llm_model_spec:
                local_llm.configure(_llm_model_spec)
            local_llm.load_model()
        except Exception as e:
            print(f"[local-llm] ❌ ローカル LLM の初期化に失敗しました: {e}", file=sys.stderr)
            print("[local-llm]    外部 LLM API にフォールバックします", file=sys.stderr)

    _sep = "─" * 56
    print(f"\n{_sep}")
    print("  simple_video_app  起動設定")
    print(_sep)
    print(f"  ComfyUI サーバー  : http://{COMFYUI_SERVER}")
    print(f"  ComfyUI ディレクトリ: {_comfyui_dir or '(自動検出されず)'}")
    print(f"  ComfyUI input/   : {COMFY_INPUT_DIR}")
    print(f"  ComfyUI output/  : {COMFY_OUTPUT_DIR}")
    print(_sep)
    if LOCAL_LLM_ENABLED:
        import local_llm as _llm_status
        _llm_model_name = _llm_status.MODEL_FILENAME
        _llm_label = f"✅ ローカル ({_llm_model_name})" if _llm_status.is_loaded() else "❌ ローカル (ロード失敗 → 外部 API フォールバック)"
        print(f"  LLM  (テキスト)  : {_llm_label}")
    else:
        print(f"  LLM  (テキスト)  : {OPENAI_BASE_URL}")
    print(f"  LLM  モデル       : {os.environ.get('OPENAI_CHAT_MODEL', '(env: OPENAI_CHAT_MODEL 未設定)')}")
    _vlm_url = VLM_BASE_URL if VLM_BASE_URL != OPENAI_BASE_URL else f"{VLM_BASE_URL}  (LLM と同一)"
    print(f"  VLM  (画像解析)  : {_vlm_url}")
    print(f"  VLM  モデル       : {VLM_MODEL}")
    print(_sep)
    if ACE_STEP_URL:
        print(f"  ACE-Step API     : {ACE_STEP_URL}  (thinking / AI Tag 対応)")
    else:
        print(f"  ACE-Step API     : (未設定 → ComfyUI ワークフローで T2A)")
    print(_sep)
    print(f"  ワークフロー      : {WORKFLOWS_DIR}  ({sum(1 for _ in WORKFLOWS_DIR.glob('*.json'))} 件)")
    print(f"  アプリ データ     : {APP_DATA_DIR}")
    _mu_label = "✅ ON (セッション分離有効)" if MULTI_USER else "OFF (single-user)"
    print(f"  マルチユーザー    : {_mu_label}")
    print(f"{_sep}\n")


def _safe_name(filename: str) -> str:
    raw = Path(str(filename or "upload.bin")).name
    raw = raw.replace("..", "_").replace("/", "_").replace("\\", "_")
    return raw or "upload.bin"


# ---------------------------------------------------------------------------
# Session isolation helpers
# ---------------------------------------------------------------------------

def _session_dir(session_id: Optional[str]) -> Optional[Path]:
    """Return a per-session data directory, or None if session isolation is off."""
    if not MULTI_USER:
        return None
    if not session_id or not str(session_id).strip():
        return None
    safe = re.sub(r'[^a-zA-Z0-9_-]', '', str(session_id).strip())[:64]
    if not safe:
        return None
    d = APP_DATA_DIR / "sessions" / safe
    d.mkdir(parents=True, exist_ok=True)
    return d


def _session_state_file(session_id: Optional[str]) -> Path:
    d = _session_dir(session_id)
    return (d / "state.json") if d else STATE_FILE


def _session_ref_index_path(session_id: Optional[str]) -> Path:
    d = _session_dir(session_id)
    return (d / "ref_images.json") if d else REF_IMAGES_INDEX


def _session_ref_images_dir(session_id: Optional[str]) -> Path:
    d = _session_dir(session_id)
    if d:
        rd = d / "ref_images"
        rd.mkdir(parents=True, exist_ok=True)
        return rd
    return REF_IMAGES_DIR


def _read_ref_index(session_id: Optional[str] = None) -> Dict[str, Dict[str, Any]]:
    idx_path = _session_ref_index_path(session_id)
    if not idx_path.exists():
        return {}
    try:
        return json.loads(idx_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_ref_index(data: Dict[str, Dict[str, Any]], session_id: Optional[str] = None) -> None:
    idx_path = _session_ref_index_path(session_id)
    idx_path.parent.mkdir(parents=True, exist_ok=True)
    idx_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "ok": True,
        "mode": "multi-user" if MULTI_USER else "single-node-single-user",
        "comfyui_server": COMFYUI_SERVER,
        "comfyui_dir": str(_comfyui_dir) if _comfyui_dir else "(not detected)",
        "comfy_input_dir": str(COMFY_INPUT_DIR),
        "comfy_output_dir": str(COMFY_OUTPUT_DIR),
        "workflows_dir": str(WORKFLOWS_DIR),
        "ace_step_api_url": ACE_STEP_URL or None,
    }


# =============================================================================
# ACE-Step API proxy endpoints (active only when ACE_STEP_URL is set)
# =============================================================================

class AceStepFormatInputRequest(BaseModel):
    prompt: str = ""
    lyrics: str = ""
    temperature: float = 0.85


@app.post("/api/v1/ace_step/format_input")
async def ace_step_format_input(request: AceStepFormatInputRequest) -> Dict[str, Any]:
    """Proxy to ACE-Step API /format_input for AI tag/caption enhancement."""
    if not ACE_STEP_URL:
        raise HTTPException(status_code=503, detail="ACE-Step API is not configured (--ace-step-url)")
    try:
        resp = await asyncio.to_thread(
            requests.post,
            f"{ACE_STEP_URL}/format_input",
            json={"prompt": request.prompt, "lyrics": request.lyrics, "temperature": request.temperature},
            timeout=60,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"ACE-Step API 接続エラー: {exc}")
    if not resp.ok:
        raise HTTPException(status_code=502, detail=f"ACE-Step API error: {resp.status_code} {resp.text[:500]}")
    return resp.json()


@app.get("/api/v1/ace_step/health")
async def ace_step_health() -> Dict[str, Any]:
    """Check ACE-Step API server availability."""
    if not ACE_STEP_URL:
        return {"available": False, "reason": "ACE_STEP_API_URL not configured"}
    try:
        resp = await asyncio.to_thread(requests.get, f"{ACE_STEP_URL}/health", timeout=10)
        if resp.ok:
            return {"available": True, "url": ACE_STEP_URL, "server_info": resp.json()}
        return {"available": False, "reason": f"HTTP {resp.status_code}", "url": ACE_STEP_URL}
    except Exception as exc:
        return {"available": False, "reason": str(exc), "url": ACE_STEP_URL}


@app.post("/api/v1/generate")
async def generate(request: WorkflowRequest) -> Dict[str, Any]:
    job_id = str(uuid.uuid4())
    workflow_name = request.workflow if isinstance(request.workflow, str) else "inline-json"
    session_id = getattr(request, 'client_session_id', None)
    job = Job(job_id=job_id, workflow=str(workflow_name), request_payload=request.model_dump(), session_id=session_id)
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
async def interrupt_job(job_id: str, request: Request) -> Dict[str, Any]:
    job = await job_manager.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Session protection: prevent interrupting another session's job
    if MULTI_USER and job.session_id:
        caller_sid = request.query_params.get("client_session_id") or request.cookies.get("comfyui_client_session_id")
        if caller_sid and caller_sid != job.session_id:
            raise HTTPException(status_code=403, detail="Cannot interrupt another session's job")

    status = str(job.status or "")
    if status in {"completed", "failed", "cancelled"}:
        return {"job_id": job_id, "status": status, "message": f"Job already {status}"}

    await _interrupt_comfyui(job.prompt_id)
    await job_manager.update(job, status="cancelled", message="Interrupted", progress=0.0)
    return {"job_id": job_id, "status": "cancelled", "message": "Interrupt requested"}


@app.post("/api/v1/interrupt")
async def interrupt_active_jobs(request: Request) -> Dict[str, Any]:
    caller_sid = request.query_params.get("client_session_id") or request.cookies.get("comfyui_client_session_id")
    jobs = list(job_manager.jobs.values())
    processing_jobs = [job for job in jobs if str(job.status or "") == "processing"]

    # In MULTI_USER mode, only interrupt the caller's own jobs
    if MULTI_USER and caller_sid:
        processing_jobs = [j for j in processing_jobs if j.session_id == caller_sid]

    if not processing_jobs:
        if not MULTI_USER:
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
        "scenario_generate",
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
    session_id = getattr(request, 'client_session_id', None)
    job = Job(
        job_id=job_id,
        workflow=f"utility:{workflow}",
        request_payload=request.model_dump(),
        session_id=session_id,
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
    safe = filename.strip("/\\")
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
    safe_sub = subfolder.strip("/\\")
    path = _find_existing_media_file(safe_name, safe_sub, type)
    if path is None:
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")
    media_type, _ = mimetypes.guess_type(str(path))
    return FileResponse(path=str(path), media_type=media_type or "application/octet-stream")


@app.get("/api/v1/simple-video/state")
async def get_simple_video_state(client_session_id: Optional[str] = None, session_mode: Optional[str] = None):
    _ = session_mode
    sf = _session_state_file(client_session_id)
    if not sf.exists():
        return {"success": True, "state": None}
    try:
        payload = json.loads(sf.read_text(encoding="utf-8"))
    except Exception:
        payload = {}
    state = payload.get("state") if isinstance(payload, dict) else None
    return {"success": True, "state": state, "updated_at": payload.get("updated_at")}


@app.post("/api/v1/simple-video/state")
async def save_simple_video_state(req: SimpleVideoStateRequest):
    _ = req.session_mode
    sf = _session_state_file(req.client_session_id)
    sf.parent.mkdir(parents=True, exist_ok=True)
    wrapped = {
        "updated_at": time.time(),
        "state": req.state if isinstance(req.state, dict) else {},
    }
    sf.write_text(json.dumps(wrapped, ensure_ascii=False), encoding="utf-8")
    return {"success": True, "updated_at": wrapped["updated_at"]}


@app.get("/api/v1/ref-images")
async def list_ref_images(client_session_id: Optional[str] = None, session_mode: Optional[str] = None):
    _ = session_mode
    idx = _read_ref_index(client_session_id)
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
    _ = session_mode
    ref_dir = _session_ref_images_dir(client_session_id)
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
        out = ref_dir / stored_name
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
        out = ref_dir / stored_name
        out.write_bytes(candidate.read_bytes())
        if not orig_name:
            orig_name = filename

    idx = _read_ref_index(client_session_id)
    idx[normalized_name] = {
        "filename": stored_name,
        "original_filename": orig_name or stored_name,
        "created_at": time.time(),
    }
    _write_ref_index(idx, client_session_id)

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
    _ = session_mode
    normalized_name = name.strip().lstrip("@")
    idx = _read_ref_index(client_session_id)
    if normalized_name not in idx:
        return {"success": True, "name": normalized_name}
    idx.pop(normalized_name, None)
    _write_ref_index(idx, client_session_id)
    return {"success": True, "name": normalized_name}


@app.get("/api/v1/ref-images/file/{name}")
async def ref_image_file(name: str, client_session_id: Optional[str] = None):
    ref_dir = _session_ref_images_dir(client_session_id)
    normalized_name = name.strip().lstrip("@")
    idx = _read_ref_index(client_session_id)
    row = idx.get(normalized_name)
    if not isinstance(row, dict):
        raise HTTPException(status_code=404, detail=f"Unknown ref image: {normalized_name}")
    filename = str(row.get("filename") or "").strip()
    if not filename:
        raise HTTPException(status_code=404, detail="Ref image has no file")
    path = ref_dir / _safe_name(filename)
    if not path.exists() or not path.is_file():
        # Fallback: check global ref_images dir
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
def simple_video_help_index(lang: Optional[str] = None) -> str:
    lang_code = "en" if str(lang or "").strip().lower().startswith("en") else "ja"
    rows: list[str] = []
    for key, meta in SIMPLE_VIDEO_HELP_DOCS.items():
        if key == "technical":
            continue
        title = str(meta.get("title_en") or meta.get("title") or key) if lang_code == "en" else str(meta.get("title") or key)
        desc = str(meta.get("description_en") or meta.get("description") or "") if lang_code == "en" else str(meta.get("description") or "")
        href = f"/api/v1/simple-video/help/{key}?lang={lang_code}"
        rows.append(
            f'<li><a href="{href}" target="_blank" rel="noopener">{title}</a>'
            + (f"<div style=\"font-size:12px;color:#666;margin-top:4px;\">{desc}</div>" if desc else "")
            + "</li>"
        )

    page_title = "Simple Video Help" if lang_code == "en" else "かんたん動画 Help"
    page_h1 = "❓ Simple Video Help" if lang_code == "en" else "❓ かんたん動画 Help"
    page_desc = "Select a document to open." if lang_code == "en" else "参照したいドキュメントを選択してください。"

    return (
        f"<!doctype html><html lang='{lang_code}'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width, initial-scale=1'>"
        f"<title>{page_title}</title>"
        "<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:24px;line-height:1.6;}"
        "h1{font-size:22px;margin:0 0 12px;} ul{padding-left:20px;} li{margin:12px 0;}"
        "a{font-weight:600;text-decoration:none;} a:hover{text-decoration:underline;}</style></head><body>"
        f"<h1>{page_h1}</h1>"
        f"<p>{page_desc}</p>"
        f"<ul>{''.join(rows)}</ul>"
        "</body></html>"
    )


@app.get("/api/v1/simple-video/help/{doc_key}")
def simple_video_help_doc(doc_key: str, lang: Optional[str] = None):
    key = str(doc_key or "").strip().lower()
    meta = SIMPLE_VIDEO_HELP_DOCS.get(key)
    if not meta:
        raise HTTPException(status_code=404, detail=f"Unknown help document: {doc_key}")

    lang_code = "en" if str(lang or "").strip().lower().startswith("en") else "ja"
    if lang_code == "en":
        filename = str(meta.get("file_en") or meta.get("file") or "").strip()
    else:
        filename = str(meta.get("file") or "").strip()
    doc_path = SIMPLE_VIDEO_DOCS_DIR / filename
    if not doc_path.exists() or not doc_path.is_file():
        fallback = str(meta.get("file") or "").strip()
        fallback_path = SIMPLE_VIDEO_DOCS_DIR / fallback
        if fallback and fallback_path.exists() and fallback_path.is_file():
            doc_path = fallback_path
        else:
            raise HTTPException(status_code=404, detail=f"Help document not found: {filename}")

    return FileResponse(path=str(doc_path), filename=doc_path.name, media_type="text/markdown; charset=utf-8")


# --- Dynamic config: switch image model via SIMPLE_VIDEO_IMAGE_MODEL env ---
@app.get("/js/simple_video_config.js")
def simple_video_config_js():
    model_variant = os.environ.get("SIMPLE_VIDEO_IMAGE_MODEL", "").strip()
    if model_variant == "2511":
        config_file = STATIC_DIR / "js" / "simple_video_config_2511.js"
    else:
        config_file = STATIC_DIR / "js" / "simple_video_config.js"
    if not config_file.exists():
        raise HTTPException(status_code=404, detail="Config file not found")
    resp = FileResponse(path=str(config_file), media_type="application/javascript; charset=utf-8")
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp


app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
