# `char_edit_i2v_mixed` Pipeline — Complete Processing Flow

> **Preset**: `🖼️→🎬🔀 キャラ EDIT + I2I + 混在トランジション`
>
> **Pipeline Summary**: EDIT prompt creates composite character image → I2I generates N+1 per-scene still images → User reviews transition type per scene boundary (FLF / I2V / Cut / Crossfade / Fade Black) → Per-boundary video generation → ffmpeg concat → optional music merge.
>
> **Key difference from `char_edit_i2i_flf`**: Instead of using FLF for ALL transitions, each scene boundary can independently use FLF (smooth morph), I2V (motion-first), Cut (direct), Crossfade, or Fade Black. The LLM assigns types automatically at prompt generation time; the user can override via the Transition Editor before generation.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          USER PREPARATION PHASE                             │
│  (All manual, order-flexible, can iterate before launching generation)      │
│                                                                             │
│  1. Scenario Input  →  2. Scenario Creation  →  3. Scene Prompt Gen        │
│     (output_type: mixed_sequence → N+1 prompts + transition type hints)    │
│  4. Key Image / Ref Images  →  5. Character Image (EDIT)                   │
│  6. Character Sheet (optional)  →  7. Music (optional: Lyrics→Tags→BGM)    │
└──────────────────────────┬───────────────────────────────────────────────────┘
                           │  ▶ Generate Video button
                           ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                       AUTOMATED GENERATION PHASE                            │
│  (Sequential, auto-progressing, with one CONTINUE gate pause)              │
│                                                                             │
│  A. Scene Prompt Resolution (N+1 prompts for N boundaries)                 │
│  B. Per-Scene I2I Image Generation (N+1 images with character reference)   │
│  C. ── CONTINUE Gate + 🔀 Transition Type Editor (user review/override) ── │
│  D. Per-Boundary Video Generation (FLF or I2V dispatch per boundary)       │
│  E. Video Concatenation (ffmpeg) with Cut/Crossfade/Fade handling          │
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

**Description**: The user types or pastes a free-form scenario description. This is the creative seed for all downstream prompt generation. Can be in any language (typically Japanese). The text is stored in `state.scenario` and persisted via `saveSimpleVideoState()`.

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
1. User enters a brief idea in `state.scenarioIdea`
2. Calls `api.generateUtility({ workflow: 'scenario_generate', user_prompt, prompt_complexity, scene_variation })`
3. Backend sends idea to LLM with scenario expansion system prompt
4. LLM response extracted via `extractScenarioFromScenarioGenerateResult()` (L7167)
5. Result populates `state.scenario` and the scenario textarea

**User Intervention Points**:
- Can edit the generated scenario text after creation
- `prompt_complexity`: `basic` / `standard` / `rich`
- `scene_variation`: `stable` / `normal` / `dynamic`
- Calling again regenerates scenario from scratch

---

### Step 3: Scene Prompt Generation (🤖 プロンプト生成) — Mixed Mode

| Property | Value |
|----------|-------|
| **Function** | [`generateSimpleVideoPrompts()`](static/js/simple_video.js#L4133) |
| **Button** | `#simpleVideoPromptGenBtn` — "🤖 プロンプト生成" |
| **Trigger** | Button click (manual), OR auto-called during video generation if prompts are empty |
| **Input** | `state.scenario`, character context, style detection |
| **Output** | `state.llmPrompt` — formatted `#1: ... #2: ... #N+1: ...` (N+1 prompts for N boundaries) |
| **Backend Workflow** | `prompt_generate` → LLM call via `app.py` L2173 |
| **Key Difference** | `output_type: 'mixed_sequence'` is sent to LLM, requesting N+1 scene prompts **plus transition type annotations** per boundary |

**Processing Flow**:
1. Collects scenario text, character token guards, style mode
2. Sends `api.generateUtility({ workflow: 'prompt_generate', output_type: 'mixed_sequence', scene_count: N, ... })`
3. Backend sends to LLM with mixed-sequence system prompt — the LLM is asked to produce N+1 scene descriptions AND a `[transition: flf/cut/crossfade/fade_black]` annotation for each of the N boundaries
4. Result parsed by `extractPromptsFromPromptGenerateResult()` (L3870)
5. Transition type annotations extracted and stored into `state.transitionTypes[]`
6. Post-processed through:
   - `applySimpleVideoPromptGuardrails()` (L3894)
   - `applySimpleVideoStyleConsistencyGuardrails()` (L4052)
7. After generation, `renderTransitionEditor()` is called to display the 🔀 Transition Editor accordion below the prompts

**Scene count**: `state.sceneCount` specifies N (the number of video segments/boundaries). The pipeline requests **N+1** scene prompts to provide a start image and an end image for each of the N segments.

**User Intervention Points**:
- Edit prompts after generation in `#simpleVideoLLMPrompt` textarea
- Override individual transition types via the 🔀 Transition Editor dropdowns (see Step 3b)
- `state.scenarioUseLLM`: toggle LLM vs. direct copy
- `state.promptComplexity`: `basic` / `standard` / `rich`
- `state.motionStrength`: affects FLF motion level

---

### Step 3b: Transition Type Editor (🔀 シーン遷移タイプ)

| Property | Value |
|----------|-------|
| **Function** | [`renderTransitionEditor()`](static/js/simple_video.js) |
| **Trigger** | Auto-rendered after prompt generation (and after CONTINUE gate) |
| **State Key** | `state.transitionTypes[]` — per-boundary type array |
| **UI** | Accordion below the LLM prompt textarea |

**Description**: After prompts are generated, an accordion UI appears showing each scene boundary (Scene 1→2, Scene 2→3, …) with a colored badge and a dropdown for the transition type.

**Transition Types**:

| Type | Label | Description |
|------|-------|-------------|
| `flf` | 🌊 FLF | Smooth morph via Wan2.2 First-Last Frame |
| `cut` | ✂️ カット | Direct cut (no video generation, just concatenation) |
| `crossfade` | 🌓 クロスフェード | ffmpeg crossfade filter |
| `fade_black` | ⬛ フェード黒 | Fade to black then fade in |
| `none` | — なし | Same as cut (passthrough) |

**User Intervention Points**:
- Change any boundary type via the dropdown — saved instantly to `state.transitionTypes[i]`
- Changes take effect at video generation time (Step D)
- Re-running prompt generation resets types to LLM-suggested values

---

### Step 4: Key Image / Reference Images (🖼️ キー画像 & 📥 画像ドロップ)

| Property | Value |
|----------|-------|
| **UI Elements** | Key image drop zone, 3 drop slots (`ref1`/`ref2`/`ref3`) |
| **State Keys** | `state.keyImage`, `state.uploadedImage`, `state.dropSlots[0..2]` |
| **Functions** | [`uploadKeyImage()`](static/js/simple_video.js#L5681), [`uploadDropSlot()`](static/js/simple_video.js#L5769) |
| **Trigger** | File drop/upload (manual) |

**Description**: The user provides reference images:
- **Key Image** (`state.keyImage` / `state.uploadedImage`): Character reference image — used as primary input for the character EDIT step
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
| **Output** | `state.characterImage` — composite image used as reference for I2I |
| **Backend Workflow** | Qwen 2511 EDIT (`qwen_i2i_2511_bf16_lightning4`) via `api.generate()` |

**Processing Flow**:
1. Reads EDIT prompt from `state.imagePrompt`
2. Detects `@character` tokens via regex
3. Calls `expandCharacterTokensInPrompt()` (L5190) to resolve character names → descriptions + registered images
4. Builds picture mapping: `@キャラ名` → `Picture 1`, `ref1` → `Picture 2`, etc.
5. Replaces tokens with `Picture N` references
6. Determines effective reference images: character images first, then dropSlots fill remaining
7. Forces Qwen 2511 workflow for multi-image support
8. Wraps prompt in EDIT instruction format via `wrapQwen2511EditInstructionPrompt()` (L11539)
9. Calls ComfyUI via `api.generate({ workflow, prompt, input_image, input_image_2, ..., denoise, cfg })`
10. Output stored as `state.characterImage` AND `state.keyImage`

**User Intervention Points**:
- Edit EDIT prompt (`state.imagePrompt`) at any time
- Change reference images in drop slots
- Adjust `state.i2iDenoise` and `state.i2iCfg`
- Regenerate by clicking button again
- If no prompt but ref1 exists, ref1 is used directly (no generation)

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
| **Output** | `state.intermediateImages` — N+1 per-scene still images |

**Description**: Pre-generates all N+1 intermediate scene images before launching the main video pipeline. Allows the user to review and selectively regenerate poor-quality images before expensive video generation.

> ⚠️ **N+1 images**: For N scene boundaries, this preset requires **N+1** still images (one image serves as both the END of one segment and the START of the next). The pre-generate button is only enabled after key image upload.

**User Intervention Points**:
- Regenerate individual scenes via `regenerateIntermediateSceneImage(index)` (L5940)
- Upload replacement images via `uploadIntermediateSceneImage(index, file)` (L6425)
- Clear individual scenes via `clearIntermediateSceneImage(index)` (L5928)
- Clear all via `clearAllIntermediateImages()` (L6373)

---

### Step 7: Music Generation (Optional — BGM生成)

Same as `char_edit_i2i_flf`. See that document for full details.

#### 7a. Lyrics Composition (作詞) — [`composeSimpleVideoT2ALyrics()`](static/js/simple_video.js#L4759)
#### 7b. Tag Suggestion (タグ提案) — [`suggestSimpleVideoT2ATags()`](static/js/simple_video.js#L4993)
#### 7c. Music Generation (音楽生成) — [`startSimpleVideoT2AGeneration()`](static/js/simple_video.js#L4452)
#### 7d. AUTO Generation — [`autoGenerateSimpleVideoT2A()`](static/js/simple_video.js#L5113)

---

## PHASE 2: Automated Generation Pipeline

### Entry Point: `startGeneration()`

| Property | Value |
|----------|-------|
| **Function** | [`startGeneration()`](static/js/simple_video.js#L12225) |
| **Button** | `#simpleVideoGenerateBtn` — "▶ 動画を生成" |
| **Trigger** | Button click |

**Validation Checks** (L12240-12274):
1. Preset must be selected (`state.selectedPreset`)
2. Scenario or M2V override must exist
3. Key image required (`preset.requiresImage`) unless intermediate images are complete
4. Character context required (`preset.requiresCharacter`)
5. Stale intermediate images cleared if preset or scene count changed

The function dispatches to the `char_edit_i2v_mixed` / `char_edit_i2i_flf` shared mixed-transitions pipeline branch.

---

### Step A: Scene Prompt Resolution

| Property | Value |
|----------|-------|
| **Function** | [`determineScenePromptsForCurrentSimpleVideoRun()`](static/js/simple_video.js#L12029) |
| **Called at** | L12304 inside `startGeneration()` |
| **Auto/Manual** | Automatic (part of pipeline) |

**Processing Flow**:
1. Checks if `state.llmPrompt` already has numbered prompts → parses via `parseScenePromptsFromText()` (L10636)
2. If empty AND `scenarioUseLLM` ON → calls `generateScenePromptsForCurrentSimpleVideoRun()` (L10688) — LLM generates **N+1 prompts** with `output_type: 'mixed_sequence'`
3. If LLM OFF → `buildScenePromptsFromScenarioText()` (L10670), then transition types default to `flf` for all boundaries
4. Normalizes count to match `state.sceneCount + 1`

**Inputs**: `state.scenario`, `state.llmPrompt`, `state.scenarioUseLLM`, `state.sceneCount`
**Output**: `string[]` of length N+1 — scene prompt strings

---

### Step B: Per-Scene I2I Image Generation (N+1 images)

| Property | Value |
|----------|-------|
| **Location** | `startGeneration()` mixed-transitions branch |
| **Workflow** | `qwen_i2i_2511_bf16_lightning4` (EDIT) or `qwen_i2i_2512_lightning4` (I2I), configurable via `state.i2iRefineWorkflow` |
| **Auto/Manual** | Automatic |
| **Count** | **N+1** images (one extra compared to non-mixed presets) |

**Processing Flow** (for each scene index 0..N):
1. Check cancel status
2. **Skip if intermediate image already exists** (`inter.images[sceneIndex]?.filename`)
3. Determine reference image for this scene:
   - Scene 0: always uses `characterImageFilename` (or character sheet if `useCharSheetAsRef`)
   - Scene 1+: depends on `state.i2iRefSource`:
     - `'character'`: character composite image (default)
     - `'first_scene'`: the generated Scene 1 image
4. Build parameters:
   - `prompt`: scene prompt with `prependNoCharacterCloneGuard()` (L11526)
   - `input_image`: reference image
   - `input_image_2`: ref3 if active
   - Prompt hints from `buildRef3PromptHint()` / `buildCharSheetRefPromptHint()`
   - Qwen 2511 prompts wrapped via `wrapQwen2511EditInstructionPrompt()` (L11539)
   - `denoise`: `state.i2iDenoise` (default `'1.0'`)
   - `cfg`: `state.i2iCfg` (default `'1.0'`)
   - `width`, `height`: from `getEffectiveWH()`
5. Call `runWorkflowStep()` (L11827) → `api.generate()` → ComfyUI
6. Store result in `inter.images[sceneIndex]`
7. Render preview and update intermediate images UI

**Reference Image Resolution** (`resolveSceneReferenceImageForRun()` L1066):
```
Priority: characterSheetImage (if useCharSheetAsRef) > characterImage > keyImage > dropSlots[0]
```

---

### Step C: CONTINUE Gate + Transition Editor (中間画像確認 & 遷移確認)

| Property | Value |
|----------|-------|
| **Function** | [`confirmContinueAfterIntermediateImages()`](static/js/simple_video.js#L9428) |
| **Auto/Manual** | **Manual pause** — user must click CONTINUE |

**Description**: After all N+1 scene images are generated, the pipeline pauses:
```
🖼️ 中間画像確認 (char_edit_i2v_mixed) / 新規生成: N+1 / 全M+1シーン。
必要ならシーン画像を再生成してから CONTINUE を押してください。
```

The 🔀 **Transition Type Editor** accordion is also rendered here (if not already visible), allowing final review/override of per-boundary transition types.

**User Intervention Points During Gate**:
- **Review** N+1 intermediate images in the UI
- **Regenerate** individual scenes via `regenerateIntermediateSceneImage(index)` — green 🔄 button
- **Upload** replacement images via file drop on individual scene slots
- **Clear** individual scenes via `clearIntermediateSceneImage(index)` — red ✕ button
- **Change transition types** in the 🔀 accordion dropdowns
- Click **CONTINUE** to proceed to video generation
- Click **PAUSE/STOP** to abort

After CONTINUE, the pipeline refreshes `sceneImages[]` from `inter.images[]` to pick up modifications.

---

### Step D: Per-Boundary Video Generation (Mixed Dispatch)

| Property | Value |
|----------|-------|
| **Location** | `startGeneration()` mixed-transitions branch, after CONTINUE |
| **Auto/Manual** | Automatic |
| **Dispatch** | Per-boundary based on `state.transitionTypes[i]` |

**Processing Flow** (for each boundary i = 0..N-1):

```
transitionTypes[i] === 'flf'        → FLF video generation (Wan2.2 FLF)
transitionTypes[i] === 'cut'        → No video; use scene image directly
transitionTypes[i] === 'crossfade'  → Short clips; ffmpeg crossfade at concat
transitionTypes[i] === 'fade_black' → Short clips; ffmpeg fade at concat
transitionTypes[i] === 'none'       → Same as 'cut'
```

#### D-1: FLF Boundaries (`flf`)

1. Build FLF prompt via `composeFLFPromptWithEndIntent()` (L12110):
   ```
   Start intent: [scene i prompt].
   End target (must be reflected near the end frame): [scene i+1 prompt].
   Keep subject identity consistent and make camera direction/pose transition smooth and coherent.
   ```
2. Build parameters:
   - `input_image_start`: scene image i
   - `input_image_end`: scene image i+1
   - `width`, `height`, `fps`, `frames`
3. Call `runWorkflowStep()` → `api.generate()` → ComfyUI (`wan22_smooth_first2last` or `wan22_flf2v`)
4. Store video basename in `sceneVideoBasenames[]`

**Workflow Selection** (`state.flfQuality`):
- `'speed'` → `wan22_smooth_first2last` (4-step, fast)
- `'quality'` → `wan22_flf2v` (20-step, high quality)

---

### Step E: Video Concatenation

| Property | Value |
|----------|-------|
| **Location** | `startGeneration()` L12849-12917 |
| **Backend Workflow** | `video_concat` → ffmpeg concat via `app.py` L2061 |
| **Auto/Manual** | Automatic |

**Processing Flow**:
1. Assembles clip list from `sceneVideoBasenames[]`
2. For `cut`/`none` boundaries: scene images converted to short still clips (1–2 frame) or skipped
3. For `crossfade` / `fade_black` boundaries: ffmpeg filter chain applied during concat
4. Calls `api.generateUtility({ workflow: 'video_concat', videos, fps, keep_audio })`
5. Backend (`app.py` L2061-2092) runs ffmpeg concat
6. Renders final output with `showMusicMergeButton: true`

---

### Step F: Music Merge (Optional — 🎵 音楽を追加)

| Property | Value |
|----------|-------|
| **Function** | [`mergeM2VAudioWithCurrentVideo()`](static/js/simple_video.js#L8623) |
| **Trigger** | "🎵 音楽を追加" button on concat output |
| **Backend Workflow** | `video_audio_merge` → ffmpeg via `app.py` L2095 |
| **Auto/Manual** | **Manual** |

Same as `char_edit_i2i_flf`. Merges generated or uploaded audio with the final video.

---

## Key Backend API Endpoints (`app.py`)

| Workflow ID | Backend Handler | Purpose |
|---|---|---|
| `scenario_generate` | L2118 | LLM-based scenario expansion |
| `prompt_generate` | L2173 | LLM scene prompts (`output_type: mixed_sequence` → N+1 + transition hints) |
| `lyrics_generate` | L2324 | LLM-based lyrics composition |
| `ace_step_1_5_t2a` | ComfyUI | ACE-Step music generation |
| `qwen_i2i_2511_bf16_lightning4` | ComfyUI | Qwen 2511 EDIT I2I (character composite + scene EDIT) |
| `qwen_i2i_2512_lightning4` | ComfyUI | Qwen 2512 I2I (scene refinement, CFG=7.0 / denoise=0.75 via refine workflow) |
| `wan22_smooth_first2last` | ComfyUI | Wan2.2 FLF 4-step — used for `flf` speed boundaries |
| `wan22_flf2v` | ComfyUI | Wan2.2 FLF 20-step — used for `flf` quality boundaries |
| `video_concat` | L2061 (ffmpeg) | Concatenate clips with optional crossfade/fade filters |
| `video_audio_merge` | L2095 (ffmpeg) | Merge video + audio tracks |
| `character_sheet_card_v1_0` | ComfyUI | Character sheet generation |
| `remove_bg_v1_0` | ComfyUI | Background removal |

> **Note**: `wan22_i2v_lightning` (I2V) is listed in the preset `steps[]` for UI labeling purposes but actual boundary dispatch uses `wan22_smooth_first2last` / `wan22_flf2v` for FLF boundaries. Pure I2V boundaries are currently handled by the FLF path (the preset name reflects the pipeline capability, not a separate I2V-only path).

---

## Complete Function Call Graph

```
User clicks "▶ 動画を生成"
  └─ startGeneration()                                         [L12225]
       ├─ Validation (preset, scenario, key image, character)  [L12240-12274]
       ├─ determineScenePromptsForCurrentSimpleVideoRun()      [L12029]
       │    ├─ parseScenePromptsFromText()                     [L10636]
       │    └─ generateScenePromptsForCurrentSimpleVideoRun()  [L10688]
       │         └─ api.generateUtility({prompt_generate,      [backend L2173]
       │                output_type: 'mixed_sequence'})
       │              → extracts N+1 prompts + transitionTypes[]
       │
       ├─ [char_edit_i2v_mixed branch]
       │
       │   ┌─ (A) Per-Scene I2I × N+1 ────────────────────────────────┐
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
       │   ┌─ (C) CONTINUE Gate + Transition Editor ──────────────────┐
       │   │  confirmContinueAfterIntermediateImages()     [L9428]     │
       │   │  renderTransitionEditor()   ← 🔀 accordion UI           │
       │   │  *** USER PAUSES — reviews images + transition types ***  │
       │   │  Refresh sceneImages from inter.images        [L12787]    │
       │   └───────────────────────────────────────────────────────────┘
       │
       │   ┌─ (D) Per-Boundary Mixed Dispatch ────────────────────────┐
       │   │  for boundary i = 0..N-1:                                │
       │   │    switch(transitionTypes[i]):                           │
       │   │      'flf':                                              │
       │   │        ├─ composeFLFPromptWithEndIntent()    [L12110]    │
       │   │        ├─ computeLTXFrames()                 [L402]      │
       │   │        └─ runWorkflowStep({wan22_smooth_first2last})     │
       │   │      'cut' / 'none':                                     │
       │   │        └─ (no video generation — passthrough in concat)  │
       │   │      'crossfade' / 'fade_black':                         │
       │   │        └─ (short still clips; ffmpeg filter at concat)   │
       │   └───────────────────────────────────────────────────────────┘
       │
       │   ┌─ (E) Video Concatenation ───────────────────────────────┐
       │   │  rememberSceneVideoBasenames()                [L12124]    │
       │   │  api.generateUtility({video_concat})                     │
       │   │    └─ backend ffmpeg concat + filter chain   [app.py L2061]
       │   │  renderSimpleVideoOutputMedia({showMusicMergeButton})    │
       │   └───────────────────────────────────────────────────────────┘
       │
       └─ Done ✅

[Optional, post-generation]:
  User clicks "🎵 音楽を追加"
    └─ mergeM2VAudioWithCurrentVideo()                         [L8623]
         └─ runSimpleVideoUtilityJob({video_audio_merge})      [L8674]
              └─ backend ffmpeg merge                          [app.py L2095]
```

---

## State Keys Summary

| State Key | Type | Purpose |
|---|---|---|
| `selectedPreset` | `string` | Active preset ID (`'char_edit_i2v_mixed'`) |
| `scenario` | `string` | User scenario text |
| `scenarioIdea` | `string` | Short idea for scenario generation |
| `llmPrompt` | `string` | Generated scene prompts — N+1 entries (editable) |
| `sceneCount` | `string` | Number of scene **boundaries** (N); N+1 images are generated |
| `sceneLengthSec` | `string` | Seconds per scene segment |
| `imagePrompt` | `string` | EDIT prompt for character composite |
| `keyImage` / `uploadedImage` | `{filename, ...}` | Character reference image |
| `dropSlots[0..2]` | `{filename, ...}[]` | ref1/ref2/ref3 reference images |
| `characterImage` | `{filename, presetId, ...}` | Generated character composite |
| `characterSheetImage` | `{filename, ...}` | Generated character sheet |
| `useCharSheetAsRef` | `boolean` | Use character sheet instead of composite |
| `i2iRefSource` | `'character' \| 'first_scene'` | Reference source for scene 2+ |
| `i2iRefineWorkflow` | `string` | I2I workflow override |
| `i2iDenoise` | `string` | I2I denoise strength |
| `i2iCfg` | `string` | I2I CFG scale |
| `transitionTypes` | `string[]` | Per-boundary transition type (`flf`/`cut`/`crossfade`/`fade_black`/`none`) |
| `flfQuality` | `'speed' \| 'quality'` | FLF step count for FLF boundaries |
| `flfEndConstraintEnabled` | `boolean` | Inject end-target in FLF prompt |
| `motionStrength` | `string` | FLF motion level hint |
| `ref3UseMode` | `string` | ref3 usage: background/style/anime |
| `intermediateImages` | `{presetId, images[]}` | N+1 per-scene still images |
| `sceneVideos` | `{presetId, videos[]}` | Per-boundary video basenames |
| `t2aGeneratedAudio` | `{filename, ...}` | Generated BGM |
| `m2vDurationPlan` | `number[]` | Per-scene duration (M2V mode) |
| `fps` | `string` | Target FPS |
| `videoSize` | `string` | Target resolution |
| `scenarioUseLLM` | `boolean` | Use LLM for prompt generation |
| `promptComplexity` | `string` | LLM prompt detail level |

---

## Preset Configuration

```javascript
// static/js/simple_video.js
{
    id: 'char_edit_i2v_mixed',
    name: '🖼️→🎬🔀 キャラ EDIT + I2I + 混在トランジション',
    requiresImage: true,
    requiresCharacter: true,
    requiresCharacterImage: true,
    supportsRefSourceSelect: true,   // i2iRefSource selector visible
    mixedTransitions: true,          // N+1 images, mixed_sequence output type, transition editor UI
    steps: [
        { workflow: 'qwen_i2i_2511_bf16_lightning4', label: 'キャラ合成画像(EDIT)' },
        { workflow: 'wan22_i2v_lightning', label: 'シーンI2V' },
        { workflow: 'wan22_smooth_first2last', label: 'FLF遷移' }
    ]
}
```

**Key Preset Flags**:
- `requiresImage: true` — key image must be provided (enables 🎭 character EDIT section)
- `requiresCharacter: true` — character context needed
- `requiresCharacterImage: true` — character composite EDIT image needed
- `supportsRefSourceSelect: true` — shows reference source dropdown
- `mixedTransitions: true` — activates mixed dispatch: N+1 image request, `mixed_sequence` prompt output type, `renderTransitionEditor()` accordion, per-boundary FLF/I2V/cut dispatch in `startGeneration()`

---

## Comparison with `char_edit_i2i_flf`

| Aspect | `char_edit_i2i_flf` | `char_edit_i2v_mixed` |
|--------|--------------------|-----------------------|
| Image count | N+1 (for N FLF segments) | N+1 (for N boundaries) |
| Transition type | FLF only (`wan22_smooth_first2last` / `wan22_flf2v`) | Per-boundary: FLF / Cut / Crossfade / Fade Black |
| LLM output type | `flf_sequence` | `mixed_sequence` |
| Transition editor UI | ❌ Not shown | ✅ Shown after prompt gen and at CONTINUE gate |
| `state.transitionTypes[]` | Not used | Per-boundary type array |
| `flfOnly` flag | `true` | Not set |
| `mixedTransitions` flag | Not set | `true` |
| Character EDIT step | ✅ Same | ✅ Same |
| CONTINUE gate | ✅ Same | ✅ Same (+ transition editor) |
| Music merge | ✅ Same | ✅ Same |
