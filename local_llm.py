"""ローカル LLM 管理モジュール (llama-cpp-python)

--local-llm 起動オプション指定時に、gemma-3-4b-it-Q4_K_M.gguf を
自動ダウンロード＆ロードし、chat_req() から直接呼び出す。

subprocess は使わず Python プロセス内で完結するため、
Windows / Linux / macOS すべてで同じコードで動作する。
"""

from __future__ import annotations

import os
import re
import sys
import threading
from pathlib import Path
from typing import Optional
from urllib.request import urlretrieve

# ---------------------------------------------------------------------------
# 定数 / デフォルト設定
# ---------------------------------------------------------------------------

LLM_DIR = Path(__file__).resolve().parent / "llm"
MODEL_DIR = LLM_DIR / "models"

# デフォルトモデル
_DEFAULT_MODEL_FILENAME = "gemma-3-4b-it-Q4_K_M.gguf"
_DEFAULT_MODEL_URL = (
    "https://huggingface.co/unsloth/gemma-3-4b-it-GGUF"
    f"/resolve/main/{_DEFAULT_MODEL_FILENAME}"
)
_DEFAULT_MODEL_SIZE_APPROX = "2.49 GB"

# 実行時設定（configure() で上書き可能）
MODEL_FILENAME = _DEFAULT_MODEL_FILENAME
MODEL_PATH = MODEL_DIR / MODEL_FILENAME
MODEL_URL = _DEFAULT_MODEL_URL
MODEL_SIZE_APPROX = _DEFAULT_MODEL_SIZE_APPROX

DEFAULT_N_CTX = 4096
DEFAULT_N_THREADS = 4

# ---------------------------------------------------------------------------
# グローバル状態
# ---------------------------------------------------------------------------

_llm_instance = None  # type: ignore[assignment]
_lock = threading.Lock()


# ---------------------------------------------------------------------------
# モデル設定
# ---------------------------------------------------------------------------

def configure(model_spec: str | None = None) -> None:
    """使用するモデルを設定する（load_model() の前に呼ぶ）。

    model_spec の形式:
      - None / 空文字列  → デフォルトモデル (gemma-3-4b-it-Q4_K_M)
      - URL (http:// / https://)  → HuggingFace 等から自動ダウンロード
      - ローカルパス (.gguf)  → そのまま使用（ダウンロードしない）
    """
    global MODEL_FILENAME, MODEL_PATH, MODEL_URL, MODEL_SIZE_APPROX

    if not model_spec or not model_spec.strip():
        # デフォルトに戻す
        MODEL_FILENAME = _DEFAULT_MODEL_FILENAME
        MODEL_PATH = MODEL_DIR / MODEL_FILENAME
        MODEL_URL = _DEFAULT_MODEL_URL
        MODEL_SIZE_APPROX = _DEFAULT_MODEL_SIZE_APPROX
        return

    spec = model_spec.strip()

    if spec.startswith("http://") or spec.startswith("https://"):
        # URL 指定 → ファイル名を URL 末尾から取得
        MODEL_URL = spec
        MODEL_FILENAME = spec.rstrip("/").split("/")[-1].split("?")[0]
        MODEL_PATH = MODEL_DIR / MODEL_FILENAME
        MODEL_SIZE_APPROX = "(custom)"
    else:
        # ローカルファイルパス指定
        local_path = Path(spec)
        if not local_path.is_absolute():
            local_path = Path(__file__).resolve().parent / spec
        MODEL_PATH = local_path.resolve()
        MODEL_FILENAME = MODEL_PATH.name
        MODEL_URL = ""  # ダウンロード不要
        MODEL_SIZE_APPROX = "(local)"

    print(f"[local-llm] カスタムモデル設定: {MODEL_FILENAME}")


# ---------------------------------------------------------------------------
# ダウンロード
# ---------------------------------------------------------------------------

def _progress_hook(block_num: int, block_size: int, total_size: int) -> None:
    """urlretrieve 用の進捗表示コールバック"""
    downloaded = block_num * block_size
    if total_size > 0:
        pct = min(downloaded / total_size * 100, 100)
        bar_len = 40
        filled = int(bar_len * pct / 100)
        bar = "█" * filled + "░" * (bar_len - filled)
        print(f"\r  [{bar}] {pct:5.1f}%  ({downloaded / 1e6:.0f}/{total_size / 1e6:.0f} MB)", end="", flush=True)
    else:
        print(f"\r  downloaded {downloaded / 1e6:.0f} MB ...", end="", flush=True)


def ensure_model() -> Path:
    """モデルファイルが存在しなければダウンロードして返す。"""
    if MODEL_PATH.exists():
        return MODEL_PATH
    if not MODEL_URL:
        raise FileNotFoundError(
            f"[local-llm] ローカルモデルが見つかりません: {MODEL_PATH}"
        )
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    print(f"\n[local-llm] モデルをダウンロードします: {MODEL_FILENAME} ({MODEL_SIZE_APPROX})")
    print(f"[local-llm] URL: {MODEL_URL}")
    tmp_path = MODEL_PATH.with_suffix(".downloading")
    try:
        urlretrieve(MODEL_URL, str(tmp_path), reporthook=_progress_hook)
        print()  # 改行
        tmp_path.rename(MODEL_PATH)
        print(f"[local-llm] ダウンロード完了: {MODEL_PATH}")
    except Exception:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
        raise
    return MODEL_PATH


# ---------------------------------------------------------------------------
# ロード
# ---------------------------------------------------------------------------

def load_model(
    n_ctx: int = DEFAULT_N_CTX,
    n_threads: int = DEFAULT_N_THREADS,
) -> None:
    """モデルをメモリにロードする。既にロード済みなら何もしない。"""
    global _llm_instance
    if _llm_instance is not None:
        return

    with _lock:
        if _llm_instance is not None:
            return

        try:
            from llama_cpp import Llama
        except ImportError:
            print(
                "[local-llm] ❌ llama-cpp-python が見つかりません。\n"
                "            pip install llama-cpp-python でインストールしてください。",
                file=sys.stderr,
            )
            raise

        model_path = ensure_model()
        print(f"[local-llm] モデルをロード中: {model_path}")
        print(f"[local-llm]   n_ctx={n_ctx}, n_threads={n_threads}, n_gpu_layers=0")
        _llm_instance = Llama(
            model_path=str(model_path),
            n_ctx=n_ctx,
            n_threads=n_threads,
            n_gpu_layers=0,
            verbose=False,
        )
        print("[local-llm] ✅ モデルロード完了")


# ---------------------------------------------------------------------------
# 歌詞タスク用ヘルパー（ローカル LLM 専用）
# ---------------------------------------------------------------------------

_LYRICS_ROLE_KEYWORDS = ("lyricist", "ACE-Step", "lyrics generation")

# ローマ字読み行: 全体が括弧で囲まれ中身がラテン文字主体
_RE_ROMAJI_LINE = re.compile(
    r"^\s*\([\w\s,\.\-\'\u0027\u2019]+\)\s*$"
)
# 英訳行: ASCII主体で日本語・中国語・韓国語文字を含まない
_RE_ENGLISH_LINE = re.compile(
    r"^[A-Z][A-Za-z0-9\s,\.\-\'\"\!\?\;\:\u2018\u2019\u201c\u201d]+$"
)


def _is_lyrics_task(role: str) -> bool:
    """system role からこのリクエストが歌詞生成タスクかを判定する。"""
    role_lower = role.lower()
    return any(kw.lower() in role_lower for kw in _LYRICS_ROLE_KEYWORDS)


_LYRICS_SUPPLEMENT = (
    "\n\nIMPORTANT: Write lyrics ONLY in the specified LANGUAGE. "
    "Do NOT add romanization, transliteration, or translations in other languages. "
    "Each line should be pure lyrics text in the target language. "
    "Do NOT add parenthetical pronunciation guides."
)


def _clean_lyrics_response(text: str) -> str:
    """歌詞応答からローマ字読み行・英訳行を除去する。

    セクションタグ行 [intro] や JSON メタデータ行はそのまま維持。
    対象言語 (日本語・中国語・韓国語) の歌詞行のみ残す。
    """
    lines = text.split("\n")
    cleaned: list[str] = []
    for line in lines:
        stripped = line.strip()
        # 空行・セクションタグ行・JSONメタデータ行はそのまま
        if not stripped or stripped.startswith("[") or stripped.startswith("{"):
            cleaned.append(line)
            continue
        # ローマ字読み行を除去 例: (Ruri-iro no kage, nijimu yoru no sora)
        if _RE_ROMAJI_LINE.match(stripped):
            continue
        # 英訳行を除去 例: Sapphire shadows, bleeding into the night sky
        if _RE_ENGLISH_LINE.match(stripped):
            continue
        cleaned.append(line)
    return "\n".join(cleaned)


# ---------------------------------------------------------------------------
# 推論
# ---------------------------------------------------------------------------

def chat_completion(
    user_msg: str,
    role: str,
    max_tokens: Optional[int] = None,
    temperature: Optional[float] = None,
    repeat_penalty: Optional[float] = None,
) -> str:
    """ローカル LLM で chat completion を実行して応答テキストを返す。"""
    if _llm_instance is None:
        raise RuntimeError("[local-llm] モデルがロードされていません")

    lyrics_task = _is_lyrics_task(role)

    # 歌詞タスク時はプロンプトを補強して翻訳・ローマ字を抑制
    effective_user_msg = user_msg
    if lyrics_task:
        effective_user_msg = user_msg + _LYRICS_SUPPLEMENT

    messages = [
        {"role": "system", "content": role},
        {"role": "user", "content": effective_user_msg},
    ]
    kwargs: dict = {}
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    else:
        kwargs["max_tokens"] = 1024
    if temperature is not None:
        kwargs["temperature"] = temperature
    if repeat_penalty is not None:
        kwargs["repeat_penalty"] = repeat_penalty

    response = _llm_instance.create_chat_completion(
        messages=messages,
        **kwargs,
    )
    content = response["choices"][0]["message"]["content"]  # type: ignore[index]
    # 歌詞タスクの場合、ローマ字読み・英訳行を後処理で除去
    if lyrics_task:
        content = _clean_lyrics_response(content)
    return content.strip()


# ---------------------------------------------------------------------------
# 状態確認
# ---------------------------------------------------------------------------

def is_loaded() -> bool:
    """ローカル LLM がロード済みかどうかを返す。"""
    return _llm_instance is not None


def unload() -> None:
    """モデルをアンロードしてメモリを解放する。"""
    global _llm_instance
    with _lock:
        _llm_instance = None
