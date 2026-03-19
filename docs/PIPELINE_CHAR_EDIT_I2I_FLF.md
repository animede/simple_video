# `char_edit_i2i_flf` Pipeline — Complete Processing Flow

> **Preset**: `📷→🖼️(EDIT)→🖼️→🎬 キャラクター動画（合成+参照選択）--連続長尺動画`
>
> **Pipeline Summary**: EDIT prompt creates composite character image → I2I generates per-scene still images → FLF (First-Last Frame) creates smooth video transitions between adjacent scenes → ffmpeg concat → optional music merge.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          USER PREPARATION PHASE                             │
│  (All manual, order-flexible, can iterate before launching generation)      │
│                                                                             │
│  1. Scenario Input  →  2. Scenario Creation  →  3. Scene Prompt Gen        │
│  4. Key Image / Ref Images  →  5. Character Image (EDIT)                   │
│  6. Character Sheet (optional)  →  7. Music (optional: Lyrics→Tags→BGM)    │
└──────────────────────────┬───────────────────────────────────────────────────┘
                           │  ▶ Generate Video button
                           ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                       AUTOMATED GENERATION PHASE                            │
│  (Sequential, auto-progressing, with one CONTINUE gate pause)              │
│                                                                             │
│  A. Scene Prompt Resolution                                                 │
│  B. Per-Scene I2I Image Generation (with character image reference)        │
│  C. ── CONTINUE Gate (user can review/regenerate intermediate images) ──   │
│  D. FLF Video Generation (between adjacent scene images)                   │
│  E. Video Concatenation (ffmpeg)                                           │
│  F. Music Merge (optional, via button on output)                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## PHASE 1: User Preparation (Manual Steps)

### Step 1: Scenario Input (⚙️ シナリオ入力)

| Property | Value |
|----------|-------|
| **UI Element** | `<textarea id="simpleVideoScenario">` |
| **State Key** | `state.scenario` |
| **Trigger** | Manual text input by user |
| **Location** | Left panel — scenario textarea |

**Description**: The user types or pastes a free-form scenario description in the textarea. This is the creative seed for all downstream prompt generation. Can be in any language (typically Japanese). The text is stored in `state.scenario` and persisted via `saveSimpleVideoState()`.

**User Intervention Points**:
- Edit text freely at any time before generation
- Style presets can be applied via `applySimpleVideoStylePresetToScenario()` (L5471)
- Scenario variation preference: `state.scenarioVariation` (`auto`/`stable`/`normal`/`dynamic`)

---

### Step 2: Scenario Creation (🧠 シナリオ作成)

| Property | Value |
|----------|-------|
| **Function** | [`generateSimpleVideoScenarioFromIdea()`](static/js/simple_video.js#L7182) |
| **Button** | `#simpleVideoScenarioBuildBtn` — "🧠 シナリオ作成" |
| **Trigger** | Button click (manual) |
| **Input** | `state.scenarioIdea` — short idea text |
| **Output** | `state.scenario` — expanded scenario text |
| **Backend Workflow** | `scenario_generate` → LLM call via `app.py` L2118 |
| **Optional** | Yes — user can write scenario directly without this step |

**Processing Flow**:
1. User enters a brief idea in `state.scenarioIdea` (e.g., "桜の下のデュエル")
2. Calls `api.generateUtility({ workflow: 'scenario_generate', user_prompt, prompt_complexity, scene_variation })`
3. Backend (`app.py` L2118-2171) sends the idea to LLM with a scenario expansion system prompt
4. LLM response is extracted via `extractScenarioFromScenarioGenerateResult()` (L7167)
5. Result populates `state.scenario` and the scenario textarea

**User Intervention Points**:
- Can edit the generated scenario text after creation
- `prompt_complexity`: `basic` / `standard` / `rich`
- `scene_variation`: `stable` / `normal` / `dynamic`
- Calling this again regenerates the scenario from scratch
- `clearSimpleVideoGeneratedPrompts()` and `invalidateGeneratedIntermediateImages()` are called to clear stale downstream state

---

### Step 3: Scene Prompt Generation (🤖 プロンプト生成)

| Property | Value |
|----------|-------|
| **Function** | [`generateSimpleVideoPrompts()`](static/js/simple_video.js#L4133) |
| **Button** | `#simpleVideoPromptGenBtn` — "🤖 プロンプト生成" |
| **Trigger** | Button click (manual), OR auto-called during video generation if prompts are empty |
| **Input** | `state.scenario`, character context, style detection |
| **Output** | `state.llmPrompt` — formatted `#1: ... #2: ... #N: ...` |
| **Backend Workflow** | `prompt_generate` → LLM call via `app.py` L2173 |

**Processing Flow**:
1. Collects scenario text, character token guards, style mode (lineart/pixel)
2. If `state.scenarioUseLLM` is OFF → simply copies scenario lines as prompts via `buildScenePromptsFromScenarioText()` (L10670)
3. If ON → calls `api.generateUtility({ workflow: 'prompt_generate', user_prompt, scene_count, output_type, prompt_complexity, scene_variation, target_workflow, flf_motion_level })`
4. Backend sends to LLM with scene-generation system prompt
5. Result parsed by `extractPromptsFromPromptGenerateResult()` (L3870)
6. Post-processed through:
   - `applySimpleVideoPromptGuardrails()` (L3894) — character identity, layout sanity
   - `applySimpleVideoStyleConsistencyGuardrails()` (L4052) — style tag injection
7. Formatted as numbered list in `state.llmPrompt`

**User Intervention Points**:
- **Edit prompts after generation** — the `#simpleVideoLLMPrompt` textarea is freely editable
- `state.scenarioUseLLM`: toggle LLM vs. direct copy
- `state.promptComplexity`: `basic` / `standard` / `rich`
- `state.motionStrength`: affects FLF motion level in prompts
- `state.flfEndConstraintEnabled`: inject end-target hints
- Scene count governed by `state.sceneCount` (+ 1 for FLF presets needing N+1 images)
- Can re-run anytime; downstream intermediate images are not auto-cleared

---

### Step 4: Key Image / Reference Images (🖼️ キー画像 & 📥 画像ドロップ)

| Property | Value |
|----------|-------|
| **UI Elements** | Key image drop zone, 3 drop slots (`ref1`/`ref2`/`ref3`) |
| **State Keys** | `state.keyImage`, `state.uploadedImage`, `state.dropSlots[0..2]` |
| **Functions** | [`uploadKeyImage()`](static/js/simple_video.js#L5681), [`uploadDropSlot()`](static/js/simple_video.js#L5769) |
| **Trigger** | File drop/upload (manual) |

**Description**: The user provides reference images:
- **Key Image** (`state.keyImage` / `state.uploadedImage`): Primary reference for I2I scene generation
- **ref1** (`dropSlots[0]`): Alternative reference image; used by character EDIT
- **ref2** (`dropSlots[1]`): Secondary reference for multi-image EDIT
- **ref3** (`dropSlots[2]`): Background/style reference (`state.ref3UseMode`: `background`/`style`/`anime`)

**User Intervention Points**:
- Drop or upload at any time
- Clear via `clearKeyImage()` (L5818) or individual slot clear buttons
- `state.removeBgBeforeGenerate`: auto-remove background before generation
- Files are uploaded to server via `uploadSimpleVideoFile()` (L8467) → `POST /api/v1/upload`

---

### Step 5: Character Image Generation (🎭 キャラ合成画像)

| Property | Value |
|----------|-------|
| **Function** | [`runCharacterImageGeneration()`](static/js/simple_video.js#L7823) |
| **Button** | `#simpleVideoCharacterImageGenBtn` — "生成" |
| **Trigger** | Button click (manual) |
| **Input** | `state.imagePrompt` (EDIT prompt), `state.dropSlots`, character tokens |
| **Output** | `state.characterImage` — the composite image used as reference for I2I |
| **Backend Workflow** | Qwen 2511 EDIT (`qwen_i2i_2511_bf16_lightning4`) via `api.generate()` |

**Processing Flow**:
1. Reads EDIT prompt from `state.imagePrompt`
2. Detects `@character` tokens via regex `/@＠|「[^」]+」|"[^"]+"|"[^"]+"/`
3. Calls `expandCharacterTokensInPrompt()` (L5190) to resolve character names → descriptions + registered images
4. Builds picture mapping: `@キャラ名` → `Picture 1`, `ref1` → `Picture 2`, etc.
5. Replaces tokens in prompt with `Picture N` references
6. Determines effective reference images: character images first, then dropSlots fill remaining
7. Forces Qwen 2511 workflow for multi-image support
8. Wraps prompt in EDIT instruction format via `wrapQwen2511EditInstructionPrompt()` (L11539)
9. Calls ComfyUI via `api.generate({ workflow, prompt, input_image, input_image_2, ..., denoise, cfg })`
10. Output image stored as `state.characterImage` AND `state.keyImage`

**User Intervention Points**:
- Edit EDIT prompt (`state.imagePrompt`) at any time
- Change reference images in drop slots
- Adjust `state.i2iDenoise` and `state.i2iCfg`
- Regenerate by clicking button again
- If no prompt but ref1 exists, ref1 is used directly as character image (no generation)

---

### Step 5b: Character Sheet Generation (Optional)

| Property | Value |
|----------|-------|
| **Function** | [`runCharacterSheetGeneration()`](static/js/simple_video.js#L8118) |
| **Trigger** | Button click (manual) |
| **Input** | ref1/keyImage/uploadedImage |
| **Output** | `state.characterSheetImage` |
| **Backend Workflow** | `character_sheet_card_v1_0` or `character_sheet_card_v1_0_nobg` |

**Description**: Generates a multi-angle character sheet. Can be used as I2I reference instead of character composite image when `state.useCharSheetAsRef` is enabled.

---

### Step 6: Pre-generate Intermediate Images (Optional — 事前画像生成)

| Property | Value |
|----------|-------|
| **Function** | [`startIntermediateImageGeneration()`](static/js/simple_video.js#L9879) |
| **Button** | `#simpleVideoVideoInitImageBtn` |
| **Trigger** | Button click (manual) |
| **Output** | `state.intermediateImages` — per-scene still images |

**Description**: Pre-generates all intermediate scene images before launching the main video pipeline. This allows the user to review and selectively regenerate poor-quality images before committing to expensive FLF video generation. The same I2I logic used in the main pipeline is applied.

**User Intervention Points**:
- Regenerate individual scenes via `regenerateIntermediateSceneImage(index)` (L5940)
- Upload replacement images via `uploadIntermediateSceneImage(index, file)` (L6425)
- Clear individual scenes via `clearIntermediateSceneImage(index)` (L5928)
- Clear all via `clearAllIntermediateImages()` (L6373)

---

### Step 7: Music Generation (Optional — BGM生成)

The music pipeline has 3 sub-steps that can run individually or via AUTO:

#### 7a. Lyrics Composition (作詞)

| Property | Value |
|----------|-------|
| **Function** | [`composeSimpleVideoT2ALyrics()`](static/js/simple_video.js#L4759) |
| **Trigger** | Button click (manual) or AUTO |
| **Input** | `state.t2aScenario` or `state.scenario` or `state.imagePrompt` |
| **Output** | `state.t2aLyrics` |
| **Backend Workflow** | `lyrics_generate` → LLM call via `app.py` L2324 |

#### 7b. Tag Suggestion (タグ提案)

| Property | Value |
|----------|-------|
| **Function** | [`suggestSimpleVideoT2ATags()`](static/js/simple_video.js#L4993) |
| **Trigger** | Button click (manual) or AUTO |
| **Output** | `state.t2aTags` |

#### 7c. Music Generation (音楽生成)

| Property | Value |
|----------|-------|
| **Function** | [`startSimpleVideoT2AGeneration()`](static/js/simple_video.js#L4452) |
| **Trigger** | Button click (manual) or AUTO |
| **Input** | Tags, lyrics, BPM, key/scale, duration, steps, cfg, seed |
| **Output** | `state.t2aGeneratedAudio` — audio file |
| **Backend Workflow** | `ace_step_1_5_t2a` → ACE-Step API or ComfyUI |

#### 7d. AUTO Generation (一括 AUTO)

| Property | Value |
|----------|-------|
| **Function** | [`autoGenerateSimpleVideoT2A()`](static/js/simple_video.js#L5113) |
| **Trigger** | AUTO button click |
| **Processing** | Runs 7a → 7b → 7c sequentially with progress tracking |

**User Intervention Points (all music steps)**:
- Edit lyrics, tags, BPM, key/scale, duration at any time
- `state.t2aLanguage`: lyrics language
- `state.t2aThinking`: ACE-Step API thinking mode
- `state.t2aSeed`: reproducibility seed
- Upload external audio via `uploadM2VAudioSource()` (L8940)

---

## PHASE 2: Automated Generation Pipeline

### Entry Point: `startGeneration()`

| Property | Value |
|----------|-------|
| **Function** | [`startGeneration()`](static/js/simple_video.js#L12225) |
| **Button** | `#simpleVideoGenerateBtn` — "▶ 動画を生成" (L3685-3688) |
| **Trigger** | Button click |

**Validation Checks** (L12240-12274):
1. Preset must be selected (`state.selectedPreset`)
2. Scenario or M2V override must exist
3. Key image required if `preset.requiresImage` (unless intermediate images are complete)
4. Character context required if `preset.requiresCharacter`
5. Stale intermediate images cleared if preset or scene count changed

The function dispatches to the `char_edit_i2i_flf` dedicated pipeline starting at **L12619**.

---

### Step A: Scene Prompt Resolution

| Property | Value |
|----------|-------|
| **Function** | [`determineScenePromptsForCurrentSimpleVideoRun()`](static/js/simple_video.js#L12029) |
| **Called at** | L12304 inside `startGeneration()` |
| **Auto/Manual** | Automatic (part of pipeline) |

**Processing Flow**:
1. Checks if `state.llmPrompt` already has numbered prompts → parses via `parseScenePromptsFromText()` (L10636)
2. If empty AND `scenarioUseLLM` is ON → calls `generateScenePromptsForCurrentSimpleVideoRun()` (L10688) which triggers LLM prompt generation
3. If LLM is OFF → calls `buildScenePromptsFromScenarioText()` (L10670) to split scenario text into lines
4. Normalizes count to match `state.sceneCount` (pads or truncates)

**Inputs**: `state.scenario`, `state.llmPrompt`, `state.scenarioUseLLM`, `state.sceneCount`
**Output**: `string[]` — array of scene prompt strings

---

### Step B: Per-Scene I2I Image Generation

| Property | Value |
|----------|-------|
| **Location** | `startGeneration()` L12650-12770 (the `char_edit_i2i_flf` branch) |
| **Workflow** | `qwen_i2i_2511_bf16_lightning4` (EDIT) or `qwen_i2i_2512_lightning4` (I2I), configurable via `state.i2iRefineWorkflow` |
| **Auto/Manual** | Automatic (part of pipeline) |

**Processing Flow** (for each scene index 0..N-1):
1. Check cancel status
2. **Skip if intermediate image already exists** (`inter.images[sceneIndex]?.filename`)
3. Determine reference image for this scene:
   - Scene 0: always uses `characterImageFilename` (character composite, or character sheet if `useCharSheetAsRef`)
   - Scene 1+: depends on `state.i2iRefSource`:
     - `'character'`: uses character image (default)
     - `'first_scene'`: uses the generated Scene 1 image
4. Build parameters:
   - `prompt`: scene prompt with `prependNoCharacterCloneGuard()` (L11526)
   - `input_image`: reference image
   - `input_image_2`: ref3 if active (`state.ref3ModeEnabled` + `dropSlots[2]`)
   - Prompt hints injected for ref3 mode and character sheet
   - For Qwen 2511: wrapped via `wrapQwen2511EditInstructionPrompt()` (L11539)
   - `denoise`: `state.i2iDenoise` (default `'1.0'`)
   - `cfg`: `state.i2iCfg` (default `'1.0'`)
   - `width`, `height`: from `getEffectiveWH()`
5. Call `runWorkflowStep()` (L11827) → `api.generate()` → ComfyUI
6. Store result in `inter.images[sceneIndex]` with source, filename, jobId, prompt
7. Render preview via `renderSimpleVideoOutputMedia()`
8. Update intermediate images UI via `renderSimpleVideoIntermediateImagesUI()`

**Reference Image Resolution** (`resolveSceneReferenceImageForRun()` L1066):
```
Priority: characterSheetImage (if useCharSheetAsRef) > characterImage > keyImage > dropSlots[0]
```

---

### Step C: CONTINUE Gate (中間画像確認)

| Property | Value |
|----------|-------|
| **Function** | [`confirmContinueAfterIntermediateImages()`](static/js/simple_video.js#L9428) |
| **Called at** | L12779 inside the `char_edit_i2i_flf` pipeline |
| **Auto/Manual** | **Manual pause** — user must click CONTINUE |

**Description**: After all scene images are generated, the pipeline pauses and shows:
```
🖼️ 中間画像確認 (preset) / 新規生成: N / 全Mシーン。
必要ならシーン画像を再生成してから CONTINUE を押してください。
```

**User Intervention Points During Gate**:
- **Review** generated intermediate images in the UI
- **Regenerate** individual scenes via `regenerateIntermediateSceneImage(index)` (L5940) — green 🔄 button
- **Upload** replacement images via file drop on individual scene slots
- **Clear** individual scenes via `clearIntermediateSceneImage(index)` (L5928) — red ✕ button
- Click **CONTINUE** to proceed to FLF video generation
- Click **PAUSE/STOP** to abort (pipeline returns without generating video)

After CONTINUE is clicked, the pipeline **refreshes** `sceneImages[]` from `inter.images[]` to pick up any user modifications (L12787-12795).

---

### Step D: FLF Video Generation (First-Last Frame Transitions)

| Property | Value |
|----------|-------|
| **Location** | `startGeneration()` L12798-12847 |
| **Workflow** | `wan22_smooth_first2last` (speed/4-step) or `wan22_flf2v` (quality/20-step) |
| **Selection** | `state.flfQuality`: `'speed'` → 4-step, `'quality'` → 20-step |
| **Auto/Manual** | Automatic |

**Processing Flow** (for each pair of adjacent scene images):
1. Check cancel status
2. Build FLF prompt via `composeFLFPromptWithEndIntent()` (L12110):
   ```
   Start intent: [scene N prompt].
   End target (must be reflected near the end frame): [scene N+1 prompt].
   Keep subject identity consistent and make camera direction/pose transition smooth and coherent.
   ```
   (Uses `state.flfEndConstraintEnabled` to control end-target injection)
3. Build parameters:
   - `prompt`: composed FLF prompt
   - `input_image_start`: scene image N
   - `input_image_end`: scene image N+1
   - `width`, `height`
   - `fps`: from `state.fps` or workflow default
   - `frames`: computed via `computeLTXFrames()` (L402) from `getSceneFramesForIndex()` which accounts for M2V duration plans
4. Call `runWorkflowStep()` → `api.generate()` → ComfyUI (Wan2.2 FLF model)
5. Extract video output filename, add to `sceneVideoBasenames[]`
6. Render preview via `renderSimpleVideoOutputMedia()`

**Key Calculation**: For N scene images, generates N-1 FLF video segments.

---

### Step E: Video Concatenation

| Property | Value |
|----------|-------|
| **Location** | `startGeneration()` L12849-12917 |
| **Backend Workflow** | `video_concat` → ffmpeg concat via `app.py` L2061 |
| **Auto/Manual** | Automatic |

**Processing Flow**:
1. If fewer than 2 videos → skip concat
2. Remember scene video basenames via `rememberSceneVideoBasenames()` (L12124)
3. Call `api.generateUtility({ workflow: 'video_concat', videos, fps, keep_audio })`
4. Backend (`app.py` L2061-2092):
   - Creates ffmpeg concat list file
   - Runs: `ffmpeg -f concat -c:v libx264 -preset fast -crf 23 -r {fps} -pix_fmt yuv420p -movflags +faststart`
5. Monitor progress via WebSocket
6. Render final output with `showMusicMergeButton: true`

**User Intervention Points**:
- Can regenerate individual scene videos via `regenerateSingleSceneVideo(index)` (L5985) and re-concat via `runSceneVideosConcatFromState()` (L12160)

---

### Step F: Music Merge (Optional — 🎵 音楽を追加)

| Property | Value |
|----------|-------|
| **Function** | [`mergeM2VAudioWithCurrentVideo()`](static/js/simple_video.js#L8623) |
| **Trigger** | "🎵 音楽を追加" button on concat output (manual) |
| **Backend Workflow** | `video_audio_merge` → ffmpeg via `app.py` L2095 |
| **Auto/Manual** | **Manual** (button appears on output only when audio source exists) |

**Processing Flow**:
1. Gets audio from `pickPreferredM2VAudioSource(state)` — generated or uploaded
2. Calls `runSimpleVideoUtilityJob({ workflow: 'video_audio_merge', video, audio })`
3. Backend (`app.py` L2095-2117):
   - `ffmpeg -i video -i audio -c:v libx264 -c:a aac -b:a 192k -map 0:v:0 -map 1:a:0 -shortest`
4. Result shown in output area

---

## Alternative Entry Point: Music-to-Video (M2V)

| Property | Value |
|----------|-------|
| **Function** | [`startSimpleVideoMusicToVideo()`](static/js/simple_video.js#L9012) |
| **Button** | `#simpleVideoM2VBtn` — "M2V" |
| **Trigger** | Button click (manual) |

**Processing Flow**:
1. Validates audio source and scenario
2. Probes audio duration
3. Auto-calculates scene count and per-scene durations via `allocateM2VSceneDurations()` (L8586)
4. Generates M2V prompt spec via `prepareM2VPromptSpec()` (L8855)
5. Sets `simpleVideoM2VPromptOverride` and `simpleVideoForcePromptRegeneration`
6. **Calls `startGeneration()`** — the same pipeline runs!
7. After video generation completes, auto-merges audio via `video_audio_merge`
8. Final output: video with synchronized BGM

---

## Key Backend API Endpoints (`app.py`)

| Workflow ID | Backend Handler | Purpose |
|---|---|---|
| `scenario_generate` | L2118 | LLM-based scenario expansion |
| `prompt_generate` | L2173 | LLM-based scene prompt generation |
| `lyrics_generate` | L2324 | LLM-based lyrics composition |
| `ace_step_1_5_t2a` | ComfyUI | ACE-Step music generation |
| `qwen_i2i_2511_bf16_lightning4` | ComfyUI | Qwen 2511 EDIT I2I (character composite) |
| `qwen_i2i_2512_lightning4` | ComfyUI | Qwen 2512 I2I (scene refinement) |
| `wan22_smooth_first2last` | ComfyUI | Wan2.2 FLF 4-step (speed mode) |
| `wan22_flf2v` | ComfyUI | Wan2.2 FLF 20-step (quality mode) |
| `video_concat` | L2061 (ffmpeg) | Concatenate multiple video segments |
| `video_audio_merge` | L2095 (ffmpeg) | Merge video + audio tracks |
| `character_sheet_card_v1_0` | ComfyUI | Character sheet generation |
| `remove_bg_v1_0` | ComfyUI | Background removal |

---

## Complete Function Call Graph

```
User clicks "▶ 動画を生成"
  └─ startGeneration()                                    [L12225]
       ├─ Validation (preset, scenario, images)           [L12240-12274]
       ├─ determineScenePromptsForCurrentSimpleVideoRun() [L12029]
       │    ├─ parseScenePromptsFromText()                [L10636]
       │    └─ generateScenePromptsForCurrentSimpleVideoRun() [L10688]
       │         └─ api.generateUtility({prompt_generate}) [backend L2173]
       │
       ├─ [char_edit_i2i_flf branch]                      [L12619]
       │
       │   ┌─ (A) Per-scene I2I Image Generation ─────────────────────┐
       │   │  for sceneIndex = 0..N-1:                                │
       │   │    ├─ resolveSceneReferenceImageForRun()     [L1066]     │
       │   │    ├─ prependNoCharacterCloneGuard()         [L11526]    │
       │   │    ├─ buildRef3PromptHint()                  [L11504]    │
       │   │    ├─ buildCharSheetRefPromptHint()          [L11483]    │
       │   │    ├─ wrapQwen2511EditInstructionPrompt()    [L11539]    │
       │   │    ├─ runWorkflowStep({i2i})                 [L11827]    │
       │   │    │    └─ api.generate() → ComfyUI                     │
       │   │    ├─ renderSimpleVideoOutputMedia()         [L11593]    │
       │   │    └─ renderSimpleVideoIntermediateImagesUI() [L7520]    │
       │   └──────────────────────────────────────────────────────────┘
       │
       │   ┌─ (C) CONTINUE Gate ──────────────────────────────────────┐
       │   │  confirmContinueAfterIntermediateImages()    [L9428]     │
       │   │  *** USER PAUSES HERE — reviews/regenerates images ***   │
       │   │  Refresh sceneImages from inter.images       [L12787]    │
       │   └──────────────────────────────────────────────────────────┘
       │
       │   ┌─ (D) FLF Video Generation ──────────────────────────────┐
       │   │  for i = 0..N-2:                                        │
       │   │    ├─ composeFLFPromptWithEndIntent()        [L12110]    │
       │   │    ├─ computeLTXFrames() / getSceneFrames    [L402]      │
       │   │    ├─ runWorkflowStep({flf})                 [L11827]    │
       │   │    │    └─ api.generate() → ComfyUI (Wan2.2 FLF)       │
       │   │    └─ renderSimpleVideoOutputMedia()         [L11593]    │
       │   └──────────────────────────────────────────────────────────┘
       │
       │   ┌─ (E) Video Concatenation ───────────────────────────────┐
       │   │  rememberSceneVideoBasenames()               [L12124]    │
       │   │  api.generateUtility({video_concat})                    │
       │   │    └─ backend ffmpeg concat                  [app.py L2061]
       │   │  renderSimpleVideoOutputMedia({showMusicMergeButton})   │
       │   └──────────────────────────────────────────────────────────┘
       │
       └─ Done ✅

[Optional, post-generation]:
  User clicks "🎵 音楽を追加"
    └─ mergeM2VAudioWithCurrentVideo()                    [L8623]
         └─ runSimpleVideoUtilityJob({video_audio_merge}) [L8674]
              └─ backend ffmpeg merge                     [app.py L2095]
```

---

## State Keys Summary

| State Key | Type | Purpose |
|---|---|---|
| `selectedPreset` | `string` | Active preset ID (`'char_edit_i2i_flf'`) |
| `scenario` | `string` | User scenario text |
| `scenarioIdea` | `string` | Short idea for scenario generation |
| `llmPrompt` | `string` | Generated scene prompts (editable) |
| `sceneCount` | `string` | Number of scenes |
| `sceneLengthSec` | `string` | Seconds per scene |
| `imagePrompt` | `string` | EDIT prompt for character composite |
| `keyImage` / `uploadedImage` | `{filename, ...}` | Primary reference image |
| `dropSlots[0..2]` | `{filename, ...}[]` | ref1/ref2/ref3 reference images |
| `characterImage` | `{filename, presetId, ...}` | Generated character composite |
| `characterSheetImage` | `{filename, ...}` | Generated character sheet |
| `useCharSheetAsRef` | `boolean` | Use character sheet instead of composite |
| `i2iRefSource` | `'character' \| 'first_scene'` | Reference source for scene 2+ |
| `i2iRefineWorkflow` | `string` | I2I workflow override |
| `i2iDenoise` | `string` | I2I denoise strength |
| `i2iCfg` | `string` | I2I CFG scale |
| `flfQuality` | `'speed' \| 'quality'` | FLF step count |
| `flfEndConstraintEnabled` | `boolean` | Inject end-target in FLF prompt |
| `motionStrength` | `string` | FLF motion level hint |
| `ref3UseMode` | `string` | ref3 usage: background/style/anime |
| `intermediateImages` | `{presetId, images[]}` | Per-scene still images |
| `sceneVideos` | `{presetId, videos[]}` | Per-scene video basenames |
| `preparedVideoInitialImage` | `{filename, ...}` | Pre-generated initial frame |
| `t2aGeneratedAudio` | `{filename, ...}` | Generated BGM |
| `m2vDurationPlan` | `number[]` | Per-scene duration (M2V mode) |
| `fps` | `string` | Target FPS |
| `videoSize` | `string` | Target resolution |
| `scenarioUseLLM` | `boolean` | Use LLM for prompt generation |
| `promptComplexity` | `string` | LLM prompt detail level |

---

## Preset Configuration

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
    supportsRefSourceSelect: true,  // i2iRefSource selector visible
    flfOnly: true,                   // No I2V, all transitions via FLF
    steps: [
        { workflow: 'qwen_i2i_2511_bf16_lightning4', label: 'キャラ合成画像(EDIT)' },
        { workflow: 'qwen_i2i_2512_lightning4', label: 'シーン画像生成(I2I)' },
        { workflow: 'wan22_smooth_first2last', label: 'FLF遷移' }
    ]
}
```

**Key Preset Flags**:
- `requiresImage: true` — key image must be provided
- `requiresCharacter: true` — character context needed (selected character OR character image)
- `requiresCharacterImage: true` — character composite EDIT image needed (enables 🎭 section)
- `supportsRefSourceSelect: true` — shows reference source dropdown (character vs. first_scene)
- `flfOnly: true` — uses FLF for ALL transitions (N+1 images needed for N scenes)
