# ACE-Step 1.5 調査記録（2026-02-21）

## 目的
ACE-Step 1.5 について、以下を確認した記録。

- thinking の役割
- llm_dit と多言語対応の関係
- 声参照（似た声質でのボーカル生成）の可否
- 実運用での推奨設定

---

## 1. thinking の役割

### 結論
- thinking=true で、5Hz LM による audio code 生成を有効化し、llm_dit 経路を使う。
- thinking=false で、LM による code 生成は行わず、dit 経路を使う。
- ただし thinking=false でも、CoT 系フラグ（use_cot_caption / use_cot_language / use_cot_metas）が有効な場合は、メタ補完目的で LM が使われる。

### 補足
OpenRouter API 側でも thinking は bool として受け取り、GenerationParams に渡される。

---

## 2. llm_dit は多言語対応に貢献するか

### 結論
- 貢献する可能性は高い。
- ただし、論文上の主張は Hybrid Reasoning-Diffusion 全体の効果であり、llm_dit 単体寄与を完全に分離した記述までは確認できない。

### 論文から読み取れる点
- LM を Composer Agent として使い、曖昧な入力を構造化して DiT に渡す設計。
- 50+ 言語での指示追従を主張。
- 多言語性能は LM 経路だけでなく、データ前処理（多言語処理）と RL 整合学習の寄与も大きい。

---

## 3. 声参照・似た声質ボーカルの可否

### 結論
- 可能（style/timbre 参照として実装あり）。
- API/推論パラメータとして reference_audio、src_audio、cover、audio_cover_strength が提供されている。

### 注意点
- これは主に「声質・歌唱スタイル寄せ」の機能。
- 特定個人の同一性を厳密再現する完全クローンとは分けて評価する必要がある。

---

## 4. 実運用プリセット（似せ重視）

### 推奨初期値
- task_type: cover
- thinking: true
- use_format: true
- vocal_language: 目標言語を固定（例: ja）
- audio_cover_strength: 0.8
- inference_steps: 8（Turbo）

### 運用のコツ
- 参照音声は 20〜45 秒程度。
- 無音・過剰リバーブ区間を避ける。
- 声が明瞭な区間を使う。
- seed を変えて複数本生成し、選別する。
- 似すぎを避ける場合は audio_cover_strength を 0.55〜0.7 に下げる。

---

## 5. 参考（確認元）

### ローカル実装・ドキュメント
- /home/animede/ACE-Step-1.5/acestep/api_server.py
- /home/animede/ACE-Step-1.5/acestep/inference.py
- /home/animede/ACE-Step-1.5/openrouter/openrouter_api_server.py
- /home/animede/ACE-Step-1.5/docs/ja/API.md
- /home/animede/ACE-Step-1.5/docs/ja/INFERENCE.md
- /home/animede/ACE-Step-1.5/docs/ja/Openrouter_API_DOC.md

### 論文
- https://arxiv.org/abs/2602.00744
- https://arxiv.org/html/2602.00744v3

---

## 6. 備考
本記録は、simple_video_app 側での運用判断（プリセット設計、ヘルプ整備、ユーザー向け説明文作成）のための要約メモ。
必要に応じて、検証ログ（実際の生成比較）を別ファイルで追加する。