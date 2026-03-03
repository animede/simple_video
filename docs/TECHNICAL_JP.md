# かんたん動画 Standalone テクニカルガイド

このドキュメントは `simple_video_app` 向けの技術情報に限定しています。

## 1. スコープ

- 対象: Standalone版 `simple_video_app`
- 非対象: distributed構成、マルチユーザー運用、本家Webアプリ全体機能

## 2. 実行構成

- サーバ: `simple_video_app/app.py`（FastAPI）
- フロント: `simple_video_app/static/index.html` + `static/js/*.js`
- 推論実行先: ComfyUI（既定 `127.0.0.1:8188`）

役割:

- フロントは同一オリジンAPIに接続
- サーバはワークフロー適用・ジョブ管理・出力配信を実施
- ComfyUIの `/prompt` `/history` `/progress` を利用

## 3. 主要ディレクトリ

- `simple_video_app/static/`: UI配信ファイル
- `simple_video_app/docs/`: Help/Guide文書
- `simple_video_app/output/`: Standalone側の成果物配置先
- `simple_video_app/data/`: 状態保存・参照画像インデックス
- `workflows/`: 使用ワークフローJSON

## 4. APIの要点（Standalone）

代表的なAPI:

- `GET /api/v1/workflows`: 利用可能ワークフロー一覧
- `POST /api/v1/generate`: 生成ジョブ投入
- `GET /api/v1/status/{job_id}`: ジョブ状態取得
- `GET /api/v1/download/{job_id}/{filename}`: 成果物ダウンロード
- `POST /api/v1/jobs/{job_id}/interrupt`: ジョブ中断
- `DELETE /api/v1/jobs/{job_id}`: ジョブ削除
- `GET /api/v1/simple-video/help/{doc_key}`: Help文書取得

## 5. ヘルプ配信方式

`SIMPLE_VIDEO_HELP_DOCS` に `doc_key -> ファイル` を定義し、
`/api/v1/simple-video/help/{doc_key}` でMarkdownを返却します。

現在のキー:

- `tutorial` → `HELP_JP.md`
- `guide` → `USAGE_JP.md`
- `technical` → `TECHNICAL_JP.md`

フロント側は `static/js/bootstrap.js` のフローティングパネルで表示し、
Help内部リンク（`/api/v1/simple-video/help/...`）は同パネル内で遷移します。

## 6. ワークフロー固定方針

`static/js/simple_video_config.js` で主要ワークフローを固定し、
Standalone利用時の挙動を安定化しています。

例:

- T2I: `qwen_t2i_2512_lightning4`
- I2I: `qwen_i2i_2511_bf16_lightning4`
- T2V: `qwen22_t2v_4step`
- I2V: `wan22_i2v_lightning`
- FLF: `wan22_smooth_first2last`

## 7. エラーハンドリング要点

- `/prompt` 失敗時はレスポンス本文を付加して原因追跡しやすくする
- `node_errors` を含むComfyUIエラーをそのまま確認可能
- 出力探索は複数候補ディレクトリを順に探索
- 古い `job_id` でも実ファイルがあれば後方互換的に配信を試行

## 8. 既知の制約

- single-user前提
- distributed非対応
- Utility機能はStandaloneでは未対応
- ComfyUI側に必要workflowが存在しない場合は実行不可

## 9. 変更時のチェックポイント

1. `app.py` のAPI仕様とフロント呼び出し整合
2. Help文書キーの追加時は `SIMPLE_VIDEO_HELP_DOCS` を更新
3. ワークフローID変更時は `simple_video_config.js` とUI側分岐を同時更新
4. 出力配信パス変更時は `download` の探索ロジックも確認

## 10. 必須モデル（正式ファイル名）

以下は Standalone 既定 workflow で参照されるモデル名です。
ファイル名不一致時はモデルロードに失敗します。

### 10.1 Qwen Image 系（T2I / I2I）

- `qwen_2.5_vl_7b_fp8_scaled.safetensors`
- `qwen_image_vae.safetensors`
- `qwen_image_2512_fp8_e4m3fn.safetensors`
- `Qwen-Image-Lightning-4steps-V1.0.safetensors`
- `qwen_image_edit_2511_bf16.safetensors`
- `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors`

### 10.2 Wan2.2 系（T2V / I2V / FLF）

- `umt5_xxl_fp8_e4m3fn_scaled.safetensors`
- `umt5_xxl_fp16.safetensors`
- `wan_2.1_vae.safetensors`
- `wan2.2_t2v_high_noise_14B_Q4_K_M.gguf`
- `wan2.2_t2v_low_noise_14B_Q5_K_M.gguf`
- `wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors`
- `wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors`
- `wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors`
- `wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors`
- `wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors`
- `wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors`
- `high_noise_model.safetensors`（I2V workflow設定名）
- `low_noise_model.safetensors`（I2V workflow設定名）

### 10.3 ACE-Step（T2A）

- `ace_step_1.5_turbo_aio.safetensors`

### 10.4 運用補足

- workflow定義上のファイル名と実ファイル名を一致させること
- 名前が異なる配布物は、workflow JSON 側のモデル指定名を実環境に合わせること
