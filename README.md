# Simple Video Standalone

`simple_video_app` は、ComfyUI をバックエンドとして使う `かんたん動画` の standalone アプリです。

公開リポジトリ向けに、利用者が必要な情報（導入・実行・操作・制約）に限定して記載しています。

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
- アプリ内フローティング Help（クイックヘルプ / ユーザーズガイド / テクニカルガイド）

## このアプリでできること（実運用イメージ）

- 画像を作る（T2I）
- 画像を修正する（I2I）
- 動画を作る（T2V / I2V / FLF）
- 音楽を作る（T2A）
- 音楽に動画を重ねて MV を作る（M2V）
- 動画に音楽を重ねて PV を作る（V2M）

上記を1つのUIで連続実行できるため、画像・動画・音楽・音声付き動画を段階的に制作できます。

## 対応範囲

- single-user 前提
- local ComfyUI 前提（既定 `127.0.0.1:8188`）
- かんたん動画で使用する API のみ実装

### 非対応

- distributed モード
- 複数ユーザー同時運用
- Standalone版での Utility 機能（本家向け機能）

## 要件

- Python 3.10+
- ComfyUI（起動済み）
- `ffmpeg`（動画結合・音声合成などで使用）

## ダウンロードが必要なモデル（役割別 / 配置先フォルダ）

以下は `simple_video_app` が既定で使用する workflow JSON に記載されているモデル名です。
ファイル名が一致しないとロードに失敗します。

### UNET（`ComfyUI/models/unet/`）

- `qwen_image_2512_fp8_e4m3fn.safetensors`（Qwen Image T2I/I2I）
- `qwen_image_edit_2511_bf16.safetensors`（Qwen Image Edit I2I）
- `wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors`（Wan I2V high noise）
- `wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors`（Wan I2V low noise）

### GGUF UNET（`ComfyUI/models/unet/` または GGUF系カスタムノード既定フォルダ）

- `wan2.2_t2v_high_noise_14B_Q4_K_M.gguf`（Wan T2V high noise）
- `wan2.2_t2v_low_noise_14B_Q5_K_M.gguf`（Wan T2V low noise）

### VAE（`ComfyUI/models/vae/`）

- `qwen_image_vae.safetensors`
- `wan_2.1_vae.safetensors`

### CLIP / Text Encoder（`ComfyUI/models/text_encoders/`）

- `qwen_2.5_vl_7b_fp8_scaled.safetensors`（Qwen Image系）
- `umt5_xxl_fp8_e4m3fn_scaled.safetensors`（Wan系）
- `umt5_xxl_fp16.safetensors`（Wan系）

### LoRA（`ComfyUI/models/loras/`）

- `Qwen-Image-Lightning-4steps-V1.0.safetensors`
- `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors`
- `wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors`
- `wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors`
- `wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors`
- `wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors`

### Checkpoint（`ComfyUI/models/checkpoints/`）

- `ace_step_1.5_turbo_aio.safetensors`（ACE-Step 1.5 / T2A）

### ワークフロー内の別名（エイリアス）

- `high_noise_model.safetensors`（I2V workflow設定名）
- `low_noise_model.safetensors`（I2V workflow設定名）

### 補足

- 上記は workflow 定義上のファイル名です。配布名が異なる場合は、workflow JSON 側のモデル指定名を実ファイル名に合わせてください。
- `high_noise_model.safetensors` / `low_noise_model.safetensors` は、実体として `wan2.2_i2v_*` 系UNETを参照するための設定名です。

確認例:

```bash
python --version
ffmpeg -version
curl -s http://127.0.0.1:8188/system_stats | head
```

## セットアップ

```bash
cd simple_video_app
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
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
```

環境変数例:

```bash
SIMPLE_VIDEO_HOST=0.0.0.0 SIMPLE_VIDEO_PORT=18090 ./start.sh
```

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
- note向け記事原稿: [docs/NOTE_ARTICLE_JP.md](docs/NOTE_ARTICLE_JP.md)

## 主要ファイル

- `app.py`: FastAPI サーバ（静的配信 + API）
- `start.sh`: standalone 起動スクリプト
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

## 公開に関する注意

- 本 README は公開リポジトリ向けの利用情報に限定しています。
- 設計途中の内部計画資料は公開ドキュメントの参照対象に含めていません。
