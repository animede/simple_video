# かんたん動画専用 API マージ計画（single-node / single-user）

> 公開対象外（内部計画資料）

最終更新: 2026-02-19

## 目的

`simple_video_app` を、既存 `comfyui_api_server_v2.py` から必要機能のみ移植した
**かんたん動画専用API** で動かす。

前提:
- distributed 非対応
- 複数ユーザー非対応（単一セッション前提）
- 管理画面/管理APIは実装しない

今回のゴール:
- `simple_video_app` から既存巨大APIに依存せず、専用APIサーバで完走できること
- 既存 `simple_video.js` を大改修せず、API互換で動かすこと

---

## 採用する構成

- フロント: 既存 `simple_video.js`（移植済み）
- API: 新規 `simple_video_api_server.py`（これから実装）
- 生成実行先: ComfyUI 本体（`127.0.0.1:8188`）
- LLM/VLM: OpenAI互換API（必要時）
- メディア処理: `ffmpeg`（video_concat/video_audio_merge/extract_last_frame で使用）

想定プロセス:
- `simple_video_app` (静的UI)
- `simple_video_api_server.py` (専用FastAPI)
- ComfyUI (`:8188`)

---

## 抜け漏れチェック（今回追加）

### A. API互換
- [ ] `simple_video.js` が呼ぶ endpoint を100%網羅
- [ ] `api.js` のメソッド契約（レスポンス形）を維持
- [ ] WebSocket進捗イベントの `status/progress/message` 互換を維持

### B. 実行依存
- [ ] `WORKFLOW_NAMES` 最小 alias を用意
- [ ] `apply_parameters` の対象workflow分岐を移植
- [ ] `ffmpeg` 未導入時の明示エラーを実装
- [ ] LLM/VLM 接続失敗時のエラーメッセージを明確化

### C. ファイルI/O
- [ ] upload → input 保存
- [ ] outputs/download/view の解決順を統一
- [ ] ref-images/state の保存先を固定（single-user向け）

### D. 運用
- [ ] `.env`/起動引数/README が一致
- [ ] 健康チェック endpoint を用意
- [ ] ログ粒度（INFO/ERROR）を最小規約化

---

## API互換マトリクス（必須）

`simple_video.js` と `api.js` から見た必須API。

### 生成・進捗
- `POST /api/v1/generate`
- `GET /api/v1/status/{job_id}`
- `GET /api/v1/outputs/{job_id}`
- `GET /api/v1/download/{job_id}/{filename}`
- `POST /api/v1/jobs/{job_id}/interrupt`
- `WS /ws/jobs/{job_id}`

### Utility（かんたん動画利用分のみ）
- `POST /api/v1/utility`
  - `video_concat`
  - `video_audio_merge`
  - `prompt_generate`
  - `lyrics_generate`
  - `lyrics_to_tags`
  - `spec_generate`
  - `extract_last_frame`
  - `prompt_expand`

### 補助I/O
- `POST /api/v1/upload`
- `GET /api/v1/files/{filename:path}`
- `GET /view`

### 状態/参照画像
- `GET /api/v1/simple-video/state`
- `POST /api/v1/simple-video/state`
- `GET /api/v1/ref-images`
- `POST /api/v1/ref-images`
- `DELETE /api/v1/ref-images/{name}`
- `GET /api/v1/ref-images/file/{name}`

### テキスト補助
- `POST /api/v1/translate`
- `POST /api/v1/vlm/analyze`

---

## APIの最小スコープ（実装対象）

### 1) 生成・進捗
- `POST /api/v1/generate`
- `GET /api/v1/status/{job_id}`
- `GET /api/v1/outputs/{job_id}`
- `GET /api/v1/download/{job_id}/{filename}`
- `POST /api/v1/jobs/{job_id}/interrupt`
- `WS /ws/jobs/{job_id}`

### 2) Utility（かんたん動画で使用）
- `POST /api/v1/utility` の以下 workflow のみ
  - `video_concat`
  - `video_audio_merge`
  - `prompt_generate`
  - `lyrics_generate`
  - `lyrics_to_tags`
  - `spec_generate`
  - `extract_last_frame`
  - `prompt_expand`

### 3) 入出力補助
- `POST /api/v1/upload`
- `GET /api/v1/files/{filename:path}`
- `GET /view`

### 4) 状態保存（single-user簡易版）
- `GET /api/v1/simple-video/state`
- `POST /api/v1/simple-video/state`
- `GET /api/v1/ref-images`
- `POST /api/v1/ref-images`
- `DELETE /api/v1/ref-images/{name}`
- `GET /api/v1/ref-images/file/{name}`

### 5) テキスト補助
- `POST /api/v1/translate`
- `POST /api/v1/vlm/analyze`（キー画像解析を使う場合）

---

## 明示的に除外する機能

- distributed mode 全般（worker/coordinator/proxy）
- admin 系 API
- cleanup サービス
- telop 系 API
- output browser 拡張機能
- Stable Audio 専用API

---

## 環境変数（single-node向け最小）

- `COMFYUI_SERVER`（default: `127.0.0.1:8188`）
- `OPENAI_BASE_URL`
- `OPENAI_API_KEY`
- `VLM_BASE_URL`（未設定時は OPENAI_BASE_URL を流用）
- `VLM_API_KEY`（未設定時は OPENAI_API_KEY を流用）
- `VLM_MODEL`
- `FFMPEG_PATH`（任意）
- `WORKFLOW_API_DIR`（任意。未設定時は `workflows/`）

---

## ディレクトリ設計（専用API側）

- `simple_video_app/api/`
  - `simple_video_api_server.py`（エントリ）
  - `models.py`（Pydantic）
  - `queue.py`（Job/JobQueue/WS配信）
  - `workflows.py`（alias + 読込）
  - `utility/`（video_concat/video_audio_merge など）
  - `llm/`（prompt/lyrics/spec/translate/vlm）
  - `storage/`（state/ref-images）

※ 初期は1ファイルでも可。安定後に分割。

---

## ワークフロー alias の最小セット

かんたん動画のプリセットで参照される alias のみ残す:
- `qwen_t2i_2512_lightning4`
- `qwen22_t2v_4step`
- `wan22_i2v_lightning`
- `wan22_smooth_first2last`
- `qwen_i2i_2511_bf16_lightning4`
- `qwen_i2i_2512_lightning4`
- `i2i_qwen_image_edit_2511_bf16_lightning4_api.json`（初期リファイン経由）
- `i2i_qwen_image_edit_2511`
- `ace_step_1_5_t2a`

※ 実際は `simple_video.js` の workflow ID と一致確認しながら最終確定する。

補足:
- alias と `*_api.json` の対応表は専用サーバ内に固定。
- 初期は「かんたん動画プリセットで実際に使うもの」だけ登録する。

---

## 実装ステップ（詳細）

### Phase 0: 土台
1. `simple_video_api_server.py` 作成
2. ヘルスチェック `/health` 追加
3. 設定ロード（env）と起動ログ整備

完了条件:
- サーバ起動・停止が安定
- 必須環境変数不足時に起動時警告が出る

### Phase 1: 生成コア
1. `Job`, `JobStatus`, `JobQueue` を実装
2. `/api/v1/generate`, `/api/v1/status/{job_id}`
3. `/ws/jobs/{job_id}` で進捗配信
4. `/api/v1/outputs/{job_id}`, `/api/v1/download/{job_id}/{filename}`

完了条件:
- 単一 workflow で生成→進捗→ダウンロード完了
- interrupt が有効

### Phase 2: Utility
1. `/api/v1/utility` と 8 workflow 実装
2. ffmpeg系 utility（concat/merge/extract）を先行
3. LLM系 utility（prompt/lyrics/spec/expand）を接続

完了条件:
- M2V, V2M に必要な utility が単体で成功

### Phase 3: 入出力補助
1. `/api/v1/upload`, `/api/v1/files/{filename:path}`, `/view`
2. MIME判定・パス検証・エラー整備

完了条件:
- 画像/動画/音声 upload 後、UIで即プレビュー可能

### Phase 4: 状態/参照画像
1. `simple-video/state` の保存/読込
2. `ref-images` CRUD とファイル配信

完了条件:
- 画面リロード後も必要状態を復元

### Phase 5: テキスト補助
1. `/api/v1/translate`
2. `/api/v1/vlm/analyze`

完了条件:
- 生成プロンプト翻訳、キー画像解析が動作

### Phase 6: E2E検証
1. A群
2. M2V
3. V2M
4. C群CONTINUE

完了条件:
- 受け入れ基準を満たす

---

## リスクと回避

- リスク: 既存 `apply_parameters` 依存が大きい
  - 回避: 先に alias を最小化し、対象workflowのパラメータだけ対応
- リスク: ffmpeg 未導入で utility 失敗
  - 回避: 起動時に ffmpeg 存在チェック
- リスク: LLM接続先設定ミス
  - 回避: `.env` / 起動ログに base_url を表示
- リスク: `/view` と `/files` の参照パス不一致
  - 回避: 保存先規約を先に固定し、テストケース化
- リスク: 互換レスポンス差分でUIが沈黙
  - 回避: `api.js` 契約のJSON形を fixture 化して検証

---

## テスト計画（詳細）

### 1) API単体
- [ ] `/generate` 正常/異常
- [ ] `/utility` 各 workflow 正常/異常
- [ ] `/upload` 画像/動画/音声
- [ ] `/translate`, `/vlm/analyze`

### 2) 互換
- [ ] `api.js` の `generate/getJobStatus/monitorProgress/getOutputs/getDownloadURL` がそのまま動く
- [ ] `simple_video.js` の直接fetch先（`/view`, `/upload`, `/translate`, `/vlm/analyze`）が動く

### 3) E2E
- [ ] A群1本完走
- [ ] M2V完走（spec→prompt→video→merge）
- [ ] V2M完走（lyrics→tags→t2a）
- [ ] C群CONTINUE（停止→再開）

### 4) 障害系
- [ ] ffmpegなし
- [ ] ComfyUI停止
- [ ] LLM停止
- [ ] 入力ファイル欠損

---

## ロールバック方針

- 問題発生時は `simple_video_app` の API base を既存APIへ戻せるようにする
  - `?api=http://127.0.0.1:8000`
- 新APIは段階導入し、Phaseごとにタグを打つ
- 不具合時は前Phaseタグへ即時復帰

---

## 受け入れ基準

- かんたん動画画面から以下が完走できる
  - A群: 1本生成
  - M2V: 音声合成まで
  - V2M: 作詞→タグ→BGM生成
- 進捗表示（WS）が機能する
- 中断（interrupt）が機能する
- 主要失敗時に 4xx/5xx が明確に返る

追加基準:
- 既存 `simple_video.js` の改修なし（または最小）で動作する
- 起動手順が README のみで再現可能

---

## 2026-02-19 追記（ドキュメント運用のStandalone専用化）

本日の実装で、Help配信ドキュメントをStandalone専用に整理した。

- `tutorial` は `HELP_JP.md`（クイックヘルプ）を返す
- `guide` は `USAGE_JP.md`（Standaloneユーザーズガイド）を返す
- `technical` は `TECHNICAL_JP.md`（Standaloneテクニカルガイド）を返す

合わせて、フローティングHelp内のリンク遷移は新規タブではなくパネル内表示に変更済み。
これにより、フォーム画面のレイアウト崩れを避けつつ、ガイド参照が可能。

### ドキュメント方針（現行）

- ユーザー向け説明は `simple_video_app/docs/*` に集約
- 本家全体向けドキュメント（`/docs` 配下）は参照用とし、Standalone Helpの既定表示先にはしない
- Standalone未対応機能（Utility/distributed/複数ユーザー）はユーザーズガイドに明示
