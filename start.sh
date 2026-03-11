#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Auto-activate virtual environment if present and not already active
if [ -z "${VIRTUAL_ENV:-}" ]; then
    for _venv in "$SCRIPT_DIR/.venv" "$SCRIPT_DIR/../.venv"; do
        if [ -f "$_venv/bin/activate" ]; then
            # shellcheck disable=SC1090
            . "$_venv/bin/activate"
            echo "[simple_video_app] venv activated: $_venv"
            break
        fi
    done
fi

usage() {
	cat <<'EOF'
Usage: ./start.sh [options]

Options:
	-H, --host HOST                 Bind host (default: SIMPLE_VIDEO_HOST or 127.0.0.1)
	-P, --port PORT                 Bind port (default: SIMPLE_VIDEO_PORT or 8090)
			--comfyui-server HOST:PORT		ComfyUI endpoint (sets COMFYUI_SERVER)
			--comfyui-dir PATH			ComfyUI root directory (sets COMFYUI_DIR; auto-detected if omitted)
			--comfyui-input PATH			ComfyUI input dir override (sets COMFYUI_INPUT_DIR)
			--comfyui-output PATH			ComfyUI output dir override (sets COMFYUI_OUTPUT_DIR)
			--openai-base-url URL			OpenAI-compatible endpoint (sets OPENAI_BASE_URL)
			--openai-api-key KEY			OpenAI API key (sets OPENAI_API_KEY)
			--vlm-base-url URL			VLM endpoint (sets VLM_BASE_URL)
			--local-llm				Use built-in local LLM (gemma-3-4b-it, CPU)
			--local-llm-model URL|PATH		Custom GGUF model (URL or local path)
			--ace-step-url URL			ACE-Step API server URL (e.g. http://127.0.0.1:8001)
			--image-model 2512|2511			Image model variant (default: 2512)
			--env-file PATH				Additional env file to load
			--reload				Enable uvicorn reload (default)
			--no-reload				Disable uvicorn reload
	-h, --help				Show this help

Examples:
	./start.sh --host 0.0.0.0 --port 8090
	./start.sh --comfyui-dir /home/user/ComfyUI
	./start.sh --env-file ../.env --openai-base-url http://127.0.0.1:11434/v1
	./start.sh --openai-api-key sk-xxxx
	./start.sh --comfyui-server 127.0.0.1:8188 --no-reload
	./start.sh --image-model 2511
	./start.sh --ace-step-url http://127.0.0.1:8001
EOF
}

# Load environment from standalone and parent api_server .env (if present)
set -a
if [ -f "$SCRIPT_DIR/.env" ]; then
	. "$SCRIPT_DIR/.env"
fi
if [ -f "$SCRIPT_DIR/../.env" ]; then
	. "$SCRIPT_DIR/../.env"
fi
set +a

HOST="${SIMPLE_VIDEO_HOST:-127.0.0.1}"
PORT="${SIMPLE_VIDEO_PORT:-8090}"
RELOAD_FLAG="--reload"

while [ $# -gt 0 ]; do
	case "$1" in
		-H|--host)
			HOST="${2:-}"
			shift 2
			;;
		-P|--port)
			PORT="${2:-}"
			shift 2
			;;
		--comfyui-server)
			export COMFYUI_SERVER="${2:-}"
			shift 2
			;;
		--comfyui-dir)
			export COMFYUI_DIR="${2:-}"
			shift 2
			;;
		--comfyui-input)
			export COMFYUI_INPUT_DIR="${2:-}"
			shift 2
			;;
		--comfyui-output)
			export COMFYUI_OUTPUT_DIR="${2:-}"
			shift 2
			;;
		--openai-base-url)
			export OPENAI_BASE_URL="${2:-}"
			shift 2
			;;
		--openai-api-key)
			export OPENAI_API_KEY="${2:-}"
			shift 2
			;;
		--vlm-base-url)
			export VLM_BASE_URL="${2:-}"
			shift 2
			;;
		--local-llm)
			export SIMPLE_VIDEO_LOCAL_LLM="1"
			shift
			;;
		--local-llm-model)
			export SIMPLE_VIDEO_LOCAL_LLM="1"
			export SIMPLE_VIDEO_LOCAL_LLM_MODEL="${2:-}"
			shift 2
			;;
		--ace-step-url)
			export ACE_STEP_API_URL="${2:-}"
			shift 2
			;;
		--image-model)
			export SIMPLE_VIDEO_IMAGE_MODEL="${2:-}"
			shift 2
			;;
		--env-file)
			EXTRA_ENV_FILE="${2:-}"
			if [ -z "$EXTRA_ENV_FILE" ] || [ ! -f "$EXTRA_ENV_FILE" ]; then
				echo "❌ env file not found: ${EXTRA_ENV_FILE:-<empty>}" >&2
				exit 1
			fi
			set -a
			. "$EXTRA_ENV_FILE"
			set +a
			shift 2
			;;
		--reload)
			RELOAD_FLAG="--reload"
			shift
			;;
		--no-reload)
			RELOAD_FLAG=""
			shift
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			echo "❌ Unknown option: $1" >&2
			usage
			exit 1
			;;
	esac
done

if [ -z "$HOST" ] || [ -z "$PORT" ]; then
	echo "❌ host/port must not be empty" >&2
	usage
	exit 1
fi

CMD=(uvicorn app:app --host "$HOST" --port "$PORT")
if [ -n "$RELOAD_FLAG" ]; then
	CMD+=("$RELOAD_FLAG")
fi

echo "[simple_video_app] host=$HOST port=$PORT reload=$([ -n "$RELOAD_FLAG" ] && echo on || echo off)"
if [ -n "${COMFYUI_SERVER:-}" ]; then
	echo "[simple_video_app] COMFYUI_SERVER=$COMFYUI_SERVER"
fi
if [ -n "${COMFYUI_DIR:-}" ]; then
	echo "[simple_video_app] COMFYUI_DIR=$COMFYUI_DIR"
fi
if [ -n "${COMFYUI_INPUT_DIR:-}" ]; then
	echo "[simple_video_app] COMFYUI_INPUT_DIR=$COMFYUI_INPUT_DIR"
fi
if [ -n "${COMFYUI_OUTPUT_DIR:-}" ]; then
	echo "[simple_video_app] COMFYUI_OUTPUT_DIR=$COMFYUI_OUTPUT_DIR"
fi
if [ -n "${OPENAI_BASE_URL:-}" ]; then
	echo "[simple_video_app] OPENAI_BASE_URL=$OPENAI_BASE_URL"
fi
if [ -n "${VLM_BASE_URL:-}" ]; then
	echo "[simple_video_app] VLM_BASE_URL=$VLM_BASE_URL"
fi
if [ -n "${SIMPLE_VIDEO_IMAGE_MODEL:-}" ]; then
	echo "[simple_video_app] IMAGE_MODEL=$SIMPLE_VIDEO_IMAGE_MODEL"
fi
if [ -n "${SIMPLE_VIDEO_LOCAL_LLM:-}" ]; then
	echo "[simple_video_app] LOCAL_LLM=enabled"
	if [ -n "${SIMPLE_VIDEO_LOCAL_LLM_MODEL:-}" ]; then
		echo "[simple_video_app] LOCAL_LLM_MODEL=$SIMPLE_VIDEO_LOCAL_LLM_MODEL"
	fi
fi
if [ -n "${ACE_STEP_API_URL:-}" ]; then
	echo "[simple_video_app] ACE_STEP_API_URL=$ACE_STEP_API_URL"
fi

exec "${CMD[@]}"
