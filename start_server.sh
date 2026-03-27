#!/usr/bin/env bash
# start_server.sh – マルチユーザー版起動スクリプト
#
# start.sh と同じオプションに対応しつつ、
# SIMPLE_VIDEO_MULTI_USER=1 を設定して app_server:app を起動します。
#
# 使い方:
#   bash start_server.sh [start.sh と同じオプション]
#   bash start_server.sh --host 0.0.0.0 --port 8090
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# マルチユーザーモードを有効化
export SIMPLE_VIDEO_MULTI_USER=1

# start.sh にすべてのオプション処理を委譲し、
# uvicorn の app モジュールだけ差し替える
# → start.sh の最終行 `exec uvicorn app:app ...` を app_server:app に変える

# .env から SIMPLE_VIDEO_MULTI_USER を上書きされないように先にエクスポート
export SIMPLE_VIDEO_MULTI_USER=1

# start.sh と同じ venv 検出
if [ -z "${VIRTUAL_ENV:-}" ]; then
    for _venv in "$SCRIPT_DIR/.venv" "$SCRIPT_DIR/../.venv"; do
        if [ -f "$_venv/bin/activate" ]; then
            # shellcheck disable=SC1090
            . "$_venv/bin/activate"
            echo "[simple_video_server] venv activated: $_venv"
            break
        fi
    done
fi

cd "$SCRIPT_DIR"

# .env 読み込み
set -a
[ -f "$SCRIPT_DIR/.env" ] && . "$SCRIPT_DIR/.env"
[ -f "$SCRIPT_DIR/../.env" ] && . "$SCRIPT_DIR/../.env"
set +a

# 再度セット（.env に SIMPLE_VIDEO_MULTI_USER=0 があった場合の上書き防止）
export SIMPLE_VIDEO_MULTI_USER=1

HOST="${SIMPLE_VIDEO_HOST:-0.0.0.0}"
PORT="${SIMPLE_VIDEO_PORT:-8090}"
RELOAD_FLAG=""

while [ $# -gt 0 ]; do
    case "$1" in
        -H|--host)        HOST="${2:-}"; shift 2 ;;
        -P|--port)        PORT="${2:-}"; shift 2 ;;
        --comfyui-server) export COMFYUI_SERVER="${2:-}"; shift 2 ;;
        --comfyui-dir)    export COMFYUI_DIR="${2:-}"; shift 2 ;;
        --comfyui-input)  export COMFYUI_INPUT_DIR="${2:-}"; shift 2 ;;
        --comfyui-output) export COMFYUI_OUTPUT_DIR="${2:-}"; shift 2 ;;
        --openai-base-url)  export OPENAI_BASE_URL="${2:-}"; shift 2 ;;
        --openai-api-key)   export OPENAI_API_KEY="${2:-}"; shift 2 ;;
        --vlm-base-url)     export VLM_BASE_URL="${2:-}"; shift 2 ;;
        --local-llm)        export SIMPLE_VIDEO_LOCAL_LLM="1"; shift ;;
        --local-llm-model)  export SIMPLE_VIDEO_LOCAL_LLM="1"; export SIMPLE_VIDEO_LOCAL_LLM_MODEL="${2:-}"; shift 2 ;;
        --ace-step-url)     export ACE_STEP_API_URL="${2:-}"; shift 2 ;;
        --image-model)      export SIMPLE_VIDEO_IMAGE_MODEL="${2:-}"; shift 2 ;;
        --env-file)
            EXTRA_ENV_FILE="${2:-}"
            if [ -z "$EXTRA_ENV_FILE" ] || [ ! -f "$EXTRA_ENV_FILE" ]; then
                echo "❌ env file not found: ${EXTRA_ENV_FILE:-<empty>}" >&2; exit 1
            fi
            set -a; . "$EXTRA_ENV_FILE"; set +a
            export SIMPLE_VIDEO_MULTI_USER=1
            shift 2 ;;
        --reload)    RELOAD_FLAG="--reload"; shift ;;
        --no-reload) RELOAD_FLAG=""; shift ;;
        -h|--help)
            echo "Usage: ./start_server.sh [options]"
            echo ""
            echo "マルチユーザー版 (SIMPLE_VIDEO_MULTI_USER=1) で起動します。"
            echo "オプションは start.sh と同じです。"
            echo ""
            echo "主な違い:"
            echo "  - デフォルト host: 0.0.0.0 (外部アクセス許可)"
            echo "  - デフォルト reload: off"
            echo "  - セッション分離が有効"
            exit 0 ;;
        *)
            echo "❌ Unknown option: $1" >&2; exit 1 ;;
    esac
done

if [ -z "$HOST" ] || [ -z "$PORT" ]; then
    echo "❌ host/port must not be empty" >&2; exit 1
fi

CMD=(uvicorn app_server:app --host "$HOST" --port "$PORT")
if [ -n "$RELOAD_FLAG" ]; then
    CMD+=("$RELOAD_FLAG")
fi

echo "────────────────────────────────────────────────────────"
echo "  simple_video_server (マルチユーザーモード)"
echo "────────────────────────────────────────────────────────"
echo "  host=$HOST  port=$PORT  reload=$([ -n "$RELOAD_FLAG" ] && echo on || echo off)"
echo "  MULTI_USER=1 (セッション分離有効)"
[ -n "${COMFYUI_SERVER:-}" ] && echo "  COMFYUI_SERVER=$COMFYUI_SERVER"
[ -n "${OPENAI_BASE_URL:-}" ] && echo "  OPENAI_BASE_URL=$OPENAI_BASE_URL"
[ -n "${ACE_STEP_API_URL:-}" ] && echo "  ACE_STEP_API_URL=$ACE_STEP_API_URL"
echo "────────────────────────────────────────────────────────"

exec "${CMD[@]}"
