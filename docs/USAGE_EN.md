# Simple Video Standalone User Guide

This document is a complete guide to features actually available in the standalone edition of `simple_video_app`.

## 1. Scope and Prerequisites

- Target: `simple_video_app` (Standalone)
- Prerequisite: ComfyUI is running at `127.0.0.1:8188`
- Browser: `http://127.0.0.1:8090/`

## 2. Screen Layout

- Left panel: key image, character image creation, image prompt, music generation
- Right panel: output preview, video generation (sequence, settings, scenario, intermediate images, execution)
- Top bar: `📁 Files` (artifact browser) / `❓ Help` (floating help)

---

## 3. Key Image

- Click or drag & drop to upload image/video
  - For video upload, the last frame is automatically extracted as key image
- `🔍 Analyze`: analyze key image using VLM (Vision-Language Model) and auto-generate prompt text
  - “Use analysis result in scenario”: inject analysis result into scenario generation
  - “Inject analysis result into scene prompts”: inject directly into each scene prompt
- `🗑️`: delete key image (also clears analysis/composition data)

## 4. Character Image Generation

This is a collapsible section.

### 4.1 📥 Image Drop (ref1–ref3)

- Drop/click upload to 3 reference slots
- If video is dropped, last frame is auto-extracted
- Use `×` on each slot for individual removal

### 4.2 ref3 Usage Mode

- Toggle whether ref3 is used in I2I scene generation
- Modes: 🏞️ Background / 🎨 Style / ✨ Anime style

### 4.3 👤 Character List

- `🔄` reload registered characters
- Clicking a character chip inserts `@character_name` token into prompt
- `🔘 Clear selection` resets current character selection

### 4.4 📝 Register Character

- Register a new character with name + image file

### 4.5 📝 What do you want to draw? (Image Prompt)

How image generation works:

- Enter prompt and run `Generate Initial Image`
- **No key image and no image-drop references -> T2I** (generate from text)
- **With key image or image-drop references -> I2I EDIT** (edit/adjust from references)
- Generated image is auto-reflected as key image and carried into video generation
- `🌐 Translate`: auto-translate prompt (EN<->JA)
- `🗑️ Clear`: clear prompt

### 4.6 Generate Initial Image

- `✂️ Pre Background Removal`: auto-remove background before generation
- To remove background more reliably, specify target background color in `📝 What do you want to draw?` (e.g. `plain white background`)
- `Generate Initial Image`: runs T2I or I2I
- `Stop`: interrupts running job

---

## 5. 🎼 Music Generation

### 5.1 Music Settings

| Setting | Description |
|---|---|
| Music Scenario | Theme / emotion / progression (uses video scenario when empty) |
| Tags (required) | Genre / mood / BPM etc. (e.g. `pop, female voice, emotional, 110 bpm`) |
| Lyrics (optional) | Lyrics text |
| Language | English / Japanese / Chinese |
| Duration | Seconds (1–300, default 30) |
| BPM | Tempo (30–240, default 120) |
| Time Signature | 2/4, 3/4, 4/4, 6/8 |
| Key/Scale | C–B major/minor |
| Steps | Inference steps (1–200, default 8) |

Recommended music scenario length:

- Long input can run, but too long text tends to blur the main idea
- Recommended: **5–12 lines** or about **300–1200 chars**
- Keep it concise: theme / emotional transition / scene flow / ending image
- Duration is controlled separately by seconds, not by scenario length

### 5.2 Music Buttons

| Button | Action |
|---|---|
| 🚀 AUTO | Auto-run lyric generation -> tag suggestion -> music generation |
| 🎼 Lyrics | Generate lyrics from scenario using LLM |
| 🏷️ Suggest Tags | Suggest tags from lyrics using LLM |
| 🎵 Generate Music | Generate audio using ACE-Step workflow |
| 🎬 Music->Video (M2V) | Generate video aligned to music |

When an ACE-Step API server is connected, additional controls appear:

| Control | Description |
|---|---|
| 🧠 Thinking | ON for high-quality generation (steps=50, cfg=3.0), OFF for turbo mode (steps=8, cfg=1.0) |
| ✨ AI Tags | Auto-enhance tags/caption using ACE-Step API's LM |
| CFG | Guidance strength (auto-adjusted when Thinking is toggled) |

### 5.3 Audio Source for M2V

- Switch source between “Generated Music” and “Uploaded Audio”
- Upload by drag & drop or click selection

### 5.4 Scenario Handling in M2V

- If scenario is empty, a confirmation dialog appears
  - `Generate as-is`: continue based on lyrics/audio
  - `Input scenario`: return to scenario field for editing
- When doing targeted scene regeneration after M2V, keep the `Scene Prompts` field populated (do not clear it)

### 5.5 ACE-Step API Server Integration

With `--ace-step-url`, you can connect an external ACE-Step API server for enhanced music generation:

- **Thinking mode**: LM-enhanced high-quality music generation (default ON)
- **AI Tag enhancement**: Auto-generate/enhance tags using ACE-Step API's LM
- Without ACE-Step API, music is generated via ComfyUI workflow (turbo 8 steps)

Startup example:
```bash
./start.sh --ace-step-url http://127.0.0.1:8001
```

---

## 6. 🎬 Output

- Preview generated video/image/audio
- Click to open full-screen modal playback
- Download links

### 6.1 🎵 Add Music to Video

A `🎵 Add Music` button appears on concatenated video output (only when audio is available):

- Shown when music has been generated or an external audio file has been uploaded
- Clicking it merges the audio track onto the video from the beginning using ffmpeg
- If video is shorter, audio fades out; if audio is shorter, it is merged as-is
- Useful for quickly creating a PV (video + music) without using M2V

### 6.2 V2M Input (Video -> Music)

- Upload video by drag & drop (for V2M input)
- Video duration is auto-detected and shown

---

## 7. 🎬 Video Generation

### 7.1 ⚙️ Generation Sequence

Choose the video generation pipeline.

| Option | Description |
|---|---|
| Use LTX | ON: prefer LTX-2 workflows (faster) |
| LTX Type | Full FP4 / Distilled |
| Generate audio too | Attach audio track when workflow supports it |

Available presets:

| Preset | Summary |
|---|---|
| T2I -> I2V Scene Cut | Generate images from text, then I2V per scene |
| T2I -> I2V Scene Continuous | Generate first image from text, then continue from previous last frame |
| T2V Scene Cut | Direct T2V generation per scene |
| T2V Scene Continuous | T2V + continue from previous last frame |
| Key Image -> I2V Continuous | Scene 1 from key image, then continuous generation |
| Key Image Refine -> I2V Continuous | I2I refine key image, then continuous I2V |
| Key Image Refine -> I2V Scene Cut | I2I refine key image, then independent I2V per scene |
| Character I2I + FLF Continuous | I2I scene images from character refs + FLF transitions |
| Character EDIT + I2I + FLF Continuous | EDIT -> I2I -> FLF transitions |
| Character EDIT + I2I + I2V Scene Cut | EDIT -> I2I -> I2V per scene |

### 7.2 ⚙️ Video Settings

Basic:

| Setting | Description |
|---|---|
| Scene Count | 1–24 (default 3) |
| Scene Length | 2 / 3 / 4 / 5 / 8 / 10(LTX) / 13(LTX) sec |
| Total | Auto-calculated (read-only) |
| Reference Image Role | Character consistency / style atmosphere consistency |
| Reference Lock | Character lock / Scene1 lock |
| Motion Strength | Tiny / Small / Medium / Large |
| Variation | Auto / Stable / Dynamic (inter-scene delta level) |

For continuous long presets (`Character I2I + FLF Continuous` / `Character EDIT + I2I + FLF Continuous`):

- `Variation=Auto` defaults to low-delta behavior (stable-leaning)
- Even with `Motion=Medium`, prompt generation is biased toward smaller motion to prioritize continuity

Advanced (⚙️ toggle):

| Setting | Description |
|---|---|
| Size | auto or fixed resolutions (landscape/portrait/square) |
| FPS | numeric (blank=auto, fixed 24 for LTX) |
| FLF Quality | ⚡ Speed / ✨ Quality |
| I2I Model | auto / Qwen 2511 Lightning / 2511 20-step / 2512 Lightning / Flux2 Edit / Klein 4B / Klein 9B |
| I2I denoise | 0–1 (step 0.001) |
| I2I CFG | numeric |

Settings management:

- `🔄 Reset`: restore all video settings to default
- `🗑️ Clear Browser Memory`: clear state and reload page

### 7.3 📜 Scenario Input

- `🎯 Rough Intent (1–2 sentences)`: short idea input
- `🧠 Build Scenario`: auto-expand rough intent into detailed scenario in the scenario field (adaptive structure, not fixed template)
- `🎨 Style Preset`: one-click insertion of `Realistic / Anime / Illustration / Cinematic / Line-art / Pixel-art`
  - Stored as a single `STYLE_ANCHOR`; selecting another style overwrites it
  - Applying style preset auto-sets baseline scene length to `5s`
- Scenario text input (describe what video you want)
- `Generate prompts with LLM`: ON = auto scene prompts; OFF = copy scenario into each scene
- `Complexity`: Basic / Standard / Detailed (default: Standard)
- `Inject FLF end intent`: inject next-scene intent into FLF prompt end constraint
- `🌐 Translate`: EN<->JA translation for generated prompt text
- `🗑️`: clear generated scene prompts

Recommended 2-step prompt workflow:

1. `🧠 Build Scenario`
2. `🤖 Generate Prompts`

Guardrails automatically apply after `🤖 Generate Prompts`:

- Suppress split composition keywords (split-screen / collage / multi-panel)
- Strengthen subject consistency (when character references exist)
- Enforce style consistency from `STYLE_ANCHOR` and supplement missing style cues

Tips for `Line-art` preset:

- It auto-adjusts to `Motion=Small` and `Complexity=Basic`
- Style preset baseline keeps scene length at `5s`
- Keep one primary action per scene to reduce line instability
- Avoid heavy photoreal texture cues; prioritize readable contours/lines
- If unstable, retry with `4–5s` scene length

Tips for `🎯 Rough Intent`:

- In 1–2 sentences, include who / where / what action
- If possible, include a short time flow (e.g., past->present->future)
- Add one style/mood keyword (e.g., cinematic, nostalgic, documentary)
- Avoid over-specifying details before scenario build

Good examples:

- `A young man in a harbor town traces family memories using an old photo. Time moves from dusk to night, ending at dawn with hope.`
- `Follow one day of a courier in rainy Tokyo: quiet morning -> crowded noon -> lonely midnight.`

Avoid:

- `cool video` (missing subject/place/action)
- `do everything automatically` (too ambiguous)

Recommended quality flow:

1. Enter rough intent -> `Build Scenario`
2. Set complexity to `Standard` or `Detailed`
3. Run `Generate Prompts`

Notes:

- `Basic` is short/lightweight, `Standard` is balanced, `Detailed` is most descriptive
- Higher quality increases generation time/tokens; start from `Standard`

### 7.4 📸 Internal Reference Images

- View auto-prepared internal refs (character composition, initial image, etc.)
- Click to enlarge
- `✕` remove individually, `🗑️` remove all

### 7.5 🖼️ Intermediate Images (Scene Images)

- Preview and edit scene thumbnails
- Click to enlarge
- Replace by drag & drop
- `🔄` regenerate scene image
- `🎬` regenerate scene video
- `✕` delete one
- `🗑️` clear all intermediate images

### 7.6 Execution Buttons

| Button | Action |
|---|---|
| 🤖 Generate Prompts | Generate scene prompts from scenario via LLM |
| 🖼️ Pre-generate Scene Images | Pre-generate all scene images with I2I |
| ▶ Generate Video | Run full video generation pipeline |
| 🎵 Video->Music | Generate BGM based on video duration (V2M) |
| ⏹ Stop | Interrupt running jobs |

### 7.7 Progress / Intermediate Confirmation

- Progress bar shows step status and progress rate
- If intermediate confirmation is enabled:
  - `▶ CONTINUE`: continue pipeline
  - `🔄 Regenerate All Scenes`: regenerate all scene images before continuing
  - `🔁 Restart from Beginning`: clear prompts/images and restart
  - `⏸ Pause & Adjust`: stop pipeline for manual intermediate edit

### 7.8 🤖 Generated Scene Prompts

- View and edit LLM-generated scene prompts
- `🌐 Translate`: EN<->JA

### 7.9 🧩 Prompt Writing Tips (Higher Quality)

Key premise:

- Manual prompt adjustment usually gives higher quality than using generated prompts unchanged
- Prompt quality depends strongly on the LLM used
- Bigger model size does not always mean better output
- In practice, models that naturally describe emotion/continuity often perform better for video prompts

Priority fixes:

1. **Subject consistency**
   - Keep age/outfit/hair/props consistent across scenes
   - Explicitly state subject in each scene

2. **Scene-to-scene continuity**
   - Add one line to connect end of scene N and start of scene N+1
   - Example: `same character and outfit, continuing from previous scene`

3. **Concrete camera direction**
   - Use concrete camera terms (`slow dolly-in`, `gentle pan-right`, `handheld close-up`)
   - Limit to 1–2 camera directives per scene

4. **Concrete action**
   - Prefer specific actions over abstract terms
   - Avoid too many simultaneous actions (main + one sub-action)

5. **Locked light/color/material**
   - Specify time/light source/color tone explicitly
   - Avoid drastic color design changes between scenes

6. **Suppress unwanted artifacts**
   - Add a short negative list (watermark/subtitle/logo/text artifacts/deformed anatomy)
   - Keep it concise (2–6 items)

Editing cautions:

- Overlong prompts cause conflicts; keep one scene = one core theme
- Avoid contradictions (e.g., night scene + harsh daylight)
- In FLF, clearly describe end state for next-scene connection
- If unsure: Standard -> manual fix -> Detailed only when needed

Practical flow (recommended):

1. `🎯 Rough Intent` -> `🧠 Build Scenario`
2. `🤖 Generate Prompts` (Complexity: Standard)
3. Manually adjust each scene using the 6 points above
4. Test-generate and fix only broken scenes

Common terms:

| Term | Meaning / usage | Example |
|---|---|---|
| cinematic | film-like look | `cinematic lighting, dramatic composition` |
| establishing shot | opening wide context shot | `establishing shot of a rainy harbor city` |
| close-up | close framing on subject | `close-up of her face, subtle breathing` |
| medium shot | standard body framing | `medium shot, character walking forward` |
| wide shot | wide framing with environment | `wide shot, skyline and crowd in frame` |
| dolly-in / dolly-out | camera forward/backward move | `slow dolly-in toward the protagonist` |
| pan / tilt | camera horizontal/vertical move | `gentle pan right following motion` |
| tracking shot | camera follows subject | `tracking shot, keeping her centered` |
| handheld | natural hand-held shake style | `handheld camera, slight natural shake` |
| shallow depth of field | blur background to emphasize subject | `shallow depth of field, focus on eyes` |
| rim light / backlight | edge/back lighting | `soft rim light separating subject` |
| volumetric light | visible light rays | `volumetric light through window haze` |
| color palette | color design specification | `teal and orange color palette` |
| film grain | film-like texture | `subtle film grain, organic texture` |
| continuity | cross-scene consistency instruction | `maintain continuity of outfit and prop` |
| atmosphere / mood | emotional tone | `melancholic mood, quiet atmosphere` |
| negative prompt | suppression instruction | `no watermark, no subtitle, no logo` |

Usage tips:

- Use only 3–6 technical terms per scene
- Keep camera directives to 1–2 per scene
- Adding `continuity` + `negative prompt` in all scenes improves stability

---

## 8. 📁 Files Browser

Artifact management modal opened via top bar `📁 Files`.

| Action | Description |
|---|---|
| Filter | All / Image / Video / Music Video / Audio |
| Sort | Date / Name / Size (asc/desc) |
| Select All / Deselect | Bulk selection |
| Batch Delete | Delete selected files |
| Delete Single | Individual 🗑️ button |
| Download | Individual ⬇ button |
| Preview | Full-screen modal for image/video/audio |

---

## 9. ❓ Help System

Switch between these docs in floating panel:

- Quick Help (`tutorial`)
- User Guide (`guide`)
- Technical Guide (`technical`)

The panel can be dragged, minimized, and closed.

---

## 10. Error Checks

- If `ComfyUI /prompt failed` appears, check stop point in error detail (`node_errors`)
- For reference image errors, re-check `📥 Image Drop` and character selection
- Old `job_id` 404 may be resolved by regenerating

## 11. Unsupported in Standalone

- Utility features (generic API calls for main product)
- Distributed mode
- Multi-user concurrent operation (single-user assumption)

## 12. Reference Links

- Quick Help: `/api/v1/simple-video/help/tutorial`
- User Guide (this doc): `/api/v1/simple-video/help/guide`
- Technical Guide: `/api/v1/simple-video/help/technical`
