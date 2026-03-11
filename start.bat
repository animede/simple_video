@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

REM --- Auto-activate virtual environment if present ---
if not defined VIRTUAL_ENV (
    if exist ".venv\Scripts\activate.bat" (
        call ".venv\Scripts\activate.bat"
        echo [simple_video_app] venv activated: .venv
    ) else if exist "..\.venv\Scripts\activate.bat" (
        call "..\.venv\Scripts\activate.bat"
        echo [simple_video_app] venv activated: ..\.venv
    )
)

REM --- Load .env files if present ---
if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
        set "line=%%A"
        if not "!line:~0,1!"=="#" (
            if not "%%A"=="" set "%%A=%%B"
        )
    )
)
if exist "..\.env" (
    for /f "usebackq tokens=1,* delims==" %%A in ("..\.env") do (
        set "line=%%A"
        if not "!line:~0,1!"=="#" (
            if not "%%A"=="" set "%%A=%%B"
        )
    )
)

REM --- Defaults ---
if not defined SIMPLE_VIDEO_HOST set "SIMPLE_VIDEO_HOST=127.0.0.1"
if not defined SIMPLE_VIDEO_PORT set "SIMPLE_VIDEO_PORT=8090"
set "HOST=%SIMPLE_VIDEO_HOST%"
set "PORT=%SIMPLE_VIDEO_PORT%"
set "RELOAD_FLAG=--reload"

REM --- Parse arguments ---
:parse_args
if "%~1"=="" goto done_args
if /i "%~1"=="-H"               ( set "HOST=%~2" & shift & shift & goto parse_args )
if /i "%~1"=="--host"           ( set "HOST=%~2" & shift & shift & goto parse_args )
if /i "%~1"=="-P"               ( set "PORT=%~2" & shift & shift & goto parse_args )
if /i "%~1"=="--port"           ( set "PORT=%~2" & shift & shift & goto parse_args )
if /i "%~1"=="--comfyui-server" ( set "COMFYUI_SERVER=%~2" & shift & shift & goto parse_args )
if /i "%~1"=="--comfyui-dir"    ( set "COMFYUI_DIR=%~2" & shift & shift & goto parse_args )
if /i "%~1"=="--comfyui-input"  ( set "COMFYUI_INPUT_DIR=%~2" & shift & shift & goto parse_args )
if /i "%~1"=="--comfyui-output" ( set "COMFYUI_OUTPUT_DIR=%~2" & shift & shift & goto parse_args )
if /i "%~1"=="--openai-base-url" ( set "OPENAI_BASE_URL=%~2" & shift & shift & goto parse_args )
if /i "%~1"=="--openai-api-key" ( set "OPENAI_API_KEY=%~2" & shift & shift & goto parse_args )
if /i "%~1"=="--vlm-base-url"   ( set "VLM_BASE_URL=%~2" & shift & shift & goto parse_args )
if /i "%~1"=="--local-llm"      ( set "SIMPLE_VIDEO_LOCAL_LLM=1" & shift & goto parse_args )
if /i "%~1"=="--local-llm-model" ( set "SIMPLE_VIDEO_LOCAL_LLM=1" & set "SIMPLE_VIDEO_LOCAL_LLM_MODEL=%~2" & shift & shift & goto parse_args )
if /i "%~1"=="--ace-step-url"   ( set "ACE_STEP_API_URL=%~2" & shift & shift & goto parse_args )
if /i "%~1"=="--image-model"    ( set "SIMPLE_VIDEO_IMAGE_MODEL=%~2" & shift & shift & goto parse_args )
if /i "%~1"=="--env-file" (
    if exist "%~2" (
        for /f "usebackq tokens=1,* delims==" %%A in ("%~2") do (
            set "line=%%A"
            if not "!line:~0,1!"=="#" (
                if not "%%A"=="" set "%%A=%%B"
            )
        )
    ) else (
        echo ERROR: env file not found: %~2
        exit /b 1
    )
    shift & shift & goto parse_args
)
if /i "%~1"=="--reload"    ( set "RELOAD_FLAG=--reload" & shift & goto parse_args )
if /i "%~1"=="--no-reload" ( set "RELOAD_FLAG=" & shift & goto parse_args )
if /i "%~1"=="-h"     ( goto show_help )
if /i "%~1"=="--help"  ( goto show_help )
echo ERROR: Unknown option: %~1
goto show_help

:done_args

if "%HOST%"=="" ( echo ERROR: host must not be empty & exit /b 1 )
if "%PORT%"=="" ( echo ERROR: port must not be empty & exit /b 1 )

echo [simple_video_app] host=%HOST% port=%PORT% reload=%RELOAD_FLAG%
if defined COMFYUI_SERVER echo [simple_video_app] COMFYUI_SERVER=%COMFYUI_SERVER%
if defined COMFYUI_DIR echo [simple_video_app] COMFYUI_DIR=%COMFYUI_DIR%
if defined COMFYUI_INPUT_DIR echo [simple_video_app] COMFYUI_INPUT_DIR=%COMFYUI_INPUT_DIR%
if defined COMFYUI_OUTPUT_DIR echo [simple_video_app] COMFYUI_OUTPUT_DIR=%COMFYUI_OUTPUT_DIR%
if defined OPENAI_BASE_URL echo [simple_video_app] OPENAI_BASE_URL=%OPENAI_BASE_URL%
if defined VLM_BASE_URL echo [simple_video_app] VLM_BASE_URL=%VLM_BASE_URL%
if defined SIMPLE_VIDEO_IMAGE_MODEL echo [simple_video_app] IMAGE_MODEL=%SIMPLE_VIDEO_IMAGE_MODEL%
if defined SIMPLE_VIDEO_LOCAL_LLM echo [simple_video_app] LOCAL_LLM=enabled
if defined SIMPLE_VIDEO_LOCAL_LLM_MODEL echo [simple_video_app] LOCAL_LLM_MODEL=%SIMPLE_VIDEO_LOCAL_LLM_MODEL%
if defined ACE_STEP_API_URL echo [simple_video_app] ACE_STEP_API_URL=%ACE_STEP_API_URL%

if defined RELOAD_FLAG (
    uvicorn app:app --host %HOST% --port %PORT% %RELOAD_FLAG%
) else (
    uvicorn app:app --host %HOST% --port %PORT%
)
exit /b %errorlevel%

:show_help
echo Usage: start.bat [options]
echo.
echo Options:
echo   -H, --host HOST                 Bind host (default: SIMPLE_VIDEO_HOST or 127.0.0.1)
echo   -P, --port PORT                 Bind port (default: SIMPLE_VIDEO_PORT or 8090)
echo       --comfyui-server HOST:PORT   ComfyUI endpoint (sets COMFYUI_SERVER)
echo       --comfyui-dir PATH           ComfyUI root directory (sets COMFYUI_DIR)
echo       --comfyui-input PATH         ComfyUI input dir override (sets COMFYUI_INPUT_DIR)
echo       --comfyui-output PATH        ComfyUI output dir override (sets COMFYUI_OUTPUT_DIR)
echo       --openai-base-url URL        OpenAI-compatible endpoint (sets OPENAI_BASE_URL)
echo       --openai-api-key KEY         OpenAI API key (sets OPENAI_API_KEY)
echo       --vlm-base-url URL           VLM endpoint (sets VLM_BASE_URL)
echo       --local-llm                  Use built-in local LLM (gemma-3-4b-it, CPU)
echo       --local-llm-model URL^|PATH  Custom GGUF model (URL or local path)
echo       --ace-step-url URL           ACE-Step API server URL (e.g. http://127.0.0.1:8001)
echo       --image-model 2512^|2511     Image model variant (default: 2512)
echo       --env-file PATH              Additional env file to load
echo       --reload                     Enable uvicorn reload (default)
echo       --no-reload                  Disable uvicorn reload
echo   -h, --help                       Show this help
echo.
echo Examples:
echo   start.bat --host 0.0.0.0 --port 8090
echo   start.bat --comfyui-dir C:\ComfyUI
echo   start.bat --env-file ..\.env --openai-base-url http://127.0.0.1:11434/v1
echo   start.bat --comfyui-server 127.0.0.1:8188 --no-reload
exit /b 0
