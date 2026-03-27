# `char_edit_i2i_flf` パイプライン — 処理フロー全体像

> **プリセット**: `📷→🖼️(EDIT)→🖼️→🎬 キャラクター動画（合成+参照選択）--連続長尺動画`
>
> **パイプライン概要**: EDIT プロンプトでキャラクタ合成画像を作成 → I2I でシーンごとの静止画を生成 → FLF（First-Last Frame）で隣接シーン間の滑らかな動画遷移を生成 → ffmpeg で結合 → 音楽マージ（任意）。

---

## アーキテクチャ概要

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          ユーザー準備フェーズ                                │
│  （すべて手動操作、順序は自由、生成開始前に繰り返し修正可能）                │
│                                                                             │
│  1. シナリオ入力  →  2. シナリオ作成  →  3. シーンプロンプト生成            │
│  4. キー画像 / 参照画像  →  5. キャラクタ合成画像（EDIT）                   │
│  6. キャラクタシート（任意）  →  7. 音楽（任意: 作詞→タグ→BGM）            │
└──────────────────────────┬───────────────────────────────────────────────────┘
                           │  ▶ 動画を生成 ボタン
                           ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          自動生成フェーズ                                    │
│  （逐次処理・自動進行、CONTINUE ゲートで1回一時停止）                       │
│                                                                             │
│  A. シーンプロンプト解決                                                    │
│  B. シーンごとの I2I 画像生成（キャラクタ画像参照付き）                      │
│  C. ── CONTINUE ゲート（中間画像の確認・再生成が可能）──                    │
│  D. FLF 動画生成（隣接シーン画像間）                                        │
│  E. 動画結合（ffmpeg）                                                      │
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
1. ユーザーが `state.scenarioIdea` に短いアイデアを入力（例: "桜の下のデュエル"）
2. `api.generateUtility({ workflow: 'scenario_generate', user_prompt, prompt_complexity, scene_variation })` を呼び出し
3. バックエンド（`app.py` L2118-2171）がシナリオ展開用システムプロンプトと共に LLM へ送信
4. LLM の応答を `extractScenarioFromScenarioGenerateResult()`（L7167）で抽出
5. 結果が `state.scenario` とシナリオテキストエリアに反映

**ユーザー介入ポイント**:
- 作成後にシナリオテキストを自由に編集可能
- `prompt_complexity`: `basic` / `standard` / `rich`
- `scene_variation`: `stable` / `normal` / `dynamic`
- 再度呼び出すとシナリオをゼロから再生成
- `clearSimpleVideoGeneratedPrompts()` と `invalidateGeneratedIntermediateImages()` により下流の古い状態がクリアされる

---

### ステップ 3: シーンプロンプト生成（🤖 プロンプト生成）

| 項目 | 値 |
|------|-----|
| **関数** | [`generateSimpleVideoPrompts()`](static/js/simple_video.js#L4133) |
| **ボタン** | `#simpleVideoPromptGenBtn` — "🤖 プロンプト生成" |
| **トリガー** | ボタンクリック（手動）、またはプロンプトが空の場合に動画生成時に自動呼び出し |
| **入力** | `state.scenario`、キャラクタコンテキスト、画風検出 |
| **出力** | `state.llmPrompt` — `#1: ... #2: ... #N: ...` のフォーマット |
| **バックエンド** | `prompt_generate` → `app.py` L2173 経由の LLM 呼び出し |

**処理フロー**:
1. シナリオテキスト、キャラクタトークンガード、画風モード（lineart/pixel）を収集
2. `state.scenarioUseLLM` が OFF → `buildScenePromptsFromScenarioText()`（L10670）でシナリオ行をそのままプロンプトとしてコピー
3. ON → `api.generateUtility({ workflow: 'prompt_generate', user_prompt, scene_count, output_type, prompt_complexity, scene_variation, target_workflow, flf_motion_level })` を呼び出し
4. バックエンドがシーン生成用システムプロンプトと共に LLM へ送信
5. 結果を `extractPromptsFromPromptGenerateResult()`（L3870）で解析
6. 後処理:
   - `applySimpleVideoPromptGuardrails()`（L3894）— キャラクタ同一性、レイアウトの妥当性
   - `applySimpleVideoStyleConsistencyGuardrails()`（L4052）— 画風タグの注入
7. 番号付きリストとして `state.llmPrompt` にフォーマット

**ユーザー介入ポイント**:
- **生成後のプロンプト編集** — `#simpleVideoLLMPrompt` テキストエリアは自由に編集可能
- `state.scenarioUseLLM`: LLM 使用 vs 直接コピーの切り替え
- `state.promptComplexity`: `basic` / `standard` / `rich`
- `state.motionStrength`: FLF のモーションレベルに影響
- `state.flfEndConstraintEnabled`: 終了ターゲットヒントの注入
- シーン数は `state.sceneCount` で制御（FLF プリセットでは N+1 画像が必要なため +1）
- いつでも再実行可能。下流の中間画像は自動クリアされない

---

### ステップ 4: キー画像 / 参照画像（🖼️ キー画像 & 📥 画像ドロップ）

| 項目 | 値 |
|------|-----|
| **UI要素** | キー画像ドロップゾーン、3つのドロップスロット（`ref1`/`ref2`/`ref3`） |
| **状態キー** | `state.keyImage`, `state.uploadedImage`, `state.dropSlots[0..2]` |
| **関数** | [`uploadKeyImage()`](static/js/simple_video.js#L5681), [`uploadDropSlot()`](static/js/simple_video.js#L5769) |
| **トリガー** | ファイルドロップ/アップロード（手動） |

**説明**: ユーザーが参照画像を提供します:
- **キー画像** (`state.keyImage` / `state.uploadedImage`): I2I シーン生成のメイン参照
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
2. `/@＠|「[^」]+」|"[^"]+"|"[^"]+"/ ` の正規表現で `@character` トークンを検出
3. `expandCharacterTokensInPrompt()`（L5190）でキャラクタ名 → 説明文 + 登録画像に展開
4. 画像マッピングを構築: `@キャラ名` → `Picture 1`、`ref1` → `Picture 2` 等
5. プロンプト内のトークンを `Picture N` 参照に置換
6. 実効参照画像を決定: キャラクタ画像が優先、残りを dropSlots で補完
7. 複数画像対応のため Qwen 2511 ワークフローを強制
8. `wrapQwen2511EditInstructionPrompt()`（L11539）で EDIT 命令フォーマットにラップ
9. `api.generate({ workflow, prompt, input_image, input_image_2, ..., denoise, cfg })` で ComfyUI を呼び出し
10. 出力画像を `state.characterImage` および `state.keyImage` として保存

**ユーザー介入ポイント**:
- EDIT プロンプト（`state.imagePrompt`）はいつでも編集可能
- ドロップスロットの参照画像を変更可能
- `state.i2iDenoise` と `state.i2iCfg` を調整可能
- ボタンの再クリックで再生成
- プロンプトなしで ref1 がある場合、ref1 がそのままキャラクタ画像として使用される（生成なし）

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
| **出力** | `state.intermediateImages` — シーンごとの静止画 |

**説明**: メインの動画パイプライン起動前に、すべての中間シーン画像を事前生成します。コストの高い FLF 動画生成に進む前に、品質の低い画像を確認・選択的に再生成できます。メインパイプラインと同じ I2I ロジックが適用されます。

**ユーザー介入ポイント**:
- `regenerateIntermediateSceneImage(index)`（L5940）で個別シーンを再生成
- `uploadIntermediateSceneImage(index, file)`（L6425）で代替画像をアップロード
- `clearIntermediateSceneImage(index)`（L5928）で個別シーンをクリア
- `clearAllIntermediateImages()`（L6373）で全クリア

---

### ステップ 7: 音楽生成（任意 — BGM生成）

音楽パイプラインには3つのサブステップがあり、個別実行または AUTO で一括実行できます:

#### 7a. 作詞

| 項目 | 値 |
|------|-----|
| **関数** | [`composeSimpleVideoT2ALyrics()`](static/js/simple_video.js#L4759) |
| **トリガー** | ボタンクリック（手動）または AUTO |
| **入力** | `state.t2aScenario` または `state.scenario` または `state.imagePrompt` |
| **出力** | `state.t2aLyrics` |
| **バックエンド** | `lyrics_generate` → `app.py` L2324 経由の LLM 呼び出し |

#### 7b. タグ提案

| 項目 | 値 |
|------|-----|
| **関数** | [`suggestSimpleVideoT2ATags()`](static/js/simple_video.js#L4993) |
| **トリガー** | ボタンクリック（手動）または AUTO |
| **出力** | `state.t2aTags` |

#### 7c. 音楽生成

| 項目 | 値 |
|------|-----|
| **関数** | [`startSimpleVideoT2AGeneration()`](static/js/simple_video.js#L4452) |
| **トリガー** | ボタンクリック（手動）または AUTO |
| **入力** | Tags, lyrics, BPM, key/scale, duration, steps, cfg, seed |
| **出力** | `state.t2aGeneratedAudio` — 音声ファイル |
| **バックエンド** | `ace_step_1_5_t2a` → ACE-Step API または ComfyUI |

#### 7d. AUTO 生成（一括 AUTO）

| 項目 | 値 |
|------|-----|
| **関数** | [`autoGenerateSimpleVideoT2A()`](static/js/simple_video.js#L5113) |
| **トリガー** | AUTO ボタンクリック |
| **処理** | 7a → 7b → 7c を進捗トラッキング付きで逐次実行 |

**ユーザー介入ポイント（全音楽ステップ共通）**:
- 歌詞、タグ、BPM、調、デュレーション等はいつでも編集可能
- `state.t2aLanguage`: 歌詞の言語
- `state.t2aThinking`: ACE-Step API の Thinking モード
- `state.t2aSeed`: 再現性シード
- `uploadM2VAudioSource()`（L8940）で外部音声をアップロード可能

---

## フェーズ 2: 自動生成パイプライン

### エントリポイント: `startGeneration()`

| 項目 | 値 |
|------|-----|
| **関数** | [`startGeneration()`](static/js/simple_video.js#L12225) |
| **ボタン** | `#simpleVideoGenerateBtn` — "▶ 動画を生成"（L3685-3688） |
| **トリガー** | ボタンクリック |

**バリデーションチェック**（L12240-12274）:
1. プリセットが選択されていること（`state.selectedPreset`）
2. シナリオまたは M2V オーバーライドが存在すること
3. `preset.requiresImage` の場合はキー画像が必要（中間画像が完了済みの場合は不要）
4. `preset.requiresCharacter` の場合はキャラクタコンテキストが必要
5. プリセットやシーン数が変更された場合、古い中間画像がクリアされる

この関数は **L12619** の `char_edit_i2i_flf` 専用パイプラインにディスパッチします。

---

### ステップ A: シーンプロンプト解決

| 項目 | 値 |
|------|-----|
| **関数** | [`determineScenePromptsForCurrentSimpleVideoRun()`](static/js/simple_video.js#L12029) |
| **呼び出し箇所** | `startGeneration()` 内の L12304 |
| **自動/手動** | 自動（パイプラインの一部） |

**処理フロー**:
1. `state.llmPrompt` に番号付きプロンプトがあるか確認 → `parseScenePromptsFromText()`（L10636）で解析
2. 空で `scenarioUseLLM` が ON → `generateScenePromptsForCurrentSimpleVideoRun()`（L10688）で LLM プロンプト生成をトリガー
3. LLM が OFF → `buildScenePromptsFromScenarioText()`（L10670）でシナリオテキストを行ごとに分割
4. `state.sceneCount` に合わせてカウントを正規化（パディングまたは切り詰め）

**入力**: `state.scenario`, `state.llmPrompt`, `state.scenarioUseLLM`, `state.sceneCount`
**出力**: `string[]` — シーンプロンプト文字列の配列

---

### ステップ B: シーンごとの I2I 画像生成

| 項目 | 値 |
|------|-----|
| **場所** | `startGeneration()` L12650-12770（`char_edit_i2i_flf` ブランチ） |
| **ワークフロー** | `qwen_i2i_2511_bf16_lightning4`（EDIT）または `qwen_i2i_2512_lightning4`（I2I）、`state.i2iRefineWorkflow` で設定可能 |
| **自動/手動** | 自動（パイプラインの一部） |

**処理フロー**（各シーンインデックス 0..N-1 について）:
1. キャンセル状態を確認
2. **中間画像が既に存在する場合はスキップ**（`inter.images[sceneIndex]?.filename`）
3. このシーンの参照画像を決定:
   - シーン 0: 常に `characterImageFilename` を使用（キャラクタ合成画像、または `useCharSheetAsRef` の場合はキャラクタシート）
   - シーン 1 以降: `state.i2iRefSource` に依存:
     - `'character'`: キャラクタ画像を使用（デフォルト）
     - `'first_scene'`: 生成されたシーン 1 の画像を使用
4. パラメータを構築:
   - `prompt`: `prependNoCharacterCloneGuard()`（L11526）付きのシーンプロンプト
   - `input_image`: 参照画像
   - `input_image_2`: ref3 がアクティブな場合（`state.ref3ModeEnabled` + `dropSlots[2]`）
   - ref3 モードとキャラクタシート用のプロンプトヒントを注入
   - Qwen 2511 の場合: `wrapQwen2511EditInstructionPrompt()`（L11539）でラップ
   - `denoise`: `state.i2iDenoise`（デフォルト `'1.0'`）
   - `cfg`: `state.i2iCfg`（デフォルト `'1.0'`）
   - `width`, `height`: `getEffectiveWH()` から取得
5. `runWorkflowStep()`（L11827）→ `api.generate()` → ComfyUI を呼び出し
6. 結果を `inter.images[sceneIndex]` に格納（source, filename, jobId, prompt）
7. `renderSimpleVideoOutputMedia()` でプレビュー描画
8. `renderSimpleVideoIntermediateImagesUI()` で中間画像 UI を更新

**参照画像の解決**（`resolveSceneReferenceImageForRun()` L1066）:
```
優先順位: characterSheetImage (useCharSheetAsRef 時) > characterImage > keyImage > dropSlots[0]
```

---

### ステップ C: CONTINUE ゲート（中間画像確認）

| 項目 | 値 |
|------|-----|
| **関数** | [`confirmContinueAfterIntermediateImages()`](static/js/simple_video.js#L9428) |
| **呼び出し箇所** | `char_edit_i2i_flf` パイプライン内の L12779 |
| **自動/手動** | **手動停止** — ユーザーが CONTINUE をクリックする必要あり |

**説明**: すべてのシーン画像が生成された後、パイプラインが一時停止し以下を表示:
```
🖼️ 中間画像確認 (preset) / 新規生成: N / 全Mシーン。
必要ならシーン画像を再生成してから CONTINUE を押してください。
```

**ゲート中のユーザー介入ポイント**:
- UI で生成された中間画像を**確認**
- `regenerateIntermediateSceneImage(index)`（L5940）で個別シーンを**再生成** — 緑の 🔄 ボタン
- ファイルドロップで個別シーンスロットに代替画像を**アップロード**
- `clearIntermediateSceneImage(index)`（L5928）で個別シーンを**クリア** — 赤の ✕ ボタン
- **CONTINUE** をクリックして FLF 動画生成に進む
- **PAUSE/STOP** をクリックして中断（動画生成せずにパイプラインが終了）

CONTINUE クリック後、パイプラインは `inter.images[]` から `sceneImages[]` を**リフレッシュ**し、ユーザーの修正を反映（L12787-12795）。

---

### ステップ D: FLF 動画生成（First-Last Frame 遷移）

| 項目 | 値 |
|------|-----|
| **場所** | `startGeneration()` L12798-12847 |
| **ワークフロー** | `wan22_smooth_first2last`（speed/4ステップ）または `wan22_flf2v`（quality/20ステップ） |
| **選択** | `state.flfQuality`: `'speed'` → 4ステップ、`'quality'` → 20ステップ |
| **自動/手動** | 自動 |

**処理フロー**（隣接するシーン画像のペアごとに）:
1. キャンセル状態を確認
2. `composeFLFPromptWithEndIntent()`（L12110）で FLF プロンプトを構築:
   ```
   Start intent: [シーン N のプロンプト].
   End target (must be reflected near the end frame): [シーン N+1 のプロンプト].
   Keep subject identity consistent and make camera direction/pose transition smooth and coherent.
   ```
   （`state.flfEndConstraintEnabled` で終了ターゲット注入を制御）
3. パラメータを構築:
   - `prompt`: 構成された FLF プロンプト
   - `input_image_start`: シーン画像 N
   - `input_image_end`: シーン画像 N+1
   - `width`, `height`
   - `fps`: `state.fps` またはワークフローのデフォルト
   - `frames`: `computeLTXFrames()`（L402）で計算（`getSceneFramesForIndex()` が M2V デュレーション計画を考慮）
4. `runWorkflowStep()` → `api.generate()` → ComfyUI（Wan2.2 FLF モデル）を呼び出し
5. 動画出力ファイル名を抽出し、`sceneVideoBasenames[]` に追加
6. `renderSimpleVideoOutputMedia()` でプレビュー描画

**重要な計算**: N 枚のシーン画像に対して、N-1 本の FLF 動画セグメントを生成。

---

### ステップ E: 動画結合

| 項目 | 値 |
|------|-----|
| **場所** | `startGeneration()` L12849-12917 |
| **バックエンド** | `video_concat` → `app.py` L2061 経由の ffmpeg 結合 |
| **自動/手動** | 自動 |

**処理フロー**:
1. 動画が 2 本未満 → 結合をスキップ
2. `rememberSceneVideoBasenames()`（L12124）でシーン動画ベース名を記憶
3. `api.generateUtility({ workflow: 'video_concat', videos, fps, keep_audio })` を呼び出し
4. バックエンド（`app.py` L2061-2092）:
   - ffmpeg 結合リストファイルを作成
   - 実行: `ffmpeg -f concat -c:v libx264 -preset fast -crf 23 -r {fps} -pix_fmt yuv420p -movflags +faststart`
5. WebSocket で進捗を監視
6. `showMusicMergeButton: true` で最終出力を描画

**ユーザー介入ポイント**:
- `regenerateSingleSceneVideo(index)`（L5985）で個別シーン動画を再生成し、`runSceneVideosConcatFromState()`（L12160）で再結合可能

---

### ステップ F: 音楽マージ（任意 — 🎵 音楽を追加）

| 項目 | 値 |
|------|-----|
| **関数** | [`mergeM2VAudioWithCurrentVideo()`](static/js/simple_video.js#L8623) |
| **トリガー** | 結合出力上の "🎵 音楽を追加" ボタン（手動） |
| **バックエンド** | `video_audio_merge` → `app.py` L2095 経由の ffmpeg |
| **自動/手動** | **手動**（音声ソースが存在する場合のみ出力にボタンが表示） |

**処理フロー**:
1. `pickPreferredM2VAudioSource(state)` から音声を取得 — 生成済みまたはアップロード済み
2. `runSimpleVideoUtilityJob({ workflow: 'video_audio_merge', video, audio })` を呼び出し
3. バックエンド（`app.py` L2095-2117）:
   - `ffmpeg -i video -i audio -c:v libx264 -c:a aac -b:a 192k -map 0:v:0 -map 1:a:0 -shortest`
4. 結果を出力エリアに表示

---

## 代替エントリポイント: Music-to-Video（M2V）

| 項目 | 値 |
|------|-----|
| **関数** | [`startSimpleVideoMusicToVideo()`](static/js/simple_video.js#L9012) |
| **ボタン** | `#simpleVideoM2VBtn` — "M2V" |
| **トリガー** | ボタンクリック（手動） |

**処理フロー**:
1. 音声ソースとシナリオをバリデーション
2. 音声のデュレーションをプローブ
3. `allocateM2VSceneDurations()`（L8586）でシーン数とシーンごとの尺を自動計算
4. `prepareM2VPromptSpec()`（L8855）で M2V プロンプトスペックを生成
5. `simpleVideoM2VPromptOverride` と `simpleVideoForcePromptRegeneration` を設定
6. **`startGeneration()` を呼び出し** — 同じパイプラインが実行される！
7. 動画生成完了後、`video_audio_merge` で音声を自動マージ
8. 最終出力: BGM と同期した動画

---

## 主要バックエンド API エンドポイント（`app.py`）

| ワークフロー ID | バックエンドハンドラ | 用途 |
|---|---|---|
| `scenario_generate` | L2118 | LLM によるシナリオ展開 |
| `prompt_generate` | L2173 | LLM によるシーンプロンプト生成 |
| `lyrics_generate` | L2324 | LLM による作詞 |
| `ace_step_1_5_t2a` | ComfyUI | ACE-Step 音楽生成 |
| `qwen_i2i_2511_bf16_lightning4` | ComfyUI | Qwen 2511 EDIT I2I（キャラクタ合成） |
| `qwen_i2i_2512_lightning4` | ComfyUI | Qwen 2512 I2I（シーンリファイン） |
| `wan22_smooth_first2last` | ComfyUI | Wan2.2 FLF 4ステップ（speed モード） |
| `wan22_flf2v` | ComfyUI | Wan2.2 FLF 20ステップ（quality モード） |
| `video_concat` | L2061（ffmpeg） | 複数動画セグメントの結合 |
| `video_audio_merge` | L2095（ffmpeg） | 動画 + 音声トラックのマージ |
| `character_sheet_card_v1_0` | ComfyUI | キャラクタシート生成 |
| `remove_bg_v1_0` | ComfyUI | 背景除去 |

---

## 関数呼び出しグラフ全体像

```
ユーザーが "▶ 動画を生成" をクリック
  └─ startGeneration()                                    [L12225]
       ├─ バリデーション（プリセット, シナリオ, 画像）      [L12240-12274]
       ├─ determineScenePromptsForCurrentSimpleVideoRun() [L12029]
       │    ├─ parseScenePromptsFromText()                [L10636]
       │    └─ generateScenePromptsForCurrentSimpleVideoRun() [L10688]
       │         └─ api.generateUtility({prompt_generate}) [バックエンド L2173]
       │
       ├─ [char_edit_i2i_flf ブランチ]                     [L12619]
       │
       │   ┌─ (A) シーンごとの I2I 画像生成 ─────────────────────────┐
       │   │  for sceneIndex = 0..N-1:                               │
       │   │    ├─ resolveSceneReferenceImageForRun()     [L1066]    │
       │   │    ├─ prependNoCharacterCloneGuard()         [L11526]   │
       │   │    ├─ buildRef3PromptHint()                  [L11504]   │
       │   │    ├─ buildCharSheetRefPromptHint()          [L11483]   │
       │   │    ├─ wrapQwen2511EditInstructionPrompt()    [L11539]   │
       │   │    ├─ runWorkflowStep({i2i})                 [L11827]   │
       │   │    │    └─ api.generate() → ComfyUI                    │
       │   │    ├─ renderSimpleVideoOutputMedia()         [L11593]   │
       │   │    └─ renderSimpleVideoIntermediateImagesUI() [L7520]   │
       │   └─────────────────────────────────────────────────────────┘
       │
       │   ┌─ (C) CONTINUE ゲート ───────────────────────────────────┐
       │   │  confirmContinueAfterIntermediateImages()    [L9428]    │
       │   │  *** ユーザーがここで一時停止 — 画像の確認・再生成 ***  │
       │   │  inter.images から sceneImages をリフレッシュ [L12787]  │
       │   └─────────────────────────────────────────────────────────┘
       │
       │   ┌─ (D) FLF 動画生成 ──────────────────────────────────────┐
       │   │  for i = 0..N-2:                                        │
       │   │    ├─ composeFLFPromptWithEndIntent()        [L12110]   │
       │   │    ├─ computeLTXFrames() / getSceneFrames    [L402]     │
       │   │    ├─ runWorkflowStep({flf})                 [L11827]   │
       │   │    │    └─ api.generate() → ComfyUI (Wan2.2 FLF)      │
       │   │    └─ renderSimpleVideoOutputMedia()         [L11593]   │
       │   └─────────────────────────────────────────────────────────┘
       │
       │   ┌─ (E) 動画結合 ─────────────────────────────────────────┐
       │   │  rememberSceneVideoBasenames()               [L12124]   │
       │   │  api.generateUtility({video_concat})                    │
       │   │    └─ バックエンド ffmpeg 結合               [app.py L2061]
       │   │  renderSimpleVideoOutputMedia({showMusicMergeButton})   │
       │   └─────────────────────────────────────────────────────────┘
       │
       └─ 完了 ✅

[任意、生成後]:
  ユーザーが "🎵 音楽を追加" をクリック
    └─ mergeM2VAudioWithCurrentVideo()                    [L8623]
         └─ runSimpleVideoUtilityJob({video_audio_merge}) [L8674]
              └─ バックエンド ffmpeg マージ               [app.py L2095]
```

---

## 状態キー一覧

| 状態キー | 型 | 用途 |
|---|---|---|
| `selectedPreset` | `string` | アクティブなプリセット ID（`'char_edit_i2i_flf'`） |
| `scenario` | `string` | ユーザーのシナリオテキスト |
| `scenarioIdea` | `string` | シナリオ生成用の短いアイデア |
| `llmPrompt` | `string` | 生成されたシーンプロンプト（編集可能） |
| `sceneCount` | `string` | シーン数 |
| `sceneLengthSec` | `string` | シーンあたりの秒数 |
| `imagePrompt` | `string` | キャラクタ合成用 EDIT プロンプト |
| `keyImage` / `uploadedImage` | `{filename, ...}` | メイン参照画像 |
| `dropSlots[0..2]` | `{filename, ...}[]` | ref1/ref2/ref3 参照画像 |
| `characterImage` | `{filename, presetId, ...}` | 生成されたキャラクタ合成画像 |
| `characterSheetImage` | `{filename, ...}` | 生成されたキャラクタシート |
| `useCharSheetAsRef` | `boolean` | 合成画像の代わりにキャラクタシートを使用 |
| `i2iRefSource` | `'character' \| 'first_scene'` | シーン 2 以降の参照ソース |
| `i2iRefineWorkflow` | `string` | I2I ワークフローのオーバーライド |
| `i2iDenoise` | `string` | I2I のノイズ除去強度 |
| `i2iCfg` | `string` | I2I の CFG スケール |
| `flfQuality` | `'speed' \| 'quality'` | FLF のステップ数 |
| `flfEndConstraintEnabled` | `boolean` | FLF プロンプトに終了ターゲットを注入 |
| `motionStrength` | `string` | FLF のモーションレベルヒント |
| `ref3UseMode` | `string` | ref3 の用途: background/style/anime |
| `intermediateImages` | `{presetId, images[]}` | シーンごとの静止画 |
| `sceneVideos` | `{presetId, videos[]}` | シーンごとの動画ベース名 |
| `preparedVideoInitialImage` | `{filename, ...}` | 事前生成された初期フレーム |
| `t2aGeneratedAudio` | `{filename, ...}` | 生成された BGM |
| `m2vDurationPlan` | `number[]` | シーンごとの尺（M2V モード） |
| `fps` | `string` | 目標 FPS |
| `videoSize` | `string` | 目標解像度 |
| `scenarioUseLLM` | `boolean` | プロンプト生成に LLM を使用 |
| `promptComplexity` | `string` | LLM プロンプトの詳細レベル |

---

## プリセット設定

```javascript
// static/js/simple_video.js L131-146
{
    id: 'char_edit_i2i_flf',
    name: '📷→🖼️(EDIT)→🖼️→🎬 キャラクター動画（合成+参照選択）--連続長尺動画',
    description: 'EDITプロンプトで合成画像を作成→その画像を参照にI2Iでシーン画像生成→全区間FLFで遷移（I2V不要・高速）',
    icon: '🎭',
    requiresImage: true,
    requiresCharacter: true,
    requiresCharacterImage: true,
    supportsRefSourceSelect: true,  // i2iRefSource セレクター表示
    flfOnly: true,                   // I2V なし、全遷移 FLF
    steps: [
        { workflow: 'qwen_i2i_2511_bf16_lightning4', label: 'キャラ合成画像(EDIT)' },
        { workflow: 'qwen_i2i_2512_lightning4', label: 'シーン画像生成(I2I)' },
        { workflow: 'wan22_smooth_first2last', label: 'FLF遷移' }
    ]
}
```

**主要プリセットフラグ**:
- `requiresImage: true` — キー画像の提供が必須
- `requiresCharacter: true` — キャラクタコンテキストが必要（選択中のキャラクタ または キャラクタ画像）
- `requiresCharacterImage: true` — キャラクタ合成 EDIT 画像が必要（🎭 セクションを有効化）
- `supportsRefSourceSelect: true` — 参照ソースドロップダウンを表示（character vs. first_scene）
- `flfOnly: true` — すべての遷移に FLF を使用（N シーンに対して N+1 画像が必要）
