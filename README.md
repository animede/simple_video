# Simple Video Standalone

Version: v0.95.1

License: [MIT](./LICENSE)

Language: 日本語 | [English](./README_EN.md)

`simple_video_app` は、ComfyUI をバックエンドとして使う `かんたん動画` の standalone アプリです。

公開リポジトリ向けに、利用者が必要な情報（導入・実行・操作・制約）に限定して記載しています。

## v0.95.1 の価値

- **1つのUIで完結**: 画像（T2I/I2I）→ 動画（T2V/I2V/FLF）→ 音楽（T2A）→ 合成（M2V/V2M）
- **プロンプト作業を短縮**: `🧠 シナリオ作成` → `🤖 プロンプト生成` の2ステップ
- **画風の崩れを抑制**: 画風テンプレ + 画風一致ガードレールで連続生成の安定性を向上
- **ACE-Step API 統合**: Thinking モード（高品質生成）と AI Tag 強化に対応
- **サーバーモード**: マルチユーザー対応（セッション分離）

## 最短スタート（3ステップ）

1. ComfyUI を起動（既定: `127.0.0.1:8188`）
2. 依存関係をインストール: `pip install -r requirements.txt`
3. アプリ起動:
   - **Linux / macOS**: `bash start.sh`（または `./start.sh`）
   - **Windows**: `start.bat`（コマンドプロンプトまたはダブルクリック）

### Windows で使う場合

Windows でもそのまま動作します。追加の変更は不要です。

1. Python 3.10+ と `ffmpeg` を PATH に通しておく
2. ComfyUI を起動する
3. コマンドプロンプトまたは PowerShell でアプリフォルダに移動:
   ```
   cd C:\path\to\simple_video_app
   pip install -r requirements.txt
   start.bat
   ```
4. `.env` ファイルに環境変数を書いておけば自動で読み込まれます（`python-dotenv` 使用）

`start.bat` は `start.sh` と同等のオプション（`--host`, `--port`, `--comfyui-server` 等）に対応しています。

## 機能概要

- T2V（テキストから動画生成）
- 画像生成（T2I）
- 画像Edit（I2I）
- 画像参照ベースのキャラクタ動画生成
- T2A（テキストから音楽生成）
- M2V（音楽から動画生成）
- V2M（動画から音楽生成）
- MV（音楽付き動画生成: 音楽に動画を重ねる）
- PV（動画+音楽合成: 動画に音楽を重ねる）
- 結合動画への音楽追加（`🎵 音楽を追加` ボタン）
- ACE-Step API 統合（Thinking モード / AI Tag 強化）
- 2ステップのプロンプト作成（`🧠 シナリオ作成` → `🤖 プロンプト生成`）
- 画風テンプレのワンクリック注入（リアル寄り/アニメ風/イラスト風/映画風/ラインアート風/ドット絵風）と、生成後の画風一致ガードレール
- アプリ内フローティング Help（クイックヘルプ / ユーザーズガイド / テクニカルガイド）

## このアプリでできること（実運用イメージ）

- 画像を作る（T2I）
- 画像を修正する（I2I）
- 動画を作る（T2V / I2V / FLF）
- 音楽を作る（T2A）
- 音楽に動画を重ねて MV を作る（M2V）
- 動画に音楽を重ねて PV を作る（V2M）
- 結合動画に音楽を追加する（`🎵 音楽を追加` ボタン）
- 2ステップでシーンプロンプトを作る（🧠 シナリオ作成 → 🤖 プロンプト生成）
- 画風テンプレをワンクリック適用し、生成後に画風一致ガードレールで補正する

上記を1つのUIで連続実行できるため、画像・動画・音楽・音声付き動画を段階的に制作できます。

## 対応範囲

- single-user（デフォルト）または multi-user（サーバーモード）
- local ComfyUI 前提（既定 `127.0.0.1:8188`）
- かんたん動画で使用する API のみ実装

### 非対応

- distributed モード
- Standalone版での Utility 機能（本家向け機能）

## 要件

- Python 3.10+
- ComfyUI（起動済み）
- `ffmpeg`（動画結合・音声合成などで使用）
- （任意）シナリオ作成 / プロンプト生成 / 作詞 / 翻訳を使う場合は OpenAI互換API
    - 例: `OPENAI_BASE_URL`, `OPENAI_API_KEY`（必要に応じて `VLM_BASE_URL`, `VLM_API_KEY`）

## VRAM 目安

| VRAM | できること | 備考 |
|------|-----------|------|
| **12 GB** | T2I (FP8)、T2V (GGUF Q4/Q5 + offload)、T2A | I2V / FLF は OOM の可能性大 |
| **16 GB** | 上記 ＋ I2V / FLF (FP8)、I2I Edit (BF16, 低解像度) | ComfyUI のモデル自動スワップにより実行可。高解像度 I2I Edit はメモリ不足になり得る |
| **24 GB（推奨）** | すべての機能を快適に利用可能 | BF16 I2I Edit を高解像度で実行しても余裕あり |

### モード別 VRAM 参考値

| モード | モデル / 量子化 | 推定 VRAM |
|--------|----------------|-----------|
| T2I (Qwen 2512) | FP8 | 約 12–14 GB |
| I2I Edit (Qwen 2511) | BF16 | 約 16–20 GB |
| T2V (Wan2.2 14B) | GGUF Q4_0_K + CPU offload | 約 10–12 GB |
| I2V (Wan2.2 14B) | FP8 | 約 16–18 GB |
| FLF / I2V (Wan2.2 14B) | FP8 | 約 16–18 GB |
| T2A (ACE-Step 1.5) | BF16 | 約 6–8 GB |
| 背景除去 (RMBG) | FP32 | 約 1 GB |

> **ディスク容量:** すべてのモデルをダウンロードすると約 **80–85 GB** のディスク容量が必要です。

## ダウンロードが必要なモデル

以下は `simple_video_app` が既定で使用する workflow JSON に記載されているモデル名です。
ファイル名が一致しないとロードに失敗します。

> **配置先:** すべて `ComfyUI/models/` 以下のサブフォルダです。ツリー内の `diffusion_models/`, `loras/`, `text_encoders/`, `vae/`, `checkpoints/` はそれぞれ `ComfyUI/models/` 直下のフォルダを指します。

### Qwen Image 系（T2I / I2I）

```
共通
├── text_encoders/      qwen_2.5_vl_7b_fp8_scaled.safetensors
└── vae/                qwen_image_vae.safetensors

2512 系（T2I / I2I 画像生成）
└── diffusion_models/   qwen_image_2512_fp8_e4m3fn.safetensors        ← ベース
    └── loras/          Qwen-Image-Lightning-4steps-V1.0.safetensors ← 4step 高速化

2511 系（I2I 画像編集 / キャラ合成）
└── diffusion_models/   qwen_image_edit_2511_bf16.safetensors                    ← ベース
    └── loras/          Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors ← 4step 高速化
```

- 2512 と 2511 の LoRA は各ベース専用（互換性なし）
- `--image-model 2511` 起動時は 2512 系の 2 ファイルが不要（→ `docs/TECHNICAL_JP.md` 10.4 参照）

### Wan2.2 系（T2V / I2V / FLF）

2 段階ノイズ除去のため、高ノイズ用と低ノイズ用のモデルを常にペアでロードします。

```
共通
├── vae/                wan_2.1_vae.safetensors
└── text_encoders/      umt5_xxl_fp8_e4m3fn_scaled.safetensors
                        （I2V のみ umt5_xxl_fp16.safetensors も使用）

T2V（テキスト→動画）
├── 高ノイズ段（step 0→2）
│   └── diffusion_models/   wan2.2_t2v_high_noise_14B_Q4_K_M.gguf                    ← ベース(GGUF)
│       └── loras/          wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors ← 4step
└── 低ノイズ段（step 2→4）
    └── diffusion_models/   wan2.2_t2v_low_noise_14B_Q5_K_M.gguf                     ← ベース(GGUF)
        └── loras/          wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors  ← 4step

I2V / FLF（画像→動画 / 先頭末尾フレーム補間）  ※Seko-V1 LoRA 使用
├── 高ノイズ段（step 0→2）
│   └── diffusion_models/   wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors   ← ベース
│       └── loras/          high_noise_model.safetensors                       ← Seko-V1 LoRA
└── 低ノイズ段（step 2→4）
    └── diffusion_models/   wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors    ← ベース
        └── loras/          low_noise_model.safetensors                        ← Seko-V1 LoRA
```

- T2V と I2V の UNET / LoRA は互換性なし（別モデル）

### 背景削除（初期画像生成前処理）

- 背景削除チェック ON 時は、`remove_bg_v1_0` ワークフロー（`workflows/remove_bg_v1.0_api.json`）を実行します。
- この前処理は ComfyUI 側で `remove_bg` 系ノード/モデルが解決できる構成であることが前提です。
- 構成不足時は背景削除ステップでエラーになるため、`/api/v1/workflows` に `remove_bg_v1_0` が表示されることを確認してください。
- FLF は I2V と同じモデルスタックを共有
- `high_noise_model` / `low_noise_model` は Seko-V1 LoRA のワークフロー内参照名。入手した LoRA をこのファイル名にリネームまたはシンボリックリンクして配置すること

### ACE-Step（T2A）

```
└── checkpoints/  ace_step_1.5_turbo_aio.safetensors
```

### 補足

- 上記は workflow 定義上のファイル名です。配布名が異なる場合は、workflow JSON 側のモデル指定名を実ファイル名に合わせてください。
- 各モデルの配置先は `ComfyUI/models/` 以下の対応フォルダです
- `diffusion_models/` は `unet/` でも検索されます（ComfyUI のレガシー互換）

### ダウンロード先候補（検索リンク）

モデルは公開場所・ファイル名が更新されることがあるため、以下の検索リンクから取得し、workflow 記載名と一致させて配置してください。

- Qwen Image 2512 base: https://huggingface.co/models?search=qwen_image_2512_fp8_e4m3fn
- Qwen Image Edit 2511 base: https://huggingface.co/models?search=qwen_image_edit_2511_bf16
- Qwen Image Lightning LoRA: https://huggingface.co/models?search=Qwen-Image-Lightning-4steps
- Qwen Image Edit Lightning LoRA: https://huggingface.co/models?search=Qwen-Image-Edit-2511-Lightning-4steps
- Wan2.2 I2V base（high/low noise）: https://huggingface.co/models?search=wan2.2_i2v_high_noise_14B_fp8_scaled
- Wan2.2 T2V GGUF base（high noise）: https://huggingface.co/models?search=wan2.2_t2v_high_noise_14B_Q4_K_M.gguf
- Wan2.2 T2V GGUF base（low noise）: https://huggingface.co/models?search=wan2.2_t2v_low_noise_14B_Q5_K_M.gguf
- Wan2.2 LightX2V LoRA: https://huggingface.co/models?search=wan2.2_lightx2v_4steps_lora
- ACE-Step 1.5 turbo: https://huggingface.co/models?search=ace_step_1.5_turbo_aio

確認ポイント:

- ダウンロード後、workflow JSON の `unet_name` / `lora_name` / `clip_name` / `vae_name` / `ckpt_name` と実ファイル名を一致させる
- 一致しない場合は、(a) 実ファイルをリネーム、または (b) workflow JSON の指定名を実ファイル名に変更
- `high_noise_model.safetensors` / `low_noise_model.safetensors` は I2V(Seko) workflow の LoRA 参照名なので、同名で `ComfyUI/models/loras/` に置く

### 特殊カスタムノード確認（既定 workflow）

既定 workflow では、以下の特殊ノードを使用します（ComfyUI標準外を含む）。

- Qwen系: `CFGNorm`, `TextEncodeQwenImageEditPlus`, `FluxKontextMultiReferenceLatentMethod`
- Wan系: `LoaderGGUF`, `WanImageToVideo`, `WanFirstLastFrameToVideo`, `CreateVideo`, `SaveVideo`
- ACE-Step系: `TextEncodeAceStepAudio1.5`, `EmptyAceStep1.5LatentAudio`, `VAEDecodeAudio`, `SaveAudioMP3`
- 背景削除系: `LayerMask: RemBgUltra`

ロード状況の確認例（ComfyUI起動中）:

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

### カスタムノード導入手順（わかりやすい版）

方法は 2 つあります。**ComfyUI-Manager で入れる方法**が一番簡単です。

#### 方法A: ComfyUI-Manager で導入（推奨）

1. ComfyUI を起動
2. Manager 画面で必要ノードを検索して Install
3. Install 後に ComfyUI を再起動
4. 上の `object_info` チェックで `missing: none` を確認

#### 方法B: 手動で導入（git clone）

```bash
cd /home/animede/ComfyUI/custom_nodes
git clone <カスタムノードのリポジトリURL>
cd <クローンしたフォルダ名>
python3 -m pip install -r requirements.txt
```

`requirements.txt` がないノードは `pip install` 手順を省略し、ComfyUI を再起動してください。

#### このアプリで確認すべきノード

- Qwen系: `CFGNorm`, `TextEncodeQwenImageEditPlus`, `FluxKontextMultiReferenceLatentMethod`
- Wan系: `LoaderGGUF`, `WanImageToVideo`, `WanFirstLastFrameToVideo`, `CreateVideo`, `SaveVideo`
- ACE-Step系: `TextEncodeAceStepAudio1.5`, `EmptyAceStep1.5LatentAudio`, `VAEDecodeAudio`, `SaveAudioMP3`
- 背景削除系: `LayerMask: RemBgUltra`

#### 具体的なリポジトリ名（どれを入れるか）

- ComfyUI本体（最新版）に含まれるノード
    - `CFGNorm`, `TextEncodeQwenImageEditPlus`, `FluxKontextMultiReferenceLatentMethod`
    - `WanImageToVideo`, `WanFirstLastFrameToVideo`, `CreateVideo`, `SaveVideo`
    - `TextEncodeAceStepAudio1.5`, `EmptyAceStep1.5LatentAudio`, `VAEDecodeAudio`, `SaveAudioMP3`
- 追加導入が必要なノード
    - `LoaderGGUF` → `calcuis/gguf`（https://github.com/calcuis/gguf）
    - `LayerMask: RemBgUltra` → ComfyUI-Manager で `RemBgUltra` または `LayerMask` を検索して導入

※ `LoaderGGUF` が見つからない場合は、まず `calcuis/gguf` を導入してください。

#### インストール確認方法（3ステップ）

1. ComfyUI が起動していることを確認

```bash
curl -s http://127.0.0.1:8188/system_stats | head
```

2. 必要クラスがロードされていることを確認（`missing: none` ならOK）

```bash
python3 - <<'PY'
import json, urllib.request
required=[
    'CFGNorm','TextEncodeQwenImageEditPlus','FluxKontextMultiReferenceLatentMethod',
    'LoaderGGUF','WanImageToVideo','WanFirstLastFrameToVideo','CreateVideo','SaveVideo',
    'TextEncodeAceStepAudio1.5','EmptyAceStep1.5LatentAudio','VAEDecodeAudio','SaveAudioMP3',
    'LayerMask: RemBgUltra'
]
with urllib.request.urlopen('http://127.0.0.1:8188/object_info', timeout=8) as r:
    obj=json.loads(r.read().decode('utf-8'))
missing=[c for c in required if c not in obj]
print('missing:', missing if missing else 'none')
PY
```

3. アプリ側から実ワークフローを実行してエラーが出ないことを確認

- T2V / I2V / T2A を各1回ずつ実行
- ComfyUIログに `Node class not found` / `Cannot import` が出ないことを確認

#### 最も確実な確認方法（ComfyUI GUIで検証）

モデル/ノードの導入確認は、ComfyUI GUIで対応ワークフローを直接開いて実行する方法が最も確実です。

このリポジトリには、確認用GUIワークフローを以下に同梱しています。

- `workflows/gui_validation/image_qwen_Image_2512.json`（T2I）
- `workflows/gui_validation/qwen_image_edit_2511.json`（I2I Edit）
- `workflows/gui_validation/video_wan2_2_14B_t2v_RTX3060_v1_linux.json`（T2V GGUF）
- `workflows/gui_validation/Wan2.2-I2V-A14B-4steps-lora-rank64-Seko-V1-NativeComfy_linux.json`（I2V）
- `workflows/gui_validation/video_wan2_2_14B_flf2v_s_linux.json`（FLF）
- `workflows/gui_validation/ace-step-v1-t2a_linux.json`（T2A）

手順:

1. ComfyUI GUIで workflow JSON を読み込み
2. 各 workflow を 1 回実行
3. `Node class not found` / `Cannot import` / `model not found` が出ないことを確認

エラーが出た場合は、不足したノード名/モデル名をそのまま控えて、上の「AIに聞くテンプレート」に貼り付けてください。

トラブル時は ComfyUI コンソールログに `Node class not found` が出るので、表示されたクラス名を基準に不足ノードを追加してください。

#### うまく入らないとき：AIに聞くときのコツ

AIに相談する場合は、**状況をそのまま貼る**と解決が速くなります。最低限、次を添えてください。

- 実行したコマンド（`git clone ...`, `pip install ...` など）
- エラーログ全文（先頭〜末尾）
- ComfyUI の `/object_info` チェック結果（`missing: ...`）
- OS / Python / ComfyUI の情報（`python3 --version` など）
- どの機能を動かしたいか（T2V / I2V / T2A）

そのまま使える質問テンプレート:

```text
ComfyUI のカスタムノード導入で失敗しています。原因と対処を手順で教えてください。

目的:
- 動かしたい機能: <T2V / I2V / T2A>

環境:
- OS: <例: Ubuntu 24.04>
- Python: <python3 --version の結果>
- ComfyUI: <ブランチ/コミット/起動方法>

実行したコマンド:
<ここに貼る>

エラーログ全文:
<ここに貼る>

object_info チェック結果:
<missing: ...>

希望:
- 初心者向けに、次に打つコマンドを1行ずつ示してください。
- 可能なら、失敗しにくい順（推奨手順→代替手順）で説明してください。
```

短く聞く場合（最小版）:

```text
このエラーを解決したいです。原因候補を3つと、確認コマンド→修正コマンドの順で教えてください。
<エラーログ>
```

確認例:

```bash
python --version
ffmpeg -version
curl -s http://127.0.0.1:8188/system_stats | head
```

## 初心者向け最短手順（10分版）

はじめて導入する場合は、まずこの手順だけ実施してください。

1. ComfyUI を導入して起動（未導入の場合）
    - 公式: https://github.com/comfyanonymous/ComfyUI
    - インストール手順: 公式 README の Install セクション
2. ComfyUI が応答することを確認

```bash
curl -s http://127.0.0.1:8188/system_stats | head
```

3. 本アプリをセットアップ

```bash
cd simple_video_app
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
```

4. モデルを `ComfyUI/models/` 配下に配置（本READMEの「ダウンロードが必要なモデル」を参照）
5. カスタムノードを導入（本READMEの「カスタムノード導入手順」を参照）
6. カスタムノード確認で `missing: none` を確認
7. アプリ起動

```bash
./start.sh
```

8. health check（アプリが起動したか確認）

```bash
curl -s http://127.0.0.1:8090/api/v1/workflows | head
```

9. 1ジョブ実行（最小テスト: T2I）

```bash
JOB_ID=$(curl -s -X POST http://127.0.0.1:8090/api/v1/generate \
    -H 'Content-Type: application/json' \
    -d '{"workflow":"qwen_t2i_2512_lightning4","prompt":"a simple landscape"}' \
    | python3 -c 'import sys,json; print(json.load(sys.stdin).get("job_id",""))')
echo "job_id=$JOB_ID"
curl -s "http://127.0.0.1:8090/api/v1/status/$JOB_ID"
```

10. ブラウザで `http://127.0.0.1:8090/` を開き、T2V / I2V / T2A を各1回テスト

### 最低限の目安（初心者向け）

- Python 3.10+
- ComfyUI がローカルで起動できること
- `ffmpeg` が使えること
- GPUメモリ目安（環境差あり）
    - 画像中心（T2I/I2I）: 12GB 以上推奨
    - 動画中心（Wan2.2 T2V/I2V）: 16GB 以上推奨
    - 快適運用: 24GB 以上推奨
    - 不足時は `--image-model 2511` を利用し、同時実行を避ける

### 最短確認コマンド（コピペ用）

```bash
curl -s http://127.0.0.1:8188/system_stats | head
cd simple_video_app && source .venv/bin/activate && ./start.sh --no-reload
```

## セットアップ

```bash
cd simple_video_app
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
```

## 起動

```bash
./start.sh
```

既定:

- Host: `127.0.0.1`
- Port: `8090`

ブラウザ:

- `http://127.0.0.1:8090/`

起動オプション例:

```bash
./start.sh --help
./start.sh --host 0.0.0.0 --port 8090
./start.sh --comfyui-server 127.0.0.1:8188 --env-file ../.env --no-reload
./start.sh --openai-api-key sk-xxxx
./start.sh --image-model 2511
./start.sh --local-llm
./start.sh --local-llm-model https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf
./start.sh --local-llm-model /path/to/my-model.gguf
./start.sh --ace-step-url http://127.0.0.1:8001
```

補足:

- `start.sh` は `.venv`（`./.venv` または `../.venv`）を自動検出して有効化します
- 画像モデルを軽量側で運用する場合は `--image-model 2511` を使用してください
- `--local-llm` を指定すると、外部 LLM API 不要でシナリオ作成・プロンプト生成・翻訳等が動作します
  - 初回起動時にモデル（gemma-3-4b-it-Q4_K_M.gguf, 約 2.49 GB）を自動ダウンロードします
  - `--local-llm-model` で任意の GGUF モデルを指定可能（URL またはローカルパス）
  - 環境変数 `SIMPLE_VIDEO_LOCAL_LLM_MODEL` でも指定できます
  - CPU のみで動作します（GPU 不要）
  - VLM（画像解析）は引き続き外部 API が必要です
- `--ace-step-url` を指定すると、ACE-Step API サーバー経由で高品質音楽生成（Thinking モード / AI Tag 強化）が利用できます
  - 未指定時は ComfyUI ワークフロー（turbo 8 ステップ）で T2A を実行

環境変数例:

```bash
SIMPLE_VIDEO_HOST=0.0.0.0 SIMPLE_VIDEO_PORT=18090 ./start.sh
OPENAI_BASE_URL=http://127.0.0.1:11434/v1 OPENAI_API_KEY=dummy ./start.sh
```

## ローカル LLM（`--local-llm`）

外部 LLM API（Ollama 等）なしでシナリオ作成・プロンプト生成・翻訳・作詞等を動かす機能です。
llama-cpp-python を使用し、CPU のみで動作します。

### 基本的な使い方

```bash
# デフォルトモデル (gemma-3-4b-it-Q4_K_M, 2.49 GB) で起動
./start.sh --local-llm
```

初回起動時にモデルを自動ダウンロードし、`llm/models/` に保存します。2回目以降はダウンロード不要です。

### カスタムモデルの指定

`--local-llm-model` または環境変数 `SIMPLE_VIDEO_LOCAL_LLM_MODEL` で任意の GGUF モデルを指定できます。

```bash
# HuggingFace の URL を指定（初回自動ダウンロード）
./start.sh --local-llm-model https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf

# ローカルファイルを直接指定
./start.sh --local-llm-model /path/to/my-model.gguf

# 環境変数で指定
SIMPLE_VIDEO_LOCAL_LLM_MODEL=https://huggingface.co/.../model.gguf ./start.sh --local-llm
```

> **注意**: `--local-llm-model` を指定すると `--local-llm` も自動的に有効になります。

### 制限事項

- **VLM（画像解析）には対応していません**。画像解析機能を使う場合は引き続き外部 API が必要です。
- CPU 推論のため、外部 API より応答速度は遅くなります。
- モデルのロードに失敗した場合は外部 LLM API に自動フォールバックします。

## ACE-Step API 統合（`--ace-step-url`）

外部の ACE-Step API サーバーを使って高品質な音楽生成を行う機能です。
ComfyUI ワークフロー経由の T2A（turbo 8 ステップ）に加え、**Thinking モード**（LM 拡張 50 ステップ）
と **AI Tag 強化**（`/format_input`）が利用可能になります。

### 基本的な使い方

```bash
# ACE-Step API サーバーを指定して起動
./start.sh --ace-step-url http://127.0.0.1:8001
```

- `--ace-step-url` 未指定時は従来どおり ComfyUI ワークフローで T2A を実行します
- 指定時は `ace_step_1_5_t2a` ワークフローのジョブが ACE-Step API サーバーに転送されます

### 画面上の操作

ACE-Step API が接続されると、音楽生成セクションに以下のコントロールが表示されます:

| コントロール | 説明 |
|--|--|
| **🧠 Thinking** | ON にすると LM 拡張の高品質生成（steps=50, cfg=3.0）。OFF は turbo モード（steps=8, cfg=1.0） |
| **✨ AI Tags** | ACE-Step API の LM でタグ/キャプションを自動強化 |

### 環境変数

```bash
ACE_STEP_API_URL=http://127.0.0.1:8001 ./start.sh
```

### 制限事項

- ACE-Step API サーバーが別途起動・動作している必要があります
- Thinking モードは生成に数分〜10分かかることがあります
- AI Tag 強化は ACE-Step API サーバー側の LM が必要です

## サーバーモード（マルチユーザー）

複数ユーザーが同時にアクセスできるサーバーモードで起動できます。
セッションごとにデータ（状態・画像・動画・音声）が分離されるため、ユーザー間の干渉がありません。

### 起動方法

```bash
# サーバーモードで起動（start.sh と同じオプションに対応）
bash start_server.sh

# ホスト・ポート指定
bash start_server.sh --host 0.0.0.0 --port 8090

# 各種オプション併用
bash start_server.sh --comfyui-server 192.168.1.100:8188 --ace-step-url http://127.0.0.1:8001
```

または手動で環境変数を設定して起動:

```bash
SIMPLE_VIDEO_MULTI_USER=1 uvicorn app_server:app --host 0.0.0.0 --port 8090
```

### 仕組み

| 項目 | 説明 |
|---|---|
| セッション ID | ブラウザごとに UUID を自動生成（localStorage + Cookie） |
| データ分離 | `data/sessions/{session_id}/` 配下に状態・参照画像を保存 |
| 出力分離 | `output/{image,video,movie,audio}/` 内をセッション ID で分離 |
| テンポラリ | `temp/{session_id}/` で一時ファイルを分離 |

### start.sh との違い

| | `start.sh` | `start_server.sh` |
|---|---|---|
| デフォルト host | `127.0.0.1` | `0.0.0.0` |
| デフォルト reload | `--reload` | off |
| セッション分離 | off | on（`MULTI_USER=1`） |
| ファイル | `app:app` | `app_server:app` |

### 注意事項

- ComfyUI は全ユーザーで共有されるため、同時に大量のジョブを投入すると待ちが発生します
- セッションデータはサーバー再起動後も `data/sessions/` に残ります（手動削除で管理）

## クイックチェック

```bash
curl -s http://127.0.0.1:8090/ | head
curl -s http://127.0.0.1:8090/api/v1/workflows
```

## 使い方ドキュメント

- クイックヘルプ: [docs/HELP_JP.md](docs/HELP_JP.md)
- ユーザーズガイド: [docs/USAGE_JP.md](docs/USAGE_JP.md)
- テクニカルガイド: [docs/TECHNICAL_JP.md](docs/TECHNICAL_JP.md)
- 技術解説記事（詳細版）: [docs/TECHNICAL_ARTICLE_JP.md](docs/TECHNICAL_ARTICLE_JP.md)

## 主要ファイル

- `app.py`: FastAPI サーバ（静的配信 + API）
- `app_server.py`: マルチユーザー版エントリポイント
- `start.sh`: standalone 起動スクリプト
- `start_server.sh`: マルチユーザー版起動スクリプト
- `static/index.html`: かんたん動画画面
- `static/js/bootstrap.js`: 初期化と Help パネル制御
- `static/js/simple_video.js`: 画面ロジック
- `static/js/simple_video_config.js`: standalone 固定設定

## トラブルシューティング

### `ComfyUI /prompt failed` が出る

- エラー詳細の停止箇所を確認（`node_errors`）
- 入力画像や参照画像の設定不足を確認

### 出力が見つからない / 404 になる

- 同じ条件で再生成して新しい `job_id` を確認
- ComfyUI 側の実際の出力有無を確認

### M2V で動画シナリオが空

- 実行時に確認ダイアログが表示されます
- `このまま生成する` または `シナリオを入力する` を選択

### M2V 後の指定シーン再生成で「シーンごとのプロンプトが空」

- `シーンごとのプロンプト` 欄を空にすると、指定シーン再生成は実行できません
- `🤖 プロンプト生成` を再実行してプロンプトを復元してから、指定シーン再生成を実行してください

## 生成サンプル

### 長尺動画

https://github.com/user-attachments/assets/da13a98c-410a-49ce-b2f2-17f86d4b7e6a

### MV（音楽付き動画）

https://github.com/user-attachments/assets/d4401f2f-84b9-4070-ad89-2ab68f13cf70

https://github.com/user-attachments/assets/1e19aebe-271f-4c9f-bbb4-b75bb237d319

## 公開に関する注意

- 本 README は公開リポジトリ向けの利用情報に限定しています。
- 設計途中の内部計画資料は公開ドキュメントの参照対象に含めていません。
