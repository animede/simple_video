# Simple Video Standalone

Version: V0.9-Preview

License: [MIT](./LICENSE)

Language: [日本語](./README.md) | English

`simple_video_app` is a standalone version of **Simple Video** that uses ComfyUI as the backend.

This document is focused on practical information for public repository users: setup, run, usage, and limits.

## Why V0.9-Preview

- **All-in-one flow**: image (T2I/I2I) -> video (T2V/I2V/FLF) -> music (T2A) -> merge (M2V/V2M)
- **Faster prompt workflow**: 2-step flow (`🧠 Build Scenario` -> `🤖 Generate Prompts`)
- **More stable style continuity**: style presets + post-generation style-consistency guardrails

## Quick Start (3 Steps)

1. Start ComfyUI (default: `127.0.0.1:8188`)
2. Install dependencies: `pip install -r requirements.txt`
3. Start app: `bash start.sh` (or `./start.sh`)

## Feature Overview

- T2V (Text to Video)
- T2I (Text to Image)
- I2I (Image Edit)
- Character video generation with image references
- T2A (Text to Audio / music generation)
- M2V (Music to Video)
- V2M (Video to Music)
- MV generation (video with music)
- PV generation (add music track to video)
- 2-step prompt workflow (`🧠 Build Scenario` → `🤖 Generate Prompts`)
- One-click style presets (Realistic / Anime / Illustration / Cinematic / Line-art / Pixel-art) with post-generation style guardrails
- In-app floating Help panel (Quick Help / User Guide / Technical Guide)

## What You Can Do in Practice

- Create images (T2I)
- Edit images (I2I)
- Create videos (T2V / I2V / FLF)
- Create music (T2A)
- Create MV by adding video to music (M2V)
- Create PV by adding music to video (V2M)
- Build scene prompts with 2-step flow
- Apply style presets and auto-correct style consistency after prompt generation

Because all of this is available in one UI, you can produce image/video/music/movie outputs in one continuous workflow.

## Scope

- Single-user only
- Local ComfyUI only (default `127.0.0.1:8188`)
- Only APIs required for Simple Video are implemented

### Not Supported

- Distributed mode
- Multi-user concurrent operation
- Utility features for the full/main product (not in standalone)

## Requirements

- Python 3.10+
- ComfyUI (already running)
- `ffmpeg` (for merge/concat/audio mixing)
- (Optional) OpenAI-compatible API if you use scenario generation / prompt generation / lyric generation / translation
  - Example: `OPENAI_BASE_URL`, `OPENAI_API_KEY` (and optionally `VLM_BASE_URL`, `VLM_API_KEY`)

## Required Models

The model names below are referenced by the default workflow JSON files used in `simple_video_app`.
If filenames do not match, loading will fail.

> **Location:** place files under `ComfyUI/models/` subfolders. `diffusion_models/`, `loras/`, `text_encoders/`, `vae/`, `checkpoints/` in this README all refer to folders under `ComfyUI/models/`.

### Qwen Image (T2I / I2I)

```text
Common
├── text_encoders/      qwen_2.5_vl_7b_fp8_scaled.safetensors
└── vae/                qwen_image_vae.safetensors

2512 series (T2I / I2I image generation)
└── diffusion_models/   qwen_image_2512_fp8_e4m3fn.safetensors        <- base
    └── loras/          Qwen-Image-Lightning-4steps-V1.0.safetensors <- 4-step LoRA

2511 series (I2I edit / character composition)
└── diffusion_models/   qwen_image_edit_2511_bf16.safetensors                    <- base
    └── loras/          Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors <- 4-step LoRA
```

- 2512 and 2511 LoRAs are base-specific (not interchangeable)
- When you start with `--image-model 2511`, the two 2512 files are not required (see `docs/TECHNICAL_JP.md` section 10.4)

### Wan2.2 (T2V / I2V / FLF)

Wan2.2 uses two-stage denoising, so high-noise and low-noise models are loaded as pairs.

```text
Common
├── vae/                wan_2.1_vae.safetensors
└── text_encoders/      umt5_xxl_fp8_e4m3fn_scaled.safetensors
                        (I2V also uses umt5_xxl_fp16.safetensors)

T2V (text -> video)
├── High-noise stage (step 0->2)
│   └── diffusion_models/   wan2.2_t2v_high_noise_14B_Q4_K_M.gguf                    <- base (GGUF)
│       └── loras/          wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors <- 4-step
└── Low-noise stage (step 2->4)
    └── diffusion_models/   wan2.2_t2v_low_noise_14B_Q5_K_M.gguf                     <- base (GGUF)
        └── loras/          wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors  <- 4-step

I2V / FLF (image -> video / first-last frame interpolation)  *Seko-V1 LoRA*
├── High-noise stage (step 0->2)
│   └── diffusion_models/   wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors   <- base
│       └── loras/          high_noise_model.safetensors                       <- Seko-V1 LoRA
└── Low-noise stage (step 2->4)
    └── diffusion_models/   wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors    <- base
        └── loras/          low_noise_model.safetensors                        <- Seko-V1 LoRA
```

- T2V and I2V UNET/LoRA are different stacks (not interchangeable)

### Background Removal (pre-step before initial image generation)

- When the Background Removal toggle is ON, the app runs the `remove_bg_v1_0` workflow (`workflows/remove_bg_v1.0_api.json`).
- This pre-step requires your ComfyUI environment to resolve the required `remove_bg` nodes/models.
- If setup is missing, the step fails at background removal. Verify `remove_bg_v1_0` appears in `/api/v1/workflows`.
- FLF shares the same model stack as I2V
- `high_noise_model` / `low_noise_model` are workflow reference names for Seko-V1 LoRA; rename/symlink your LoRA files to these names

### ACE-Step (T2A)

```text
└── checkpoints/  ace_step_1.5_turbo_aio.safetensors
```

### Notes

- These names are workflow-level names. If distributed filenames differ, edit workflow JSON model names to your local files.
- Model folders are all under `ComfyUI/models/`
- `diffusion_models/` may also be searched as legacy `unet/` by ComfyUI

### Download Candidates (Search Links)

- Qwen Image 2512 base: https://huggingface.co/models?search=qwen_image_2512_fp8_e4m3fn
- Qwen Image Edit 2511 base: https://huggingface.co/models?search=qwen_image_edit_2511_bf16
- Qwen Image Lightning LoRA: https://huggingface.co/models?search=Qwen-Image-Lightning-4steps
- Qwen Image Edit Lightning LoRA: https://huggingface.co/models?search=Qwen-Image-Edit-2511-Lightning-4steps
- Wan2.2 I2V base (high/low): https://huggingface.co/models?search=wan2.2_i2v_high_noise_14B_fp8_scaled
- Wan2.2 T2V GGUF base (high): https://huggingface.co/models?search=wan2.2_t2v_high_noise_14B_Q4_K_M.gguf
- Wan2.2 T2V GGUF base (low): https://huggingface.co/models?search=wan2.2_t2v_low_noise_14B_Q5_K_M.gguf
- Wan2.2 LightX2V LoRA: https://huggingface.co/models?search=wan2.2_lightx2v_4steps_lora
- ACE-Step 1.5 turbo: https://huggingface.co/models?search=ace_step_1.5_turbo_aio

Checklist:

- Match workflow JSON fields (`unet_name`, `lora_name`, `clip_name`, `vae_name`, `ckpt_name`) with actual filenames
- If mismatch: rename local file OR edit workflow JSON
- Place `high_noise_model.safetensors` / `low_noise_model.safetensors` in `ComfyUI/models/loras/` for I2V(Seko)

### Special Custom Nodes (Default Workflows)

Default workflows use these nodes (including non-core nodes):

- Qwen: `CFGNorm`, `TextEncodeQwenImageEditPlus`, `FluxKontextMultiReferenceLatentMethod`
- Wan: `LoaderGGUF`, `WanImageToVideo`, `WanFirstLastFrameToVideo`, `CreateVideo`, `SaveVideo`
- ACE-Step: `TextEncodeAceStepAudio1.5`, `EmptyAceStep1.5LatentAudio`, `VAEDecodeAudio`, `SaveAudioMP3`
- Background removal: `LayerMask: RemBgUltra`

Check loaded classes while ComfyUI is running:

```bash
python3 - <<'PY'
import json, urllib.request
url='http://127.0.0.1:8188/object_info'
required=[
    'CFGNorm','TextEncodeQwenImageEditPlus','FluxKontextMultiReferenceLatentMethod',
    'LoaderGGUF','WanImageToVideo','WanFirstLastFrameToVideo','CreateVideo','SaveVideo',
  'TextEncodeAceStepAudio1.5','EmptyAceStep1.5LatentAudio','VAEDecodeAudio','SaveAudioMP3',
  'LayerMask: RemBgUltra'
]
with urllib.request.urlopen(url, timeout=8) as r:
    obj=json.loads(r.read().decode('utf-8'))
missing=[name for name in required if name not in obj]
print('missing:', missing if missing else 'none')
PY
```

### Custom Node Install (Easy Version)

Two methods are available. **ComfyUI-Manager** is easiest.

#### Method A: ComfyUI-Manager (recommended)

1. Start ComfyUI
2. Search/install required nodes in Manager
3. Restart ComfyUI
4. Confirm `missing: none` with `object_info`

#### Method B: Manual install (`git clone`)

```bash
cd /home/animede/ComfyUI/custom_nodes
git clone <custom-node-repo-url>
cd <cloned-folder>
python3 -m pip install -r requirements.txt
```

If `requirements.txt` does not exist, skip pip and just restart ComfyUI.

#### Repositories to Check

- Included in latest ComfyUI core:
  - `CFGNorm`, `TextEncodeQwenImageEditPlus`, `FluxKontextMultiReferenceLatentMethod`
  - `WanImageToVideo`, `WanFirstLastFrameToVideo`, `CreateVideo`, `SaveVideo`
  - `TextEncodeAceStepAudio1.5`, `EmptyAceStep1.5LatentAudio`, `VAEDecodeAudio`, `SaveAudioMP3`
- Additional install required:
  - `LoaderGGUF` -> `calcuis/gguf` (https://github.com/calcuis/gguf)
  - `LayerMask: RemBgUltra` -> install via ComfyUI-Manager by searching `RemBgUltra` or `LayerMask`

### Most Reliable Validation (ComfyUI GUI)

For model/node validation, loading and running workflows directly in ComfyUI GUI is the most reliable method.

Included GUI validation workflows:

- `workflows/gui_validation/image_qwen_Image_2512.json` (T2I)
- `workflows/gui_validation/qwen_image_edit_2511.json` (I2I Edit)
- `workflows/gui_validation/video_wan2_2_14B_t2v_RTX3060_v1_linux.json` (T2V GGUF)
- `workflows/gui_validation/Wan2.2-I2V-A14B-4steps-lora-rank64-Seko-V1-NativeComfy_linux.json` (I2V)
- `workflows/gui_validation/video_wan2_2_14B_flf2v_s_linux.json` (FLF)
- `workflows/gui_validation/ace-step-v1-t2a_linux.json` (T2A)

Steps:

1. Load workflow JSON in ComfyUI GUI
2. Run each workflow once
3. Ensure no `Node class not found` / `Cannot import` / `model not found`

## Quick Start for Beginners (10-minute path)

1. Install/start ComfyUI (if needed)
   - Official: https://github.com/comfyanonymous/ComfyUI
2. Verify ComfyUI responds:

```bash
curl -s http://127.0.0.1:8188/system_stats | head
```

3. Setup this app:

```bash
cd simple_video_app
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
```

4. Place models under `ComfyUI/models/` (see "Required Models")
5. Install custom nodes (see above)
6. Confirm custom node check returns `missing: none`
7. Start app:

```bash
./start.sh
```

8. Health check:

```bash
curl -s http://127.0.0.1:8090/api/v1/workflows | head
```

9. Minimal test (T2I):

```bash
JOB_ID=$(curl -s -X POST http://127.0.0.1:8090/api/v1/generate \
    -H 'Content-Type: application/json' \
    -d '{"workflow":"qwen_t2i_2512_lightning4","prompt":"a simple landscape"}' \
    | python3 -c 'import sys,json; print(json.load(sys.stdin).get("job_id",""))')
echo "job_id=$JOB_ID"
curl -s "http://127.0.0.1:8090/api/v1/status/$JOB_ID"
```

10. Open `http://127.0.0.1:8090/` and test T2V / I2V / T2A once each.

### Minimum Practical Baseline

- Python 3.10+
- ComfyUI runnable locally
- `ffmpeg` available
- GPU memory guideline (depends on environment):
  - Image-centric (T2I/I2I): 12GB+
  - Video-centric (Wan2.2 T2V/I2V): 16GB+
  - Comfortable usage: 24GB+
  - If limited, use `--image-model 2511` and avoid parallel heavy jobs

## Setup

```bash
cd simple_video_app
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
```

## Run

```bash
./start.sh
```

Defaults:

- Host: `127.0.0.1`
- Port: `8090`

Browser:

- `http://127.0.0.1:8090/`

Startup options:

```bash
./start.sh --help
./start.sh --host 0.0.0.0 --port 8090
./start.sh --comfyui-server 127.0.0.1:8188 --env-file ../.env --no-reload
./start.sh --openai-api-key sk-xxxx
./start.sh --image-model 2511
```

Notes:

- `start.sh` auto-activates `.venv` (`./.venv` or `../.venv`) if found
- Use `--image-model 2511` for lighter image model operation

Environment variable examples:

```bash
SIMPLE_VIDEO_HOST=0.0.0.0 SIMPLE_VIDEO_PORT=18090 ./start.sh
OPENAI_BASE_URL=http://127.0.0.1:11434/v1 OPENAI_API_KEY=dummy ./start.sh
```

## Quick Check

```bash
curl -s http://127.0.0.1:8090/ | head
curl -s http://127.0.0.1:8090/api/v1/workflows
```

## Usage Docs

- Quick Help: [docs/HELP_EN.md](docs/HELP_EN.md)
- Tutorial: [docs/TUTORIAL_EN.md](docs/TUTORIAL_EN.md)
- User Guide: [docs/USAGE_EN.md](docs/USAGE_EN.md)
- Technical Guide: [docs/TECHNICAL_JP.md](docs/TECHNICAL_JP.md)
- Technical Article (detailed): [docs/TECHNICAL_ARTICLE_JP.md](docs/TECHNICAL_ARTICLE_JP.md)

## Key Files

- `app.py`: FastAPI server (static + API)
- `start.sh`: standalone startup script
- `static/index.html`: Simple Video screen
- `static/js/bootstrap.js`: bootstrap + Help panel control
- `static/js/simple_video.js`: UI logic
- `static/js/simple_video_config.js`: standalone fixed config

## Troubleshooting

### `ComfyUI /prompt failed`

- Check failure point in error detail (`node_errors`)
- Check missing input/reference images

### Output not found / 404

- Re-generate with same condition and check new `job_id`
- Check actual output files in ComfyUI output side

### Empty video scenario in M2V

- Confirmation dialog appears at run time
- Choose `Generate as-is` or `Input scenario`

### "Scene prompts are empty" on targeted regeneration after M2V

- Targeted scene regeneration requires the `Scene Prompts` field to be non-empty
- Re-run `🤖 Generate Prompts` to restore scene prompts, then run targeted regeneration again

## Note for Public Repository

- This README is intentionally limited to practical usage information for public users.
- Internal planning documents in-progress are not referenced from public docs.
