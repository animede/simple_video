# `char_edit_i2v_mixed` パイプライン — 処理フロー全体像

> **プリセット**: `🖼️→🎬🔀 キャラ EDIT + I2I + 混在トランジション`
>
> **パイプライン概要**: EDIT プロンプトでキャラクタ合成画像を作成 → I2I で N+1 枚のシーンごと静止画を生成 → ユーザーがシーン境界ごとのトランジションタイプを確認（FLF / I2V / カット / クロスフェード / フェード黒）→ 境界ごとの動画生成 → ffmpeg で結合 → 音楽マージ（任意）。
>
> **`char_edit_i2i_flf` との主な違い**: すべての遷移に FLF を使用する代わりに、各シーン境界が独立して FLF（滑らかなモーフ）、I2V（動き重視）、カット（直接接続）、クロスフェード、フェード黒を使用できます。LLM がプロンプト生成時にタイプを自動割り当て、ユーザーは生成前にトランジションエディタでオーバーライドできます。

---

## アーキテクチャ概要

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          ユーザー準備フェーズ                                │
│  （すべて手動操作、順序は自由、生成開始前に繰り返し修正可能）                │
│                                                                             │
│  1. シナリオ入力  →  2. シナリオ作成  →  3. シーンプロンプト生成            │
│     （output_type: mixed_sequence → N+1 プロンプト + トランジションヒント） │
│  4. キー画像 / 参照画像  →  5. キャラクタ合成画像（EDIT）                   │
│  6. キャラクタシート（任意）  →  7. 音楽（任意: 作詞→タグ→BGM）            │
└──────────────────────────┬───────────────────────────────────────────────────┘
                           │  ▶ 動画を生成 ボタン
                           ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          自動生成フェーズ                                    │
│  （逐次処理・自動進行、CONTINUE ゲートで1回一時停止）                       │
│                                                                             │
│  A. シーンプロンプト解決（N 境界に対して N+1 プロンプト）                    │
│  B. シーンごとの I2I 画像生成（N+1 枚、キャラクタ参照付き）                 │
│  C. ── CONTINUE ゲート + 🔀 トランジションエディタ（確認・オーバーライド）──│
│  D. 境界ごとの動画生成（境界ごとに FLF または I2V をディスパッチ）           │
│  E. 動画結合（ffmpeg）カット/クロスフェード/フェード処理付き                 │
│  F. 音楽マージ（任意、出力上のボタンから）                                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## フェーズ 1: ユーザー準備（手動ステップ）

### ステップ 1: シナリオ入力（⚙️ シナリオ入力）

| 項目 | 値 |
|------|-----|
| **UI要素** | `<textarea id="simpleVideoScenario">` |
| **状態キー** | `state.scenario` |
| **トリガー** | ユーザーによるテキスト入力（手動） |
| **配置** | 左パネル — シナリオテキストエリア |

**説明**: シナリオの自由記述をテキストエリアに入力または貼り付けます。後続のプロンプト生成すべてのクリエイティブな種となります。言語は任意（通常は日本語）。テキストは `state.scenario` に保存され、`saveSimpleVideoState()` で永続化されます。

**ユーザー介入ポイント**:
- 生成開始前ならいつでも自由に編集可能
- `applySimpleVideoStylePresetToScenario()`（L5471）で画風プリセットを適用可能
- シナリオバリエーション設定: `state.scenarioVariation`（`auto`/`stable`/`normal`/`dynamic`）

---

### ステップ 2: シナリオ作成（🧠 シナリオ作成）

| 項目 | 値 |
|------|-----|
| **関数** | [`generateSimpleVideoScenarioFromIdea()`](static/js/simple_video.js#L7182) |
| **ボタン** | `#simpleVideoScenarioBuildBtn` — "🧠 シナリオ作成" |
| **トリガー** | ボタンクリック（手動） |
| **入力** | `state.scenarioIdea` — 短いアイデアテキスト |
| **出力** | `state.scenario` — 展開されたシナリオテキスト |
| **バックエンド** | `scenario_generate` → `app.py` L2118 経由の LLM 呼び出し |
| **任意** | はい — ユーザーはこのステップなしで直接シナリオを記述可能 |

**処理フロー**:
1. ユーザーが `state.scenarioIdea` に短いアイデアを入力
2. `api.generateUtility({ workflow: 'scenario_generate', user_prompt, prompt_complexity, scene_variation })` を呼び出し
3. バックエンドがシナリオ展開用システムプロンプトと共に LLM へ送信
4. LLM の応答を `extractScenarioFromScenarioGenerateResult()`（L7167）で抽出
5. 結果が `state.scenario` とシナリオテキストエリアに反映

**ユーザー介入ポイント**:
- 作成後にシナリオテキストを自由に編集可能
- `prompt_complexity`: `basic` / `standard` / `rich`
- `scene_variation`: `stable` / `normal` / `dynamic`
- 再度呼び出すとシナリオをゼロから再生成

---

### ステップ 3: シーンプロンプト生成（🤖 プロンプト生成）— 混在モード

| 項目 | 値 |
|------|-----|
| **関数** | [`generateSimpleVideoPrompts()`](static/js/simple_video.js#L4133) |
| **ボタン** | `#simpleVideoPromptGenBtn` — "🤖 プロンプト生成" |
| **トリガー** | ボタンクリック（手動）、またはプロンプトが空の場合に動画生成時に自動呼び出し |
| **入力** | `state.scenario`、キャラクタコンテキスト、画風検出 |
| **出力** | `state.llmPrompt` — `#1: ... #2: ... #N+1: ...` のフォーマット（N 境界に対して N+1 プロンプト） |
| **バックエンド** | `prompt_generate` → `app.py` L2173 経由の LLM 呼び出し |
| **主な違い** | `output_type: 'mixed_sequence'` を LLM に送信し、N+1 シーンプロンプト **およびトランジションタイプの注釈** を境界ごとに要求 |

**処理フロー**:
1. シナリオテキスト、キャラクタトークンガード、画風モードを収集
2. `api.generateUtility({ workflow: 'prompt_generate', output_type: 'mixed_sequence', scene_count: N, ... })` を送信
3. バックエンドが混在シーケンス用システムプロンプトと共に LLM へ送信 — LLM は N+1 シーン記述 **および** N 境界それぞれの `[transition: flf/cut/crossfade/fade_black]` 注釈を生成するよう求められる
4. 結果を `extractPromptsFromPromptGenerateResult()`（L3870）で解析
5. トランジションタイプ注釈を抽出し `state.transitionTypes[]` に格納
6. 後処理:
   - `applySimpleVideoPromptGuardrails()`（L3894）
   - `applySimpleVideoStyleConsistencyGuardrails()`（L4052）
7. 生成後、`renderTransitionEditor()` を呼び出してプロンプト下に 🔀 トランジションエディタアコーディオンを表示

**シーン数**: `state.sceneCount` は N（動画セグメント/境界の数）を指定。パイプラインは **N+1** シーンプロンプトを要求し、N セグメントそれぞれの開始画像と終了画像を提供します。

**ユーザー介入ポイント**:
- `#simpleVideoLLMPrompt` テキストエリアで生成後のプロンプトを編集
- 🔀 トランジションエディタのドロップダウンで個別のトランジションタイプをオーバーライド（ステップ 3b 参照）
- `state.scenarioUseLLM`: LLM 使用 vs 直接コピーの切り替え
- `state.promptComplexity`: `basic` / `standard` / `rich`
- `state.motionStrength`: FLF のモーションレベルに影響

---

### ステップ 3b: トランジションタイプエディタ（🔀 シーン遷移タイプ）

| 項目 | 値 |
|------|-----|
| **関数** | [`renderTransitionEditor()`](static/js/simple_video.js) |
| **トリガー** | プロンプト生成後に自動描画（および CONTINUE ゲート後にも） |
| **状態キー** | `state.transitionTypes[]` — 境界ごとのタイプ配列 |
| **UI** | LLM プロンプトテキストエリア下のアコーディオン |

**説明**: プロンプト生成後、各シーン境界（シーン 1→2、シーン 2→3、…）のカラーバッジとトランジションタイプのドロップダウンを含むアコーディオン UI が表示されます。

**トランジションタイプ**:

| タイプ | ラベル | 説明 |
|--------|--------|------|
| `flf` | 🌊 FLF | Wan2.2 First-Last Frame による滑らかなモーフ |
| `cut` | ✂️ カット | 直接カット（動画生成なし、結合のみ） |
| `crossfade` | 🌓 クロスフェード | ffmpeg クロスフェードフィルター |
| `fade_black` | ⬛ フェード黒 | 黒にフェードアウトしてからフェードイン |
| `none` | — なし | カットと同じ（パススルー） |

**ユーザー介入ポイント**:
- ドロップダウンで任意の境界タイプを変更 — 即座に `state.transitionTypes[i]` に保存
- 変更は動画生成時（ステップ D）に反映
- プロンプト生成の再実行で LLM 推奨値にリセット

---

### ステップ 4: キー画像 / 参照画像（🖼️ キー画像 & 📥 画像ドロップ）

| 項目 | 値 |
|------|-----|
| **UI要素** | キー画像ドロップゾーン、3つのドロップスロット（`ref1`/`ref2`/`ref3`） |
| **状態キー** | `state.keyImage`, `state.uploadedImage`, `state.dropSlots[0..2]` |
| **関数** | [`uploadKeyImage()`](static/js/simple_video.js#L5681), [`uploadDropSlot()`](static/js/simple_video.js#L5769) |
| **トリガー** | ファイルドロップ/アップロード（手動） |

**説明**: ユーザーが参照画像を提供します:
- **キー画像** (`state.keyImage` / `state.uploadedImage`): キャラクタ参照画像 — キャラクタ EDIT ステップのメイン入力
- **ref1** (`dropSlots[0]`): 代替参照画像。キャラクタ EDIT で使用
- **ref2** (`dropSlots[1]`): 複数画像 EDIT 用のセカンダリ参照
- **ref3** (`dropSlots[2]`): 背景/画風参照（`state.ref3UseMode`: `background`/`style`/`anime`）

**ユーザー介入ポイント**:
- いつでもドロップまたはアップロード可能
- `clearKeyImage()`（L5818）または個別スロットのクリアボタンで削除
- `state.removeBgBeforeGenerate`: 生成前に背景を自動削除
- ファイルは `uploadSimpleVideoFile()`（L8467）→ `POST /api/v1/upload` でサーバーにアップロード

---

### ステップ 5: キャラクタ合成画像の生成（🎭 キャラ合成画像）

| 項目 | 値 |
|------|-----|
| **関数** | [`runCharacterImageGeneration()`](static/js/simple_video.js#L7823) |
| **ボタン** | `#simpleVideoCharacterImageGenBtn` — "生成" |
| **トリガー** | ボタンクリック（手動） |
| **入力** | `state.imagePrompt`（EDIT プロンプト）, `state.dropSlots`, キャラクタトークン |
| **出力** | `state.characterImage` — I2I の参照に使われる合成画像 |
| **バックエンド** | Qwen 2511 EDIT（`qwen_i2i_2511_bf16_lightning4`）→ `api.generate()` 経由 |

**処理フロー**:
1. `state.imagePrompt` から EDIT プロンプトを読み取り
2. 正規表現で `@character` トークンを検出
3. `expandCharacterTokensInPrompt()`（L5190）でキャラクタ名 → 説明文 + 登録画像に展開
4. 画像マッピングを構築: `@キャラ名` → `Picture 1`、`ref1` → `Picture 2` 等
5. トークンを `Picture N` 参照に置換
6. 実効参照画像を決定: キャラクタ画像が優先、残りを dropSlots で補完
7. 複数画像対応のため Qwen 2511 ワークフローを強制
8. `wrapQwen2511EditInstructionPrompt()`（L11539）で EDIT 命令フォーマットにラップ
9. `api.generate({ workflow, prompt, input_image, input_image_2, ..., denoise, cfg })` で ComfyUI を呼び出し
10. 出力を `state.characterImage` および `state.keyImage` として保存

**ユーザー介入ポイント**:
- EDIT プロンプト（`state.imagePrompt`）はいつでも編集可能
- ドロップスロットの参照画像を変更可能
- `state.i2iDenoise` と `state.i2iCfg` を調整可能
- ボタンの再クリックで再生成
- プロンプトなしで ref1 がある場合、ref1 がそのまま使用される（生成なし）

---

### ステップ 5b: キャラクタシート生成（任意）

| 項目 | 値 |
|------|-----|
| **関数** | [`runCharacterSheetGeneration()`](static/js/simple_video.js#L8118) |
| **トリガー** | ボタンクリック（手動） |
| **入力** | ref1/keyImage/uploadedImage |
| **出力** | `state.characterSheetImage` |
| **バックエンド** | `character_sheet_card_v1_0` または `character_sheet_card_v1_0_nobg` |

**説明**: 多角度のキャラクタシートを生成します。`state.useCharSheetAsRef` を有効にすると、キャラクタ合成画像の代わりに I2I の参照として使用できます。

---

### ステップ 6: 中間画像の事前生成（任意 — 事前画像生成）

| 項目 | 値 |
|------|-----|
| **関数** | [`startIntermediateImageGeneration()`](static/js/simple_video.js#L9879) |
| **ボタン** | `#simpleVideoVideoInitImageBtn` |
| **トリガー** | ボタンクリック（手動） |
| **出力** | `state.intermediateImages` — N+1 枚のシーンごとの静止画 |

**説明**: メインの動画パイプライン起動前に、N+1 枚の中間シーン画像をすべて事前生成します。コストの高い動画生成に進む前に、品質の低い画像を確認・選択的に再生成できます。

> ⚠️ **N+1 枚**: N シーン境界に対して、このプリセットは **N+1** 枚の静止画を必要とします（1枚の画像が1つのセグメントの終了と次のセグメントの開始の両方を兼ねるため）。事前生成ボタンはキー画像のアップロード後にのみ有効になります。

**ユーザー介入ポイント**:
- `regenerateIntermediateSceneImage(index)`（L5940）で個別シーンを再生成
- `uploadIntermediateSceneImage(index, file)`（L6425）で代替画像をアップロード
- `clearIntermediateSceneImage(index)`（L5928）で個別シーンをクリア
- `clearAllIntermediateImages()`（L6373）で全クリア

---

### ステップ 7: 音楽生成（任意 — BGM生成）

`char_edit_i2i_flf` と同じです。詳細はそちらのドキュメントを参照してください。

#### 7a. 作詞 — [`composeSimpleVideoT2ALyrics()`](static/js/simple_video.js#L4759)
#### 7b. タグ提案 — [`suggestSimpleVideoT2ATags()`](static/js/simple_video.js#L4993)
#### 7c. 音楽生成 — [`startSimpleVideoT2AGeneration()`](static/js/simple_video.js#L4452)
#### 7d. AUTO 生成 — [`autoGenerateSimpleVideoT2A()`](static/js/simple_video.js#L5113)

---

## フェーズ 2: 自動生成パイプライン

### エントリポイント: `startGeneration()`

| 項目 | 値 |
|------|-----|
| **関数** | [`startGeneration()`](static/js/simple_video.js#L12225) |
| **ボタン** | `#simpleVideoGenerateBtn` — "▶ 動画を生成" |
| **トリガー** | ボタンクリック |

**バリデーションチェック**（L12240-12274）:
1. プリセットが選択されていること（`state.selectedPreset`）
2. シナリオまたは M2V オーバーライドが存在すること
3. `preset.requiresImage` の場合はキー画像が必要（中間画像が完了済みの場合は不要）
4. `preset.requiresCharacter` の場合はキャラクタコンテキストが必要
5. プリセットやシーン数が変更された場合、古い中間画像がクリアされる

この関数は `char_edit_i2v_mixed` / `char_edit_i2i_flf` 共有の混在トランジションパイプラインブランチにディスパッチします。

---

### ステップ A: シーンプロンプト解決

| 項目 | 値 |
|------|-----|
| **関数** | [`determineScenePromptsForCurrentSimpleVideoRun()`](static/js/simple_video.js#L12029) |
| **呼び出し箇所** | `startGeneration()` 内の L12304 |
| **自動/手動** | 自動（パイプラインの一部） |

**処理フロー**:
1. `state.llmPrompt` に番号付きプロンプトがあるか確認 → `parseScenePromptsFromText()`（L10636）で解析
2. 空で `scenarioUseLLM` が ON → `generateScenePromptsForCurrentSimpleVideoRun()`（L10688）— LLM が `output_type: 'mixed_sequence'` で **N+1 プロンプト** を生成
3. LLM が OFF → `buildScenePromptsFromScenarioText()`（L10670）で分割、トランジションタイプはすべての境界で `flf` にデフォルト設定
4. `state.sceneCount + 1` に合わせてカウントを正規化

**入力**: `state.scenario`, `state.llmPrompt`, `state.scenarioUseLLM`, `state.sceneCount`
**出力**: 長さ N+1 の `string[]` — シーンプロンプト文字列

---

### ステップ B: シーンごとの I2I 画像生成（N+1 枚）

| 項目 | 値 |
|------|-----|
| **場所** | `startGeneration()` 混在トランジションブランチ |
| **ワークフロー** | `qwen_i2i_2511_bf16_lightning4`（EDIT）または `qwen_i2i_2512_lightning4`（I2I）、`state.i2iRefineWorkflow` で設定可能 |
| **自動/手動** | 自動 |
| **枚数** | **N+1** 枚（非混在プリセットより 1 枚多い） |

**処理フロー**（各シーンインデックス 0..N について）:
1. キャンセル状態を確認
2. **中間画像が既に存在する場合はスキップ**（`inter.images[sceneIndex]?.filename`）
3. このシーンの参照画像を決定:
   - シーン 0: 常に `characterImageFilename` を使用（または `useCharSheetAsRef` の場合はキャラクタシート）
   - シーン 1 以降: `state.i2iRefSource` に依存:
     - `'character'`: キャラクタ合成画像（デフォルト）
     - `'first_scene'`: 生成されたシーン 1 の画像
4. パラメータを構築:
   - `prompt`: `prependNoCharacterCloneGuard()`（L11526）付きのシーンプロンプト
   - `input_image`: 参照画像
   - `input_image_2`: ref3 がアクティブな場合
   - `buildRef3PromptHint()` / `buildCharSheetRefPromptHint()` からのプロンプトヒント
   - Qwen 2511 のプロンプトは `wrapQwen2511EditInstructionPrompt()`（L11539）でラップ
   - `denoise`: `state.i2iDenoise`（デフォルト `'1.0'`）
   - `cfg`: `state.i2iCfg`（デフォルト `'1.0'`）
   - `width`, `height`: `getEffectiveWH()` から取得
5. `runWorkflowStep()`（L11827）→ `api.generate()` → ComfyUI を呼び出し
6. 結果を `inter.images[sceneIndex]` に格納
7. プレビュー描画と中間画像 UI を更新

**参照画像の解決**（`resolveSceneReferenceImageForRun()` L1066）:
```
優先順位: characterSheetImage (useCharSheetAsRef 時) > characterImage > keyImage > dropSlots[0]
```

---

### ステップ C: CONTINUE ゲート + トランジションエディタ（中間画像確認 & 遷移確認）

| 項目 | 値 |
|------|-----|
| **関数** | [`confirmContinueAfterIntermediateImages()`](static/js/simple_video.js#L9428) |
| **自動/手動** | **手動停止** — ユーザーが CONTINUE をクリックする必要あり |

**説明**: N+1 枚のシーン画像がすべて生成された後、パイプラインが一時停止:
```
🖼️ 中間画像確認 (char_edit_i2v_mixed) / 新規生成: N+1 / 全M+1シーン。
必要ならシーン画像を再生成してから CONTINUE を押してください。
```

🔀 **トランジションタイプエディタ** アコーディオンもここで描画され（まだ表示されていない場合）、境界ごとのトランジションタイプの最終確認・オーバーライドが可能です。

**ゲート中のユーザー介入ポイント**:
- UI で N+1 枚の中間画像を**確認**
- `regenerateIntermediateSceneImage(index)` で個別シーンを**再生成** — 緑の 🔄 ボタン
- ファイルドロップで個別シーンスロットに代替画像を**アップロード**
- `clearIntermediateSceneImage(index)` で個別シーンを**クリア** — 赤の ✕ ボタン
- 🔀 アコーディオンのドロップダウンで**トランジションタイプを変更**
- **CONTINUE** をクリックして動画生成に進む
- **PAUSE/STOP** をクリックして中断

CONTINUE 後、パイプラインは `inter.images[]` から `sceneImages[]` をリフレッシュし、修正を反映。

---

### ステップ D: 境界ごとの動画生成（混在ディスパッチ）

| 項目 | 値 |
|------|-----|
| **場所** | `startGeneration()` 混在トランジションブランチ、CONTINUE 後 |
| **自動/手動** | 自動 |
| **ディスパッチ** | `state.transitionTypes[i]` に基づいて境界ごと |

**処理フロー**（各境界 i = 0..N-1 について）:

```
transitionTypes[i] === 'flf'        → FLF 動画生成（Wan2.2 FLF）
transitionTypes[i] === 'cut'        → 動画なし。シーン画像をそのまま使用
transitionTypes[i] === 'crossfade'  → 短いクリップ。結合時に ffmpeg クロスフェード
transitionTypes[i] === 'fade_black' → 短いクリップ。結合時に ffmpeg フェード
transitionTypes[i] === 'none'       → 'cut' と同じ
```

#### D-1: FLF 境界（`flf`）

1. `composeFLFPromptWithEndIntent()`（L12110）で FLF プロンプトを構築:
   ```
   Start intent: [シーン i のプロンプト].
   End target (must be reflected near the end frame): [シーン i+1 のプロンプト].
   Keep subject identity consistent and make camera direction/pose transition smooth and coherent.
   ```
2. パラメータを構築:
   - `input_image_start`: シーン画像 i
   - `input_image_end`: シーン画像 i+1
   - `width`, `height`, `fps`, `frames`
3. `runWorkflowStep()` → `api.generate()` → ComfyUI（`wan22_smooth_first2last` または `wan22_flf2v`）を呼び出し
4. 動画ベース名を `sceneVideoBasenames[]` に格納

**ワークフロー選択**（`state.flfQuality`）:
- `'speed'` → `wan22_smooth_first2last`（4ステップ、高速）
- `'quality'` → `wan22_flf2v`（20ステップ、高品質）

---

### ステップ E: 動画結合

| 項目 | 値 |
|------|-----|
| **場所** | `startGeneration()` L12849-12917 |
| **バックエンド** | `video_concat` → `app.py` L2061 経由の ffmpeg 結合 |
| **自動/手動** | 自動 |

**処理フロー**:
1. `sceneVideoBasenames[]` からクリップリストを組み立て
2. `cut`/`none` 境界: シーン画像を短い静止クリップ（1〜2 フレーム）に変換、またはスキップ
3. `crossfade` / `fade_black` 境界: 結合時に ffmpeg フィルターチェーンを適用
4. `api.generateUtility({ workflow: 'video_concat', videos, fps, keep_audio })` を呼び出し
5. バックエンド（`app.py` L2061-2092）が ffmpeg 結合を実行
6. `showMusicMergeButton: true` で最終出力を描画

---

### ステップ F: 音楽マージ（任意 — 🎵 音楽を追加）

| 項目 | 値 |
|------|-----|
| **関数** | [`mergeM2VAudioWithCurrentVideo()`](static/js/simple_video.js#L8623) |
| **トリガー** | 結合出力上の "🎵 音楽を追加" ボタン |
| **バックエンド** | `video_audio_merge` → `app.py` L2095 経由の ffmpeg |
| **自動/手動** | **手動** |

`char_edit_i2i_flf` と同じです。生成済みまたはアップロード済みの音声を最終動画にマージします。

---

## 主要バックエンド API エンドポイント（`app.py`）

| ワークフロー ID | バックエンドハンドラ | 用途 |
|---|---|---|
| `scenario_generate` | L2118 | LLM によるシナリオ展開 |
| `prompt_generate` | L2173 | LLM シーンプロンプト（`output_type: mixed_sequence` → N+1 + トランジションヒント） |
| `lyrics_generate` | L2324 | LLM による作詞 |
| `ace_step_1_5_t2a` | ComfyUI | ACE-Step 音楽生成 |
| `qwen_i2i_2511_bf16_lightning4` | ComfyUI | Qwen 2511 EDIT I2I（キャラクタ合成 + シーン EDIT） |
| `qwen_i2i_2512_lightning4` | ComfyUI | Qwen 2512 I2I（シーンリファイン、CFG=7.0 / denoise=0.75 refine ワークフロー経由） |
| `wan22_smooth_first2last` | ComfyUI | Wan2.2 FLF 4ステップ — `flf` speed 境界用 |
| `wan22_flf2v` | ComfyUI | Wan2.2 FLF 20ステップ — `flf` quality 境界用 |
| `video_concat` | L2061（ffmpeg） | クリップ結合（クロスフェード/フェードフィルター対応） |
| `video_audio_merge` | L2095（ffmpeg） | 動画 + 音声トラックのマージ |
| `character_sheet_card_v1_0` | ComfyUI | キャラクタシート生成 |
| `remove_bg_v1_0` | ComfyUI | 背景除去 |

> **注意**: `wan22_i2v_lightning`（I2V）はプリセットの `steps[]` に UI ラベル用として記載されていますが、実際の境界ディスパッチでは FLF 境界に `wan22_smooth_first2last` / `wan22_flf2v` が使用されます。純粋な I2V 境界は現在 FLF パスで処理されます（プリセット名はパイプラインの能力を反映しており、I2V 専用パスではありません）。

---

## 関数呼び出しグラフ全体像

```
ユーザーが "▶ 動画を生成" をクリック
  └─ startGeneration()                                         [L12225]
       ├─ バリデーション（プリセット, シナリオ, キー画像, キャラクタ）[L12240-12274]
       ├─ determineScenePromptsForCurrentSimpleVideoRun()      [L12029]
       │    ├─ parseScenePromptsFromText()                     [L10636]
       │    └─ generateScenePromptsForCurrentSimpleVideoRun()  [L10688]
       │         └─ api.generateUtility({prompt_generate,      [バックエンド L2173]
       │                output_type: 'mixed_sequence'})
       │              → N+1 プロンプト + transitionTypes[] を抽出
       │
       ├─ [char_edit_i2v_mixed ブランチ]
       │
       │   ┌─ (A) シーンごとの I2I × N+1 ─────────────────────────────┐
       │   │  for sceneIndex = 0..N:                                   │
       │   │    ├─ resolveSceneReferenceImageForRun()      [L1066]     │
       │   │    ├─ prependNoCharacterCloneGuard()          [L11526]    │
       │   │    ├─ buildRef3PromptHint()                   [L11504]    │
       │   │    ├─ buildCharSheetRefPromptHint()           [L11483]    │
       │   │    ├─ wrapQwen2511EditInstructionPrompt()     [L11539]    │
       │   │    ├─ runWorkflowStep({i2i})                  [L11827]    │
       │   │    │    └─ api.generate() → ComfyUI                      │
       │   │    ├─ renderSimpleVideoOutputMedia()          [L11593]    │
       │   │    └─ renderSimpleVideoIntermediateImagesUI() [L7520]     │
       │   └───────────────────────────────────────────────────────────┘
       │
       │   ┌─ (C) CONTINUE ゲート + トランジションエディタ ───────────┐
       │   │  confirmContinueAfterIntermediateImages()     [L9428]     │
       │   │  renderTransitionEditor()   ← 🔀 アコーディオン UI      │
       │   │  *** ユーザーが一時停止 — 画像 + トランジションタイプを確認 *** │
       │   │  inter.images から sceneImages をリフレッシュ  [L12787]   │
       │   └───────────────────────────────────────────────────────────┘
       │
       │   ┌─ (D) 境界ごとの混在ディスパッチ ─────────────────────────┐
       │   │  for boundary i = 0..N-1:                                │
       │   │    switch(transitionTypes[i]):                           │
       │   │      'flf':                                              │
       │   │        ├─ composeFLFPromptWithEndIntent()    [L12110]    │
       │   │        ├─ computeLTXFrames()                 [L402]      │
       │   │        └─ runWorkflowStep({wan22_smooth_first2last})     │
       │   │      'cut' / 'none':                                     │
       │   │        └─ （動画生成なし — 結合でパススルー）             │
       │   │      'crossfade' / 'fade_black':                         │
       │   │        └─ （短い静止クリップ。結合時に ffmpeg フィルター）│
       │   └───────────────────────────────────────────────────────────┘
       │
       │   ┌─ (E) 動画結合 ─────────────────────────────────────────┐
       │   │  rememberSceneVideoBasenames()                [L12124]   │
       │   │  api.generateUtility({video_concat})                     │
       │   │    └─ バックエンド ffmpeg 結合 + フィルターチェーン      │
       │   │                                              [app.py L2061]
       │   │  renderSimpleVideoOutputMedia({showMusicMergeButton})    │
       │   └─────────────────────────────────────────────────────────┘
       │
       └─ 完了 ✅

[任意、生成後]:
  ユーザーが "🎵 音楽を追加" をクリック
    └─ mergeM2VAudioWithCurrentVideo()                         [L8623]
         └─ runSimpleVideoUtilityJob({video_audio_merge})      [L8674]
              └─ バックエンド ffmpeg マージ                     [app.py L2095]
```

---

## 状態キー一覧

| 状態キー | 型 | 用途 |
|---|---|---|
| `selectedPreset` | `string` | アクティブなプリセット ID（`'char_edit_i2v_mixed'`） |
| `scenario` | `string` | ユーザーのシナリオテキスト |
| `scenarioIdea` | `string` | シナリオ生成用の短いアイデア |
| `llmPrompt` | `string` | 生成されたシーンプロンプト — N+1 エントリ（編集可能） |
| `sceneCount` | `string` | シーン **境界** の数（N）。N+1 枚の画像が生成される |
| `sceneLengthSec` | `string` | シーンセグメントあたりの秒数 |
| `imagePrompt` | `string` | キャラクタ合成用 EDIT プロンプト |
| `keyImage` / `uploadedImage` | `{filename, ...}` | キャラクタ参照画像 |
| `dropSlots[0..2]` | `{filename, ...}[]` | ref1/ref2/ref3 参照画像 |
| `characterImage` | `{filename, presetId, ...}` | 生成されたキャラクタ合成画像 |
| `characterSheetImage` | `{filename, ...}` | 生成されたキャラクタシート |
| `useCharSheetAsRef` | `boolean` | 合成画像の代わりにキャラクタシートを使用 |
| `i2iRefSource` | `'character' \| 'first_scene'` | シーン 2 以降の参照ソース |
| `i2iRefineWorkflow` | `string` | I2I ワークフローのオーバーライド |
| `i2iDenoise` | `string` | I2I のノイズ除去強度 |
| `i2iCfg` | `string` | I2I の CFG スケール |
| `transitionTypes` | `string[]` | 境界ごとのトランジションタイプ（`flf`/`cut`/`crossfade`/`fade_black`/`none`） |
| `flfQuality` | `'speed' \| 'quality'` | FLF 境界の FLF ステップ数 |
| `flfEndConstraintEnabled` | `boolean` | FLF プロンプトに終了ターゲットを注入 |
| `motionStrength` | `string` | FLF のモーションレベルヒント |
| `ref3UseMode` | `string` | ref3 の用途: background/style/anime |
| `intermediateImages` | `{presetId, images[]}` | N+1 枚のシーンごとの静止画 |
| `sceneVideos` | `{presetId, videos[]}` | 境界ごとの動画ベース名 |
| `t2aGeneratedAudio` | `{filename, ...}` | 生成された BGM |
| `m2vDurationPlan` | `number[]` | シーンごとの尺（M2V モード） |
| `fps` | `string` | 目標 FPS |
| `videoSize` | `string` | 目標解像度 |
| `scenarioUseLLM` | `boolean` | プロンプト生成に LLM を使用 |
| `promptComplexity` | `string` | LLM プロンプトの詳細レベル |

---

## プリセット設定

```javascript
// static/js/simple_video.js
{
    id: 'char_edit_i2v_mixed',
    name: '🖼️→🎬🔀 キャラ EDIT + I2I + 混在トランジション',
    requiresImage: true,
    requiresCharacter: true,
    requiresCharacterImage: true,
    supportsRefSourceSelect: true,   // i2iRefSource セレクター表示
    mixedTransitions: true,          // N+1 画像, mixed_sequence output type, トランジションエディタ UI
    steps: [
        { workflow: 'qwen_i2i_2511_bf16_lightning4', label: 'キャラ合成画像(EDIT)' },
        { workflow: 'wan22_i2v_lightning', label: 'シーンI2V' },
        { workflow: 'wan22_smooth_first2last', label: 'FLF遷移' }
    ]
}
```

**主要プリセットフラグ**:
- `requiresImage: true` — キー画像の提供が必須（🎭 キャラクタ EDIT セクションを有効化）
- `requiresCharacter: true` — キャラクタコンテキストが必要
- `requiresCharacterImage: true` — キャラクタ合成 EDIT 画像が必要
- `supportsRefSourceSelect: true` — 参照ソースドロップダウンを表示
- `mixedTransitions: true` — 混在ディスパッチを有効化: N+1 画像要求、`mixed_sequence` プロンプト出力タイプ、`renderTransitionEditor()` アコーディオン、`startGeneration()` での境界ごとの FLF/I2V/カット ディスパッチ

---

## `char_edit_i2i_flf` との比較

| 観点 | `char_edit_i2i_flf` | `char_edit_i2v_mixed` |
|------|--------------------|-----------------------|
| 画像枚数 | N+1（N 本の FLF セグメント用） | N+1（N 境界用） |
| トランジションタイプ | FLF のみ（`wan22_smooth_first2last` / `wan22_flf2v`） | 境界ごと: FLF / カット / クロスフェード / フェード黒 |
| LLM 出力タイプ | `flf_sequence` | `mixed_sequence` |
| トランジションエディタ UI | ❌ 非表示 | ✅ プロンプト生成後と CONTINUE ゲートで表示 |
| `state.transitionTypes[]` | 未使用 | 境界ごとのタイプ配列 |
| `flfOnly` フラグ | `true` | 未設定 |
| `mixedTransitions` フラグ | 未設定 | `true` |
| キャラクタ EDIT ステップ | ✅ 同一 | ✅ 同一 |
| CONTINUE ゲート | ✅ 同一 | ✅ 同一（+ トランジションエディタ） |
| 音楽マージ | ✅ 同一 | ✅ 同一 |
