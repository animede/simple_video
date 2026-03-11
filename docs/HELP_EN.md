# Simple Video Quick Help

This help page focuses only on operation steps when the app is **already open**.

## 1. T2V (Generate Video from Text)

1. In `⚙️ Generation Sequence`, select a T2V preset (e.g., Generate video directly from text)
2. In `📜 Scenario Input`, write what you want to create
3. If needed, use `🤖 Generate Prompts`
4. Click `Generate Video`

## 2. Character Video (Generate with Image References)

1. Put reference images into `📥 Image Drop`
2. Select from `👤 Character List`, or use `📝 Register Character`
3. Enter an initial image prompt in `📝 What do you want to draw?`
4. Click `Generate Initial Image`, then proceed to video generation

Notes:

- In `char_edit_i2i_flf`, initial image and character image are especially important
- Generated images are automatically reflected as key images

## 3. T2A (Generate Music from Text)

1. Enter music mood and lyric ideas in the music input area
2. Use lyric/tag suggestion when needed
3. Run music generation and check the output audio

With `--ace-step-url`, you can use `🧠 Thinking` (high quality) and `✨ AI Tags` (tag enhancement).

## 4. M2V (Generate Video from Music)

1. Select generated audio or uploaded audio
2. Enter video scenario (a confirmation dialog appears if empty)
3. Run `Generate Video`

## 5. V2M (Generate Music from Video)

1. Select generated video or uploaded video
2. Specify music style conditions if needed
3. Run and check the resulting video with merged music

## 5.5 🎵 Add Music to Video

- A `🎵 Add Music` button appears on concatenated video output (when audio is available)
- Click to merge audio track onto video and create a PV

## 6. When Something Goes Wrong

- If `ComfyUI /prompt failed` appears, check the error detail for where it stopped (`node_errors`)
- For image reference errors, re-check `📥 Image Drop` and character selection
- 404 on old job IDs may be resolved by regenerating

## 7. Guides

- Technical Guide: [/api/v1/simple-video/help/technical](/api/v1/simple-video/help/technical)
- User Guide: [/api/v1/simple-video/help/guide](/api/v1/simple-video/help/guide)
