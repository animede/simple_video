/**
 * かんたん動画 (Simple Video) UI
 * 
 * A beginner-friendly full-screen wrapper for Full Auto Video generation.
 * Current implementation uses direct API calls (window.app.api.*).
 */

/* ========================================
    Video Presets (Sequences)
    ======================================== */

const VIDEO_PRESETS = [
    {
        id: 't2i_i2v',
        name: 'テキストから初期画像生成し動画生成--シーン切替え動画',
        description: 'プロンプトだけで動画を生成（シーン毎に切り替わる）',
        icon: '✏️→🖼️→📹',
        requiresImage: false,
        requiresCharacter: false,
        steps: [
            { workflow: 'qwen_t2i_2512_lightning4', label: '画像生成' },
            { workflow: 'wan22_i2v_lightning', label: '動画生成' }
        ]
    },
    {
        id: 't2i_i2v_scene_continuous',
        name: 'テキストから初期画像生成し動画生成（シーン連続）',
        description: '最初は画像生成、以降は前シーン最終フレームから連続生成',
        icon: '✏️→🖼️→🎬',
        requiresImage: false,
        requiresCharacter: false,
        // Initial key image generation (once) using the first scene prompt.
        initialImageWorkflow: 'qwen_t2i_2512_lightning4',
        initialImageLabel: '初期画像生成',
        // Between scenes, chain by extracting last frame from the previous scene video.
        sceneContinuity: 'last_frame',
        // Per-scene step: I2V only.
        steps: [
            { workflow: 'wan22_i2v_lightning', label: '動画生成' }
        ]
    },
    {
        id: 't2v_i2v',
        name: 'テキストから直接動画を生成--シーン切替え動画',
        description: 'シーン毎プロンプトを直接T2Vで生成',
        icon: '✏️→📹',
        requiresImage: false,
        requiresCharacter: false,
        steps: [
            { workflow: 'qwen22_t2v_4step', label: '動画生成' }
        ]
    },
    {
        id: 't2v_i2v_scene_continuous',
        name: 'テキストから直接動画を生成（シーン連続）',
        description: '最初はT2Vで動画生成、以降は最終フレームからI2Vで連続生成',
        icon: '✏️→🎬',
        requiresImage: false,
        requiresCharacter: false,
        // First scene uses T2V directly (no T2I).
        initialVideoWorkflow: 'qwen22_t2v_4step',
        initialVideoLabel: '最初の動画生成',
        // Between scenes, chain by extracting last frame from the previous scene video.
        sceneContinuity: 'last_frame',
        // Per-scene step: I2V only.
        steps: [
            { workflow: 'wan22_i2v_lightning', label: '動画生成' }
        ]
    },
    {
        id: 'ext_i2v',
        name: 'キー画像から連続動画生成',
        description: '1シーン目はキー画像からI2V、以降は前シーン最終フレームから連続生成',
        icon: '🖼️→🎬',
        requiresImage: true,
        requiresCharacter: false,
        // Between scenes, chain by extracting last frame from the previous scene video.
        sceneContinuity: 'last_frame',
        steps: [
            { workflow: 'wan22_i2v_lightning', label: '動画生成' }
        ]
    },
    {
        id: 'ext_i2i_i2v_first',
        name: '画像リファイン後動画生成（連続）',
        description: 'キー画像をリファイン→その画像からI2V（2シーン目以降は最終フレームで連続）',
        icon: '🖼️→🔧→🎬',
        requiresImage: true,
        requiresCharacter: false,
        // Initial refine (once) using the key image as input.
        initialRefineWorkflow: 'i2i_qwen_image_edit_2511_bf16_lightning4_api.json',
        initialRefineLabel: '画像リファイン',
        // Between scenes, chain by extracting last frame from the previous scene video.
        sceneContinuity: 'last_frame',
        // Per-scene step: I2V only.
        steps: [
            { workflow: 'wan22_i2v_lightning', label: '動画生成' }
        ]
    },
    {
        id: 'ext_i2i_i2v_scene_cut',
        name: '画像リファイン後動画生成--シーン切替え動画',
        description: '毎シーン: キー画像をI2Iでリファイン→その画像からI2V（シーン間の継続なし）',
        icon: '🖼️→🔧→📹',
        requiresImage: true,
        requiresCharacter: false,
        // Support pre-generation of all scene images before video generation
        supportsPregenerateImages: true,
        // Per-scene: refine key image using each scene prompt, then generate video from that refined image.
        steps: [
            { workflow: 'i2i_qwen_image_edit_2511', label: '画像リファイン' },
            { workflow: 'wan22_i2v_lightning', label: '動画生成' }
        ]
    },
    {
        id: 'char_i2i_flf',
        name: '📷→🖼️→🎬 キャラクター動画（I2I + FLF）--連続長尺動画',
        description: 'キー画像を参照して各シーン画像をI2Iで作成→全区間FLFで遷移動画を生成（I2V不要・高速）',
        icon: '👤',
        requiresImage: true,
        requiresCharacter: false,
        flfOnly: true,  // I2Vを使わず全区間FLFで遷移（画像はN+1枚必要）
        steps: [
            // NOTE: This preset is executed via a dedicated pipeline in startGeneration().
            // Steps are kept for UI + prompt_generate targeting.
            { workflow: 'qwen_i2i_2512_lightning4', label: 'シーン画像生成(I2I)' },
            { workflow: 'wan22_smooth_first2last', label: 'FLF遷移' }
        ]
    },
    {
        id: 'char_edit_i2i_flf',
        name: '📷→🖼️(EDIT)→🖼️→🎬 キャラクター動画（合成+参照選択）--連続長尺動画',
        description: 'EDITプロンプトで合成画像を作成→その画像を参照にI2Iでシーン画像生成→全区間FLFで遷移（I2V不要・高速）',
        icon: '🎭',
        requiresImage: true,
        requiresCharacter: true,
        requiresCharacterImage: true,  // 事前にキャラ合成画像を生成する必要がある
        supportsRefSourceSelect: true, // 参照ソース選択（キャラ画像 or シーン1画像）
        flfOnly: true,  // I2Vを使わず全区間FLFで遷移（画像はN+1枚必要）
        steps: [
            { workflow: 'qwen_i2i_2511_bf16_lightning4', label: 'キャラ合成画像(EDIT)' },
            { workflow: 'qwen_i2i_2512_lightning4', label: 'シーン画像生成(I2I)' },
            { workflow: 'wan22_smooth_first2last', label: 'FLF遷移' }
        ]
    },
    {
        id: 'char_edit_i2v_scene_cut',
        name: '📷→🖼️(EDIT)→🖼️→📹 キャラクター動画（合成+参照選択）--シーン切替え動画',
        description: 'EDITプロンプトで合成画像を作成→I2Iでシーン画像生成→各シーンをI2Vで動画化（FLFなし・シーンカット形式）',
        icon: '🎭',
        requiresImage: true,
        requiresCharacter: true,
        requiresCharacterImage: true,  // 事前にキャラ合成画像を生成する必要がある
        supportsRefSourceSelect: true, // 参照ソース選択（キャラ画像 or シーン1画像）
        // FLFを使わないのでLTX/音声オプションが有効
        steps: [
            { workflow: 'qwen_i2i_2511_bf16_lightning4', label: 'キャラ合成画像(EDIT)' },
            { workflow: 'qwen_i2i_2512_lightning4', label: 'シーン画像生成(I2I)' },
            { workflow: 'wan22_i2v_lightning', label: 'シーンI2V' }
        ]
    }
];

const SIMPLE_VIDEO_STANDALONE_CONFIG = (() => {
    const defaults = {
        enableLtx: false,
        showGenerateAudioOption: false,
        lockI2IWorkflow: true,
        workflows: {
            initialImage: 'qwen_i2i_2511_bf16_lightning4',
            t2i: 'qwen_t2i_2512_lightning4',
            i2i: 'qwen_i2i_2511_bf16_lightning4',
            t2v: 'wan22_t2v_gguf_lightning4',
            i2v: 'wan22_i2v_lightning',
            flf: 'wan22_smooth_first2last',
        },
    };
    const fromWindow = (typeof window !== 'undefined' && window.SimpleVideoStandaloneConfig && typeof window.SimpleVideoStandaloneConfig === 'object')
        ? window.SimpleVideoStandaloneConfig
        : {};
    return {
        ...defaults,
        ...fromWindow,
        workflows: {
            ...defaults.workflows,
            ...((fromWindow && typeof fromWindow.workflows === 'object') ? fromWindow.workflows : {}),
        },
    };
})();

function getConfiguredSimpleVideoWorkflow(kind, fallback = '') {
    const workflows = SIMPLE_VIDEO_STANDALONE_CONFIG?.workflows || {};
    const value = String(workflows?.[kind] || fallback || '').trim();
    return value || String(fallback || '').trim();
}

function mapPresetWorkflowToConfigured(workflowId) {
    const wf = String(normalizeWorkflowAlias(workflowId) || '').trim();
    if (!wf) return wf;
    if (isFLFWorkflowId(wf)) return getConfiguredSimpleVideoWorkflow('flf', wf);
    if (isT2VWorkflowId(wf)) return getConfiguredSimpleVideoWorkflow('t2v', wf);
    if (isI2VWorkflowId(wf)) return getConfiguredSimpleVideoWorkflow('i2v', wf);
    if (isT2IWorkflowId(wf)) return getConfiguredSimpleVideoWorkflow('t2i', wf);
    if (isI2IWorkflowId(wf)) return getConfiguredSimpleVideoWorkflow('i2i', wf);
    return wf;
}

function applyStandaloneWorkflowConfigToPresets() {
    for (const preset of VIDEO_PRESETS) {
        if (!preset || typeof preset !== 'object') continue;

        if (Array.isArray(preset.steps)) {
            preset.steps = preset.steps.map((step) => {
                if (!step || typeof step !== 'object') return step;
                return {
                    ...step,
                    workflow: mapPresetWorkflowToConfigured(step.workflow),
                };
            });
        }

        if (preset.initialImageWorkflow) {
            preset.initialImageWorkflow = getConfiguredSimpleVideoWorkflow('t2i', preset.initialImageWorkflow);
        }
        if (preset.initialVideoWorkflow) {
            preset.initialVideoWorkflow = getConfiguredSimpleVideoWorkflow('t2v', preset.initialVideoWorkflow);
        }
        if (preset.initialRefineWorkflow) {
            preset.initialRefineWorkflow = getConfiguredSimpleVideoWorkflow(
                'initialImage',
                getConfiguredSimpleVideoWorkflow('i2i', preset.initialRefineWorkflow),
            );
        }
    }
}

applyStandaloneWorkflowConfigToPresets();

function normalizeWorkflowAlias(workflowId) {
    const id = String(workflowId || '').trim();
    if (!id) return id;
    // Backward-compat aliases (older UI ids)
    if (id === 'wan22_i2v_lightning_4step') return 'wan22_i2v_lightning';
    if (id === 'wan22_i2v_4step') return 'wan22_i2v';
    if (id === 'fun_inpaint_4step') return 'wan22_fun_inpaint';
    if (id === 'qwen_i2i_lightning4') return 'i2i_qwen_image_edit_2511_bf16_lightning4_api.json';
    return id;
}

function isFLFWorkflowId(workflowId) {
    const id = String(normalizeWorkflowAlias(workflowId) || '').trim();
    if (!id) return false;
    // Common naming patterns
    if (/\bflf\b/i.test(id) || /_flf/i.test(id) || /flf_/i.test(id) || /flf2v/i.test(id)) return true;
    // WAN FLF workflows used by Full Auto Video
    if (id === 'wan22_smooth_first2last') return true;
    if (id.includes('first2last')) return true;
    return false;
}

function isI2IWorkflowId(workflowId) {
    const id = normalizeWorkflowAlias(workflowId);
    if (!id) return false;
    // Known aliases that don't include "i2i" in the name
    if (id === 'flux2_edit') return true;
    if (id.startsWith('flux2_multi_edit')) return true;
    // Common naming convention: i2i_* or *_i2i*
    if (id.includes('_i2i')) return true;
    if (id.startsWith('i2i_')) return true;
    if (id.includes('i2i')) return true;
    return false;
}

function isI2VWorkflowId(workflowId) {
    const id = normalizeWorkflowAlias(workflowId);
    if (!id) return false;
    // Common naming convention across this repo: *_i2v*
    if (id.includes('_i2v')) return true;
    // Fallback for older ids
    if (id.includes('i2v')) return true;
    return false;
}

function isT2VWorkflowId(workflowId) {
    const id = normalizeWorkflowAlias(workflowId);
    if (!id) return false;
    if (id.includes('_t2v')) return true;
    if (id.includes('t2v')) return true;
    return false;
}

function isT2IWorkflowId(workflowId) {
    const id = normalizeWorkflowAlias(workflowId);
    if (!id) return false;
    if (id.includes('_t2i')) return true;
    if (id.includes('t2i')) return true;
    return false;
}

function isVideoWorkflowId(workflowId) {
    const id = normalizeWorkflowAlias(workflowId);
    if (!id) return false;
    if (id.startsWith('ltx2_')) return true;
    return isI2VWorkflowId(id) || isT2VWorkflowId(id);
}

function computeLTXFrames(seconds, fps) {
    const s = Number(seconds);
    const f = Number(fps);
    if (!Number.isFinite(s) || s <= 0) return null;
    if (!Number.isFinite(f) || f <= 0) return null;
    // Many video workflows (WAN/LTX) use frames = fps * seconds + 1.
    return Math.max(1, Math.round(f * s) + 1);
}

function getDefaultFpsForVideoWorkflow(workflowId) {
    const wf = normalizeWorkflowAlias(workflowId);
    if (!wf) return 16;
    if (wf.startsWith('ltx2_')) return 24;
    return 16;
}

function syncFpsForCurrentOptions({ forceUI = true } = {}) {
    const preset = VIDEO_PRESETS.find(p => p.id === SimpleVideoUI.state.selectedPreset);
    if (!preset) return;

    const steps = getEffectivePresetStepsForCurrentOptions(preset);
    const usesLTX = steps.some(s => String(normalizeWorkflowAlias(s?.workflow) || '').startsWith('ltx2_'));

    if (usesLTX) {
        if (!SimpleVideoUI.state.ltxFpsForced) {
            SimpleVideoUI.state.fpsBackup = String(SimpleVideoUI.state.fps ?? '');
        }
        SimpleVideoUI.state.ltxFpsForced = true;
        SimpleVideoUI.state.fps = '24';

        // When switching to LTX, set appropriate size if current is auto or WAN default
        // BUT respect user's manual selection
        if (!SimpleVideoUI.state.userSelectedSize) {
            const currentSize = normalizeVideoSize(SimpleVideoUI.state.videoSize);
            const wanDefaultSizes = ['640x640', '480x832', '832x480', 'auto', ''];
            if (!currentSize || wanDefaultSizes.includes(currentSize)) {
                if (!SimpleVideoUI.state.ltxSizeForced) {
                    SimpleVideoUI.state.videoSizeBackup = currentSize;
                    SimpleVideoUI.state.customSizeBackup = normalizeCustomSize(SimpleVideoUI.state.customSize);
                }
                SimpleVideoUI.state.ltxSizeForced = true;
                // LTX recommended default: 1280x720 (HD)
                SimpleVideoUI.state.videoSize = '1280x720';
            } else {
                // User already picked a non-WAN-default size; do not override it.
                SimpleVideoUI.state.ltxSizeForced = false;
            }
        }
    } else {
        if (SimpleVideoUI.state.ltxFpsForced) {
            SimpleVideoUI.state.fps = String(SimpleVideoUI.state.fpsBackup ?? '');
        }
        SimpleVideoUI.state.ltxFpsForced = false;

        if (SimpleVideoUI.state.ltxSizeForced) {
            SimpleVideoUI.state.videoSize = normalizeVideoSize(SimpleVideoUI.state.videoSizeBackup);
            SimpleVideoUI.state.customSize = normalizeCustomSize(SimpleVideoUI.state.customSizeBackup);
        }
        SimpleVideoUI.state.ltxSizeForced = false;

        // Default to 640x640 when LTX is not used and no meaningful size is selected
        const currentSizeNonLTX = normalizeVideoSize(SimpleVideoUI.state.videoSize);
        if (!currentSizeNonLTX || currentSizeNonLTX === 'auto') {
            SimpleVideoUI.state.videoSize = '640x640';
        }
    }

    saveSimpleVideoState();

    if (forceUI) {
        const fpsInput = document.getElementById('simpleVideoFps');
        if (fpsInput) {
            try { fpsInput.value = String(SimpleVideoUI.state.fps ?? ''); } catch (_e) {}
        }

        const sizeSel = document.getElementById('simpleVideoSize');
        if (sizeSel) {
            try { sizeSel.value = normalizeVideoSize(SimpleVideoUI.state.videoSize); } catch (_e) {}
        }
    }
}

function applyWorkflowSpeedOption(workflowId, useFast) {
    const wf = normalizeWorkflowAlias(workflowId);
    if (!wf) return wf;

    if (!SIMPLE_VIDEO_STANDALONE_CONFIG.enableLtx) {
        return wf;
    }

    // Spec: when "fast" is ON, prefer LTX-2 workflows.
    if (useFast) {
        const ltxVariant = normalizeLtxVariant(SimpleVideoUI?.state?.ltxVariant || 'fp4');
        const i2vTarget = (ltxVariant === 'distilled') ? 'ltx2_i2v_distilled' : 'ltx2_i2v_full_fp4';
        const t2vTarget = (ltxVariant === 'distilled') ? 'ltx2_t2v_distilled' : 'ltx2_t2v_full_fp4';

        if (wf.startsWith('ltx2_i2v')) return i2vTarget;
        if (wf.startsWith('ltx2_t2v')) return t2vTarget;
        if (isI2VWorkflowId(wf)) return i2vTarget;
        if (isT2VWorkflowId(wf)) return t2vTarget;
        if (wf.startsWith('ltx2_')) return wf;
        return wf;
    }

    // When "fast" is OFF, keep the preset's original workflow.
    return wf;
}

function getEffectivePresetStepsForCurrentOptions(preset) {
    const rawSteps = Array.isArray(preset?.steps) ? preset.steps : [];
    
    // FLF presets don't support LTX fast option - they use WAN workflows
    const hasFLF = rawSteps.some(s => isFLFWorkflowId(s?.workflow)) || String(preset?.id || '').includes('flf');
    const useFast = (!SIMPLE_VIDEO_STANDALONE_CONFIG.enableLtx || hasFLF) ? false : !!SimpleVideoUI.state.useFast;

    const steps = [];
    for (const step of rawSteps) {
        const wf0 = normalizeWorkflowAlias(step?.workflow);
        if (!wf0) continue;

        const wf = applyWorkflowSpeedOption(wf0, useFast);
        steps.push({ ...step, workflow: wf });
    }
    return steps;
}

/* ========================================
   Simple Video UI State
   ======================================== */

let simpleVideoM2VPromptOverride = null;
let simpleVideoForcePromptRegeneration = false;
let simpleVideoContinueGateResolver = null;
let simpleVideoContinueGateActive = false;
let simpleVideoContinueGateRestartM2V = false;

const SimpleVideoUI = {
    initialized: false,
    state: {
        selectedPreset: null,       // VIDEO_PRESETS[].id
        imagePrompt: '',
        llmPrompt: '',
        scenario: '',
        // Defaults per spec
        sceneCount: '3',
        sceneLengthSec: '5',
        // Derived (sceneCount x sceneLengthSec); kept for back-compat but not user-editable.
        totalLengthSec: 15,
        // 'auto' | '<width>x<height>' (e.g. '1280x720')
        // Back-compat: previously used 'landscape'|'portrait'|'square'
        videoSize: 'auto',
        customSize: { width: '', height: '' },
        fps: '',
        showVideoSettingsSection: true,
        showAdvancedSettings: false,
        showI2IAdvancedSettings: false,
        showCharacterImageGroup: true, // キャラクタ画像の生成グループ開閉状態
        showCharactersList: true,  // キャラクター一覧アコーディオンの開閉状態
        showInternalImagesSection: true, // 内部参照画像セクションのアコーディオン開閉状態
        // Key image (single)
        keyImage: null,             // { filename, originalName, previewUrl }
        // Back-compat: generation gating still checks this
        uploadedImage: null,

        // Drop slots (3)
        dropSlots: [null, null, null], // [{ kind:'image'|'video', filename, originalName, previewUrl }]
        selectedCharacter: null,    // Character from registry
        flfQuality: 'speed',        // 'speed' | 'quality'
        
        // Character composite image (for char_edit_i2i_flf preset)
        characterImage: null,       // { filename, subfolder, type, jobId, previewUrl, presetId }
        characterImageAnalysis: null,  // VLM analysis result text (deprecated)
        i2iRefSource: 'character',  // 'character' | 'first_scene' - which image to use for scene 2+ I2I
        
        // Key image analysis (VLM) - same as full auto video
        keyImageAnalysis: null,     // VLM analysis result text (prompt part)
        keyImageAnalysisRaw: null,  // { raw, prompt, negativePrompt, elapsedTime }

        // Sequence-side options
        useFast: !!SIMPLE_VIDEO_STANDALONE_CONFIG.enableLtx,
        ltxVariant: 'fp4',          // 'fp4' | 'distilled'（default FP4）
        generateAudio: false,       // 音声も生成（default OFF / currently informational)

        // Left-column BGM generation (ACE-Step 1.5 T2A)
        t2aScenario: '',
        t2aTags: '',
        t2aLyrics: '',
        t2aLanguage: 'en',
        t2aDuration: '30',
        t2aBpm: '120',
        t2aTimesignature: '4',
        t2aKeyscale: 'C major',
        t2aSteps: '8',
        t2aCfg: '1.0',
        t2aSeed: '',
        // M2V/V2M source management
        t2aSourceMode: 'generated', // 'generated' | 'uploaded'
        t2aGeneratedAudio: null,    // { jobId, filename, previewUrl, durationSec }
        t2aUploadedAudio: null,     // { filename, originalName, previewUrl, durationSec }
        v2mGeneratedVideo: null,    // { jobId, filename, previewUrl, durationSec }
        v2mUploadedVideo: null,     // { filename, originalName, previewUrl, durationSec }
        m2vDurationPlan: null,      // number[] (seconds per scene)
        m2vIsRunning: false,
        v2mIsRunning: false,
        t2aIsGenerating: false,
        t2aIsComposingLyrics: false,
        t2aIsSuggestingTags: false,
        t2aIsAutoGenerating: false,

        // Scenario helper options
        // Default ON: use prompt_generate (LLM) to create per-scene prompts.
        // OFF: copy the scenario text as-is into the prompt area.
        scenarioUseLLM: true,
        // Prompt complexity for LLM scene generation: 'basic' | 'standard' | 'rich'
        // basic = previous default level, standard = more detailed, rich = includes in-scene motion layers
        promptComplexity: 'basic',
        // FLF prompt augmentation: inject scene N+1 intent as end-target constraint into scene N FLF prompt
        flfEndConstraintEnabled: true,

        // I2I refine strength (mainly for Qwen Image Edit 2511)
        // denoise: 0..1 (higher => more change), cfg: higher => prompt dominates more
        // 0.805 is the boundary: <0.805 = reference image dominant (mood), >=0.805 = prompt dominant (character)
        i2iDenoise: '1.0',
        i2iCfg: '1.0',
        // I2I refine workflow override (default: Qwen 2511 I2I Lightning 4-step)
        i2iRefineWorkflow: getConfiguredSimpleVideoWorkflow('i2i', 'qwen_i2i_2511_bf16_lightning4'),
        
        // ref3 usage mode for scene I2I: 'background' | 'style' | 'anime'
        // Only active when ref3 (dropSlots[2]) has an image.
        ref3UseMode: 'background',
        // Whether to use ref3 in scene I2I (checkbox, default ON)
        ref3ModeEnabled: true,

        // Motion strength for video generation: 'small' | 'medium' | 'large'
        motionStrength: 'medium',

        // I2I prompt conversion mode for image-refine sequences
        // 'character': prioritize keeping character identity consistent with reference
        // 'mood': prioritize keeping mood/style/lighting consistent with reference
        i2iRefRole: 'character',

        // Prepared initial image (generated via left-panel image generation button)
        // NOTE: This is separate from the video-generation initial frame.
        preparedInitialImage: null, // { jobId, filename, prompt }

        // Character sheet image (generated via キャラクターシートを生成 button)
        characterSheetImage: null, // { jobId, filename, previewUrl }

        // Whether to run background removal before initial image / character sheet generation
        removeBgBeforeGenerate: false,

        // Whether to run RMBG preprocessing + use no-bg workflow for character sheet generation
        charSheetNobg: false,

        // Whether to use characterSheetImage as the primary scene I2I reference instead of characterImage
        useCharSheetAsRef: false,

        // Prepared initial frame for VIDEO generation (reference image + scene prompt -> image)
        // Used by the Video Generate button when available.
        preparedVideoInitialImage: null, // { jobId, filename, prompt, presetId }

        // Intermediate per-scene still images (e.g. for FLF pipelines).
        // { presetId: string, images: Array<null | { source:'generated'|'uploaded'|'prepared', filename:string, jobId?:string|null, previewUrl?:string, originalName?:string, prompt?:string }> }
        intermediateImages: null,
        // Per-scene generated video basenames for concat/reconcat.
        // { presetId: string, videos: Array<null|string> }
        sceneVideos: null,

        // Internal: reversible LTX FPS forcing
        ltxFpsForced: false,
        fpsBackup: '',

        // Internal: reversible LTX default size forcing
        ltxSizeForced: false,
        videoSizeBackup: 'auto',
        customSizeBackup: { width: '', height: '' },

        isGenerating: false,
        isPromptGenerating: false,
        isImageGenerating: false,
        // Interrupt/cancel support (non-persisted)
        cancelSeq: 0,
        activeJobId: null,
        currentStep: 0,
        totalSteps: 0,
        progress: 0,
        outputs: []                 // Generated outputs
    },
    
    // DOM references (populated on init)
    elements: {},
    
    // Background card reference (currently unused; implementation uses window.app.api.*)
    backgroundCard: null,

    // Characters request sequence (avoid race conditions)
    charactersReqSeq: 0,

    // Last focused prompt target (for inserting @tokens)
    lastPromptTarget: 'scenario'
};

let simpleVideoArtifactSaveTimer = null;
let simpleVideoArtifactHydrated = false;
let simpleVideoOutputFiles = [];
let simpleVideoOutputSelectedPaths = new Set();
let simpleVideoOutputFilesLoading = false;
let simpleVideoOutputBrowserSetup = false;

/* ========================================
   Initialization
   ======================================== */

function initSimpleVideoUI() {
    if (SimpleVideoUI.initialized) {
        console.log('[SimpleVideo] Already initialized');
        return;
    }

    console.log('[SimpleVideo] Initializing UI...');
    
    // Get DOM elements
    const root = document.getElementById('simpleVideoRoot');
    if (!root) {
        console.error('[SimpleVideo] Root element not found');
        return;
    }
    
    SimpleVideoUI.elements = {
        root: root,
        leftPanel: root.querySelector('.simple-video-left'),
        rightPanel: root.querySelector('.simple-video-right')
    };

    // Load saved state first so initial render reflects it
    loadSimpleVideoState();
    enforceStandaloneConfigState();
    rebasePreviewUrls();

    // Build initial UI
    renderSimpleVideoUI();

    // Try server-side restore (artifact store) for important state like intermediate images.
    hydrateSimpleVideoStateFromArtifact();
    
    SimpleVideoUI.initialized = true;
    console.log('[SimpleVideo] UI initialized');
}

/* ========================================
   State Management
   ======================================== */

function loadSimpleVideoState() {
    try {
        const saved = localStorage.getItem('simpleVideoState');
        if (saved) {
            const parsed = JSON.parse(saved);
            // Only restore safe state (not generating state)
            SimpleVideoUI.state.selectedPreset = parsed.selectedPreset || null;
            SimpleVideoUI.state.imagePrompt = parsed.imagePrompt || '';
            SimpleVideoUI.state.llmPrompt = parsed.llmPrompt || '';
            SimpleVideoUI.state.scenario = parsed.scenario || '';
            // Spec: sceneCount default 3, sceneLength default 5
            // Back-compat: if old state used 'auto', coerce to defaults.
            SimpleVideoUI.state.sceneCount = (parsed.sceneCount && parsed.sceneCount !== 'auto') ? String(parsed.sceneCount) : '3';
            SimpleVideoUI.state.sceneLengthSec = (parsed.sceneLengthSec && parsed.sceneLengthSec !== 'auto') ? String(parsed.sceneLengthSec) : '5';
            // Keep saved totalLengthSec for compat, but will be overwritten by derived length on UI update.
            SimpleVideoUI.state.totalLengthSec = normalizeTotalLengthSec(parsed.totalLengthSec);
            SimpleVideoUI.state.videoSize = normalizeVideoSize(parsed.videoSize);
            SimpleVideoUI.state.customSize = normalizeCustomSize(parsed.customSize);
            SimpleVideoUI.state.fps = normalizeFps(parsed.fps);
            SimpleVideoUI.state.showVideoSettingsSection = parsed.showVideoSettingsSection !== false;
            SimpleVideoUI.state.showAdvancedSettings = !!parsed.showAdvancedSettings;
            SimpleVideoUI.state.showCharacterImageGroup = parsed.showCharacterImageGroup !== false; // default true
            SimpleVideoUI.state.showCharactersList = parsed.showCharactersList !== false; // default true
            SimpleVideoUI.state.showInternalImagesSection = parsed.showInternalImagesSection !== false; // default true
            SimpleVideoUI.state.keyImage = parsed.keyImage || parsed.uploadedImage || null;
            SimpleVideoUI.state.uploadedImage = SimpleVideoUI.state.keyImage;
            SimpleVideoUI.state.dropSlots = normalizeDropSlots(parsed.dropSlots);
            SimpleVideoUI.state.selectedCharacter = parsed.selectedCharacter || null;
            SimpleVideoUI.state.flfQuality = parsed.flfQuality || 'speed';

            // Sequence-side options (defaults: fast ON, audio OFF)
            SimpleVideoUI.state.useFast = SIMPLE_VIDEO_STANDALONE_CONFIG.enableLtx
                ? ((typeof parsed.useFast === 'boolean') ? parsed.useFast : true)
                : false;
            SimpleVideoUI.state.ltxVariant = normalizeLtxVariant(parsed.ltxVariant);
            SimpleVideoUI.state.generateAudio = !!parsed.generateAudio;

            // Left-column BGM generation (ACE-Step 1.5 T2A)
            SimpleVideoUI.state.t2aScenario = String(parsed.t2aScenario || '');
            SimpleVideoUI.state.t2aTags = String(parsed.t2aTags || '');
            SimpleVideoUI.state.t2aLyrics = String(parsed.t2aLyrics || '');
            SimpleVideoUI.state.t2aLanguage = normalizeT2ALanguage(parsed.t2aLanguage);
            SimpleVideoUI.state.t2aDuration = normalizeT2ANumber(parsed.t2aDuration, { fallback: 30, min: 1, max: 300, precision: 0 });
            SimpleVideoUI.state.t2aBpm = normalizeT2ANumber(parsed.t2aBpm, { fallback: 120, min: 30, max: 240, precision: 0 });
            SimpleVideoUI.state.t2aTimesignature = normalizeT2ATimeSignature(parsed.t2aTimesignature);
            SimpleVideoUI.state.t2aKeyscale = normalizeT2AKeyscale(parsed.t2aKeyscale);
            SimpleVideoUI.state.t2aSteps = normalizeT2ANumber(parsed.t2aSteps, { fallback: 8, min: 1, max: 200, precision: 0 });
            SimpleVideoUI.state.t2aCfg = normalizeT2ANumber(parsed.t2aCfg, { fallback: 1.0, min: 0.1, max: 30, precision: 2 });
            SimpleVideoUI.state.t2aSeed = String(parsed.t2aSeed || '').replace(/\D/g, '');
            SimpleVideoUI.state.t2aSourceMode = (String(parsed.t2aSourceMode || '') === 'uploaded') ? 'uploaded' : 'generated';
            SimpleVideoUI.state.t2aGeneratedAudio = parsed.t2aGeneratedAudio || null;
            SimpleVideoUI.state.t2aUploadedAudio = parsed.t2aUploadedAudio || null;
            SimpleVideoUI.state.v2mGeneratedVideo = parsed.v2mGeneratedVideo || null;
            SimpleVideoUI.state.v2mUploadedVideo = parsed.v2mUploadedVideo || null;
            SimpleVideoUI.state.m2vDurationPlan = Array.isArray(parsed.m2vDurationPlan) ? parsed.m2vDurationPlan : null;

            // Scenario helper options
            // New behavior (2026-01): default ON. Only restore when explicitly saved.
            SimpleVideoUI.state.scenarioUseLLM = (typeof parsed.scenarioUseLLM === 'boolean') ? parsed.scenarioUseLLM : true;
            SimpleVideoUI.state.promptComplexity = normalizePromptComplexity(parsed.promptComplexity);
            SimpleVideoUI.state.flfEndConstraintEnabled = (typeof parsed.flfEndConstraintEnabled === 'boolean') ? parsed.flfEndConstraintEnabled : true;

            // I2I prompt conversion mode
            SimpleVideoUI.state.i2iRefRole = normalizeI2IRefRole(parsed.i2iRefRole);

            // I2I refine strength
            // Default denoise differs by reference-role (mood tends to need lower denoise).
            const defaultDenoise = (SimpleVideoUI.state.i2iRefRole === 'mood') ? '0.70' : '0.90';
            SimpleVideoUI.state.i2iDenoise = normalizeDenoise(parsed.i2iDenoise, defaultDenoise);
            SimpleVideoUI.state.i2iCfg = normalizeCfg(parsed.i2iCfg, '7.0');
            const defaultI2I = getConfiguredSimpleVideoWorkflow('i2i', 'qwen_i2i_2511_bf16_lightning4');
            const parsedI2I = String(parsed.i2iRefineWorkflow || defaultI2I);
            SimpleVideoUI.state.i2iRefineWorkflow = (SIMPLE_VIDEO_STANDALONE_CONFIG.lockI2IWorkflow === false)
                ? parsedI2I
                : defaultI2I;
            
            // Motion strength for video generation
            SimpleVideoUI.state.motionStrength = normalizeMotionStrength(parsed.motionStrength);

            // Internal (safe to restore)
            SimpleVideoUI.state.ltxFpsForced = !!parsed.ltxFpsForced;
            SimpleVideoUI.state.fpsBackup = String(parsed.fpsBackup ?? '');

            SimpleVideoUI.state.ltxSizeForced = !!parsed.ltxSizeForced;
            SimpleVideoUI.state.videoSizeBackup = normalizeVideoSize(parsed.videoSizeBackup);
            SimpleVideoUI.state.customSizeBackup = normalizeCustomSize(parsed.customSizeBackup);

            SimpleVideoUI.state.intermediateImages = normalizeIntermediateImages(parsed.intermediateImages);
            SimpleVideoUI.state.sceneVideos = normalizeSceneVideos(parsed.sceneVideos);

            // Character composite image for char_edit_i2i_flf preset
            SimpleVideoUI.state.characterImage = normalizeCharacterImage(parsed.characterImage);
            SimpleVideoUI.state.characterSheetImage = normalizeCharacterImage(parsed.characterSheetImage);
            SimpleVideoUI.state.characterImageEditPrompt = String(parsed.characterImageEditPrompt || '');
            // Reference source for scene I2I: 'character' (use character image) or 'first_scene' (use scene 1 image)
            SimpleVideoUI.state.i2iRefSource = normalizeI2IRefSource(parsed.i2iRefSource);
            
            // Key image analysis (VLM)
            SimpleVideoUI.state.keyImageAnalysis = String(parsed.keyImageAnalysis || '') || null;
            SimpleVideoUI.state.keyImageAnalysisRaw = parsed.keyImageAnalysisRaw || null;

            // Background removal option
            SimpleVideoUI.state.removeBgBeforeGenerate = !!parsed.removeBgBeforeGenerate;

            // Character sheet no-bg option
            SimpleVideoUI.state.charSheetNobg = !!parsed.charSheetNobg;

            // Whether to use character sheet as scene I2I reference
            SimpleVideoUI.state.useCharSheetAsRef = !!parsed.useCharSheetAsRef;
        }
    } catch (_e) {
        console.warn('[SimpleVideo] Failed to load state');
    }
    enforceStandaloneConfigState();
}

function enforceStandaloneConfigState() {
    if (!SimpleVideoUI || !SimpleVideoUI.state) return;
    if (!SIMPLE_VIDEO_STANDALONE_CONFIG.enableLtx) {
        SimpleVideoUI.state.useFast = false;
        SimpleVideoUI.state.ltxVariant = 'fp4';
    }
    if (SIMPLE_VIDEO_STANDALONE_CONFIG.lockI2IWorkflow !== false) {
        SimpleVideoUI.state.i2iRefineWorkflow = getConfiguredSimpleVideoWorkflow('i2i', 'qwen_i2i_2511_bf16_lightning4');
    }
}

/**
 * Rewrite all previewUrl values in state so they point to the current origin.
 * This is necessary when the app was used on localhost and the state was saved,
 * then later accessed via a reverse-proxy on a different host/port.
 * Without this, Firefox (and potentially other browsers) blocks fetches to
 * 127.0.0.1 from a public origin as a local-network access violation.
 */
function rebasePreviewUrls() {
    if (!SimpleVideoUI?.state) return;
    const currentBase = (window.app?.api?.baseURL) || getDefaultAPIURL();
    if (!currentBase) return;

    // Replace any http(s)://host:port prefix in a URL with currentBase
    const rebase = (url) => {
        if (!url || typeof url !== 'string') return url;
        // Match URLs that start with http(s)://... and have /api/ in the path
        const m = url.match(/^https?:\/\/[^/]+(\/api\/.+)$/);
        if (m) return currentBase + m[1];
        // Also handle /view? style URLs
        const m2 = url.match(/^https?:\/\/[^/]+(\/view\?.+)$/);
        if (m2) return currentBase + m2[1];
        return url;
    };

    const rebaseObj = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (typeof obj.previewUrl === 'string') {
            obj.previewUrl = rebase(obj.previewUrl);
        }
    };

    // keyImage
    rebaseObj(SimpleVideoUI.state.keyImage);
    rebaseObj(SimpleVideoUI.state.uploadedImage);

    // dropSlots
    if (Array.isArray(SimpleVideoUI.state.dropSlots)) {
        SimpleVideoUI.state.dropSlots.forEach(rebaseObj);
    }

    // characterImage
    rebaseObj(SimpleVideoUI.state.characterImage);

    // t2a audio
    rebaseObj(SimpleVideoUI.state.t2aGeneratedAudio);
    rebaseObj(SimpleVideoUI.state.t2aUploadedAudio);

    // v2m video
    rebaseObj(SimpleVideoUI.state.v2mGeneratedVideo);
    rebaseObj(SimpleVideoUI.state.v2mUploadedVideo);

    // intermediateImages
    if (SimpleVideoUI.state.intermediateImages?.images) {
        SimpleVideoUI.state.intermediateImages.images.forEach(rebaseObj);
    }

    // sceneVideos
    if (Array.isArray(SimpleVideoUI.state.sceneVideos)) {
        SimpleVideoUI.state.sceneVideos.forEach(rebaseObj);
    }

    console.log('[SimpleVideo] Preview URLs rebased to', currentBase);
}

function normalizeDropSlots(value) {
    const out = [null, null, null];
    if (!Array.isArray(value)) return out;
    for (let i = 0; i < 3; i++) {
        const v = value[i];
        if (!v || typeof v !== 'object') continue;
        const kind = (v.kind === 'video') ? 'video' : 'image';
        const filename = typeof v.filename === 'string' ? v.filename : '';
        const previewUrl = typeof v.previewUrl === 'string' ? v.previewUrl : '';
        const originalName = typeof v.originalName === 'string' ? v.originalName : '';
        if (filename && previewUrl) out[i] = { kind, filename, previewUrl, originalName };
    }
    return out;
}

function normalizeIntermediateImages(value) {
    if (!value || typeof value !== 'object') return null;

    const presetId = String(value.presetId || '').trim();
    if (!presetId) return null;

    const raw = Array.isArray(value.images) ? value.images : [];
    const images = raw.map((v) => {
        if (!v || typeof v !== 'object') return null;
        const filename = String(v.filename || '').trim();
        if (!filename) return null;

        const source0 = String(v.source || '').trim();
        const source = (source0 === 'uploaded' || source0 === 'prepared') ? source0 : 'generated';
        const jobId = v.jobId ? String(v.jobId) : null;
        const previewUrl = v.previewUrl ? String(v.previewUrl) : '';
        const originalName = v.originalName ? String(v.originalName) : '';
        const prompt = v.prompt ? String(v.prompt) : '';

        return { source, filename, jobId, previewUrl, originalName, prompt };
    });

    const scenarioFingerprint = value.scenarioFingerprint ? String(value.scenarioFingerprint) : '';
    return { presetId, images, scenarioFingerprint };
}

function normalizeSceneVideos(value) {
    if (!value || typeof value !== 'object') return null;
    const presetId = String(value.presetId || '').trim();
    if (!presetId) return null;
    const raw = Array.isArray(value.videos) ? value.videos : [];
    const videos = raw.map((v) => {
        const s = String(v || '').trim();
        return s || null;
    });
    return { presetId, videos };
}

function normalizeCharacterImage(value) {
    if (!value || typeof value !== 'object') return null;
    const filename = String(value.filename || '').trim();
    if (!filename) return null;
    
    const jobId = value.jobId ? String(value.jobId) : null;
    const type = String(value.type || 'output');
    
    // Reconstruct previewUrl based on type and jobId
    // - output type with jobId: use /api/v1/download/{jobId}/{filename}
    // - input type: use /api/v1/files/{filename}
    let previewUrl = '';
    if (type === 'output' && jobId) {
        previewUrl = getSimpleVideoDownloadURL(jobId, filename);
    } else if (type === 'input') {
        previewUrl = getSimpleVideoInputImageURL(filename);
    } else if (value.previewUrl) {
        previewUrl = String(value.previewUrl);
    }
    
    return {
        filename,
        subfolder: String(value.subfolder || ''),
        type,
        jobId,
        previewUrl,
        presetId: value.presetId ? String(value.presetId) : ''
    };
}

function normalizeI2IRefSource(value) {
    // 'character' = use character composite image, 'first_scene' = use scene 1 image
    if (value === 'first_scene') return 'first_scene';
    return 'character';
}

function normalizeMotionStrength(value) {
    // 'small' = stable/subtle motion, 'medium' = balanced, 'large' = dynamic
    if (value === 'small' || value === 'large') return value;
    return 'medium';
}

function normalizeLtxVariant(value) {
    if (value === 'distilled') return 'distilled';
    return 'fp4';
}

function normalizePromptComplexity(value) {
    if (value === 'standard' || value === 'rich') return value;
    return 'basic';
}

function inferMediaKindFromFile(file) {
    const mime = String(file?.type || '').toLowerCase();
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';

    const name = String(file?.name || '').toLowerCase();
    if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(name)) return 'image';
    if (/\.(mp4|webm|mov|mkv|avi)$/i.test(name)) return 'video';
    if (/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name)) return 'audio';

    return null;
}

function normalizeVideoSize(value) {
    if (!value) return 'auto';

    // Backward compatibility
    if (value === 'landscape') return '1280x720';
    if (value === 'portrait') return '720x1280';
    if (value === 'square') return '1024x1024';

    if (value === 'auto') return 'auto';

    if (value === 'custom') return 'custom';

    // Accept '<w>x<h>' strings
    if (typeof value === 'string' && /^\d{2,5}x\d{2,5}$/.test(value)) {
        return value;
    }

    return 'auto';
}

function normalizeCustomSize(value) {
    const fallback = { width: '', height: '' };
    if (!value || typeof value !== 'object') return fallback;

    const width = String(value.width ?? '').replace(/\D/g, '');
    const height = String(value.height ?? '').replace(/\D/g, '');
    return { width, height };
}

function normalizeFps(value) {
    if (value === null || value === undefined || value === '') return '';
    const raw = Number(value);
    if (!Number.isFinite(raw)) return '';
    const clamped = Math.min(120, Math.max(1, Math.round(raw)));
    return String(clamped);
}

function normalizeDenoise(value, fallback = '0.900') {
    if (value === null || value === undefined || value === '') return String(fallback);
    const raw = Number(value);
    if (!Number.isFinite(raw)) return String(fallback);
    const clamped = Math.min(1.0, Math.max(0.0, raw));
    // Keep a stable string representation (3 decimal places)
    return clamped.toFixed(3);
}

function normalizeCfg(value, fallback = '7.0') {
    if (value === null || value === undefined || value === '') return String(fallback);
    const raw = Number(value);
    if (!Number.isFinite(raw)) return String(fallback);
    const clamped = Math.min(30, Math.max(1, raw));
    return String(Math.round(clamped * 10) / 10);
}

function normalizeT2ALanguage(value) {
    const v = String(value || '').trim().toLowerCase();
    if (v === 'ja' || v === 'zh') return v;
    return 'en';
}

function normalizeT2ATimeSignature(value) {
    const v = String(value || '').trim();
    if (v === '2' || v === '3' || v === '4' || v === '6') return v;
    return '4';
}

function normalizeT2AKeyscale(value) {
    const allowed = new Set([
        'C major', 'C minor',
        'C# major', 'C# minor',
        'D major', 'D minor',
        'D# major', 'D# minor',
        'E major', 'E minor',
        'F major', 'F minor',
        'F# major', 'F# minor',
        'G major', 'G minor',
        'G# major', 'G# minor',
        'A major', 'A minor',
        'A# major', 'A# minor',
        'B major', 'B minor',
    ]);
    const v = String(value || '').trim();
    return allowed.has(v) ? v : 'C major';
}

function normalizeHalfWidthDigits(value) {
    const raw = String(value || '');
    let normalized = raw;
    try {
        normalized = raw.normalize('NFKC');
    } catch (_e) {
        normalized = raw;
    }
    return normalized.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
}

function normalizeT2ANumber(value, { fallback, min, max, precision = 0 } = {}) {
    const normalizedText = normalizeHalfWidthDigits(value);
    const raw = Number(normalizedText);
    if (!Number.isFinite(raw)) return String(fallback);
    const lower = Number.isFinite(min) ? min : raw;
    const upper = Number.isFinite(max) ? max : raw;
    const clamped = Math.min(upper, Math.max(lower, raw));
    if (precision <= 0) return String(Math.round(clamped));
    const p = Math.pow(10, precision);
    return String(Math.round(clamped * p) / p);
}

function getEffectiveVideoSize() {
    const { videoSize, customSize } = SimpleVideoUI.state;
    if (videoSize === 'custom') {
        const w = Number(customSize?.width);
        const h = Number(customSize?.height);
        if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return `${w}x${h}`;
        return 'auto';
    }
    return normalizeVideoSize(videoSize);
}

function normalizeTotalLengthSec(value) {
    // Allowed options: 15, 20, 30..120 (step 10)
    if (value === 'auto') return 15;

    const raw = Number(value);
    if (!Number.isFinite(raw)) return 15;

    const clamped = Math.min(120, Math.max(15, raw));
    if (clamped <= 15) return 15;
    if (clamped <= 20) return 20;

    // Snap to nearest 10s between 30 and 120
    const snapped = Math.round(clamped / 10) * 10;
    return Math.min(120, Math.max(30, snapped));
}

function saveSimpleVideoState() {
    try {
        const toSave = {
            selectedPreset: SimpleVideoUI.state.selectedPreset,
            imagePrompt: SimpleVideoUI.state.imagePrompt,
            llmPrompt: SimpleVideoUI.state.llmPrompt,
            scenario: SimpleVideoUI.state.scenario,
            sceneCount: SimpleVideoUI.state.sceneCount,
            sceneLengthSec: SimpleVideoUI.state.sceneLengthSec,
            totalLengthSec: SimpleVideoUI.state.totalLengthSec,
            videoSize: SimpleVideoUI.state.videoSize,
            customSize: SimpleVideoUI.state.customSize,
            fps: SimpleVideoUI.state.fps,
            showVideoSettingsSection: SimpleVideoUI.state.showVideoSettingsSection,
            showAdvancedSettings: SimpleVideoUI.state.showAdvancedSettings,
            showCharacterImageGroup: SimpleVideoUI.state.showCharacterImageGroup,
            showCharactersList: SimpleVideoUI.state.showCharactersList,
            showInternalImagesSection: SimpleVideoUI.state.showInternalImagesSection,
            keyImage: SimpleVideoUI.state.keyImage,
            dropSlots: SimpleVideoUI.state.dropSlots,
            selectedCharacter: SimpleVideoUI.state.selectedCharacter,
            flfQuality: SimpleVideoUI.state.flfQuality,

            // Sequence-side options
            useFast: !!SimpleVideoUI.state.useFast,
            ltxVariant: normalizeLtxVariant(SimpleVideoUI.state.ltxVariant),
            generateAudio: !!SimpleVideoUI.state.generateAudio,

            // Left-column BGM generation (ACE-Step 1.5 T2A)
            t2aScenario: String(SimpleVideoUI.state.t2aScenario || ''),
            t2aTags: String(SimpleVideoUI.state.t2aTags || ''),
            t2aLyrics: String(SimpleVideoUI.state.t2aLyrics || ''),
            t2aLanguage: normalizeT2ALanguage(SimpleVideoUI.state.t2aLanguage),
            t2aDuration: String(SimpleVideoUI.state.t2aDuration || '30'),
            t2aBpm: String(SimpleVideoUI.state.t2aBpm || '120'),
            t2aTimesignature: normalizeT2ATimeSignature(SimpleVideoUI.state.t2aTimesignature),
            t2aKeyscale: normalizeT2AKeyscale(SimpleVideoUI.state.t2aKeyscale),
            t2aSteps: String(SimpleVideoUI.state.t2aSteps || '8'),
            t2aCfg: String(SimpleVideoUI.state.t2aCfg || '1.0'),
            t2aSeed: String(SimpleVideoUI.state.t2aSeed || ''),
            t2aSourceMode: String(SimpleVideoUI.state.t2aSourceMode || 'generated'),
            t2aGeneratedAudio: SimpleVideoUI.state.t2aGeneratedAudio || null,
            t2aUploadedAudio: SimpleVideoUI.state.t2aUploadedAudio || null,
            v2mGeneratedVideo: SimpleVideoUI.state.v2mGeneratedVideo || null,
            v2mUploadedVideo: SimpleVideoUI.state.v2mUploadedVideo || null,
            m2vDurationPlan: Array.isArray(SimpleVideoUI.state.m2vDurationPlan) ? SimpleVideoUI.state.m2vDurationPlan : null,

            // Scenario helper options
            scenarioUseLLM: !!SimpleVideoUI.state.scenarioUseLLM,
            promptComplexity: normalizePromptComplexity(SimpleVideoUI.state.promptComplexity),
            flfEndConstraintEnabled: !!SimpleVideoUI.state.flfEndConstraintEnabled,

            // I2I refine strength
            i2iDenoise: String(SimpleVideoUI.state.i2iDenoise ?? '0.81'),
            i2iCfg: String(SimpleVideoUI.state.i2iCfg ?? '7.0'),
            i2iRefineWorkflow: String(SimpleVideoUI.state.i2iRefineWorkflow ?? 'auto'),

            // I2I prompt conversion mode
            i2iRefRole: String(SimpleVideoUI.state.i2iRefRole || 'character'),

            // Intermediate images for FLF pipelines
            intermediateImages: SimpleVideoUI.state.intermediateImages,
            sceneVideos: SimpleVideoUI.state.sceneVideos,

            // Character composite image for char_edit_i2i_flf preset
            characterImage: SimpleVideoUI.state.characterImage,
            characterImageEditPrompt: String(SimpleVideoUI.state.characterImageEditPrompt || ''),
            i2iRefSource: String(SimpleVideoUI.state.i2iRefSource || 'character'),

            // Character sheet image (generated via キャラクターシートを生成)
            characterSheetImage: SimpleVideoUI.state.characterSheetImage,
            useCharSheetAsRef: !!SimpleVideoUI.state.useCharSheetAsRef,

            // Background removal options
            removeBgBeforeGenerate: !!SimpleVideoUI.state.removeBgBeforeGenerate,
            charSheetNobg: !!SimpleVideoUI.state.charSheetNobg,

            // Key image analysis (VLM)
            keyImageAnalysis: SimpleVideoUI.state.keyImageAnalysis || null,
            keyImageAnalysisRaw: SimpleVideoUI.state.keyImageAnalysisRaw || null,

            ltxFpsForced: !!SimpleVideoUI.state.ltxFpsForced,
            fpsBackup: String(SimpleVideoUI.state.fpsBackup ?? ''),
            ltxSizeForced: !!SimpleVideoUI.state.ltxSizeForced,
            videoSizeBackup: String(SimpleVideoUI.state.videoSizeBackup ?? 'auto'),
            customSizeBackup: SimpleVideoUI.state.customSizeBackup
        };
        localStorage.setItem('simpleVideoState', JSON.stringify(toSave));
        scheduleSimpleVideoArtifactStateSave();
    } catch (_e) {
        console.warn('[SimpleVideo] Failed to save state');
    }
}

function hasAnyIntermediateImagesPayload(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.images)) return false;
    return value.images.some((entry) => !!entry && !!String(entry.filename || '').trim());
}

function getSimpleVideoArtifactStatePayload() {
    return {
        selectedPreset: SimpleVideoUI.state.selectedPreset || null,
        scenario: String(SimpleVideoUI.state.scenario || ''),
        sceneCount: String(SimpleVideoUI.state.sceneCount || '3'),
        i2iRefSource: String(SimpleVideoUI.state.i2iRefSource || 'character'),
        intermediateImages: normalizeIntermediateImages(SimpleVideoUI.state.intermediateImages),
        sceneVideos: normalizeSceneVideos(SimpleVideoUI.state.sceneVideos),
        characterImage: normalizeCharacterImage(SimpleVideoUI.state.characterImage),
    };
}

function scheduleSimpleVideoArtifactStateSave() {
    if (!SimpleVideoUI.initialized) return;
    if (!window.app?.api || typeof window.app.api.saveSimpleVideoState !== 'function') return;
    if (simpleVideoArtifactSaveTimer) {
        clearTimeout(simpleVideoArtifactSaveTimer);
    }
    simpleVideoArtifactSaveTimer = setTimeout(async () => {
        simpleVideoArtifactSaveTimer = null;
        try {
            await window.app.api.saveSimpleVideoState(getSimpleVideoArtifactStatePayload());
        } catch (e) {
            console.warn('[SimpleVideo] Failed to persist artifact state:', e?.message || e);
        }
    }, 800);
}

async function hydrateSimpleVideoStateFromArtifact() {
    if (simpleVideoArtifactHydrated) return;
    simpleVideoArtifactHydrated = true;

    if (!window.app?.api || typeof window.app.api.getSimpleVideoState !== 'function') return;

    try {
        const res = await window.app.api.getSimpleVideoState();
        const remote = (res && typeof res === 'object' && res.state && typeof res.state === 'object')
            ? res.state
            : null;
        if (!remote) return;

        let changed = false;

        const localInter = normalizeIntermediateImages(SimpleVideoUI.state.intermediateImages);
        const remoteInter = normalizeIntermediateImages(remote.intermediateImages);
        if (remoteInter && !hasAnyIntermediateImagesPayload(localInter)) {
            SimpleVideoUI.state.intermediateImages = remoteInter;
            changed = true;
        }

        const localSceneVideos = normalizeSceneVideos(SimpleVideoUI.state.sceneVideos);
        const remoteSceneVideos = normalizeSceneVideos(remote.sceneVideos);
        if (remoteSceneVideos && (!localSceneVideos || !(Array.isArray(localSceneVideos.videos) && localSceneVideos.videos.some((v) => !!String(v || '').trim())))) {
            SimpleVideoUI.state.sceneVideos = remoteSceneVideos;
            changed = true;
        }

        if (!SimpleVideoUI.state.selectedPreset && typeof remote.selectedPreset === 'string' && remote.selectedPreset.trim()) {
            SimpleVideoUI.state.selectedPreset = remote.selectedPreset.trim();
            changed = true;
        }

        if (!String(SimpleVideoUI.state.scenario || '').trim() && typeof remote.scenario === 'string') {
            SimpleVideoUI.state.scenario = remote.scenario;
            changed = true;
        }

        if (!SimpleVideoUI.state.characterImage && remote.characterImage) {
            const normalizedCharacterImage = normalizeCharacterImage(remote.characterImage);
            if (normalizedCharacterImage) {
                SimpleVideoUI.state.characterImage = normalizedCharacterImage;
                changed = true;
            }
        }

        if (changed) {
            saveSimpleVideoState();
            updateSimpleVideoUI();
            renderSimpleVideoIntermediateImagesUI();
            updateGenerateButtonState();
            if (typeof showToast === 'function') {
                showToast('artifactから中間画像状態を復元しました', 'info');
            }
        }
    } catch (e) {
        console.warn('[SimpleVideo] Failed to hydrate artifact state:', e?.message || e);
    }
}

/* ========================================
   UI Rendering
   ======================================== */

function renderSimpleVideoUI() {
    const { leftPanel, rightPanel } = SimpleVideoUI.elements;
    if (!leftPanel || !rightPanel) return;
    
    // Left panel: Image generation area (spec)
    leftPanel.innerHTML = `
        <div class="simple-video-section">
            <div class="simple-video-section-title with-actions">
                <span class="title-left"><i class="fas fa-images"></i> 🖼️キー画像</span>
                <div class="simple-video-scenario-actions">
                    <button class="simple-video-btn" id="simpleVideoKeyImageAnalyzeBtn" type="button" style="display:none;">🔍 解析</button>
                    <button class="simple-video-icon-btn" id="simpleVideoKeyImageDelete" type="button" title="キー画像を削除" style="display:none;">🗑️</button>
                </div>
            </div>
            <div class="simple-video-keyimage" id="simpleVideoKeyImage">
                <div class="simple-video-keyimage-placeholder" id="simpleVideoKeyImagePlaceholder">クリック/ドロップで画像・動画をアップロード（動画は最終フレームをキー画像化）</div>
                <img class="simple-video-keyimage-img" id="simpleVideoKeyImageImg" alt="Key image" style="display:none;" />
                <div class="simple-video-keyimage-meta" id="simpleVideoKeyImageMeta" style="display:none;"></div>
            </div>
            <!-- キー画像解析結果 -->
            <div class="simple-video-character-analysis" id="simpleVideoKeyImageAnalysis" style="display:none;">
                <div class="simple-video-character-analysis-status" id="simpleVideoKeyImageAnalysisStatus"></div>
                <div class="simple-video-character-analysis-result" id="simpleVideoKeyImageAnalysisResult">
                    <div class="simple-video-character-analysis-text" id="simpleVideoKeyImageAnalysisText"></div>
                </div>
                <div class="simple-video-character-analysis-options">
                    <label class="simple-video-checkbox-label">
                        <input type="checkbox" id="simpleVideoKeyImageAnalysisToScenario" checked />
                        <span>📜 解析結果をシナリオ作成に使う</span>
                    </label>
                    <label class="simple-video-checkbox-label">
                        <input type="checkbox" id="simpleVideoKeyImageAnalysisInject" />
                        <span>🧩 解析結果をシーンプロンプトにインジェクション</span>
                    </label>
                </div>
            </div>
        </div>

        <div class="simple-video-section" id="simpleVideoCharacterImageGroup">
            <div class="simple-video-section-title" id="simpleVideoCharacterImageGroupTitle" style="cursor:pointer;"><i class="fas fa-user-astronaut"></i> キャラクタ画像の生成 <span id="simpleVideoCharacterImageGroupToggleIcon">▼</span></div>
            <div id="simpleVideoCharacterImageGroupContent">
            <div class="simple-video-subsection" id="simpleVideoDropSection">
            <div class="simple-video-section-title with-actions">
                <span class="title-left"><i class="fas fa-upload"></i> 📥 画像ドロップ</span>
                <div class="simple-video-scenario-actions" id="simpleVideoI2ISettingsActions" style="display:none;">
                    <button class="simple-video-icon-btn" id="simpleVideoI2ISettingsBtn" type="button" title="I2I詳細設定">⚙️</button>
                </div>
            </div>
            <div class="simple-video-drop-row" id="simpleVideoDropSlots">
                <div class="simple-video-drop-slot" data-slot="0">
                    <button class="simple-video-drop-delete" type="button" title="削除" style="display:none;">×</button>
                    <div class="simple-video-drop-ref-badge">ref1</div>
                    <div class="simple-video-drop-label">📥 ドロップ</div>
                    <img class="simple-video-drop-img" alt="ref1" style="display:none;" />
                    <div class="simple-video-drop-meta" style="display:none;"></div>
                </div>
                <div class="simple-video-drop-slot" data-slot="1">
                    <button class="simple-video-drop-delete" type="button" title="削除" style="display:none;">×</button>
                    <div class="simple-video-drop-ref-badge">ref2</div>
                    <div class="simple-video-drop-label">📥 ドロップ</div>
                    <img class="simple-video-drop-img" alt="ref2" style="display:none;" />
                    <div class="simple-video-drop-meta" style="display:none;"></div>
                </div>
                <div class="simple-video-drop-slot" data-slot="2">
                    <button class="simple-video-drop-delete" type="button" title="削除" style="display:none;">×</button>
                    <div class="simple-video-drop-ref-badge">ref3</div>
                    <div class="simple-video-drop-label">📥 ドロップ</div>
                    <img class="simple-video-drop-img" alt="ref3" style="display:none;" />
                    <div class="simple-video-drop-meta" style="display:none;"></div>
                </div>
            </div>
            <!-- ref3活用モード -->
            <div class="simple-video-ref3-mode-row" id="simpleVideoRef3ModeRow" style="display:none;">
                <label class="simple-video-checkbox-label">
                    <input type="checkbox" id="simpleVideoRef3ModeEnabled" checked />
                    <span>🖼️ ref3をシーンI2Iに活用する</span>
                </label>
                <select id="simpleVideoRef3ModeSelect" class="simple-video-select" style="margin-left:8px; max-width:160px;">
                    <option value="background">🏞️ 背景として</option>
                    <option value="style">🎨 画風として</option>
                    <option value="anime">✨ アニメ風に</option>
                </select>
            </div>
            <!-- I2I設定（アコーディオン） -->
            <div class="simple-video-i2i-settings-row" id="simpleVideoI2IAdvancedSettings" style="display:none;">
                <div class="simple-video-i2i-setting">
                    <label>ワークフロー</label>
                    <select id="simpleVideoI2IWorkflow" class="simple-video-select">
                        <option value="qwen_i2i_2511_bf16_lightning4">Qwen 2511 Lightning 4-step (推奨)</option>
                        <option value="qwen_i2i_2512_lightning4">Qwen-2512 I2I Lightning 4-step</option>
                        <option value="qwen_i2i_fp8_lightning4">Qwen FP8 Lightning 4-step</option>
                        <option value="qwen_multi_image_edit">Multi Image Edit 4-step</option>
                        <option value="flux2_klein_image_edit_4b_distilled">Flux2 Klein 4B Distilled (高速)</option>
                        <option value="flux2_klein_image_edit_9b_base">Flux2 Klein 9B Base (高品質)</option>
                    </select>
                </div>
                <div class="simple-video-i2i-setting">
                    <label>Denoise: <span id="simpleVideoI2IDenoiseValue">1.000</span></label>
                    <input type="number" id="simpleVideoI2IDenoise" min="0" max="1" step="0.001" value="1.0" class="simple-video-number-input">
                </div>
                <div class="simple-video-i2i-setting">
                    <label>CFG: <span id="simpleVideoI2ICfgValue">1.0</span></label>
                    <input type="number" id="simpleVideoI2ICfg" min="0" max="20" step="0.1" value="1.0" class="simple-video-number-input">
                </div>
            </div>
            </div>

            <div class="simple-video-subsection">
            <div class="simple-video-section-title with-actions" id="simpleVideoCharactersTitle" style="cursor:pointer;">
                <span class="title-left"><i class="fas fa-user"></i> 👤 キャラクタ一覧 <span id="simpleVideoCharactersToggleIcon">▼</span></span>
                <div class="simple-video-scenario-actions">
                    <span class="simple-video-characters-status">登録: <span id="simpleVideoCharactersStatus">-</span></span>
                    <button class="simple-video-icon-btn" id="simpleVideoRefreshCharacters" type="button" title="キャラクタ一覧を更新">🔄</button>
                    <button class="simple-video-icon-btn" id="simpleVideoClearCharacter" type="button" title="選択解除">🔘解除</button>
                </div>
            </div>
            <div id="simpleVideoCharactersContent">
                <div class="simple-video-characters-split" id="simpleVideoCharactersSplit">
                    <div class="simple-video-characters-register" id="simpleVideoCharactersRegisterPane">
                        <div class="simple-video-characters-pane-title">📝 キャラクタ登録</div>
                        <label class="simple-video-field simple-video-field-wide">
                            <span>キャラクタ名</span>
                            <input class="simple-video-input" id="simpleVideoRegisterCharacterName" placeholder="例: yuki" />
                        </label>
                        <label class="simple-video-field simple-video-field-wide">
                            <span>画像ファイル</span>
                            <input class="simple-video-input" id="simpleVideoRegisterCharacterFile" type="file" accept="image/*" />
                        </label>
                        <div class="simple-video-characters-register-actions">
                            <button class="simple-video-settings-btn simple-video-inline-btn" id="simpleVideoRegisterCharacterBtn" type="button">➕ 登録</button>
                        </div>
                        <div class="simple-video-hint">名前と画像を指定して登録します。</div>
                    </div>
                    <div class="simple-video-characters-list" id="simpleVideoCharactersListPane">
                        <div class="simple-video-characters-pane-title">📚 キャラクタ一覧</div>
                        <div class="simple-video-characters-row" id="simpleVideoCharactersRow"></div>
                        <div class="simple-video-hint">クリックで @キャラ名 を挿入（最後に触った入力欄に入ります）</div>
                    </div>
                </div>
            </div>
            </div>

            <div class="simple-video-subsection">
            <div class="simple-video-section-title"><i class="fas fa-pen"></i> 📝 何を描きたい？</div>
            <textarea class="simple-video-prompt" id="simpleVideoImagePrompt" placeholder="画像にしたい内容を入力してください..."></textarea>
            </div>

            <div class="simple-video-generate-row">
            <label class="simple-video-removebg-label" title="生成前に入力画像の背景を自動削除します">
                <input type="checkbox" id="simpleVideoRemoveBgCheck">
                <i class="fas fa-scissors"></i> 背景を削除
            </label>
            <button class="simple-video-generate-btn" id="simpleVideoImageGenBtn">
                <i class="fas fa-wand-magic-sparkles"></i> 初期画像を生成
            </button>
            <div class="simple-video-charsheet-group">
            <label class="simple-video-charsheet-nobg-label" title="キャラクターシート生成前に背景を削除し、背景なしモデルで生成します">
                <input type="checkbox" id="simpleVideoCharSheetNobgCheck">
                <i class="fas fa-eraser"></i> 背景なし
            </label>
            <button class="simple-video-generate-btn simple-video-sheet-btn" id="simpleVideoCharSheetGenBtn" type="button" title="ref1画像からキャラクターシートを生成し内部参照画像に登録">
                <i class="fas fa-id-card"></i> キャラクターシート
            </button>
            </div>
            <button class="simple-video-stop-btn" id="simpleVideoImageStopBtn" type="button" disabled>
                <i class="fas fa-stop"></i> 生成中止
            </button>
            </div>
            </div>
        </div>

        <div class="simple-video-section">
            <div class="simple-video-section-title"><i class="fas fa-music"></i> 🎼 BGM生成（ACE-Step 1.5）</div>
            <label class="simple-video-field simple-video-field-wide" style="display:block;margin-bottom:8px;">
                <span>音楽シナリオ（作詞に優先利用）</span>
                <textarea class="simple-video-prompt" id="simpleVideoT2AScenario" placeholder="曲のテーマ・感情・展開を入力（未入力時は動画シナリオを利用）" style="min-height:76px;"></textarea>
            </label>
            <label class="simple-video-field simple-video-field-wide" style="display:block;margin-bottom:8px;">
                <span>Tags（必須）</span>
                <input class="simple-video-input" id="simpleVideoT2ATags" placeholder="例: pop, female voice, emotional, 110 bpm" />
            </label>
            <label class="simple-video-field simple-video-field-wide" style="display:block;margin-bottom:8px;">
                <span>Lyrics（任意）</span>
                <textarea class="simple-video-prompt" id="simpleVideoT2ALyrics" placeholder="歌詞を入力（空欄可）" style="min-height:88px;"></textarea>
            </label>
            <div class="simple-video-form-row simple-video-t2a-param-row">
                <label class="simple-video-field simple-video-t2a-field-medium">
                    <span>Language</span>
                    <select class="simple-video-select" id="simpleVideoT2ALanguage">
                        <option value="en">English</option>
                        <option value="ja">日本語</option>
                        <option value="zh">中文</option>
                    </select>
                </label>
                <label class="simple-video-field simple-video-t2a-field-compact">
                    <span>Duration</span>
                    <input class="simple-video-input" id="simpleVideoT2ADuration" inputmode="numeric" placeholder="30" />
                </label>
                <label class="simple-video-field simple-video-t2a-field-compact">
                    <span>BPM</span>
                    <input class="simple-video-input" id="simpleVideoT2ABpm" inputmode="numeric" placeholder="120" />
                </label>
                <label class="simple-video-field simple-video-t2a-field-compact">
                    <span>拍子</span>
                    <select class="simple-video-select" id="simpleVideoT2ATimesignature">
                        <option value="2">2/4</option>
                        <option value="3">3/4</option>
                        <option value="4">4/4</option>
                        <option value="6">6/8</option>
                    </select>
                </label>
                <label class="simple-video-field simple-video-t2a-field-medium">
                    <span>Key Scale</span>
                    <select class="simple-video-select" id="simpleVideoT2AKeyscale">
                        <option value="C major">C major</option>
                        <option value="C minor">C minor</option>
                        <option value="C# major">C# major</option>
                        <option value="C# minor">C# minor</option>
                        <option value="D major">D major</option>
                        <option value="D minor">D minor</option>
                        <option value="D# major">D# major</option>
                        <option value="D# minor">D# minor</option>
                        <option value="E major">E major</option>
                        <option value="E minor">E minor</option>
                        <option value="F major">F major</option>
                        <option value="F minor">F minor</option>
                        <option value="F# major">F# major</option>
                        <option value="F# minor">F# minor</option>
                        <option value="G major">G major</option>
                        <option value="G minor">G minor</option>
                        <option value="G# major">G# major</option>
                        <option value="G# minor">G# minor</option>
                        <option value="A major">A major</option>
                        <option value="A minor">A minor</option>
                        <option value="A# major">A# major</option>
                        <option value="A# minor">A# minor</option>
                        <option value="B major">B major</option>
                        <option value="B minor">B minor</option>
                    </select>
                </label>
                <label class="simple-video-field simple-video-t2a-field-compact">
                    <span>Steps</span>
                    <input class="simple-video-input" id="simpleVideoT2ASteps" inputmode="numeric" placeholder="8" />
                </label>
            </div>
            <div class="simple-video-generate-row simple-video-t2a-actions-row" style="margin-top:10px;">
                <button class="simple-video-settings-btn simple-video-inline-btn simple-video-t2a-mini-btn" id="simpleVideoT2AAutoBtn" type="button">🚀 AUTO</button>
                <button class="simple-video-settings-btn simple-video-inline-btn simple-video-t2a-mini-btn" id="simpleVideoT2AComposeLyricsBtn" type="button">🎼 作詞</button>
                <button class="simple-video-settings-btn simple-video-inline-btn simple-video-t2a-mini-btn" id="simpleVideoT2ASuggestTagsBtn" type="button">🏷️ タグ提案</button>
                <button class="simple-video-generate-btn" id="simpleVideoT2AGenBtn" type="button">
                    <i class="fas fa-music"></i> 音楽を生成
                </button>
                <button class="simple-video-generate-btn" id="simpleVideoM2VBtn" type="button" title="音源に合わせて動画を生成">
                    <i class="fas fa-film"></i> 音楽→動画
                </button>
            </div>
            <div class="simple-video-form-row" style="margin-top:8px; align-items:end;">
                <label class="simple-video-field" style="max-width:220px;">
                    <span>M2V 音源</span>
                    <select class="simple-video-select" id="simpleVideoM2VSourceMode">
                        <option value="generated">生成音楽を使う</option>
                        <option value="uploaded">外部音楽をアップロード</option>
                    </select>
                </label>
                <div class="simple-video-hint" id="simpleVideoM2VSourceMeta" style="margin:0 0 6px 0;">音源: なし</div>
            </div>
            <div class="simple-video-keyimage" id="simpleVideoM2VAudioDrop" style="height:112px; margin-top:6px;">
                <div class="simple-video-keyimage-placeholder" id="simpleVideoM2VAudioDropPlaceholder">クリック/ドロップで音声をアップロード（M2V入力）</div>
                <div class="simple-video-keyimage-meta" id="simpleVideoM2VAudioDropMeta" style="display:none;"></div>
            </div>
            <div id="simpleVideoT2AAudioOutput" style="margin-top:10px;"></div>
        </div>
    `;
    
    // Right panel: Video generation area (spec)
    rightPanel.innerHTML = `
        <div class="simple-video-section">
            <div class="simple-video-section-title"><i class="fas fa-film"></i> 🎬 出力動画</div>
            <div class="simple-video-output" id="simpleVideoOutput">
                <div class="simple-video-output-preview" id="simpleVideoOutputPreview" aria-label="初期画像プレビュー"></div>
                <div class="simple-video-output-placeholder">
                    <i class="fas fa-film"></i>
                    <div>生成された動画がここに表示されます</div>
                </div>
            </div>
            <div class="simple-video-hint" id="simpleVideoV2MSourceMeta" style="margin-top:8px;">動画入力: なし</div>
            <div class="simple-video-keyimage" id="simpleVideoV2MVideoDrop" style="height:112px; margin-top:6px;">
                <div class="simple-video-keyimage-placeholder" id="simpleVideoV2MVideoDropPlaceholder">クリック/ドロップで動画をアップロード（動画→音楽入力）</div>
                <div class="simple-video-keyimage-meta" id="simpleVideoV2MVideoDropMeta" style="display:none;"></div>
            </div>
        </div>

        <div class="simple-video-section">
            <div class="simple-video-section-title with-actions">
                <span class="title-left"><i class="fas fa-list"></i> ⚙️ 生成シーケンス</span>
                <div class="simple-video-sequence-flags" aria-label="生成シーケンスオプション">
                    <label class="simple-video-sequence-flag" title="ONでLTX系（I2V/T2V）を優先します（音声ON時はLTXの音声を保持）">
                        <input type="checkbox" id="simpleVideoOptFast" />
                        <span>LTXを使う</span>
                    </label>
                    <label class="simple-video-sequence-flag" title="LTX使用時のモデル種別を選択します（デフォルト: Full FP4）">
                        <span>LTX種別</span>
                        <select class="simple-video-select" id="simpleVideoLtxVariant" style="min-width:130px; width:66.666%;">
                            <option value="fp4" selected>Full FP4</option>
                            <option value="distilled">Distilled</option>
                        </select>
                    </label>
                    <label class="simple-video-sequence-flag" title="（現状は音声対応ワークフローが必要です）">
                        <input type="checkbox" id="simpleVideoOptAudio" />
                        <span>音声も生成</span>
                    </label>
                </div>
            </div>
            <div class="simple-video-sequence-row">
                <select class="simple-video-select" id="simpleVideoSequenceSelect">
                    <option value="" selected disabled>選択してください</option>
                    ${VIDEO_PRESETS.map(p => `<option value="${p.id}">${p.icon} ${p.name}</option>`).join('')}
                </select>
            </div>
            <div class="simple-video-hint" id="simpleVideoSequenceDesc">${''}</div>
        </div>

        <div class="simple-video-section simple-video-section-video-settings">
            <div class="simple-video-section-title with-actions" id="simpleVideoVideoSettingsTitle" style="cursor:pointer;">
                <span class="title-left"><i class="fas fa-cog"></i> ⚙️ 動画設定 <span id="simpleVideoVideoSettingsToggleIcon">▼</span></span>
                <div class="simple-video-scenario-actions">
                    <button class="simple-video-icon-btn" id="simpleVideoSettingsBtn" type="button" title="詳細設定">⚙️</button>
                    <button class="simple-video-icon-btn" id="simpleVideoResetSettingsBtn" type="button" title="設定をデフォルト値に戻す">🔄</button>
                    <button class="simple-video-icon-btn" id="simpleVideoClearStorageBtn" type="button" title="ブラウザメモリを完全にクリア（全状態を削除してリロード）" style="color:#e55;">🗑️</button>
                </div>
            </div>
            <div id="simpleVideoVideoSettingsContent">
            <div class="simple-video-settings-row">
                <div class="simple-video-title-inline-field" aria-label="シーン数">
                    <span>シーン数</span>
                    <select class="simple-video-select" id="simpleVideoSceneCount">
                        <option value="3" selected>3</option>
                        ${Array.from({ length: 24 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}
                    </select>
                </div>
                <div class="simple-video-title-inline-field" aria-label="シーン長さ">
                    <span>⏱️長さ(秒)</span>
                    <select class="simple-video-select" id="simpleVideoSceneLength" style="min-width:110px;">
                        <option value="2">2秒</option>
                        <option value="3">3秒</option>
                        <option value="4">4秒</option>
                        <option value="5" selected>5秒</option>
                        <option value="8">8秒</option>
                        <option value="10">10秒（LTX）</option>
                        <option value="13">13秒（LTX）</option>
                    </select>
                </div>
                <div class="simple-video-title-inline-field" aria-label="動画長">
                    <span>📹合計</span>
                    <span class="simple-video-computed-inline" id="simpleVideoTotalLengthDisplay">-</span>
                </div>
                <div class="simple-video-title-inline-field" id="simpleVideoI2IRefRoleField" aria-label="参照画像の役割" style="display:none;">
                    <span>参照画像の役割</span>
                    <select class="simple-video-select" id="simpleVideoI2IRefRole">
                        <option value="character">キャラクター一貫性</option>
                        <option value="mood">雰囲気・絵柄維持</option>
                    </select>
                </div>
                <div class="simple-video-title-inline-field" id="simpleVideoRefSourceField" aria-label="参照固定" style="display:none;">
                    <span>🔗参照</span>
                    <select class="simple-video-select" id="simpleVideoRefSource">
                        <option value="character">キャラ固定</option>
                        <option value="first_scene">シーン1固定</option>
                    </select>
                </div>
                <div class="simple-video-title-inline-field" id="simpleVideoMotionStrengthField" aria-label="動きの強さ">
                    <span>🎬動き</span>
                    <select class="simple-video-select" id="simpleVideoMotionStrength">
                        <option value="small">小</option>
                        <option value="medium" selected>中</option>
                        <option value="large">大</option>
                    </select>
                </div>
            </div>

            <div class="simple-video-hint" id="simpleVideoI2IRefRoleHint" style="display:none;">画像リファイン（I2I）で「参照画像」を何として扱うかを選択します。キャラ一貫性は人物/服/髪などを固定しやすく、雰囲気維持は画調/ライティング/色を固定しやすい。</div>
            <div class="simple-video-hint" id="simpleVideoCurrentRefHint">参照: -</div>

            <div class="simple-video-advanced-settings" id="simpleVideoAdvancedSettings" style="display:none;">
                <div class="simple-video-form-row">
                    <label class="simple-video-field simple-video-field-wide">
                        <span>サイズ</span>
                        <select class="simple-video-select" id="simpleVideoSize">
                            <option value="auto" selected>(auto)</option>
                            <option value="1920x1080">横長 1920×1080（高精細）</option>
                            <option value="1280x720">横長 1280×720（HD）</option>
                            <option value="832x480">横長 832×480（WAN標準）</option>
                            <option value="640x480">横長 640×480</option>
                            <option value="1080x1920">縦長 1080×1920</option>
                            <option value="720x1280">縦長 720×1280</option>
                            <option value="480x832">縦長 480×832（WAN標準）</option>
                            <option value="480x640">縦長 480×640</option>
                            <option value="1024x1024">スクエア 1024×1024</option>
                            <option value="640x640">スクエア 640×640（WAN標準）</option>
                            <option value="512x512">スクエア 512×512</option>
                        </select>
                    </label>
                    <label class="simple-video-field">
                        <span>FPS</span>
                        <input class="simple-video-input" id="simpleVideoFps" inputmode="numeric" placeholder="(auto)" />
                    </label>
                    <label class="simple-video-field" id="simpleVideoFLFQualityField" style="display:none;">
                        <span>FLF品質</span>
                        <select class="simple-video-select" id="simpleVideoFLFQuality">
                            <option value="speed" selected>⚡高速</option>
                            <option value="quality">✨高品質</option>
                        </select>
                    </label>
                </div>
                <div class="simple-video-hint">サイズはワークフローに合わせて選択してください。推奨は640x640です。</div>

                <div class="simple-video-form-row" id="simpleVideoI2ISettingsRow" style="display:none; margin-top:10px;">
                    <label class="simple-video-field simple-video-field-wide">
                        <span>I2Iモデル</span>
                        <select class="simple-video-select" id="simpleVideoI2IWorkflow">
                            <option value="auto" selected>(auto) 既定</option>
                            <option value="qwen_i2i_2511_bf16_lightning4">Qwen i2i 2511 Lightning 4-step (Edit)</option>
                            <option value="qwen_i2i_2511_bf16">Qwen i2i 2511 20-step (Edit/強め)</option>
                            <option value="qwen_i2i_2512_lightning4">Qwen i2i 2512 Lightning 4-step (I2I/高速)</option>
                            <option value="flux2_edit">Flux2 I2I Edit</option>
                            <option value="flux2_klein_image_edit_4b_distilled">Flux2 Klein 4B Distilled (高速)</option>
                            <option value="flux2_klein_image_edit_9b_base">Flux2 Klein 9B Base (高品質)</option>
                        </select>
                    </label>
                    <label class="simple-video-field simple-video-field-medium">
                        <span>I2I強度 (denoise)</span>
                        <input type="number" step="0.001" min="0" max="1" class="simple-video-input" id="simpleVideoI2IDenoise" inputmode="decimal" placeholder="1.0" />
                    </label>
                    <label class="simple-video-field simple-video-field-compact">
                        <span>I2Iプロンプト (cfg)</span>
                        <input class="simple-video-input" id="simpleVideoI2ICfg" inputmode="decimal" placeholder="6.0" />
                    </label>
                </div>
                <div class="simple-video-hint" id="simpleVideoI2IHint" style="display:none;">Qwen 2512（I2I）は低denoiseでも効きやすい（例: 0.2〜0.4）。画像の影響が強い場合は denoise を上げる。変化が出ない場合は cfg も上げる。</div>
            </div>
            </div>
        </div>

        <div class="simple-video-section">
            <div class="simple-video-section-title with-actions">
                <span class="title-left"><i class="fas fa-scroll"></i> 📜 シナリオ入力</span>
                <div class="simple-video-scenario-actions" aria-label="シナリオ補助">
                    <label class="simple-video-inline-check" title="既定ON: LLMでシーンプロンプトを生成します。OFF: シナリオ本文をそのまま各シーンのプロンプトにコピーします">
                        <input type="checkbox" id="simpleVideoScenarioUseLLM" />
                        <span>LLMでプロンプト生成</span>
                    </label>
                    <label class="simple-video-inline-check" title="簡単=従来相当、標準=より詳しく、詳細=動画内の動きまで記述します">
                        <span>複雑さ</span>
                        <select class="simple-video-select" id="simpleVideoPromptComplexity" style="min-width:80px; width:88px;">
                            <option value="basic" selected>簡単</option>
                            <option value="standard">標準</option>
                            <option value="rich">詳細</option>
                        </select>
                    </label>
                    <label class="simple-video-inline-check" title="ON: シーンNのFLF動画プロンプトに、シーンN+1画像の生成プロンプト要点（終端条件）を注入します">
                        <input type="checkbox" id="simpleVideoFlfEndConstraintEnabled" checked />
                        <span>FLF終端意図注入</span>
                    </label>
                    <button class="simple-video-settings-btn simple-video-inline-btn" id="simpleVideoScenarioTranslateBtn" type="button" title="生成プロンプトを翻訳（英⇔日）">🌐 翻訳</button>
                    <button class="simple-video-icon-btn" id="simpleVideoScenarioClearLLMBtn" type="button" title="生成済みシーンプロンプトをクリア">🗑️</button>
                </div>
            </div>
            <textarea class="simple-video-prompt" id="simpleVideoScenario" placeholder="どんな動画を作りたい？"></textarea>
        </div>

        <div class="simple-video-section" id="simpleVideoInternalImagesWrap">
            <div class="simple-video-section-title with-actions" id="simpleVideoInternalImagesTitle" style="cursor:pointer;">
                <span class="title-left"><i class="fas fa-image"></i> 📸 内部参照画像 <span id="simpleVideoInternalImagesToggleIcon">▼</span></span>
                <div class="simple-video-scenario-actions" aria-label="内部参照画像操作">
                    <button class="simple-video-icon-btn" id="simpleVideoInternalImagesClearAll" type="button" title="内部参照画像をすべてクリア">🗑️</button>
                </div>
            </div>
            <div id="simpleVideoInternalImagesContent">
                <div class="simple-video-hint">自動生成・準備済みの内部参照画像（確認・クリア用）。✕で個別削除できます。</div>
                <div id="simpleVideoInternalImagesGrid"></div>
            </div>
        </div>

        <div class="simple-video-section" id="simpleVideoIntermediateWrap" style="display:none;">
            <div class="simple-video-section-title with-actions">
                <span class="title-left" id="simpleVideoIntermediateTitle"><i class="fas fa-images"></i> 🖼️ 中間画像</span>
                <div class="simple-video-scenario-actions" aria-label="中間画像操作">
                    <button class="simple-video-icon-btn" id="simpleVideoIntermediateClearBtn" type="button" title="中間画像をクリア">🗑️</button>
                </div>
            </div>
            <div class="simple-video-hint">サムネにドラッグ&ドロップで置換できます（画像OK）。クリックで拡大。</div>
            <div class="simple-video-intermediate-grid" id="simpleVideoIntermediateGrid"></div>
        </div>

        <div class="simple-video-generate-row">
            <button class="simple-video-generate-btn" id="simpleVideoPromptGenBtn" type="button" disabled>
                <i class="fas fa-robot"></i> プロンプト生成
            </button>
            <button class="simple-video-generate-btn" id="simpleVideoVideoInitImageBtn" type="button" disabled title="全シーンの初期画像を事前に生成します（I2Iモード対応）">
                <i class="fas fa-images"></i> シーン事前生成
            </button>
            <button class="simple-video-generate-btn" id="simpleVideoGenerateBtn" disabled>
                <i class="fas fa-play"></i> 動画を生成
            </button>
            <button class="simple-video-generate-btn" id="simpleVideoV2MBtn" type="button" title="動画尺を反映してBGMを生成">
                <i class="fas fa-music"></i> 動画→音楽
            </button>
            <button class="simple-video-stop-btn" id="simpleVideoStopBtn" type="button" disabled>
                <i class="fas fa-stop"></i> 生成中止
            </button>
        </div>

        <div class="simple-video-progress" id="simpleVideoProgress" style="display:none;">
            <div class="simple-video-progress-status" id="simpleVideoProgressStatus">準備中...</div>
            <div class="simple-video-progress-bar"><div class="simple-video-progress-fill" id="simpleVideoProgressFill" style="width: 0%;"></div></div>
            <div id="simpleVideoContinueGate" style="display:none; margin-top:8px;">
                <div class="simple-video-hint" id="simpleVideoContinueGateText" style="margin-bottom:6px;"></div>
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    <button class="simple-video-generate-btn" id="simpleVideoContinueBtn" type="button">▶ CONTINUE</button>
                    <button class="simple-video-settings-btn simple-video-inline-btn" id="simpleVideoRegenAllScenesBtn" type="button" title="シーン画像を全て再生成してからCONTINUEで続行">🔄 全シーン再生成</button>
                    <button class="simple-video-settings-btn simple-video-inline-btn" id="simpleVideoRestartM2VBtn" type="button" title="プロンプト・シーン画像を全てクリアして最初からやり直す">🔁 最初からやり直し</button>
                    <button class="simple-video-settings-btn simple-video-inline-btn" id="simpleVideoPauseAtIntermediateBtn" type="button">⏸ 停止して調整</button>
                </div>
            </div>

            <div class="simple-video-generated-prompts" id="simpleVideoGeneratedPromptsWrap" style="display:none;">
                <div class="simple-video-generated-prompts-title">
                    <span>🤖 生成されたシーンプロンプト</span>
                    <button class="simple-video-settings-btn simple-video-inline-btn" id="simpleVideoGeneratedTranslateBtn" type="button" title="生成プロンプトを翻訳（英⇔日）">🌐 翻訳</button>
                </div>
                <textarea class="simple-video-prompt simple-video-generated-prompts-text" id="simpleVideoLLMPrompt" placeholder="（生成されたプロンプトがここに表示されます）"></textarea>
            </div>
        </div>
    `;
    
    // Attach event listeners
    attachSimpleVideoEventListeners();
    
    // Update UI based on current state
    updateSimpleVideoUI();

    // Load characters list (async)
    renderSimpleVideoCharacters();

    // Load generated output files list (async)
    loadSimpleVideoOutputFiles({ resetSelection: true });
}

/* ========================================
   Event Listeners
   ======================================== */

function attachSimpleVideoEventListeners() {
    // Back button
    const backBtn = document.getElementById('simpleVideoBackBtn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            if (typeof toggleSimpleVideoMode === 'function') {
                toggleSimpleVideoMode(false);
            }
        });
    }
    
    // Sequence selection (right column)
    const seqSel = document.getElementById('simpleVideoSequenceSelect');
    if (seqSel) {
        seqSel.addEventListener('change', (e) => {
            selectPreset(e.target.value);
        });
    }

    // Sequence-side options
    const fast = document.getElementById('simpleVideoOptFast');
    const ltxVariant = document.getElementById('simpleVideoLtxVariant');
    if (fast) {
        fast.addEventListener('change', (e) => {
            if (!SIMPLE_VIDEO_STANDALONE_CONFIG.enableLtx) {
                SimpleVideoUI.state.useFast = false;
                try { e.target.checked = false; } catch (_e) {}
                saveSimpleVideoState();
                updateSimpleVideoUI();
                return;
            }
            const useLTX = !!e.target.checked;
            SimpleVideoUI.state.useFast = useLTX;
            
            // Auto-switch video size based on LTX selection (only if user hasn't manually selected)
            const sizeSelect = document.getElementById('simpleVideoSize');
            if (sizeSelect && !SimpleVideoUI.state.userSelectedSize) {
                if (useLTX) {
                    // Save current size as backup before switching to LTX
                    if (!SimpleVideoUI.state._preLtxVideoSize) {
                        SimpleVideoUI.state._preLtxVideoSize = SimpleVideoUI.state.videoSize || '640x640';
                    }
                    // Switch to LTX recommended size (1280x720 HD)
                    SimpleVideoUI.state.videoSize = '1280x720';
                    sizeSelect.value = '1280x720';
                    console.log('[SimpleVideo] LTX enabled: auto-switched to 1280x720');
                } else {
                    // Restore previous size or default to WAN size
                    const restoreSize = SimpleVideoUI.state._preLtxVideoSize || '640x640';
                    SimpleVideoUI.state.videoSize = restoreSize;
                    sizeSelect.value = restoreSize;
                    SimpleVideoUI.state._preLtxVideoSize = null;
                    console.log('[SimpleVideo] LTX disabled: restored to', restoreSize);
                }
            }

            if (ltxVariant) {
                ltxVariant.disabled = !useLTX;
            }
            
            saveSimpleVideoState();
            updateSimpleVideoUI();
        });
    }

    if (ltxVariant) {
        ltxVariant.addEventListener('change', (e) => {
            SimpleVideoUI.state.ltxVariant = normalizeLtxVariant(e.target.value);
            saveSimpleVideoState();
            updateSimpleVideoUI();
        });
    }

    const audio = document.getElementById('simpleVideoOptAudio');
    if (audio) {
        audio.addEventListener('change', (e) => {
            SimpleVideoUI.state.generateAudio = !!e.target.checked;
            saveSimpleVideoState();
            updateSimpleVideoUI();
        });
    }

    // ref3 mode controls
    const ref3Enabled = document.getElementById('simpleVideoRef3ModeEnabled');
    if (ref3Enabled) {
        ref3Enabled.addEventListener('change', (e) => {
            SimpleVideoUI.state.ref3ModeEnabled = !!e.target.checked;
            const sel = document.getElementById('simpleVideoRef3ModeSelect');
            if (sel) sel.disabled = !e.target.checked;
            saveSimpleVideoState();
        });
    }
    const ref3ModeSelect = document.getElementById('simpleVideoRef3ModeSelect');
    if (ref3ModeSelect) {
        ref3ModeSelect.addEventListener('change', (e) => {
            SimpleVideoUI.state.ref3UseMode = e.target.value;
            saveSimpleVideoState();
        });
    }

    // Image prompt (left column)
    const imagePromptInput = document.getElementById('simpleVideoImagePrompt');
    if (imagePromptInput) {
        imagePromptInput.addEventListener('focus', () => {
            SimpleVideoUI.lastPromptTarget = 'imagePrompt';
        });
        imagePromptInput.addEventListener('input', (e) => {
            SimpleVideoUI.state.imagePrompt = e.target.value;
            saveSimpleVideoState();
        });
    }

    const t2aTagsInput = document.getElementById('simpleVideoT2ATags');
    t2aTagsInput?.addEventListener('input', (e) => {
        SimpleVideoUI.state.t2aTags = String(e.target.value || '');
        saveSimpleVideoState();
        updateSimpleVideoT2AButtonState();
    });

    const t2aScenarioInput = document.getElementById('simpleVideoT2AScenario');
    t2aScenarioInput?.addEventListener('focus', () => {
        SimpleVideoUI.lastPromptTarget = 't2aScenario';
    });
    t2aScenarioInput?.addEventListener('input', (e) => {
        SimpleVideoUI.state.t2aScenario = String(e.target.value || '');
        saveSimpleVideoState();
    });

    const t2aLyricsInput = document.getElementById('simpleVideoT2ALyrics');
    t2aLyricsInput?.addEventListener('input', (e) => {
        SimpleVideoUI.state.t2aLyrics = String(e.target.value || '');
        saveSimpleVideoState();
    });

    const t2aLangInput = document.getElementById('simpleVideoT2ALanguage');
    t2aLangInput?.addEventListener('change', (e) => {
        SimpleVideoUI.state.t2aLanguage = normalizeT2ALanguage(e.target.value);
        saveSimpleVideoState();
    });

    const t2aDurationInput = document.getElementById('simpleVideoT2ADuration');
    const sanitizeT2AIntegerField = (target) => {
        if (!target) return;
        const cleaned = normalizeHalfWidthDigits(target.value).replace(/\D/g, '').slice(0, 3);
        target.value = cleaned;
    };
    const bindT2AIntegerInputNormalize = (inputEl) => {
        if (!inputEl) return;
        inputEl.addEventListener('compositionstart', () => {
            inputEl.dataset.svComposing = '1';
        });
        inputEl.addEventListener('compositionend', () => {
            inputEl.dataset.svComposing = '0';
            sanitizeT2AIntegerField(inputEl);
        });
        inputEl.addEventListener('input', (e) => {
            const target = e?.target;
            if (!target || target.dataset?.svComposing === '1') return;
            sanitizeT2AIntegerField(target);
        });
    };
    bindT2AIntegerInputNormalize(t2aDurationInput);

    const commitT2ADuration = (target) => {
        const normalized = normalizeT2ANumber(target?.value, { fallback: 30, min: 1, max: 300, precision: 0 });
        if (target) target.value = normalized;
        SimpleVideoUI.state.t2aDuration = normalized;
        saveSimpleVideoState();
    };

    t2aDurationInput?.addEventListener('change', (e) => {
        commitT2ADuration(e.target);
    });
    t2aDurationInput?.addEventListener('blur', (e) => {
        commitT2ADuration(e.target);
    });
    t2aDurationInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commitT2ADuration(e.target);
            e.target.blur?.();
        }
    });

    const t2aBpmInput = document.getElementById('simpleVideoT2ABpm');
    bindT2AIntegerInputNormalize(t2aBpmInput);

    const commitT2ABpm = (target) => {
        const normalized = normalizeT2ANumber(target?.value, { fallback: 120, min: 30, max: 240, precision: 0 });
        if (target) target.value = normalized;
        SimpleVideoUI.state.t2aBpm = normalized;
        saveSimpleVideoState();
    };

    t2aBpmInput?.addEventListener('change', (e) => {
        commitT2ABpm(e.target);
    });
    t2aBpmInput?.addEventListener('blur', (e) => {
        commitT2ABpm(e.target);
    });
    t2aBpmInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commitT2ABpm(e.target);
            e.target.blur?.();
        }
    });

    const t2aTimesigInput = document.getElementById('simpleVideoT2ATimesignature');
    t2aTimesigInput?.addEventListener('change', (e) => {
        SimpleVideoUI.state.t2aTimesignature = normalizeT2ATimeSignature(e.target.value);
        saveSimpleVideoState();
    });

    const t2aKeyscaleInput = document.getElementById('simpleVideoT2AKeyscale');
    t2aKeyscaleInput?.addEventListener('change', (e) => {
        SimpleVideoUI.state.t2aKeyscale = normalizeT2AKeyscale(e.target.value);
        saveSimpleVideoState();
    });

    const t2aStepsInput = document.getElementById('simpleVideoT2ASteps');
    bindT2AIntegerInputNormalize(t2aStepsInput);

    const commitT2ASteps = (target) => {
        const normalized = normalizeT2ANumber(target?.value, { fallback: 8, min: 1, max: 200, precision: 0 });
        if (target) target.value = normalized;
        SimpleVideoUI.state.t2aSteps = normalized;
        saveSimpleVideoState();
    };

    t2aStepsInput?.addEventListener('change', (e) => {
        commitT2ASteps(e.target);
    });
    t2aStepsInput?.addEventListener('blur', (e) => {
        commitT2ASteps(e.target);
    });
    t2aStepsInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commitT2ASteps(e.target);
            e.target.blur?.();
        }
    });

    const t2aCfgInput = document.getElementById('simpleVideoT2ACfg');
    t2aCfgInput?.addEventListener('input', (e) => {
        const cleaned = String(e.target.value || '').replace(/[^0-9.]/g, '');
        e.target.value = cleaned;
        SimpleVideoUI.state.t2aCfg = cleaned;
        saveSimpleVideoState();
    });
    t2aCfgInput?.addEventListener('change', (e) => {
        const normalized = normalizeT2ANumber(e.target.value, { fallback: 1.0, min: 0.1, max: 30, precision: 2 });
        e.target.value = normalized;
        SimpleVideoUI.state.t2aCfg = normalized;
        saveSimpleVideoState();
    });

    const t2aSeedInput = document.getElementById('simpleVideoT2ASeed');
    t2aSeedInput?.addEventListener('input', (e) => {
        const cleaned = String(e.target.value || '').replace(/\D/g, '');
        e.target.value = cleaned;
        SimpleVideoUI.state.t2aSeed = cleaned;
        saveSimpleVideoState();
    });

    const t2aGenBtn = document.getElementById('simpleVideoT2AGenBtn');
    t2aGenBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        await startSimpleVideoT2AGeneration();
    });

    const m2vBtn = document.getElementById('simpleVideoM2VBtn');
    m2vBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        await startSimpleVideoMusicToVideo();
    });

    const m2vSourceMode = document.getElementById('simpleVideoM2VSourceMode');
    m2vSourceMode?.addEventListener('change', (e) => {
        SimpleVideoUI.state.t2aSourceMode = (String(e.target.value || '') === 'uploaded') ? 'uploaded' : 'generated';
        saveSimpleVideoState();
        updateSimpleVideoUI();
    });

    const t2aAutoBtn = document.getElementById('simpleVideoT2AAutoBtn');
    t2aAutoBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!e.isTrusted) return; // ignore synthetic clicks during init
        await autoGenerateSimpleVideoT2A();
    });

    const t2aComposeBtn = document.getElementById('simpleVideoT2AComposeLyricsBtn');
    t2aComposeBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!e.isTrusted) return; // ignore synthetic clicks during init
        await composeSimpleVideoT2ALyrics();
    });

    const t2aSuggestBtn = document.getElementById('simpleVideoT2ASuggestTagsBtn');
    t2aSuggestBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!e.isTrusted) return; // ignore synthetic clicks during init
        await suggestSimpleVideoT2ATags();
    });

    // Scenario (right column)
    const continueBtn = document.getElementById('simpleVideoContinueBtn');
    continueBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof simpleVideoContinueGateResolver === 'function') {
            const resolver = simpleVideoContinueGateResolver;
            simpleVideoContinueGateResolver = null;
            setSimpleVideoContinueGateVisible(false);
            updateGenerateButtonState();
            resolver(true);
        }
    });

    const pauseBtn = document.getElementById('simpleVideoPauseAtIntermediateBtn');
    pauseBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof simpleVideoContinueGateResolver === 'function') {
            const resolver = simpleVideoContinueGateResolver;
            simpleVideoContinueGateResolver = null;
            setSimpleVideoContinueGateVisible(false);
            updateGenerateButtonState();
            resolver(false);
        }
    });

    const regenAllScenesBtn = document.getElementById('simpleVideoRegenAllScenesBtn');
    regenAllScenesBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!simpleVideoContinueGateActive) return;
        if (SimpleVideoUI.state.isImageGenerating) return;
        const inter = SimpleVideoUI.state.intermediateImages;
        const sceneCount = Array.isArray(inter?.images) ? inter.images.length : Math.max(1, Number(SimpleVideoUI.state.sceneCount) || 1);
        const allIndexes = Array.from({ length: sceneCount }, (_, i) => i);
        await startIntermediateImageGeneration({ forceSceneIndexes: allIndexes });
        // After regeneration, update gate text if still active
        if (simpleVideoContinueGateActive) {
            const gateTextEl = document.getElementById('simpleVideoContinueGateText');
            if (gateTextEl) gateTextEl.textContent = '🔄 全シーン再生成完了。CONTINUE で動画生成へ進みます。';
        }
    });

    const restartM2VBtn = document.getElementById('simpleVideoRestartM2VBtn');
    restartM2VBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        if (!simpleVideoContinueGateActive) return;
        if (SimpleVideoUI.state.isImageGenerating) return;
        if (!confirm('最初からやり直しますか？\nプロンプトとシーン画像を全てクリアして再生成します。')) return;
        // Clear generated prompts and intermediate images
        SimpleVideoUI.state.intermediateImages = null;
        SimpleVideoUI.state.llmPrompt = '';
        saveSimpleVideoState();
        updateSimpleVideoUI();
        const isM2VRunning = !!SimpleVideoUI.state.m2vIsRunning;
        if (isM2VRunning) simpleVideoContinueGateRestartM2V = true;
        if (typeof simpleVideoContinueGateResolver === 'function') {
            const resolver = simpleVideoContinueGateResolver;
            simpleVideoContinueGateResolver = null;
            setSimpleVideoContinueGateVisible(false);
            updateGenerateButtonState();
            resolver(false);
        }
        if (!isM2VRunning) {
            // Non-M2V: just notify user to re-run manually
            if (typeof showToast === 'function') showToast('プロンプト・シーン画像をクリアしました。再度「動画生成」を実行してください', 'info');
        }
    });

    // Scenario (right column)
    const scenarioInput = document.getElementById('simpleVideoScenario');
    if (scenarioInput) {
        scenarioInput.addEventListener('focus', () => {
            SimpleVideoUI.lastPromptTarget = 'scenario';
        });
        scenarioInput.addEventListener('input', (e) => {
            SimpleVideoUI.state.scenario = e.target.value;
            // Scenario changed: invalidate auto-generated intermediate images
            invalidateGeneratedIntermediateImages();
            saveSimpleVideoState();
            updateGenerateButtonState();
        });
    }

    // Background removal checkbox
    const removeBgCheck = document.getElementById('simpleVideoRemoveBgCheck');
    if (removeBgCheck) {
        removeBgCheck.checked = SimpleVideoUI.state.removeBgBeforeGenerate || false;
        removeBgCheck.addEventListener('change', () => {
            SimpleVideoUI.state.removeBgBeforeGenerate = removeBgCheck.checked;
            saveSimpleVideoState();
        });
    }

    // Initial image generation (left column)
    const imgGenBtn = document.getElementById('simpleVideoImageGenBtn');
    if (imgGenBtn) {
        imgGenBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await startInitialImageGeneration();
        });
    }

    // Character sheet no-bg checkbox
    const charSheetNobgCheck = document.getElementById('simpleVideoCharSheetNobgCheck');
    if (charSheetNobgCheck) {
        charSheetNobgCheck.checked = SimpleVideoUI.state.charSheetNobg || false;
        charSheetNobgCheck.addEventListener('change', () => {
            SimpleVideoUI.state.charSheetNobg = charSheetNobgCheck.checked;
            saveSimpleVideoState();
        });
    }

    // Character sheet generation
    const charSheetGenBtn = document.getElementById('simpleVideoCharSheetGenBtn');
    if (charSheetGenBtn) {
        charSheetGenBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await generateCharacterSheet();
        });
    }

    // Scenario helper controls
    const scenarioUseLLM = document.getElementById('simpleVideoScenarioUseLLM');
    if (scenarioUseLLM) {
        scenarioUseLLM.addEventListener('change', (e) => {
            SimpleVideoUI.state.scenarioUseLLM = !!e.target.checked;
            saveSimpleVideoState();
        });
    }

    const promptComplexity = document.getElementById('simpleVideoPromptComplexity');
    if (promptComplexity) {
        promptComplexity.addEventListener('change', (e) => {
            SimpleVideoUI.state.promptComplexity = normalizePromptComplexity(e.target.value);
            // Complexity changed: existing generated prompts may no longer match desired detail level.
            clearSimpleVideoGeneratedPrompts();
            saveSimpleVideoState();
        });
    }

    const flfEndConstraintEnabled = document.getElementById('simpleVideoFlfEndConstraintEnabled');
    if (flfEndConstraintEnabled) {
        flfEndConstraintEnabled.addEventListener('change', (e) => {
            SimpleVideoUI.state.flfEndConstraintEnabled = !!e.target.checked;
            saveSimpleVideoState();
        });
    }

    const scenarioTranslateBtn = document.getElementById('simpleVideoScenarioTranslateBtn');
    scenarioTranslateBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        await translateSimpleVideoGeneratedPrompts();
    });

    const generatedTranslateBtn = document.getElementById('simpleVideoGeneratedTranslateBtn');
    generatedTranslateBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        await translateSimpleVideoGeneratedPrompts('simpleVideoGeneratedTranslateBtn');
    });

    // Allow editing of generated prompts and save state
    const llmPromptEl = document.getElementById('simpleVideoLLMPrompt');
    llmPromptEl?.addEventListener('input', () => {
        SimpleVideoUI.state.llmPrompt = llmPromptEl.value;
        syncGeneratedPromptsVisibility();
        // LLM prompts changed: invalidate auto-generated intermediate images
        invalidateGeneratedIntermediateImages();
        saveSimpleVideoState();
        updateGenerateButtonState();
    });

    const scenarioClearLLMBtn = document.getElementById('simpleVideoScenarioClearLLMBtn');
    scenarioClearLLMBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        clearSimpleVideoGeneratedPrompts();
    });

    // Character list
    const refreshCharsBtn = document.getElementById('simpleVideoRefreshCharacters');
    refreshCharsBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        await renderSimpleVideoCharacters();
    });

    const clearCharBtn = document.getElementById('simpleVideoClearCharacter');
    clearCharBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        SimpleVideoUI.state.selectedCharacter = null;
        // Character cleared → composite is stale
        SimpleVideoUI.state.characterImage = null;
        saveSimpleVideoState();
        updateSimpleVideoUI();
        updateGenerateButtonState();
    });

    const registerCharBtn = document.getElementById('simpleVideoRegisterCharacterBtn');
    const registerCharName = document.getElementById('simpleVideoRegisterCharacterName');
    const registerCharFile = document.getElementById('simpleVideoRegisterCharacterFile');
    registerCharBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        const nameRaw = String(registerCharName?.value || '').trim();
        const file = registerCharFile?.files?.[0] || null;
        if (!nameRaw) {
            if (typeof showToast === 'function') showToast('キャラクタ名を入力してください', 'warning');
            return;
        }
        if (!file) {
            if (typeof showToast === 'function') showToast('登録する画像を選択してください', 'warning');
            return;
        }
        if (!window.app?.api || typeof window.app.api.registerRefImage !== 'function') {
            if (typeof showToast === 'function') showToast('登録APIが利用できません', 'error');
            return;
        }
        try {
            registerCharBtn.disabled = true;
            await window.app.api.registerRefImage({ name: nameRaw, file });
            if (registerCharFile) registerCharFile.value = '';
            await renderSimpleVideoCharacters();
            if (typeof showToast === 'function') showToast(`キャラクタ「${nameRaw}」を登録しました`, 'success');
        } catch (err) {
            const msg = String(err?.message || err || '登録に失敗しました');
            if (typeof showToast === 'function') showToast(msg, 'error');
        } finally {
            registerCharBtn.disabled = false;
        }
    });
    
    // Characters list accordion toggle
    const characterImageGroupTitle = document.getElementById('simpleVideoCharacterImageGroupTitle');
    if (characterImageGroupTitle) {
        characterImageGroupTitle.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            SimpleVideoUI.state.showCharacterImageGroup = !SimpleVideoUI.state.showCharacterImageGroup;
            saveSimpleVideoState();
            const content = document.getElementById('simpleVideoCharacterImageGroupContent');
            const icon = document.getElementById('simpleVideoCharacterImageGroupToggleIcon');
            if (content) content.style.display = SimpleVideoUI.state.showCharacterImageGroup ? '' : 'none';
            if (icon) icon.textContent = SimpleVideoUI.state.showCharacterImageGroup ? '▼' : '▶';
        });
    }

    // Characters list accordion toggle
    const charactersTitle = document.getElementById('simpleVideoCharactersTitle');
    if (charactersTitle) {
        charactersTitle.addEventListener('click', (e) => {
            // Don't toggle if clicking on buttons
            if (e.target.closest('button')) return;
            SimpleVideoUI.state.showCharactersList = !SimpleVideoUI.state.showCharactersList;
            saveSimpleVideoState();
            const content = document.getElementById('simpleVideoCharactersContent');
            const icon = document.getElementById('simpleVideoCharactersToggleIcon');
            if (content) content.style.display = SimpleVideoUI.state.showCharactersList ? '' : 'none';
            if (icon) icon.textContent = SimpleVideoUI.state.showCharactersList ? '▼' : '▶';
        });
    }

    // Character composite image generation (for char_edit_i2i_flf preset)
    // NOTE: キャラ合成画像セクションは削除されました。キー画像の解析ボタンを使用してください。
    
    // Key image analyze button
    const keyImageAnalyzeBtn = document.getElementById('simpleVideoKeyImageAnalyzeBtn');
    keyImageAnalyzeBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        await runKeyImageAnalysis();
    });

    // Reference source selection for char_edit_i2i_flf
    const refSourceSelect = document.getElementById('simpleVideoRefSource');
    if (refSourceSelect) {
        refSourceSelect.addEventListener('change', (e) => {
            SimpleVideoUI.state.i2iRefSource = normalizeI2IRefSource(e.target.value);
            saveSimpleVideoState();
        });
    }

    // I2I Settings
    const i2iWorkflowSelect = document.getElementById('simpleVideoI2IWorkflow');
    if (i2iWorkflowSelect) {
        i2iWorkflowSelect.addEventListener('change', (e) => {
            if (SIMPLE_VIDEO_STANDALONE_CONFIG.lockI2IWorkflow !== false) {
                const fixedWorkflow = getConfiguredSimpleVideoWorkflow('i2i', 'qwen_i2i_2511_bf16_lightning4');
                SimpleVideoUI.state.i2iRefineWorkflow = fixedWorkflow;
                try { e.target.value = fixedWorkflow; } catch (_e) {}
                saveSimpleVideoState();
                return;
            }
            SimpleVideoUI.state.i2iRefineWorkflow = e.target.value;
            saveSimpleVideoState();
        });
    }

    const i2iDenoiseInput = document.getElementById('simpleVideoI2IDenoise');
    if (i2iDenoiseInput) {
        i2iDenoiseInput.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value) || 1.0;
            SimpleVideoUI.state.i2iDenoise = val;
            const displayEl = document.getElementById('simpleVideoI2IDenoiseValue');
            if (displayEl) displayEl.textContent = val.toFixed(3);
            saveSimpleVideoState();
        });
    }

    const i2iCfgInput = document.getElementById('simpleVideoI2ICfg');
    if (i2iCfgInput) {
        i2iCfgInput.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value) || 1.0;
            SimpleVideoUI.state.i2iCfg = val;
            const displayEl = document.getElementById('simpleVideoI2ICfgValue');
            if (displayEl) displayEl.textContent = val.toFixed(1);
            saveSimpleVideoState();
        });
    }

    // Motion strength selection
    const motionStrengthSelect = document.getElementById('simpleVideoMotionStrength');
    if (motionStrengthSelect) {
        motionStrengthSelect.addEventListener('change', (e) => {
            SimpleVideoUI.state.motionStrength = e.target.value || 'medium';
            saveSimpleVideoState();
            console.log(`[SimpleVideo] Motion strength set to: ${SimpleVideoUI.state.motionStrength}`);
        });
    }

    // Video settings
    const sceneCountSel = document.getElementById('simpleVideoSceneCount');
    if (sceneCountSel) {
        sceneCountSel.addEventListener('change', (e) => {
            SimpleVideoUI.state.sceneCount = e.target.value;
            updateSimpleVideoDerivedTotalLength();
            saveSimpleVideoState();
            // Update thumbnail grid when scene count changes
            renderSimpleVideoIntermediateImagesUI();
        });
    }

    const sceneLengthSel = document.getElementById('simpleVideoSceneLength');
    if (sceneLengthSel) {
        sceneLengthSel.addEventListener('change', (e) => {
            SimpleVideoUI.state.sceneLengthSec = e.target.value;
            updateSimpleVideoDerivedTotalLength();
            saveSimpleVideoState();
        });
    }

    const sizeSel = document.getElementById('simpleVideoSize');
    if (sizeSel) {
        sizeSel.addEventListener('change', (e) => {
            SimpleVideoUI.state.videoSize = normalizeVideoSize(e.target.value);
            // User manually selected a size, prevent auto-override by LTX sync
            SimpleVideoUI.state.ltxSizeForced = false;
            SimpleVideoUI.state.userSelectedSize = true;

            // If user picked a preset, optionally prefill custom fields
            if (SimpleVideoUI.state.videoSize !== 'custom') {
                const effective = getEffectiveVideoSize();
                const match = /^([0-9]+)x([0-9]+)$/.exec(effective);
                if (match) {
                    SimpleVideoUI.state.customSize = { width: match[1], height: match[2] };
                }
            }
            saveSimpleVideoState();
            updateSimpleVideoUI();
        });
    }

    // Internal images section accordion toggle
    const internalImagesTitle = document.getElementById('simpleVideoInternalImagesTitle');
    if (internalImagesTitle) {
        internalImagesTitle.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            SimpleVideoUI.state.showInternalImagesSection = !SimpleVideoUI.state.showInternalImagesSection;
            saveSimpleVideoState();
            updateSimpleVideoUI();
        });
    }

    // Video settings section accordion toggle
    const videoSettingsTitle = document.getElementById('simpleVideoVideoSettingsTitle');
    if (videoSettingsTitle) {
        videoSettingsTitle.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            SimpleVideoUI.state.showVideoSettingsSection = !SimpleVideoUI.state.showVideoSettingsSection;
            saveSimpleVideoState();
            updateSimpleVideoUI();
        });
    }

    // Advanced settings toggle
    const settingsBtn = document.getElementById('simpleVideoSettingsBtn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            SimpleVideoUI.state.showAdvancedSettings = !SimpleVideoUI.state.showAdvancedSettings;
            saveSimpleVideoState();
            updateSimpleVideoUI();
        });
    }

    // I2I Advanced settings toggle
    const i2iSettingsBtn = document.getElementById('simpleVideoI2ISettingsBtn');
    if (i2iSettingsBtn) {
        i2iSettingsBtn.addEventListener('click', () => {
            SimpleVideoUI.state.showI2IAdvancedSettings = !SimpleVideoUI.state.showI2IAdvancedSettings;
            saveSimpleVideoState();
            const advPanel = document.getElementById('simpleVideoI2IAdvancedSettings');
            if (advPanel) {
                advPanel.style.display = SimpleVideoUI.state.showI2IAdvancedSettings ? '' : 'none';
            }
        });
    }

    // Reset settings to default values
    const resetBtn = document.getElementById('simpleVideoResetSettingsBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (!confirm('動画設定をデフォルト値にリセットしますか？\n（中間画像や準備済み初期フレームもクリアされます）')) return;
            
            // Reset to default values
            SimpleVideoUI.state.sceneCount = '3';
            SimpleVideoUI.state.sceneLengthSec = '5';
            SimpleVideoUI.state.totalLengthSec = 15;
            SimpleVideoUI.state.videoSize = 'auto';
            SimpleVideoUI.state.customSize = { width: '', height: '' };
            SimpleVideoUI.state.fps = '';
            SimpleVideoUI.state.i2iDenoise = '1.0';
            SimpleVideoUI.state.i2iCfg = '1.0';
            SimpleVideoUI.state.i2iRefineWorkflow = getConfiguredSimpleVideoWorkflow('i2i', 'qwen_i2i_2511_bf16_lightning4');
            SimpleVideoUI.state.i2iRefRole = 'character';
            SimpleVideoUI.state.useFast = !!SIMPLE_VIDEO_STANDALONE_CONFIG.enableLtx;
            SimpleVideoUI.state.generateAudio = false;
            SimpleVideoUI.state.scenarioUseLLM = true;
            SimpleVideoUI.state.flfQuality = 'speed';

            SimpleVideoUI.state.t2aTags = '';
            SimpleVideoUI.state.t2aScenario = '';
            SimpleVideoUI.state.t2aLyrics = '';
            SimpleVideoUI.state.t2aLanguage = 'en';
            SimpleVideoUI.state.t2aDuration = '30';
            SimpleVideoUI.state.t2aBpm = '120';
            SimpleVideoUI.state.t2aTimesignature = '4';
            SimpleVideoUI.state.t2aKeyscale = 'C major';
            SimpleVideoUI.state.t2aSteps = '8';
            SimpleVideoUI.state.t2aCfg = '1.0';
            SimpleVideoUI.state.t2aSeed = '';
            SimpleVideoUI.state.t2aSourceMode = 'generated';
            SimpleVideoUI.state.t2aGeneratedAudio = null;
            SimpleVideoUI.state.t2aUploadedAudio = null;
            SimpleVideoUI.state.v2mGeneratedVideo = null;
            SimpleVideoUI.state.v2mUploadedVideo = null;
            SimpleVideoUI.state.m2vDurationPlan = null;
            SimpleVideoUI.state.m2vIsRunning = false;
            SimpleVideoUI.state.v2mIsRunning = false;
            
            // Reset LTX forcing state
            SimpleVideoUI.state.ltxFpsForced = false;
            SimpleVideoUI.state.fpsBackup = '';
            SimpleVideoUI.state.ltxSizeForced = false;
            SimpleVideoUI.state.videoSizeBackup = 'auto';
            SimpleVideoUI.state.customSizeBackup = { width: '', height: '' };
            
            // IMPORTANT: Clear intermediate images and prepared video frame to avoid stale data
            SimpleVideoUI.state.intermediateImages = null;
            SimpleVideoUI.state.preparedVideoInitialImage = null;
            SimpleVideoUI.state.preparedInitialImage = null;
            
            saveSimpleVideoState();
            syncFpsForCurrentOptions({ forceUI: true });
            updateSimpleVideoUI();
            
            if (typeof showToast === 'function') showToast('設定をリセットしました', 'info');
        });
    }

    // Full browser memory clear button
    const clearStorageBtn = document.getElementById('simpleVideoClearStorageBtn');
    if (clearStorageBtn) {
        clearStorageBtn.addEventListener('click', async () => {
            if (!confirm('⚠️ ブラウザメモリを完全にクリアしますか？\n\nすべての設定・シナリオ・中間画像・キー画像・LLMプロンプトなどが完全に削除されます。\n（キャラクタ登録データ・モード設定は保持されます）\nページがリロードされます。')) return;
            try {
                // Also clear server-side persisted Simple Video state so hydration won't restore old values.
                if (window.app?.api && typeof window.app.api.saveSimpleVideoState === 'function') {
                    try {
                        await window.app.api.saveSimpleVideoState({});
                    } catch (e) {
                        console.warn('[SimpleVideo] Failed to clear server-side simple video state:', e?.message || e);
                    }
                }

                // Keys to preserve (mode toggle, session IDs, user IDs, theme, etc.)
                const preservePatterns = [
                    'simpleVideoModeEnabled',   // かんたん動画モードON/OFF
                    'comfyui_api_',             // セッションID・ユーザーID
                    'theme',                    // テーマ設定
                    'hasVisited',               // 初回訪問フラグ
                    'outputBrowserLayout',      // レイアウト設定
                    'comfyui_workflow_accordion_state:', // アコーディオン状態
                ];
                const shouldPreserve = (key) => preservePatterns.some(p => key === p || key.startsWith(p));

                localStorage.removeItem('simpleVideoState');
                // Also clear any other simpleVideo related keys, but preserve important ones
                const keysToRemove = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && (key.startsWith('simpleVideo') || key.startsWith('SimpleVideo'))) {
                        if (!shouldPreserve(key)) {
                            keysToRemove.push(key);
                        }
                    }
                }
                keysToRemove.forEach(k => localStorage.removeItem(k));
                console.log('[SimpleVideo] Cleared browser storage:', keysToRemove.length + 1, 'keys removed (preserved mode/session/theme)');
            } catch (e) {
                console.error('[SimpleVideo] Failed to clear storage:', e);
            }
            // Force reload to start fresh
            window.location.reload();
        });
    }

    const fpsInput = document.getElementById('simpleVideoFps');

    if (fpsInput) {
        fpsInput.addEventListener('input', () => {
            fpsInput.value = String(fpsInput.value ?? '').replace(/\D/g, '');
            SimpleVideoUI.state.fps = normalizeFps(fpsInput.value);
            if (SimpleVideoUI.state.fps !== fpsInput.value) fpsInput.value = SimpleVideoUI.state.fps;
            saveSimpleVideoState();
        });
    }
    
    // FLF quality select
    const flfQualitySelect = document.getElementById('simpleVideoFLFQuality');
    if (flfQualitySelect) {
        flfQualitySelect.addEventListener('change', (e) => {
            SimpleVideoUI.state.flfQuality = e.target.value;
            saveSimpleVideoState();
        });
    }
    
    // Key image upload (click / drag&drop)
    const keyArea = document.getElementById('simpleVideoKeyImage');
    if (keyArea) {
        let keyInputArmed = false;
        const delBtn = document.getElementById('simpleVideoKeyImageDelete');
        if (delBtn) {
            delBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (keyArea.classList.contains('uploading')) return;

                const hasKey = !!(SimpleVideoUI.state.keyImage || SimpleVideoUI.state.uploadedImage);
                if (!hasKey) return;

                clearKeyImage();
            });
        }

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*,video/*';
        input.style.display = 'none';
        keyArea.appendChild(input);

        input.addEventListener('change', async (e) => {
            if (!e?.isTrusted || !keyInputArmed) {
                input.value = '';
                keyInputArmed = false;
                return;
            }
            const file = input.files && input.files[0];
            input.value = '';
            keyInputArmed = false;
            if (!file) return;
            await uploadKeyImage(file);
        });

        keyArea.addEventListener('click', (e) => {
            if (!e?.isTrusted) return;
            if (e?.target && e.target.closest && e.target.closest('#simpleVideoKeyImageDelete')) return;
            keyInputArmed = true;
            input.click();
        });

        keyArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            keyArea.classList.add('drag-over');
        });
        keyArea.addEventListener('dragleave', () => {
            keyArea.classList.remove('drag-over');
        });
        keyArea.addEventListener('drop', async (e) => {
            if (!e?.isTrusted) return;
            e.preventDefault();
            keyArea.classList.remove('drag-over');
            const dt = e.dataTransfer;
            if (!dt) return;

            // 1) From Files panel
            const dropped = await getDroppedFileFromFilesPanel(dt);
            if (dropped) {
                keyInputArmed = false;
                await uploadKeyImage(dropped);
                return;
            }

            // 2) From OS
            const file = dt.files?.[0];
            if (!file) return;
            keyInputArmed = false;
            await uploadKeyImage(file);
        });
    }

    // M2V audio source upload (click / drag&drop)
    const m2vAudioDrop = document.getElementById('simpleVideoM2VAudioDrop');
    if (m2vAudioDrop) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'audio/*';
        input.style.display = 'none';
        m2vAudioDrop.appendChild(input);

        input.addEventListener('change', async () => {
            const file = input.files && input.files[0];
            input.value = '';
            if (!file) return;
            await uploadM2VAudioSource(file);
        });

        m2vAudioDrop.addEventListener('click', () => input.click());
        m2vAudioDrop.addEventListener('dragover', (e) => {
            e.preventDefault();
            m2vAudioDrop.classList.add('drag-over');
        });
        m2vAudioDrop.addEventListener('dragleave', () => {
            m2vAudioDrop.classList.remove('drag-over');
        });
        m2vAudioDrop.addEventListener('drop', async (e) => {
            e.preventDefault();
            m2vAudioDrop.classList.remove('drag-over');
            const dt = e.dataTransfer;
            if (!dt) return;

            const dropped = await getDroppedFileFromFilesPanel(dt);
            if (dropped) {
                await uploadM2VAudioSource(dropped);
                return;
            }

            const file = dt.files?.[0];
            if (!file) return;
            await uploadM2VAudioSource(file);
        });
    }

    // V2M video source upload (click / drag&drop)
    const v2mVideoDrop = document.getElementById('simpleVideoV2MVideoDrop');
    if (v2mVideoDrop) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'video/*';
        input.style.display = 'none';
        v2mVideoDrop.appendChild(input);

        input.addEventListener('change', async () => {
            const file = input.files && input.files[0];
            input.value = '';
            if (!file) return;
            await uploadV2MVideoSource(file);
        });

        v2mVideoDrop.addEventListener('click', () => input.click());
        v2mVideoDrop.addEventListener('dragover', (e) => {
            e.preventDefault();
            v2mVideoDrop.classList.add('drag-over');
        });
        v2mVideoDrop.addEventListener('dragleave', () => {
            v2mVideoDrop.classList.remove('drag-over');
        });
        v2mVideoDrop.addEventListener('drop', async (e) => {
            e.preventDefault();
            v2mVideoDrop.classList.remove('drag-over');
            const dt = e.dataTransfer;
            if (!dt) return;

            const dropped = await getDroppedFileFromFilesPanel(dt);
            if (dropped) {
                await uploadV2MVideoSource(dropped);
                return;
            }

            const file = dt.files?.[0];
            if (!file) return;
            await uploadV2MVideoSource(file);
        });
    }

    setupSimpleVideoOutputBrowser();

    // Drop slots (3)
    document.querySelectorAll('.simple-video-drop-slot').forEach((slotEl) => {
        const idx = Number(slotEl.dataset.slot);
        if (!Number.isFinite(idx) || idx < 0 || idx > 2) return;
        let slotInputArmed = false;

        const delBtn = slotEl.querySelector('.simple-video-drop-delete');
        if (delBtn) {
            delBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!SimpleVideoUI.state.dropSlots[idx]) return;
                if (!confirm(`画像${idx + 1}を削除しますか？`)) return;
                SimpleVideoUI.state.dropSlots[idx] = null;
                // dropSlots[0] deletion invalidates character composite
                if (idx === 0 && SimpleVideoUI.state.characterImage) {
                    console.log('[SimpleVideo] dropSlots[0] deleted: clearing stale character composite image');
                    SimpleVideoUI.state.characterImage = null;
                }
                saveSimpleVideoState();
                updateSimpleVideoUI();
            });
        }

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*,video/*';
        input.style.display = 'none';
        slotEl.appendChild(input);

        input.addEventListener('change', async (e) => {
            if (!e?.isTrusted || !slotInputArmed) {
                input.value = '';
                slotInputArmed = false;
                return;
            }
            const file = input.files && input.files[0];
            input.value = '';
            slotInputArmed = false;
            if (!file) return;
            await uploadDropSlot(idx, file);
        });

        slotEl.addEventListener('click', (e) => {
            if (!e?.isTrusted) return;
            if (e?.target && e.target.closest && e.target.closest('.simple-video-drop-delete')) return;
            slotInputArmed = true;
            input.click();
        });

        slotEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            slotEl.classList.add('drag-over');
        });
        slotEl.addEventListener('dragleave', () => {
            slotEl.classList.remove('drag-over');
        });
        slotEl.addEventListener('drop', async (e) => {
            if (!e?.isTrusted) return;
            e.preventDefault();
            slotEl.classList.remove('drag-over');
            const dt = e.dataTransfer;
            if (!dt) return;

            const dropped = await getDroppedFileFromFilesPanel(dt);
            if (dropped) {
                slotInputArmed = false;
                await uploadDropSlot(idx, dropped);
                return;
            }

            const file = dt.files?.[0];
            if (!file) return;
            slotInputArmed = false;
            await uploadDropSlot(idx, file);
        });
    });

    // Intermediate images (FLF)
    const midWrap = document.getElementById('simpleVideoIntermediateWrap');
    const midGrid = document.getElementById('simpleVideoIntermediateGrid');
    const midClearBtn = document.getElementById('simpleVideoIntermediateClearBtn');
    if (midWrap && midGrid) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*,video/*';
        input.style.display = 'none';
        midWrap.appendChild(input);

        let pendingIndex = null;
        input.addEventListener('change', async (e) => {
            if (!e?.isTrusted) return;
            const file = input.files && input.files[0];
            input.value = '';
            const idx = Number(pendingIndex);
            pendingIndex = null;
            if (!file) return;
            if (!Number.isFinite(idx) || idx < 0) return;
            await uploadIntermediateSceneImage(idx, file);
        });

        midGrid.addEventListener('click', (e) => {
            const videoRegenBtn = e?.target?.closest?.('.simple-video-intermediate-video-regen');
            if (videoRegenBtn) {
                e.preventDefault();
                e.stopPropagation();
                const idx = Number(videoRegenBtn.dataset.index);
                if (!Number.isFinite(idx) || idx < 0) return;
                regenerateSingleSceneVideo(idx);
                return;
            }

            const regenBtn = e?.target?.closest?.('.simple-video-intermediate-regen');
            if (regenBtn) {
                e.preventDefault();
                e.stopPropagation();
                const idx = Number(regenBtn.dataset.index);
                if (!Number.isFinite(idx) || idx < 0) return;
                regenerateIntermediateSceneImage(idx);
                return;
            }

            const delBtn = e?.target?.closest?.('.simple-video-intermediate-delete');
            if (delBtn) {
                e.preventDefault();
                e.stopPropagation();
                const idx = Number(delBtn.dataset.index);
                if (!Number.isFinite(idx) || idx < 0) return;
                if (!confirm(`初期画像 #${idx + 1} を削除しますか？`)) return;
                clearIntermediateSceneImage(idx);
                return;
            }

            const tile = e?.target?.closest?.('.simple-video-intermediate-tile');
            if (!tile) return;
            const idx = Number(tile.dataset.index);
            if (!Number.isFinite(idx) || idx < 0) return;
            
            // Check if image exists for this tile
            const inter = SimpleVideoUI.state.intermediateImages;
            const entry = inter?.images?.[idx];
            const imageUrl = getIntermediatePreviewUrl(entry);
            
            if (imageUrl) {
                // Show enlarged image in modal
                showSimpleVideoImageModal(imageUrl, `シーン #${idx + 1}`);
            } else {
                // No image - open file picker
                pendingIndex = idx;
                input.click();
            }
        });

        midGrid.addEventListener('dragover', (e) => {
            e.preventDefault();
            const tile = e?.target?.closest?.('.simple-video-intermediate-tile');
            if (tile) tile.classList.add('drag-over');
        });
        midGrid.addEventListener('dragleave', (e) => {
            const tile = e?.target?.closest?.('.simple-video-intermediate-tile');
            if (tile) tile.classList.remove('drag-over');
        });
        midGrid.addEventListener('drop', async (e) => {
            e.preventDefault();
            const tile = e?.target?.closest?.('.simple-video-intermediate-tile');
            if (tile) tile.classList.remove('drag-over');
            const idx = Number(tile?.dataset?.index);
            if (!Number.isFinite(idx) || idx < 0) return;

            const dt = e.dataTransfer;
            if (!dt) return;

            const dropped = await getDroppedFileFromFilesPanel(dt);
            if (dropped) {
                await uploadIntermediateSceneImage(idx, dropped);
                return;
            }

            const file = dt.files?.[0];
            if (!file) return;
            await uploadIntermediateSceneImage(idx, file);
        });
    }

    if (midClearBtn) {
        midClearBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (!SimpleVideoUI.state.intermediateImages) return;
            if (!confirm('中間画像をすべてクリアしますか？')) return;
            clearAllIntermediateImages();
        });
    }

    // Internal images preview (characterImage / preparedInitialImage / preparedVideoInitialImage)
    const internalImagesWrap = document.getElementById('simpleVideoInternalImagesWrap');
    if (internalImagesWrap) {
        const INTERNAL_IMAGE_LABELS = {
            characterImage:            'キャラクター合成画像',
            preparedInitialImage:      '準備済み初期画像',
            preparedVideoInitialImage: '準備済み動画初期フレーム',
            characterSheetImage:       'キャラクターシート',
        };

        internalImagesWrap.addEventListener('click', (e) => {
            // Clear individual image
            const clearBtn = e.target.closest('.simple-video-internal-image-clear');
            if (clearBtn) {
                e.preventDefault();
                const key = clearBtn.dataset.key;
                const label = INTERNAL_IMAGE_LABELS[key] || key;
                if (!confirm(`${label} をクリアしますか？`)) return;
                SimpleVideoUI.state[key] = null;
                saveSimpleVideoState();
                updateInternalImagesUI();
                updateGenerateButtonState();
                if (typeof showToast === 'function') showToast(`${label}をクリアしました`, 'info');
                return;
            }

            // "Use as reference" toggle — select characterImage or characterSheetImage as scene I2I reference
            const useRefBtn = e.target.closest('.simple-video-internal-image-use-ref');
            if (useRefBtn && !useRefBtn.classList.contains('static')) {
                e.preventDefault();
                const key = useRefBtn.dataset.key;
                SimpleVideoUI.state.useCharSheetAsRef = (key === 'characterSheetImage');
                saveSimpleVideoState();
                updateInternalImagesUI();
                const label = key === 'characterSheetImage' ? 'キャラクターシート' : 'キャラクター合成画像';
                if (typeof showToast === 'function') showToast(`シーンI2I参照: ${label} を使用します`, 'info');
                return;
            }

            // Click thumbnail -> enlarge
            const thumb = e.target.closest('.simple-video-internal-image-thumb-wrap');
            if (thumb) {
                const item = thumb.closest('.simple-video-internal-image-item');
                const key = item?.dataset?.key;
                if (!key) return;
                const v = SimpleVideoUI.state[key];
                if (!v) return;
                let imgUrl = v.previewUrl
                    || (v.jobId ? getSimpleVideoDownloadURL(v.jobId, v.filename) : getSimpleVideoInputImageURL(v.filename));
                if (imgUrl) {
                    const titleEl = item.querySelector('.simple-video-internal-image-label');
                    showSimpleVideoImageModal(imgUrl, titleEl?.textContent || '内部参照画像');
                }
            }
        });

        // Clear all button
        const internalClearAllBtn = document.getElementById('simpleVideoInternalImagesClearAll');
        if (internalClearAllBtn) {
            internalClearAllBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (!confirm('内部参照画像をすべてクリアしますか？')) return;
                SimpleVideoUI.state.characterImage = null;
                SimpleVideoUI.state.preparedInitialImage = null;
                SimpleVideoUI.state.preparedVideoInitialImage = null;
                SimpleVideoUI.state.characterSheetImage = null;
                saveSimpleVideoState();
                updateInternalImagesUI();
                updateGenerateButtonState();
                if (typeof showToast === 'function') showToast('内部参照画像をすべてクリアしました', 'info');
            });
        }
    }

    
    // Generate button
    const generateBtn = document.getElementById('simpleVideoGenerateBtn');
    if (generateBtn) {
        generateBtn.addEventListener('click', () => {
            startGeneration();
        });
    }

    const v2mBtn = document.getElementById('simpleVideoV2MBtn');
    if (v2mBtn) {
        v2mBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await startSimpleVideoVideoToMusic();
        });
    }

    // Prompt generate button
    const promptGenBtn = document.getElementById('simpleVideoPromptGenBtn');
    if (promptGenBtn) {
        promptGenBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await generateSimpleVideoPrompts();
        });
    }

    // Video initial-frame generation button -> Scene pre-generation button
    const videoInitBtn = document.getElementById('simpleVideoVideoInitImageBtn');
    if (videoInitBtn) {
        videoInitBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await startIntermediateImageGeneration();
        });
    }

    // Stop button (interrupt)
    const stopBtn = document.getElementById('simpleVideoStopBtn');
    if (stopBtn) {
        stopBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await requestSimpleVideoForceStop();
        });
    }

    // Left image-generate stop button (interrupt)
    const imageStopBtn = document.getElementById('simpleVideoImageStopBtn');
    if (imageStopBtn) {
        imageStopBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await requestSimpleVideoForceStop();
        });
    }

    const i2iDenoiseEl = document.getElementById('simpleVideoI2IDenoise');
    if (i2iDenoiseEl) {
        i2iDenoiseEl.addEventListener('change', () => {
            SimpleVideoUI.state.i2iDenoise = normalizeDenoise(i2iDenoiseEl.value, SimpleVideoUI.state.i2iDenoise);
            i2iDenoiseEl.value = String(SimpleVideoUI.state.i2iDenoise || '');
            saveSimpleVideoState();
        });
    }

    const i2iCfgEl = document.getElementById('simpleVideoI2ICfg');
    if (i2iCfgEl) {
        i2iCfgEl.addEventListener('change', () => {
            SimpleVideoUI.state.i2iCfg = normalizeCfg(i2iCfgEl.value, SimpleVideoUI.state.i2iCfg);
            i2iCfgEl.value = String(SimpleVideoUI.state.i2iCfg || '');
            saveSimpleVideoState();
        });
    }

    const i2iWfEl = document.getElementById('simpleVideoI2IWorkflow');
    if (i2iWfEl) {
        i2iWfEl.addEventListener('change', () => {
            if (SIMPLE_VIDEO_STANDALONE_CONFIG.lockI2IWorkflow !== false) {
                const fixedWorkflow = getConfiguredSimpleVideoWorkflow('i2i', 'qwen_i2i_2511_bf16_lightning4');
                SimpleVideoUI.state.i2iRefineWorkflow = fixedWorkflow;
                try { i2iWfEl.value = fixedWorkflow; } catch (_e) {}
                saveSimpleVideoState();
                updateSimpleVideoUI();
                return;
            }
            const v = String(i2iWfEl.value || 'auto');
            SimpleVideoUI.state.i2iRefineWorkflow = v || getConfiguredSimpleVideoWorkflow('i2i', 'qwen_i2i_2511_bf16_lightning4');
            saveSimpleVideoState();
            updateSimpleVideoUI();
        });
    }

    const i2iRoleEl = document.getElementById('simpleVideoI2IRefRole');
    if (i2iRoleEl) {
        i2iRoleEl.addEventListener('change', () => {
            SimpleVideoUI.state.i2iRefRole = normalizeI2IRefRole(i2iRoleEl.value);

            // When switching to mood/style preservation, default denoise to 0.70
            // (without clobbering user-tuned values).
            if (SimpleVideoUI.state.i2iRefRole === 'mood') {
                const current = normalizeDenoise(SimpleVideoUI.state.i2iDenoise, '0.900');
                if (!String(SimpleVideoUI.state.i2iDenoise ?? '').trim() || current === '0.90') {
                    SimpleVideoUI.state.i2iDenoise = '0.70';
                    const denoiseEl = document.getElementById('simpleVideoI2IDenoise');
                    if (denoiseEl) denoiseEl.value = '0.70';
                }
            }
            saveSimpleVideoState();
        });
    }
}

function normalizeI2IRefRole(value) {
    const v = String(value || '').trim().toLowerCase();
    if (v === 'mood') return 'mood';
    return 'character';
}

/**
 * Auto-determine i2iRefRole based on denoise value.
 * Boundary: 0.805
 * - denoise < 0.805 → 'mood' (reference image dominant = preserve mood/style)
 * - denoise >= 0.805 → 'character' (prompt dominant = change character)
 */
function getEffectiveI2IRefRole() {
    const denoise = parseFloat(SimpleVideoUI.state.i2iDenoise);
    if (Number.isFinite(denoise) && denoise < 0.805) {
        return 'mood';
    }
    return 'character';
}
function getEffectiveSceneCountForPromptGeneration() {
    const { state } = SimpleVideoUI;
    const explicit = Number(state.sceneCount);
    let count = (Number.isFinite(explicit) && explicit >= 1) ? Math.min(24, Math.max(1, Math.round(explicit))) : 3;

    // FLF-only presets need N+1 images (and thus N+1 prompts) to produce N FLF transition segments.
    // The extra prompt is for the "ending" image that serves as the end frame of the last FLF.
    const preset = VIDEO_PRESETS.find(p => p.id === state.selectedPreset);
    if (preset?.flfOnly) {
        count += 1;
    }

    return count;
}

function updateSimpleVideoDerivedTotalLength() {
    const { state } = SimpleVideoUI;
    const count = Number(state.sceneCount);
    const per = Number(state.sceneLengthSec);
    const totalEl = document.getElementById('simpleVideoTotalLengthDisplay');

    if (Number.isFinite(count) && count > 0 && Number.isFinite(per) && per > 0) {
        const total = Math.round(count * per);
        state.totalLengthSec = normalizeTotalLengthSec(total);
        if (totalEl) totalEl.textContent = `${total}秒`;
        return;
    }

    if (totalEl) totalEl.textContent = '-';
}

function pickPromptOutputTypeForPreset(preset) {
    // Full Auto uses a specialized prompt_type for FLF character video.
    const steps = Array.isArray(preset?.steps) ? preset.steps : [];
    const hasFLF = steps.some((s) => isFLFWorkflowId(s?.workflow));
    return hasFLF ? 'flf_sequence' : 'video';
}

function pickTargetWorkflowForPromptGeneration(preset) {
    const steps = Array.isArray(preset?.steps) ? preset.steps : [];
    const normalized = steps
        .map((s) => normalizeWorkflowAlias(s?.workflow))
        .filter(Boolean);

    const prefer = normalized.findLast?.((id) => isFLFWorkflowId(id))
        || normalized.findLast?.((id) => /i2v/i.test(id))
        || normalized.findLast?.((id) => /t2v/i.test(id));

    // Older browsers may not support findLast
    if (prefer) return prefer;

    for (let i = normalized.length - 1; i >= 0; i--) {
        const id = normalized[i];
        if (isFLFWorkflowId(id) || /i2v/i.test(id) || /t2v/i.test(id)) return id;
    }

    return normalized[normalized.length - 1] || null;
}

function extractPromptsFromPromptGenerateResult(payload) {
    const p = payload || {};

    // Common shapes
    const candidates = [
        p?.result?.prompts,
        p?.result?.result?.prompts,
        p?.generated_prompts,
        p?.result?.generated_prompts,
        p?.prompts,
        p?.result?.prompts_list,
    ];

    for (const c of candidates) {
        if (!Array.isArray(c) || c.length === 0) continue;
        if (typeof c[0] === 'string') return c.map((x) => String(x));
        if (c[0] && typeof c[0] === 'object' && (c[0].prompt || c[0].text)) {
            return c.map((x) => String(x.prompt || x.text || '')).filter((s) => s.trim().length > 0);
        }
    }

    return null;
}

async function generateSimpleVideoPrompts() {
    const { state } = SimpleVideoUI;

    if (state.isGenerating || state.isPromptGenerating) return;

    const scenarioPrompt = String(state.scenario || '').trim();
    if (!scenarioPrompt) {
        if (typeof showToast === 'function') showToast('シナリオを入力してください', 'warning');
        return;
    }

    const api = window.app?.api;
    if (!api || typeof api.generateUtility !== 'function' || typeof api.monitorProgress !== 'function') {
        if (typeof showToast === 'function') showToast('APIが利用できません（app.api.generateUtility/monitorProgress）', 'error');
        return;
    }

    const preset = VIDEO_PRESETS.find((p) => p.id === state.selectedPreset) || null;
    const sceneCount = getEffectiveSceneCountForPromptGeneration();
    const outputType = pickPromptOutputTypeForPreset(preset);
    const targetWorkflow = preset ? pickTargetWorkflowForPromptGeneration(preset) : null;
    // Map motionStrength to FLF motion level for prompt generation
    const flfMotionLevel = outputType === 'flf_sequence'
        ? (state.motionStrength || 'medium')
        : null;

    // If LLM prompt generation is disabled, just copy the scenario text as-is.
    if (!state.scenarioUseLLM) {
        const prompts = buildScenePromptsFromScenarioText({ scenarioText: scenarioPrompt, desiredCount: sceneCount });
        const formatted = prompts
            .map((p, i) => `#${i + 1}: ${String(p || '').trim()}`)
            .join('\n');

        state.llmPrompt = formatted;
        saveSimpleVideoState();

        const llmPromptEl = document.getElementById('simpleVideoLLMPrompt');
        if (llmPromptEl) llmPromptEl.value = formatted;

        const promptsWrap = document.getElementById('simpleVideoGeneratedPromptsWrap');
        if (promptsWrap) promptsWrap.style.display = '';

        setSimpleVideoProgressVisible(true);
        setSimpleVideoProgress('✅ シナリオをプロンプトにコピーしました', 1);
        if (typeof showToast === 'function') showToast('✅ シナリオをそのままコピーしました', 'success');
        updateGenerateButtonState();

        // Guide user if no preset is selected yet
        if (!state.selectedPreset) {
            setTimeout(() => {
                if (typeof showToast === 'function') showToast('⚙️ 「生成シーケンス」を選択してください', 'warning', 5000);
                nudgePresetSelector();
            }, 800);
        }
        return;
    }

    const promptGenBtn = document.getElementById('simpleVideoPromptGenBtn');
    if (promptGenBtn) {
        promptGenBtn.disabled = true;
        promptGenBtn.textContent = '⏳ 生成中...';
        promptGenBtn.style.opacity = '0.6';
    }

    const cancelSeqAtStart = Number(state.cancelSeq) || 0;
    state.isPromptGenerating = true;
    saveSimpleVideoState();
    updateGenerateButtonState();
    setSimpleVideoProgressVisible(true);
    setSimpleVideoProgress('🤖 プロンプト生成: 準備中...', 0);
    if (typeof showToast === 'function') showToast('🤖 シーンプロンプトを生成中...', 'info');

    let jobId = null;
    try {
        const requestBody = {
            workflow: 'prompt_generate',
            user_prompt: scenarioPrompt,
            scene_count: sceneCount,
            output_type: outputType,
            prompt_complexity: normalizePromptComplexity(state.promptComplexity),
            translation_mode: false,
        };
        if (targetWorkflow) requestBody.target_workflow = targetWorkflow;
        if (flfMotionLevel) requestBody.flf_motion_level = flfMotionLevel;

        const job = await api.generateUtility(requestBody);
        jobId = job?.job_id;
        if (!jobId) throw new Error('job_idが取得できません');

        state.activeJobId = String(jobId);
        saveSimpleVideoState();
        updateGenerateButtonState();

        const result = await new Promise((resolve, reject) => {
            let done = false;
            const finish = (fn) => (arg) => {
                if (done) return;
                done = true;
                fn(arg);
            };

            api.monitorProgress(
                jobId,
                (p) => {
                    if ((Number(state.cancelSeq) || 0) !== cancelSeqAtStart) {
                        try { api.closeWebSocket?.(jobId); } catch (_e) {}
                        finish(reject)(new Error('Cancelled'));
                        return;
                    }
                    const local = Number(p?.progress) || 0;
                    setSimpleVideoProgress(`🤖 プロンプト生成: ${p?.message || 'Processing...'}`, Math.min(1, Math.max(0, local)));
                },
                finish((data) => resolve(data)),
                finish((err) => reject(err))
            );
        });

        const prompts = extractPromptsFromPromptGenerateResult(result);
        if (!prompts || prompts.length === 0) {
            console.error('[SimpleVideo] prompt_generate raw result:', result);
            throw new Error('プロンプト生成結果の形式が不正です');
        }

        const formatted = prompts
            .map((p, i) => `#${i + 1}: ${String(p || '').trim()}`)
            .join('\n');

        state.llmPrompt = formatted;
        saveSimpleVideoState();

        const llmPromptEl = document.getElementById('simpleVideoLLMPrompt');
        if (llmPromptEl) llmPromptEl.value = formatted;

        const promptsWrap = document.getElementById('simpleVideoGeneratedPromptsWrap');
        if (promptsWrap) promptsWrap.style.display = '';

        setSimpleVideoProgress('✅ プロンプト生成完了', 1);
        if (typeof showToast === 'function') showToast(`✅ ${prompts.length}個のプロンプトを生成しました`, 'success');

        // Guide user if no preset is selected yet
        if (!state.selectedPreset) {
            setTimeout(() => {
                if (typeof showToast === 'function') showToast('⚙️ 「生成シーケンス」を選択してください', 'warning', 5000);
                nudgePresetSelector();
            }, 800);
        }
    } catch (err) {
        const msg = String(err?.message || err || 'Prompt generation failed');
        if (msg === 'Cancelled') {
            setSimpleVideoProgress('⏹ 中止しました', 0);
            if (typeof showToast === 'function') showToast('プロンプト生成を中止しました', 'warning');
        } else {
            console.error('[SimpleVideo] Prompt generation error:', err);
            setSimpleVideoProgress(`エラー: ${msg}`, 0);
            if (typeof showToast === 'function') showToast(`エラー: ${msg}`, 'error');
        }
    } finally {
        state.isPromptGenerating = false;
        if (jobId && String(state.activeJobId) === String(jobId)) {
            state.activeJobId = null;
        }
        saveSimpleVideoState();
        updateGenerateButtonState();

        if (promptGenBtn) {
            promptGenBtn.disabled = false;
            promptGenBtn.textContent = '🤖 プロンプト生成';
            promptGenBtn.style.opacity = '1';
        }
    }
}

async function requestSimpleVideoForceStop() {
    const { state } = SimpleVideoUI;
    // Mark cancel intent so in-flight steps can short-circuit.
    state.cancelSeq = (Number(state.cancelSeq) || 0) + 1;
    saveSimpleVideoState();
    updateGenerateButtonState();

    const api = window.app?.api;
    const jobId = state.activeJobId;

    // Local pause gate (CONTINUE待機) can have no active backend job.
    // In that case, stop should cancel the waiting pipeline locally.
    if (simpleVideoContinueGateActive && !jobId) {
        if (typeof simpleVideoContinueGateResolver === 'function') {
            const resolver = simpleVideoContinueGateResolver;
            simpleVideoContinueGateResolver = null;
            simpleVideoContinueGateActive = false;
            setSimpleVideoContinueGateVisible(false);
            try {
                resolver(false);
            } catch (_e) {}
        } else {
            simpleVideoContinueGateActive = false;
            setSimpleVideoContinueGateVisible(false);
        }

        // Ensure UI is immediately operable even if there is no in-flight job.
        state.isGenerating = false;
        state.isImageGenerating = false;
        state.isPromptGenerating = false;
        state.activeJobId = null;
        saveSimpleVideoState();
        updateGenerateButtonState();
        setSimpleVideoProgress('⏹ 停止しました', 0);
        if (typeof showToast === 'function') showToast('中間画像確認待機を停止しました', 'info');
        return;
    }

    try {
        if (!api || typeof api.interruptJob !== 'function') {
            if (typeof showToast === 'function') showToast('生成中止APIが利用できません（app.api.interruptJob）', 'error');
            return;
        }

        // If no active job id is known on frontend, fallback to server-side active interrupt.
        if (!jobId) {
            if (typeof api.interruptActiveJob === 'function') {
                setSimpleVideoProgress('⛔ 強制停止要求を送信中...', 0);
                await api.interruptActiveJob();
                if (typeof showToast === 'function') showToast('強制停止を要求しました（active interrupt）', 'warning');
            } else {
                if (typeof showToast === 'function') showToast('停止しました（次の処理を開始しません）', 'info');
                setSimpleVideoProgress('⏹ 停止要求（ジョブ未実行）', 0);
            }
            return;
        }

        try {
            api.closeWebSocket?.(jobId);
        } catch (_e) {}

        if (typeof showToast === 'function') showToast('強制停止を要求しました（interrupt）', 'warning');
        setSimpleVideoProgress('⛔ 強制停止要求を送信中...', 0);
        try {
            await api.interruptJob(jobId);
        } catch (jobInterruptError) {
            // Fallback for stale/missing job-id race on frontend.
            if (typeof api.interruptActiveJob === 'function') {
                await api.interruptActiveJob();
            } else {
                throw jobInterruptError;
            }
        }
    } catch (e) {
        const msg = String(e?.message || e || 'interrupt failed');
        if (typeof showToast === 'function') showToast(`強制停止要求に失敗: ${msg}`, 'error');
    }
}

async function startSimpleVideoT2AGeneration(options = {}) {
    if (!SimpleVideoUI.initialized) return false;
    const { state } = SimpleVideoUI;
    const fromAuto = !!options.fromAuto;
    const autoStage = options.autoStage || null;

    if (
        state.isGenerating
        || state.isPromptGenerating
        || state.isImageGenerating
        || state.t2aIsGenerating
        || state.t2aIsComposingLyrics
        || state.t2aIsSuggestingTags
        || (state.t2aIsAutoGenerating && !fromAuto)
    ) {
        if (typeof showToast === 'function') showToast('他の処理が実行中です。完了後に再実行してください', 'warning');
        return false;
    }

    const tags = String(state.t2aTags || '').trim();
    if (!tags) {
        if (typeof showToast === 'function') showToast('Tagsを入力してください', 'warning');
        updateSimpleVideoT2AButtonState();
        return false;
    }

    const api = window.app?.api;
    if (!api || typeof api.generate !== 'function' || typeof api.monitorProgress !== 'function' || typeof api.getJobStatus !== 'function') {
        if (typeof showToast === 'function') showToast('APIが利用できません（app.api.generate/monitorProgress/getJobStatus）', 'error');
        return false;
    }

    const aligned = buildMoodAlignedT2ASettings({
        scenarioText: state.scenario,
        imagePromptText: state.imagePrompt,
        lyricsText: state.t2aLyrics,
        tagsText: tags,
        keyscaleText: state.t2aKeyscale,
    });

    const parsedSeed = Number.parseInt(String(state.t2aSeed || '').trim(), 10);
    let effectiveSeed = Number.isFinite(parsedSeed) && parsedSeed > 0 ? parsedSeed : null;
    if (!effectiveSeed) {
        try {
            if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
                const arr = new Uint32Array(1);
                crypto.getRandomValues(arr);
                effectiveSeed = Number(arr[0] || 1);
            }
        } catch (_error) {}
    }
    if (!effectiveSeed) {
        effectiveSeed = Math.floor(Math.random() * 4294967295) + 1;
    }

    if (!(Number.isFinite(parsedSeed) && parsedSeed > 0)) {
        state.t2aSeed = String(effectiveSeed);
        const t2aSeedInput = document.getElementById('simpleVideoT2ASeed');
        if (t2aSeedInput) t2aSeedInput.value = state.t2aSeed;
    }

    const params = {
        workflow: 'ace_step_1_5_t2a',
        tags: normalizeAceStepCaptionTags(aligned.tags),
        lyrics: String(state.t2aLyrics || '').trim(),
        language: normalizeT2ALanguage(state.t2aLanguage),
        duration: Number(normalizeT2ANumber(state.t2aDuration, { fallback: 30, min: 1, max: 300, precision: 0 })),
        bpm: Number(normalizeT2ANumber(state.t2aBpm, { fallback: 120, min: 30, max: 240, precision: 0 })),
        timesignature: normalizeT2ATimeSignature(state.t2aTimesignature),
        keyscale: aligned.keyscale,
        steps: Number(normalizeT2ANumber(state.t2aSteps, { fallback: 8, min: 1, max: 200, precision: 0 })),
        seed: Number(effectiveSeed),
    };

    if (aligned.preferMajor) {
        console.log(`[SimpleVideo] T2A mood alignment: positive scenario detected (score=${aligned.polarityScore}), keyscale=${aligned.keyscale}, tags=${aligned.tags}`);
    }

    state.t2aIsGenerating = true;
    saveSimpleVideoState();
    updateGenerateButtonState();

    let success = false;
    let jobId = null;
    try {
        setSimpleVideoProgressVisible(true);
        if (autoStage) {
            setSimpleVideoT2AAutoStageProgress(autoStage, 0.03, '音楽生成を開始');
        } else {
            setSimpleVideoProgress('🎼 BGM生成: ジョブ送信中...', 0.03);
        }

        const job = await api.generate(params);
        jobId = String(job?.job_id || '');
        if (!jobId) throw new Error('job_idが取得できません');

        state.activeJobId = jobId;
        saveSimpleVideoState();

        await new Promise((resolve, reject) => {
            let done = false;
            const finish = (fn) => (arg) => {
                if (done) return;
                done = true;
                fn(arg);
            };

            api.monitorProgress(
                jobId,
                (progressData) => {
                    const local = Number(progressData?.progress) || 0;
                    const pct = Math.min(0.95, Math.max(0.05, local));
                    if (autoStage) {
                        setSimpleVideoT2AAutoStageProgress(autoStage, pct, `音楽生成 ${progressData?.message || 'Processing...'}`);
                    } else {
                        setSimpleVideoProgress(`🎼 BGM生成: ${progressData?.message || 'Processing...'}`, pct);
                    }
                },
                finish(() => resolve(true)),
                finish((error) => reject(error instanceof Error ? error : new Error(String(error))))
            );
        });

        const full = await api.getJobStatus(jobId);
        if (String(full?.status || '') !== 'completed') {
            const details = full?.error || full?.message || `status=${String(full?.status || 'unknown')}`;
            throw new Error(`BGM生成に失敗しました: ${details}`);
        }

        const outputs = Array.isArray(full?.result?.outputs) ? full.result.outputs : [];
        renderSimpleVideoT2AAudioOutput({
            jobId,
            outputs,
            title: 'ACE-Step 1.5 BGM'
        });

        if (autoStage) {
            setSimpleVideoT2AAutoStageProgress(autoStage, 1, '音楽生成 完了');
        } else {
            setSimpleVideoProgress('✅ BGM生成完了', 1);
        }
        if (typeof showToast === 'function') showToast('✅ BGMを生成しました', 'success');
        success = true;
    } catch (error) {
        const msg = String(error?.message || error || 'BGM generation failed');
        console.error('[SimpleVideo] T2A generation error:', error);
        if (autoStage) {
            setSimpleVideoT2AAutoStageProgress(autoStage, 1, `エラー: ${msg}`);
        } else {
            setSimpleVideoProgress(`エラー: ${msg}`, 0);
        }
        if (typeof showToast === 'function') showToast(msg, 'error');
    } finally {
        state.t2aIsGenerating = false;
        if (jobId && String(state.activeJobId || '') === String(jobId)) {
            state.activeJobId = null;
        }
        saveSimpleVideoState();
        updateGenerateButtonState();
    }
    return success;
}

function mapSimpleVideoT2ALanguageToLyricsLanguage(code) {
    const c = normalizeT2ALanguage(code);
    if (c === 'ja') return 'Japanese';
    if (c === 'zh') return 'Chinese';
    return 'English';
}

function scoreSimpleVideoScenarioPolarity(text) {
    const src = String(text || '').toLowerCase();
    if (!src.trim()) return 0;

    const positiveWords = [
        'happy', 'joy', 'hope', 'bright', 'sunny', 'smile', 'fun', 'celebrate', 'uplift', 'positive',
        '明る', '楽しい', '嬉しい', '希望', '爽やか', '元気', '前向き', '笑顔', '祝', '青春',
    ];
    const negativeWords = [
        'sad', 'dark', 'lonely', 'pain', 'sorrow', 'despair', 'fear', 'melancholy', 'cry', 'tragic',
        '暗い', '悲しい', '孤独', '不安', '絶望', '涙', '喪失', '苦しい', '寂しい', '陰鬱',
    ];

    let score = 0;
    for (const word of positiveWords) {
        if (src.includes(word)) score += 1;
    }
    for (const word of negativeWords) {
        if (src.includes(word)) score -= 1;
    }
    return score;
}

function toMajorKeyscaleIfNeeded(keyscale, shouldPreferMajor) {
    const norm = normalizeT2AKeyscale(keyscale);
    if (!shouldPreferMajor) return norm;

    const m = String(norm).match(/^([A-G]#?)\s+(major|minor)$/i);
    if (!m) return 'C major';
    const tonic = String(m[1] || 'C').toUpperCase();
    return `${tonic} major`;
}

function buildMoodAlignedT2ASettings({ scenarioText, imagePromptText, lyricsText, tagsText, keyscaleText }) {
    const mergedText = [scenarioText, imagePromptText, lyricsText]
        .map((v) => String(v || '').trim())
        .filter(Boolean)
        .join('\n');
    const score = scoreSimpleVideoScenarioPolarity(mergedText);
    const preferMajor = score >= 2;

    let nextTags = String(tagsText || '').trim();
    if (preferMajor) {
        const conflictWords = [
            'minor', 'sad', 'dark', 'melancholy', 'gloomy', 'depress',
            '切ない', '哀愁', '悲', '暗', '陰鬱',
        ];
        const rawTokens = nextTags
            .split(',')
            .map((v) => String(v || '').trim())
            .filter(Boolean);
        const filteredTokens = rawTokens.filter((token) => {
            const low = token.toLowerCase();
            return !conflictWords.some((w) => low.includes(w));
        });
        nextTags = filteredTokens.join(', ');

        const boosts = ['uplifting', 'bright', 'hopeful', 'warm'];
        for (const token of boosts) {
            const lower = nextTags.toLowerCase();
            if (!lower.includes(token)) {
                nextTags = nextTags ? `${nextTags}, ${token}` : token;
            }
        }
    }

    return {
        tags: nextTags,
        keyscale: toMajorKeyscaleIfNeeded(keyscaleText, preferMajor),
        preferMajor,
        polarityScore: score,
    };
}

function normalizeAceStepCaptionTags(tagsText) {
    const raw = String(tagsText || '').trim();
    if (!raw) return '';

    const keyPattern = /^[A-G](?:#|b)?\s*(major|minor)$/i;
    const forbiddenPatterns = [
        /\b\d{2,3}\s*bpm\b/i,
        /\btempo\b/i,
        /\b(?:2\/4|3\/4|4\/4|6\/8|5\/4|7\/8)\b/i,
        /\btime\s*signature\b/i,
        /\bkey\s*(?:of)?\s*[A-G](?:#|b)?\b/i,
        /\b(?:major\s+key|minor\s+key)\b/i,
    ];

    const sourceTokens = raw
        .split(',')
        .map((v) => String(v || '').trim())
        .filter(Boolean);

    const dedup = new Map();
    for (const token of sourceTokens) {
        const normalized = token.replace(/\s+/g, ' ').trim();
        if (!normalized) continue;
        if (keyPattern.test(normalized)) continue;
        if (forbiddenPatterns.some((pattern) => pattern.test(normalized))) continue;

        const low = normalized.toLowerCase();
        if (!dedup.has(low)) dedup.set(low, normalized);
    }

    const cleaned = Array.from(dedup.values()).slice(0, 14);
    if (cleaned.length === 0) return 'pop, emotional, cinematic, clean mix';
    return cleaned.join(', ');
}

function setSimpleVideoT2AAutoStageProgress(autoStage, innerProgress01, detail) {
    const stageIndex = Number(autoStage?.index);
    const stageTotal = Number(autoStage?.total);
    const stageLabel = String(autoStage?.label || '').trim() || `Step ${stageIndex}`;
    if (!Number.isFinite(stageIndex) || !Number.isFinite(stageTotal) || stageIndex < 1 || stageTotal < 1) {
        return;
    }

    const inner = Math.min(1, Math.max(0, Number(innerProgress01) || 0));
    const overall = ((stageIndex - 1) + inner) / stageTotal;
    const marks = Array.from({ length: stageTotal }, (_, i) => {
        if ((i + 1) < stageIndex) return '●';
        if ((i + 1) === stageIndex) return inner >= 0.999 ? '●' : '◐';
        return '○';
    }).join('');
    const suffix = String(detail || '').trim();
    const text = suffix
        ? `🚀 AUTO [${marks}] ${stageIndex}/${stageTotal} ${stageLabel}: ${suffix}`
        : `🚀 AUTO [${marks}] ${stageIndex}/${stageTotal} ${stageLabel}`;
    setSimpleVideoProgress(text, overall);
}

async function composeSimpleVideoT2ALyrics(options = {}) {
    if (!SimpleVideoUI.initialized) return false;
    const { state } = SimpleVideoUI;
    const fromAuto = !!options.fromAuto;
    const autoStage = options.autoStage || null;

    if (
        state.isGenerating
        || state.isPromptGenerating
        || state.isImageGenerating
        || state.t2aIsGenerating
        || state.t2aIsComposingLyrics
        || state.t2aIsSuggestingTags
        || (state.t2aIsAutoGenerating && !fromAuto)
    ) {
        if (typeof showToast === 'function') showToast('他の処理が実行中です。完了後に再実行してください', 'warning');
        return false;
    }

    const scenario = String(state.t2aScenario || '').trim()
        || String(state.scenario || '').trim()
        || String(state.imagePrompt || '').trim();
    if (!scenario) {
        if (typeof showToast === 'function') showToast('音楽シナリオ、動画シナリオ、または画像プロンプトを入力してください', 'warning');
        return false;
    }

    const api = window.app?.api;
    if (!api || typeof api.generateUtility !== 'function' || typeof api.monitorProgress !== 'function' || typeof api.getJobStatus !== 'function') {
        if (typeof showToast === 'function') showToast('APIが利用できません（app.api.generateUtility/monitorProgress/getJobStatus）', 'error');
        return false;
    }

    state.t2aIsComposingLyrics = true;
    saveSimpleVideoState();
    updateGenerateButtonState();

    let success = false;
    let jobId = null;
    try {
        setSimpleVideoProgressVisible(true);
        if (autoStage) {
            setSimpleVideoT2AAutoStageProgress(autoStage, 0.03, '作詞を開始');
        } else {
            setSimpleVideoProgress('🎼 作詞: ジョブ送信中...', 0.03);
        }

        const params = {
            workflow: 'lyrics_generate',
            scenario,
            genre: String(state.t2aTags || '').trim(),
            language: mapSimpleVideoT2ALanguageToLyricsLanguage(state.t2aLanguage),
            lyrics_target_duration: Number(normalizeT2ANumber(state.t2aDuration, { fallback: 30, min: 1, max: 300, precision: 0 }))
        };

        const job = await api.generateUtility(params);
        jobId = String(job?.job_id || '');
        if (!jobId) throw new Error('job_idが取得できません');

        state.activeJobId = jobId;
        saveSimpleVideoState();

        await new Promise((resolve, reject) => {
            let done = false;
            const finish = (fn) => (arg) => {
                if (done) return;
                done = true;
                fn(arg);
            };

            api.monitorProgress(
                jobId,
                (progressData) => {
                    const local = Number(progressData?.progress) || 0;
                    const pct = Math.min(0.95, Math.max(0.05, local));
                    if (autoStage) {
                        setSimpleVideoT2AAutoStageProgress(autoStage, pct, `作詞 ${progressData?.message || 'Processing...'}`);
                    } else {
                        setSimpleVideoProgress(`🎼 作詞: ${progressData?.message || 'Processing...'}`, pct);
                    }
                },
                finish(() => resolve(true)),
                finish((error) => reject(error instanceof Error ? error : new Error(String(error))))
            );
        });

        const full = await api.getJobStatus(jobId);
        if (String(full?.status || '') !== 'completed') {
            const details = full?.error || full?.message || `status=${String(full?.status || 'unknown')}`;
            throw new Error(`作詞に失敗しました: ${details}`);
        }

        const lyrics = String(full?.result?.lyrics || '').trim();
        if (!lyrics) throw new Error('歌詞が生成されませんでした');

        state.t2aLyrics = lyrics;
        saveSimpleVideoState();

        const lyricsInput = document.getElementById('simpleVideoT2ALyrics');
        if (lyricsInput) lyricsInput.value = state.t2aLyrics;
        const durationInput = document.getElementById('simpleVideoT2ADuration');
        if (durationInput) durationInput.value = String(state.t2aDuration || '30');

        if (autoStage) {
            setSimpleVideoT2AAutoStageProgress(autoStage, 1, '作詞 完了');
        } else {
            setSimpleVideoProgress('✅ 作詞完了', 1);
        }
        if (typeof showToast === 'function') showToast('✅ 歌詞を生成しました', 'success');
        success = true;
    } catch (error) {
        const msg = String(error?.message || error || 'Lyrics generation failed');
        console.error('[SimpleVideo] T2A lyrics compose error:', error);
        if (autoStage) {
            setSimpleVideoT2AAutoStageProgress(autoStage, 1, `エラー: ${msg}`);
        } else {
            setSimpleVideoProgress(`エラー: ${msg}`, 0);
        }
        if (typeof showToast === 'function') showToast(msg, 'error');
    } finally {
        state.t2aIsComposingLyrics = false;
        if (jobId && String(state.activeJobId || '') === String(jobId)) {
            state.activeJobId = null;
        }
        saveSimpleVideoState();
        updateGenerateButtonState();
    }
    return success;
}

async function suggestSimpleVideoT2ATags(options = {}) {
    if (!SimpleVideoUI.initialized) return false;
    const { state } = SimpleVideoUI;
    const fromAuto = !!options.fromAuto;
    const autoStage = options.autoStage || null;

    if (
        state.isGenerating
        || state.isPromptGenerating
        || state.isImageGenerating
        || state.t2aIsGenerating
        || state.t2aIsComposingLyrics
        || state.t2aIsSuggestingTags
        || (state.t2aIsAutoGenerating && !fromAuto)
    ) {
        if (typeof showToast === 'function') showToast('他の処理が実行中です。完了後に再実行してください', 'warning');
        return false;
    }

    const lyrics = String(state.t2aLyrics || '').trim();
    if (!lyrics) {
        if (typeof showToast === 'function') showToast('歌詞を入力してください', 'warning');
        return false;
    }

    const api = window.app?.api;
    if (!api || typeof api.generateUtility !== 'function' || typeof api.monitorProgress !== 'function' || typeof api.getJobStatus !== 'function') {
        if (typeof showToast === 'function') showToast('APIが利用できません（app.api.generateUtility/monitorProgress/getJobStatus）', 'error');
        return false;
    }

    state.t2aIsSuggestingTags = true;
    saveSimpleVideoState();
    updateGenerateButtonState();

    let success = false;
    let jobId = null;
    try {
        setSimpleVideoProgressVisible(true);
        if (autoStage) {
            setSimpleVideoT2AAutoStageProgress(autoStage, 0.03, 'タグ提案を開始');
        } else {
            setSimpleVideoProgress('🏷️ タグ提案: ジョブ送信中...', 0.03);
        }

        const job = await api.generateUtility({ workflow: 'lyrics_to_tags', lyrics });
        jobId = String(job?.job_id || '');
        if (!jobId) throw new Error('job_idが取得できません');

        state.activeJobId = jobId;
        saveSimpleVideoState();

        await new Promise((resolve, reject) => {
            let done = false;
            const finish = (fn) => (arg) => {
                if (done) return;
                done = true;
                fn(arg);
            };

            api.monitorProgress(
                jobId,
                (progressData) => {
                    const local = Number(progressData?.progress) || 0;
                    const pct = Math.min(0.95, Math.max(0.05, local));
                    if (autoStage) {
                        setSimpleVideoT2AAutoStageProgress(autoStage, pct, `タグ提案 ${progressData?.message || 'Processing...'}`);
                    } else {
                        setSimpleVideoProgress(`🏷️ タグ提案: ${progressData?.message || 'Processing...'}`, pct);
                    }
                },
                finish(() => resolve(true)),
                finish((error) => reject(error instanceof Error ? error : new Error(String(error))))
            );
        });

        const full = await api.getJobStatus(jobId);
        if (String(full?.status || '') !== 'completed') {
            const details = full?.error || full?.message || `status=${String(full?.status || 'unknown')}`;
            throw new Error(`タグ提案に失敗しました: ${details}`);
        }

        const genre = String(full?.result?.genre || '').trim();
        const tags = String(full?.result?.tags || '').trim();
        const merged = [genre, tags].filter(Boolean).join(', ').trim();
        if (!merged) throw new Error('タグ提案の結果が空でした');

        state.t2aTags = merged;
        saveSimpleVideoState();

        const tagsInput = document.getElementById('simpleVideoT2ATags');
        if (tagsInput) tagsInput.value = state.t2aTags;

        if (autoStage) {
            setSimpleVideoT2AAutoStageProgress(autoStage, 1, 'タグ提案 完了');
        } else {
            setSimpleVideoProgress('✅ タグ提案完了', 1);
        }
        if (typeof showToast === 'function') showToast('✅ タグを提案しました', 'success');
        success = true;
    } catch (error) {
        const msg = String(error?.message || error || 'Tags suggestion failed');
        console.error('[SimpleVideo] T2A tags suggestion error:', error);
        if (autoStage) {
            setSimpleVideoT2AAutoStageProgress(autoStage, 1, `エラー: ${msg}`);
        } else {
            setSimpleVideoProgress(`エラー: ${msg}`, 0);
        }
        if (typeof showToast === 'function') showToast(msg, 'error');
    } finally {
        state.t2aIsSuggestingTags = false;
        if (jobId && String(state.activeJobId || '') === String(jobId)) {
            state.activeJobId = null;
        }
        saveSimpleVideoState();
        updateGenerateButtonState();
    }
    return success;
}

async function autoGenerateSimpleVideoT2A() {
    if (!SimpleVideoUI.initialized) return;
    const { state } = SimpleVideoUI;
    if (
        state.isGenerating
        || state.isPromptGenerating
        || state.isImageGenerating
        || state.t2aIsGenerating
        || state.t2aIsComposingLyrics
        || state.t2aIsSuggestingTags
        || state.t2aIsAutoGenerating
    ) {
        if (typeof showToast === 'function') showToast('他の処理が実行中です。完了後に再実行してください', 'warning');
        return;
    }

    const hasTheme = !!String(state.t2aScenario || '').trim()
        || !!String(state.scenario || '').trim()
        || !!String(state.imagePrompt || '').trim();
    if (!hasTheme) {
        if (typeof showToast === 'function') showToast('音楽シナリオ、動画シナリオ、または画像プロンプトを入力してください', 'warning');
        return;
    }

    state.t2aIsAutoGenerating = true;
    saveSimpleVideoState();
    updateGenerateButtonState();

    try {
        setSimpleVideoProgressVisible(true);
        setSimpleVideoT2AAutoStageProgress({ index: 1, total: 3, label: '作詞' }, 0.01, '開始');

        const okLyrics = await composeSimpleVideoT2ALyrics({ fromAuto: true, autoStage: { index: 1, total: 3, label: '作詞' } });
        if (!okLyrics) throw new Error('作詞に失敗しました');

        setSimpleVideoT2AAutoStageProgress({ index: 2, total: 3, label: 'タグ提案' }, 0.01, '開始');
        const okTags = await suggestSimpleVideoT2ATags({ fromAuto: true, autoStage: { index: 2, total: 3, label: 'タグ提案' } });
        if (!okTags) throw new Error('タグ提案に失敗しました');

        setSimpleVideoT2AAutoStageProgress({ index: 3, total: 3, label: '音楽生成' }, 0.01, '開始');
        const okAudio = await startSimpleVideoT2AGeneration({ fromAuto: true, autoStage: { index: 3, total: 3, label: '音楽生成' } });
        if (!okAudio) throw new Error('音楽生成に失敗しました');

        setSimpleVideoT2AAutoStageProgress({ index: 3, total: 3, label: '音楽生成' }, 1, '完了');

        if (typeof showToast === 'function') showToast('✅ AUTO生成が完了しました', 'success');
    } catch (error) {
        const msg = String(error?.message || error || 'AUTO generation failed');
        console.error('[SimpleVideo] T2A AUTO generation error:', error);
        if (typeof showToast === 'function') showToast(`AUTO生成エラー: ${msg}`, 'error');
    } finally {
        state.t2aIsAutoGenerating = false;
        saveSimpleVideoState();
        updateGenerateButtonState();
    }
}

function getSimpleVideoCharacterToken(sel) {
    const token = String(sel?.token || sel?.name || '').trim();
    if (!token) return '';
    return token.startsWith('@') || token.startsWith('＠') ? token.replace(/^＠/, '@') : `@${token}`;
}

/**
 * Get URL for viewing an input image
 */
function getSimpleVideoInputImageURL(filename) {
    if (!filename) return '';
    const baseURL = window.app?.api?.baseURL || '';
    return `${baseURL}/view?filename=${encodeURIComponent(filename)}&type=input`;
}

/**
 * Expand @character tokens in prompt to their registered descriptions
 * For Qwen Image Edit, character tokens are typically expanded to descriptive text
 * @returns {Object} { expandedPrompt: string, characterImages: Array<{name, filename}> }
 */
async function expandCharacterTokensInPrompt(prompt) {
    if (!prompt || typeof prompt !== 'string') return { expandedPrompt: prompt, characterImages: [] };
    
    console.log('[expandCharacterTokens] Input prompt:', prompt);
    console.log('[expandCharacterTokens] Prompt char codes:', [...prompt.slice(0, 20)].map(c => c.charCodeAt(0).toString(16)));
    
    // Find all character token patterns including various quote styles
    // Supports: @token, 「token」, "token", "token", ""token"" (various quote types)
    // Note: Create new RegExp each time to avoid lastIndex issues
    // Also support mixed quotes - any combination of quote characters
    // Quote characters: " (U+0022), " (U+201C), " (U+201D), " (U+FF02)
    const tokenPatternDefs = [
        { re: /「([^」]+)」/g, desc: 'Japanese brackets' },           // 「キャラ名」
        { re: /[@＠]「([^」]+)」/g, desc: '@Japanese brackets' },     // @「キャラ名」
        // Universal quote pattern: any quote char, capture content, any quote char
        // Matches: "x", "x", "x", "x", "x", "x" and all other combinations
        { re: /[""\u201C\u201D]([^""\u201C\u201D]+)[""\u201C\u201D]/g, desc: 'any quotes' },
        { re: /[@＠][""\u201C\u201D]([^""\u201C\u201D]+)[""\u201C\u201D]/g, desc: '@any quotes' },
        { re: /[@＠]([^\s@＠,.<>「」""\u201C\u201D]+)/g, desc: '@token' } // @キャラ名
    ];
    
    // Collect all tokens with their original forms
    const tokenMatches = [];
    for (const { re, desc } of tokenPatternDefs) {
        // Reset lastIndex to ensure fresh matching
        re.lastIndex = 0;
        const matches = [...prompt.matchAll(re)];
        console.log(`[expandCharacterTokens] Pattern ${desc}: ${matches.length} matches`);
        for (const match of matches) {
            tokenMatches.push({
                original: match[0],           // Full match including @ and quotes
                name: match[1] || match[0].replace(/^[@＠]/, ''),  // Extracted name
                index: match.index
            });
        }
    }
    
    console.log('[expandCharacterTokens] Token matches:', tokenMatches);
    
    if (tokenMatches.length === 0) {
        console.log('[expandCharacterTokens] No token matches found');
        return { expandedPrompt: prompt, characterImages: [] };
    }
    
    // Fetch character registry if not cached
    if (!SimpleVideoUI.characterCache) {
        try {
            const api = window.app?.api;
            if (api && typeof api.listRefImages === 'function') {
                const data = await api.listRefImages();
                console.log('[expandCharacterTokens] Fetched character data:', data);
                // API returns { items: [...] } not { characters: [...] }
                if (Array.isArray(data?.items)) {
                    SimpleVideoUI.characterCache = data.items;
                } else if (Array.isArray(data?.characters)) {
                    SimpleVideoUI.characterCache = data.characters;
                }
            }
        } catch (e) {
            console.warn('[SimpleVideo] Failed to fetch character registry:', e);
        }
    }
    
    const characters = SimpleVideoUI.characterCache || [];
    if (characters.length === 0) return { expandedPrompt: prompt, characterImages: [] };
    
    // Sort by index descending to replace from end to start (avoids index shifting)
    tokenMatches.sort((a, b) => b.index - a.index);
    
    // Remove duplicates (same original string)
    const seen = new Set();
    const uniqueMatches = tokenMatches.filter(m => {
        if (seen.has(m.original)) return false;
        seen.add(m.original);
        return true;
    });
    
    console.log('[expandCharacterTokens] Characters in registry:', characters.map(c => ({ name: c.name, token: c.token, filename: c.filename })));
    
    let result = prompt;
    const characterImages = [];
    
    for (const tokenMatch of uniqueMatches) {
        const normalizedToken = tokenMatch.name.toLowerCase();
        console.log(`[expandCharacterTokens] Looking for token: "${normalizedToken}"`);
        
        // Find matching character
        const char = characters.find(c => {
            const charToken = String(c.token || c.name || '').toLowerCase().replace(/^[@＠]/, '');
            console.log(`[expandCharacterTokens]   Comparing with: "${charToken}"`);
            return charToken === normalizedToken;
        });
        
        if (char) {
            console.log(`[expandCharacterTokens] Found match:`, char);
            // DO NOT expand to description here - we will replace with Picture N later
            // Just collect character image filename for Picture N mapping
            
            // Collect character image filename if available
            if (char.filename) {
                characterImages.push({
                    name: char.name || tokenMatch.name,
                    filename: char.filename,
                    originalToken: tokenMatch.original
                });
                console.log(`[SimpleVideo] Found character image: ${char.name} -> ${char.filename} (token: ${tokenMatch.original})`);
            }
        }
    }
    
    // Note: We don't replace tokens here anymore - that's done in runCharacterImageGeneration
    // to correctly map to Picture N numbers
    return { expandedPrompt: result, characterImages };
}

/**
 * Expand @character tokens and ref1/ref2/ref3 in prompt for I2I workflows
 * Replaces @キャラ名 -> Picture N and ref1/ref2/ref3 -> Picture N
 * @param {Object} options
 * @param {string} options.prompt - Input prompt
 * @param {Array} options.dropSlots - Array of dropSlot objects with filename
 * @returns {Object} { expandedPrompt, characterImages, pictureMapping, refToPicture }
 */
async function expandCharacterTokensForI2I({ prompt, dropSlots }) {
    if (!prompt || typeof prompt !== 'string') {
        return { expandedPrompt: prompt || '', characterImages: [], pictureMapping: {}, refToPicture: {} };
    }
    
    console.log('[expandCharacterTokensForI2I] Input prompt:', prompt);
    
    // First, get character images using existing function
    const { expandedPrompt: basePrompt, characterImages } = await expandCharacterTokensInPrompt(prompt);
    
    let result = basePrompt;
    const pictureMapping = {}; // token -> Picture N
    const refToPicture = {};   // ref1/ref2/ref3 -> Picture N
    let nextPictureNum = 1;
    
    // Map character images to Picture numbers
    for (const charImg of characterImages) {
        if (charImg?.originalToken) {
            pictureMapping[charImg.originalToken] = nextPictureNum;
            console.log(`[expandCharacterTokensForI2I] Mapped ${charImg.originalToken} -> Picture ${nextPictureNum}`);
            nextPictureNum++;
        }
    }
    
    // Map dropSlots (ref1, ref2, ref3) to Picture numbers
    const slots = Array.isArray(dropSlots) ? dropSlots : [];
    for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (slot?.filename) {
            const refName = `ref${i + 1}`;
            refToPicture[refName] = nextPictureNum;
            console.log(`[expandCharacterTokensForI2I] Mapped ${refName} -> Picture ${nextPictureNum}`);
            nextPictureNum++;
        }
    }
    
    // Replace character tokens with Picture N (e.g., "ももちゃん" or "@ももちゃん" -> "Picture 1")
    for (const [token, pictureNum] of Object.entries(pictureMapping)) {
        const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(escapedToken, 'g'), `Picture ${pictureNum}`);
        console.log(`[expandCharacterTokensForI2I] Replaced ${token} -> Picture ${pictureNum}`);
    }
    
    // Replace ref1/ref2/ref3 with their actual Picture numbers
    for (const [ref, pictureNum] of Object.entries(refToPicture)) {
        result = result.replace(new RegExp(`\\b${ref}\\b`, 'gi'), `Picture ${pictureNum}`);
        console.log(`[expandCharacterTokensForI2I] Replaced ${ref} -> Picture ${pictureNum}`);
    }
    
    console.log('[expandCharacterTokensForI2I] Output prompt:', result);
    
    return { expandedPrompt: result, characterImages, pictureMapping, refToPicture };
}

function simpleVideoInsertTextIntoBestPrompt(text) {
    const insert = String(text || '');
    if (!insert) return;

    const imagePromptEl = document.getElementById('simpleVideoImagePrompt');
    const scenarioEl = document.getElementById('simpleVideoScenario');
    const t2aScenarioEl = document.getElementById('simpleVideoT2AScenario');

    const target = (SimpleVideoUI.lastPromptTarget === 'imagePrompt' ? imagePromptEl
        : (SimpleVideoUI.lastPromptTarget === 't2aScenario' ? t2aScenarioEl : scenarioEl))
        || scenarioEl
        || t2aScenarioEl
        || imagePromptEl;

    if (!target) return;

    const start = target.selectionStart || 0;
    const end = target.selectionEnd || 0;
    const before = target.value.slice(0, start);
    const after = target.value.slice(end);
    target.value = `${before}${insert}${after}`;
    const nextPos = start + insert.length;
    target.focus();
    try { target.setSelectionRange(nextPos, nextPos); } catch (_e) {}

    if (target === imagePromptEl) {
        SimpleVideoUI.state.imagePrompt = target.value;
    } else if (target === scenarioEl) {
        SimpleVideoUI.state.scenario = target.value;
    } else if (target === t2aScenarioEl) {
        SimpleVideoUI.state.t2aScenario = target.value;
    }
    saveSimpleVideoState();
}

async function renderSimpleVideoCharacters() {
    const statusEl = document.getElementById('simpleVideoCharactersStatus');
    const row = document.getElementById('simpleVideoCharactersRow');
    if (!row) return;

    const setStatus = (t) => { if (statusEl) statusEl.textContent = t || ''; };

    const reqId = (SimpleVideoUI.charactersReqSeq || 0) + 1;
    SimpleVideoUI.charactersReqSeq = reqId;

    row.innerHTML = '';
    setStatus('Loading...');

    if (!window.app?.api || typeof window.app.api.listRefImages !== 'function') {
        setStatus('N/A');
        row.innerHTML = '<div class="simple-video-hint">APIが利用できません（app.api.listRefImages）</div>';
        return;
    }

    try {
        const data = await window.app.api.listRefImages();
        if (reqId !== SimpleVideoUI.charactersReqSeq) return;

        const itemsRaw = Array.isArray(data?.items) ? data.items : [];

        const normalizeKey = (value) => {
            let key = String(value || '');
            key = key.replace(/^[@＠]/, '');
            try { key = key.normalize('NFKC'); } catch (_e) {}
            key = key.replace(/[\s\u200B-\u200D\uFEFF]/g, '');
            key = key.replace(/\.(png|jpg|jpeg|webp)$/i, '');
            key = key.trim().toLowerCase();
            return key;
        };

        const seen = new Set();
        const seenFiles = new Set();
        const items = [];
        for (const it of itemsRaw) {
            const rawName = it?.name || it?.token || '';
            const key = normalizeKey(rawName);
            const fileKey = String(it?.filename || '').trim().toLowerCase();
            if (!key) continue;
            if (seen.has(key)) continue;
            if (fileKey && seenFiles.has(fileKey)) continue;
            seen.add(key);
            if (fileKey) seenFiles.add(fileKey);
            items.push(it);
        }

        setStatus(items.length ? String(items.length) : '0');
        if (!items.length) {
            row.innerHTML = '<div class="simple-video-hint">キャラクタ登録がありません。左側の「📝 キャラクタ登録」から追加してください。</div>';
            return;
        }

        row.innerHTML = '';
        for (const item of items) {
            const token = getSimpleVideoCharacterToken({ token: item.token, name: item.name });
            const previewUrl = (typeof window.app.api.getRefImagePreviewURL === 'function')
                ? window.app.api.getRefImagePreviewURL(item.preview_url)
                : (item.preview_url || '');

            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'simple-video-character-chip';
            chip.title = token;
            chip.dataset.token = token;
            chip.style.marginRight = '16px';
            chip.style.marginBottom = '12px';
            chip.innerHTML = `
                <img src="${previewUrl || ''}" alt="${token}" loading="lazy" decoding="async" style="width:72px;height:72px;max-width:72px;max-height:72px;object-fit:cover;border-radius:8px;background:rgba(0,0,0,0.22);" />
                <div class="simple-video-character-token">${token}</div>
            `;
            chip.addEventListener('click', () => {
                const prev = SimpleVideoUI.state.selectedCharacter;
                SimpleVideoUI.state.selectedCharacter = {
                    name: item.name || token,
                    token,
                    previewUrl,
                    filename: item.filename || null,
                    original_filename: item.original_filename || null,
                };

                // If character changed, old composite image is stale
                if (prev?.token !== token && SimpleVideoUI.state.characterImage) {
                    console.log('[SimpleVideo] Character changed: clearing stale character composite image');
                    SimpleVideoUI.state.characterImage = null;
                }

                saveSimpleVideoState();
                updateSimpleVideoUI();
                updateGenerateButtonState();

                const insert = `${token} `;
                simpleVideoInsertTextIntoBestPrompt(insert);
            });
            row.appendChild(chip);
        }

        // Apply selection highlight
        const selectedToken = getSimpleVideoCharacterToken(SimpleVideoUI.state.selectedCharacter);
        if (selectedToken) {
            row.querySelectorAll('.simple-video-character-chip').forEach((el) => {
                el.classList.toggle('selected', String(el.dataset.token || '') === selectedToken);
            });
        }
    } catch (err) {
        console.error('[SimpleVideo] list ref images error:', err);
        setStatus('ERR');
        row.innerHTML = '<div class="simple-video-hint">キャラクタ一覧の取得に失敗しました</div>';
    }
}

async function uploadKeyImage(file) {
    if (!SimpleVideoUI.initialized) return;
    const keyArea = document.getElementById('simpleVideoKeyImage');
    try {
        if (!file) return;

        const kind = inferMediaKindFromFile(file);
        if (kind !== 'image' && kind !== 'video') {
            if (typeof showToast === 'function') showToast('画像または動画ファイルを選択してください', 'warning');
            return;
        }

        // Key image changed: any prepared initial frame for video generation is no longer reliable.
        if (SimpleVideoUI.state.preparedVideoInitialImage) {
            SimpleVideoUI.state.preparedVideoInitialImage = null;
        }

        // Key image changed: intermediate images are no longer reliable.
        if (SimpleVideoUI.state.intermediateImages) {
            SimpleVideoUI.state.intermediateImages = null;
        }

        if (keyArea) {
            keyArea.classList.add('uploading');
        }

        // If a video is provided, extract its last frame as an image and upload that
        let fileToUpload = file;
        if (kind === 'video') {
            if (typeof showToast === 'function') showToast('動画から最終フレームを抽出中...', 'info');
            fileToUpload = await extractLastFrameAsImageFile(file);
        }

        const uploaded = await uploadSimpleVideoFile(fileToUpload);

        const base = getSimpleVideoBaseURL();
        const filename = uploaded?.filename;
        if (!filename) throw new Error('Upload response missing filename');
        const previewUrl = `${base}/api/v1/files/${encodeURIComponent(filename)}`;

        SimpleVideoUI.state.keyImage = { filename, originalName: fileToUpload.name, previewUrl };
        SimpleVideoUI.state.uploadedImage = SimpleVideoUI.state.keyImage;

        // Key image changed → old character composite is stale
        if (SimpleVideoUI.state.characterImage) {
            console.log('[SimpleVideo] Key image changed: clearing stale character composite image');
            SimpleVideoUI.state.characterImage = null;
        }

        saveSimpleVideoState();
        updateSimpleVideoUI();
        updateGenerateButtonState();
        if (typeof showToast === 'function') showToast('キー画像をアップロードしました', 'success');
    } catch (err) {
        console.error('[SimpleVideo] Key image upload failed:', err);
        if (typeof showToast === 'function') showToast('アップロードに失敗しました', 'error');
    } finally {
        if (keyArea) {
            keyArea.classList.remove('uploading');
        }
    }
}

async function getDroppedFileFromFilesPanel(dataTransfer) {
    const payload = dataTransfer?.getData?.('application/x-comfyui-file');
    if (!payload) return null;

    let info;
    try {
        info = JSON.parse(payload);
    } catch (_e) {
        return null;
    }

    const type = String(info?.type || '');
    const url = String(info?.url || '');
    const filename = String(info?.filename || info?.path || '');
    if (!url) return null;
    if (type !== 'image' && type !== 'video') return null;

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`);
    const blob = await resp.blob();
    const inferredExt = type === 'video' ? '.mp4' : '.png';
    const safeName = filename || `dropped${inferredExt}`;
    return new File([blob], safeName, { type: blob.type || (type === 'video' ? 'video/mp4' : 'image/png') });
}

async function uploadDropSlot(index, file) {
    if (!SimpleVideoUI.initialized) return;
    const slotEl = document.querySelector(`.simple-video-drop-slot[data-slot="${index}"]`);
    try {
        if (!file) return;

        const kind = inferMediaKindFromFile(file);
        if (kind !== 'image' && kind !== 'video') {
            if (typeof showToast === 'function') showToast('画像または動画ファイルを選択してください', 'warning');
            return;
        }

        if (slotEl) slotEl.classList.add('uploading');

        // If video is dropped into an image slot, use its last frame as the preview image
        const displayName = file.name;
        let fileToUpload = file;
        if (kind === 'video') {
            if (typeof showToast === 'function') showToast('動画から最終フレームを抽出中...', 'info');
            fileToUpload = await extractLastFrameAsImageFile(file);
        }

        const uploaded = await uploadSimpleVideoFile(fileToUpload);

        const base = getSimpleVideoBaseURL();
        const filename = uploaded?.filename;
        if (!filename) throw new Error('Upload response missing filename');
        const previewUrl = `${base}/api/v1/files/${encodeURIComponent(filename)}`;

        // We always preview an image in the slot UI.
        SimpleVideoUI.state.dropSlots[index] = { kind: 'image', filename, originalName: displayName, previewUrl };

        // dropSlots[0] is the reference image for char_edit presets; if it changes, composite is stale
        if (index === 0 && SimpleVideoUI.state.characterImage) {
            console.log('[SimpleVideo] dropSlots[0] changed: clearing stale character composite image');
            SimpleVideoUI.state.characterImage = null;
        }

        saveSimpleVideoState();
        updateSimpleVideoUI();
        if (typeof showToast === 'function') showToast(`画像${index + 1}をアップロードしました`, 'success');
    } catch (err) {
        console.error('[SimpleVideo] Drop slot upload failed:', err);
        if (typeof showToast === 'function') showToast('アップロードに失敗しました', 'error');
    } finally {
        if (slotEl) slotEl.classList.remove('uploading');
    }
}

function clearKeyImage() {
    SimpleVideoUI.state.keyImage = null;
    SimpleVideoUI.state.uploadedImage = null;

    // Clearing key image invalidates any prepared video-initial frame.
    SimpleVideoUI.state.preparedVideoInitialImage = null;

    // Clearing key image also invalidates intermediate images.
    SimpleVideoUI.state.intermediateImages = null;

    // Character composite is derived from key image, so clear it too.
    SimpleVideoUI.state.characterImage = null;
    saveSimpleVideoState();
    updateSimpleVideoUI();
    updateGenerateButtonState();
    if (typeof showToast === 'function') showToast('キー画像を削除しました', 'info');
}

function getSimpleVideoDownloadURL(jobId, filename) {
    if (!jobId || !filename) return '';
    if (window.app?.api?.getDownloadURL) return window.app.api.getDownloadURL(jobId, filename);
    const baseUrl = (window.app && window.app.api && window.app.api.baseURL) ? window.app.api.baseURL : '';
    if (!baseUrl) return '';
    return `${baseUrl}/api/v1/download/${encodeURIComponent(String(jobId))}/${String(filename)
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/')}`;
}

function ensureIntermediateImagesState({ presetId, desiredCount, scenarioFingerprint, skipFingerprintInvalidate = false }) {
    const pid = String(presetId || '').trim();
    if (!pid) return null;
    const count = Math.max(1, Number(desiredCount) || 1);
    const fp = String(scenarioFingerprint || '').trim();

    const cur = SimpleVideoUI.state.intermediateImages;
    if (!cur || String(cur.presetId || '') !== pid || !Array.isArray(cur.images)) {
        SimpleVideoUI.state.intermediateImages = { presetId: pid, images: Array(count).fill(null), scenarioFingerprint: fp };
        return SimpleVideoUI.state.intermediateImages;
    }

    // If scenario fingerprint changed, clear auto-generated images (keep user-uploaded ones)
    if (fp && String(cur.scenarioFingerprint || '') !== fp) {
        if (skipFingerprintInvalidate) {
            console.log(`[SimpleVideo] Scenario changed, but preserving existing intermediate images for targeted regeneration (${String(cur.scenarioFingerprint || '').slice(0, 20)}... → ${fp.slice(0, 20)}...)`);
            cur.scenarioFingerprint = fp;
        } else {
            console.log(`[SimpleVideo] Scenario changed (fingerprint: ${String(cur.scenarioFingerprint || '').slice(0, 20)}... → ${fp.slice(0, 20)}...): clearing generated intermediate images`);
            for (let i = 0; i < cur.images.length; i++) {
                if (cur.images[i] && cur.images[i].source !== 'uploaded') {
                    cur.images[i] = null;
                }
            }
            cur.scenarioFingerprint = fp;
        }
    }

    if (cur.images.length !== count) {
        const next = Array(count).fill(null);
        for (let i = 0; i < Math.min(count, cur.images.length); i++) next[i] = cur.images[i] || null;
        cur.images = next;
    }

    return cur;
}

/**
 * Compute a simple fingerprint from scenario text + scene prompts for cache invalidation.
 * @param {string} scenario - The scenario text
 * @param {string[]} scenePrompts - Array of scene prompts
 * @returns {string}
 */
function computeScenarioFingerprint(scenario, scenePrompts) {
    const parts = [String(scenario || '').trim()];
    if (Array.isArray(scenePrompts)) {
        parts.push(...scenePrompts.map(p => String(p || '').trim()));
    }
    const raw = parts.join('|||');
    // Simple hash: djb2
    let hash = 5381;
    for (let i = 0; i < raw.length; i++) {
        hash = ((hash << 5) + hash + raw.charCodeAt(i)) | 0;
    }
    return 'fp_' + (hash >>> 0).toString(36) + '_' + raw.length;
}

function hasCompleteIntermediateImagesForPreset({ presetId, desiredCount }) {
    const pid = String(presetId || '').trim();
    const count = Math.max(1, Number(desiredCount) || 1);
    // FLF-only presets need N+1 images; caller should already pass the correct desiredCount.
    const cur = SimpleVideoUI.state.intermediateImages;
    if (!cur || String(cur.presetId || '') !== pid || !Array.isArray(cur.images)) return false;
    if (cur.images.length < count) return false;
    for (let i = 0; i < count; i++) {
        const entry = cur.images[i];
        if (!entry || !String(entry.filename || '').trim()) return false;
    }
    return true;
}

function getIntermediatePreviewUrl(entry) {
    if (!entry) return '';
    const previewUrl = String(entry.previewUrl || '').trim();
    if (previewUrl) return previewUrl;
    const jobId = String(entry.jobId || '').trim();
    const filename = String(entry.filename || '').trim();
    if (jobId && filename) return getSimpleVideoDownloadURL(jobId, filename);
    return '';
}

function clearIntermediateSceneImage(index) {
    const idx = Number(index);
    if (!Number.isFinite(idx) || idx < 0) return;
    const cur = SimpleVideoUI.state.intermediateImages;
    if (!cur || !Array.isArray(cur.images)) return;
    if (idx >= cur.images.length) return;
    cur.images[idx] = null;
    saveSimpleVideoState();
    updateSimpleVideoUI();
    updateGenerateButtonState();
}

async function regenerateIntermediateSceneImage(index) {
    const idx = Number(index);
    if (!Number.isFinite(idx) || idx < 0) return;

    const { state } = SimpleVideoUI;
    const gateEditingAllowed = !!(simpleVideoContinueGateActive && state.isGenerating && !state.isPromptGenerating && !state.isImageGenerating);
    if ((state.isGenerating || state.isPromptGenerating || state.isImageGenerating) && !gateEditingAllowed) {
        if (typeof showToast === 'function') showToast('他の処理が実行中です。完了後に再実行してください', 'warning');
        return;
    }

    const preset = VIDEO_PRESETS.find((p) => p.id === state.selectedPreset) || null;
    const isFLFPreset = String(preset?.id || '') === 'char_i2i_flf' || String(preset?.id || '') === 'char_edit_i2i_flf' || String(preset?.id || '') === 'char_edit_i2v_scene_cut';
    const isSupported = !!preset && (isFLFPreset || !!preset.supportsPregenerateImages);
    if (!isSupported) {
        if (typeof showToast === 'function') showToast('このプリセットはシーン画像の単体再生成に対応していません', 'warning');
        return;
    }

    // Check whether the scene prompt has changed since the image was last generated.
    const inter = state.intermediateImages;
    const existingEntry = Array.isArray(inter?.images) ? (inter.images[idx] || null) : null;
    if (existingEntry?.filename && typeof existingEntry.rawPrompt === 'string') {
        const currentScenePrompts = parseScenePromptsFromText(state.llmPrompt);
        const currentRaw = String(currentScenePrompts[idx] || '').trim();
        const storedRaw = String(existingEntry.rawPrompt || '').trim();
        if (currentRaw && storedRaw && currentRaw === storedRaw) {
            const proceed = confirm(
                `⚠️ シーン #${idx + 1} のプロンプトが前回の生成から変更されていません。

「シーンごとのプロンプト」を編集すれば、別の画像を生成できます。

このまま再生成しますか？`
            );
            if (!proceed) return;
        } else {
            if (!confirm(`シーン画像 #${idx + 1} を再生成しますか？`)) return;
        }
    } else {
        if (!confirm(`シーン画像 #${idx + 1} を再生成しますか？`)) return;
    }

    await startIntermediateImageGeneration({ forceSceneIndexes: [idx] });
}

async function regenerateSingleSceneVideo(index) {
    const idx = Number(index);
    if (!Number.isFinite(idx) || idx < 0) return;

    const { state } = SimpleVideoUI;
    if (state.isGenerating || state.isPromptGenerating || state.isImageGenerating) {
        if (typeof showToast === 'function') showToast('他の処理が実行中です。完了後に再実行してください', 'warning');
        return;
    }

    const preset = VIDEO_PRESETS.find((p) => p.id === state.selectedPreset) || null;
    if (!preset) {
        if (typeof showToast === 'function') showToast('生成シーケンスを選択してください', 'warning');
        return;
    }

    const inter = state.intermediateImages;
    const images = Array.isArray(inter?.images) ? inter.images : [];
    const entry = images[idx];
    if (!entry || !String(entry.filename || '').trim()) {
        if (typeof showToast === 'function') showToast(`シーン #${idx + 1} の中間画像がありません`, 'warning');
        return;
    }

    if (!confirm(`シーン動画 #${idx + 1} を再生成しますか？`)) return;

    state.isImageGenerating = true;
    saveSimpleVideoState();
    updateGenerateButtonState();

    try {
        const cancelSeqAtStart = Number(state.cancelSeq) || 0;
        const scenePrompts = await determineScenePromptsForCurrentSimpleVideoRun({
            preset,
            cancelSeqAtStart,
            allowLLMGeneration: false,
        });
        const { width, height } = getEffectiveWH();

        const effectiveSteps = getEffectivePresetStepsForCurrentOptions(preset);
        const hasFLF = !!preset.flfOnly || effectiveSteps.some((s) => isFLFWorkflowId(s?.workflow));

        if (hasFLF) {
            const flfWorkflow = state.flfQuality === 'quality' ? 'wan22_flf2v' : 'wan22_smooth_first2last';
            const fpsRaw = Number(state.fps);
            const fallbackFps = getDefaultFpsForVideoWorkflow(flfWorkflow);
            const effectiveFps = (Number.isFinite(fpsRaw) && fpsRaw > 0) ? Math.round(fpsRaw) : fallbackFps;
            const frames = computeLTXFrames(state.sceneLengthSec, effectiveFps);
            const segmentIndexes = [];
            if (idx > 0) segmentIndexes.push(idx - 1);
            if (idx < images.length - 1) segmentIndexes.push(idx);

            if (segmentIndexes.length === 0) {
                throw new Error(`FLF再生成対象がありません（#${idx + 1} は端点で遷移区間を構成できません）`);
            }

            let lastRes = null;
            for (const segIdx of segmentIndexes) {
                const start = images[segIdx];
                const end = images[segIdx + 1];
                if (!start || !String(start.filename || '').trim() || !end || !String(end.filename || '').trim()) {
                    throw new Error(`FLF再生成に必要な画像が不足しています（#${segIdx + 1}→#${segIdx + 2}）`);
                }

                const basePrompt = String(scenePrompts[segIdx] || '').trim();
                const endPrompt = String(scenePrompts[segIdx + 1] || '').trim();
                const flfPrompt = composeFLFPromptWithEndIntent(basePrompt, endPrompt, state.flfEndConstraintEnabled !== false);

                const params = {
                    prompt: flfPrompt,
                    input_image_start: String(start.filename),
                    input_image_end: String(end.filename),
                    fps: effectiveFps,
                };
                if (Number.isFinite(frames) && frames > 0) params.frames = frames;
                if (width && height) {
                    params.width = width;
                    params.height = height;
                }

                const res = await runWorkflowStep({
                    workflow: flfWorkflow,
                    label: `S${segIdx + 1}→S${segIdx + 2} FLF再生成`,
                    requestParams: params,
                    stepIndex: segmentIndexes.indexOf(segIdx),
                    totalSteps: segmentIndexes.length,
                });
                lastRes = res;

                const videoOut = pickBestOutput(res.outputs, 'video');
                const videoBase = videoOut?.filename ? String(videoOut.filename).split('/').pop() : '';
                if (!videoBase) throw new Error(`FLF再生成動画が取得できません（#${segIdx + 1}→#${segIdx + 2}）`);

                setSceneVideoBasenameAtIndex({
                    presetId: preset.id,
                    index: segIdx,
                    basename: videoBase,
                });
            }

            if (lastRes) {
                renderSimpleVideoOutputMedia({
                    jobId: lastRes.jobId,
                    outputs: lastRes.outputs,
                    title: `シーン動画 #${idx + 1}`,
                });
            }
        } else {
            const i2vStep = effectiveSteps.find((s) => isI2VWorkflowId(s?.workflow));
            const i2vWorkflow = i2vStep ? normalizeWorkflowAlias(i2vStep.workflow) : applyWorkflowSpeedOption('wan22_i2v_lightning', !!state.useFast);

            const fpsRaw = Number(state.fps);
            const fallbackFps = getDefaultFpsForVideoWorkflow(i2vWorkflow);
            const effectiveFps = (Number.isFinite(fpsRaw) && fpsRaw > 0) ? Math.round(fpsRaw) : fallbackFps;
            const frames = computeLTXFrames(state.sceneLengthSec, effectiveFps);

            const params = {
                prompt: String(scenePrompts[idx] || state.scenario || '').trim(),
                input_image: String(entry.filename),
                fps: effectiveFps,
            };
            if (Number.isFinite(frames) && frames > 0) params.frames = frames;
            if (String(i2vWorkflow || '').startsWith('ltx2_')) {
                params.strip_audio = !state.generateAudio;
            }

            if (width && height) {
                params.width = width;
                params.height = height;
            }

            const res = await runWorkflowStep({
                workflow: i2vWorkflow,
                label: `S${idx + 1} シーン動画再生成`,
                requestParams: params,
                stepIndex: 0,
                totalSteps: 1,
            });

            renderSimpleVideoOutputMedia({
                jobId: res.jobId,
                outputs: res.outputs,
                title: `シーン動画 #${idx + 1}`,
            });

            const videoOut = pickBestOutput(res.outputs, 'video');
            const videoBase = videoOut?.filename ? String(videoOut.filename).split('/').pop() : '';
            if (!videoBase) throw new Error('再生成動画ファイル名が取得できませんでした');

            setSceneVideoBasenameAtIndex({
                presetId: preset.id,
                index: idx,
                basename: videoBase,
            });
        }

        let concatDone = false;
        try {
            await runSceneVideosConcatFromState({
                presetId: preset.id,
                title: '結合結果（単体再生成反映）',
            });
            concatDone = true;
        } catch (concatErr) {
            console.warn('[SimpleVideo] concat after single-scene regen skipped:', concatErr);
            if (typeof showToast === 'function') {
                showToast(`単体再生成は完了（再結合はスキップ: ${String(concatErr?.message || concatErr || 'unknown')})`, 'warning');
            }
        }

        if (concatDone && typeof showToast === 'function') {
            showToast(`シーン動画 #${idx + 1} を再生成し、再結合しました`, 'success');
        }
    } catch (err) {
        console.error('[SimpleVideo] regenerate single scene video failed:', err);
        if (typeof showToast === 'function') showToast(String(err?.message || err || 'シーン動画再生成に失敗しました'), 'error');
    } finally {
        state.isImageGenerating = false;
        state.activeJobId = null;
        saveSimpleVideoState();
        updateGenerateButtonState();
    }
}

/**
 * Show image in a modal overlay (click to enlarge feature)
 * @param {string} imageUrl - URL of the image to display
 * @param {string} title - Title to show above the image
 */
function showSimpleVideoMediaModal({ mediaType = 'image', mediaUrl, title = '' } = {}) {
    const url = String(mediaUrl || '').trim();
    if (!url) return;

    const existingModal = document.querySelector('.simple-video-media-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.className = 'simple-video-media-modal';
    modal.style.cssText = [
        'position:fixed',
        'inset:0',
        'background:rgba(0,0,0,0.9)',
        'z-index:10000',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'padding:24px',
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
        'position:relative',
        'max-width:92vw',
        'max-height:88vh',
        'display:flex',
        'flex-direction:column',
        'align-items:center',
        'gap:10px',
    ].join(';');

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.style.cssText = [
        'position:absolute',
        'top:-10px',
        'right:-10px',
        'width:34px',
        'height:34px',
        'border:none',
        'border-radius:999px',
        'background:rgba(0,0,0,0.7)',
        'color:#fff',
        'font-size:24px',
        'line-height:1',
        'cursor:pointer',
    ].join(';');

    if (title) {
        const titleEl = document.createElement('div');
        titleEl.textContent = String(title);
        titleEl.style.cssText = 'color:#fff;font-size:15px;font-weight:600;';
        panel.appendChild(titleEl);
    }

    const normalizedType = String(mediaType || '').toLowerCase();
    if (normalizedType === 'video') {
        const videoEl = document.createElement('video');
        videoEl.src = url;
        videoEl.controls = true;
        videoEl.playsInline = true;
        videoEl.style.cssText = 'max-width:92vw;max-height:78vh;border-radius:8px;box-shadow:0 0 20px rgba(0,0,0,0.5);background:#000;';
        panel.appendChild(videoEl);
    } else if (normalizedType === 'audio') {
        const audioWrap = document.createElement('div');
        audioWrap.style.cssText = 'min-width:min(640px,92vw);max-width:92vw;padding:20px 18px;border-radius:10px;background:rgba(15,23,42,0.92);border:1px solid rgba(255,255,255,0.15);display:flex;flex-direction:column;align-items:center;gap:12px;';
        const icon = document.createElement('div');
        icon.textContent = '🎵';
        icon.style.cssText = 'font-size:44px;line-height:1;';
        const audioEl = document.createElement('audio');
        audioEl.src = url;
        audioEl.controls = true;
        audioEl.autoplay = true;
        audioEl.style.cssText = 'width:min(580px,88vw);';
        audioWrap.appendChild(icon);
        audioWrap.appendChild(audioEl);
        panel.appendChild(audioWrap);
    } else {
        const imgEl = document.createElement('img');
        imgEl.src = url;
        imgEl.style.cssText = 'max-width:92vw;max-height:78vh;object-fit:contain;border-radius:8px;box-shadow:0 0 20px rgba(0,0,0,0.5);';
        panel.appendChild(imgEl);
    }

    const closeHint = document.createElement('div');
    closeHint.textContent = 'ESC または外側クリックで閉じる';
    closeHint.style.cssText = 'color:rgba(255,255,255,0.65);font-size:12px;';
    panel.appendChild(closeHint);
    panel.appendChild(closeBtn);
    modal.appendChild(panel);

    const cleanup = () => {
        modal.remove();
        document.removeEventListener('keydown', onEsc);
    };

    const onEsc = (event) => {
        if (event.key === 'Escape') cleanup();
    };

    closeBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        cleanup();
    });
    modal.addEventListener('click', (event) => {
        if (event.target === modal) cleanup();
    });
    document.addEventListener('keydown', onEsc);
    document.body.appendChild(modal);
}

function showSimpleVideoImageModal(imageUrl, title = '') {
    showSimpleVideoMediaModal({ mediaType: 'image', mediaUrl: imageUrl, title });
}

function askSimpleVideoM2VNoScenarioDialog(options = {}) {
    const sourceType = String(options?.sourceType || '').trim().toLowerCase();
    const isUploadedAudio = sourceType === 'uploaded';
    return new Promise((resolve) => {
        const existing = document.querySelector('.simple-video-confirm-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'simple-video-confirm-modal';
        overlay.style.cssText = [
            'position:fixed',
            'inset:0',
            'z-index:10020',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'background:rgba(0,0,0,0.62)',
            'padding:18px',
        ].join(';');

        const card = document.createElement('div');
        card.style.cssText = [
            'width:min(560px,92vw)',
            'background:#0f172a',
            'border:1px solid rgba(255,255,255,0.12)',
            'border-radius:12px',
            'padding:16px',
            'box-shadow:0 18px 40px rgba(0,0,0,0.45)',
            'color:#e2e8f0',
        ].join(';');

        const title = document.createElement('div');
        title.textContent = '動画シナリオが未入力です';
        title.style.cssText = 'font-size:16px;font-weight:700;margin-bottom:8px;';

        const desc = document.createElement('div');
        desc.textContent = isUploadedAudio
            ? '外部音源の場合、動画シナリオを入力するとシーン整合性が上がります。このまま進む場合は、歌詞/音源ベースでシーンプロンプトを生成して M2V を継続します。'
            : 'このまま進む場合は、歌詞/音源ベースでシーンプロンプトを生成して M2V を継続します。';
        desc.style.cssText = 'font-size:13px;line-height:1.6;color:#cbd5e1;margin-bottom:14px;';

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;';

        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.textContent = 'シナリオを入力する';
        backBtn.className = 'simple-video-settings-btn simple-video-inline-btn';

        const goBtn = document.createElement('button');
        goBtn.type = 'button';
        goBtn.textContent = 'このまま生成する';
        goBtn.className = 'simple-video-generate-btn';

        actions.appendChild(backBtn);
        actions.appendChild(goBtn);
        card.appendChild(title);
        card.appendChild(desc);
        card.appendChild(actions);
        overlay.appendChild(card);

        const cleanup = (result) => {
            overlay.remove();
            document.removeEventListener('keydown', onEsc);
            resolve(!!result);
        };

        const onEsc = (e) => {
            if (e.key === 'Escape') cleanup(false);
        };

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) cleanup(false);
        });
        backBtn.addEventListener('click', () => cleanup(false));
        goBtn.addEventListener('click', () => cleanup(true));
        document.addEventListener('keydown', onEsc);
        document.body.appendChild(overlay);
    });
}

function clearAllIntermediateImages() {
    SimpleVideoUI.state.intermediateImages = null;
    saveSimpleVideoState();
    updateSimpleVideoUI();
    updateGenerateButtonState();
}

/**
 * Invalidate (clear) only auto-generated intermediate images, keeping user-uploaded ones.
 * Called when scenario or LLM prompts change so that stale images aren't reused.
 */
function invalidateGeneratedIntermediateImages() {
    const cur = SimpleVideoUI.state.intermediateImages;
    if (!cur || !Array.isArray(cur.images)) return;

    // Do not clear thumbnails immediately on edit.
    // Only mark fingerprint dirty so next full regeneration can decide scope.
    cur.scenarioFingerprint = '';
    console.log('[SimpleVideo] Marked intermediate images as prompt-changed (fingerprint reset)');
}

function invalidateSceneVideosForImageIndexes({ preset, imageIndexes }) {
    const pid = String(preset?.id || '').trim();
    if (!pid) return;

    const cur = normalizeSceneVideos(SimpleVideoUI.state.sceneVideos);
    if (!cur || String(cur.presetId || '') !== pid || !Array.isArray(cur.videos)) return;

    const targets = new Set();
    const uniq = Array.isArray(imageIndexes) ? imageIndexes : [];
    for (const raw of uniq) {
        const idx = Number(raw);
        if (!Number.isFinite(idx) || idx < 0) continue;
        // Keep invalidation scope minimal so single-scene regeneration can re-concat immediately.
        targets.add(idx);
    }

    let changed = false;
    for (const vidIdx of targets) {
        if (!Number.isFinite(vidIdx) || vidIdx < 0 || vidIdx >= cur.videos.length) continue;
        if (cur.videos[vidIdx]) {
            cur.videos[vidIdx] = null;
            changed = true;
        }
    }

    if (changed) {
        SimpleVideoUI.state.sceneVideos = cur;
        saveSimpleVideoState();
    }
}

async function uploadIntermediateSceneImage(index, file) {
    if (!SimpleVideoUI.initialized) return;
    const idx = Number(index);
    const tileEl = document.querySelector(`.simple-video-intermediate-tile[data-index="${idx}"]`);
    try {
        if (!file) return;

        const kind = inferMediaKindFromFile(file);
        if (kind !== 'image' && kind !== 'video') {
            if (typeof showToast === 'function') showToast('画像または動画ファイルを選択してください', 'warning');
            return;
        }

        if (tileEl) tileEl.classList.add('uploading');

        const displayName = file.name;
        let fileToUpload = file;
        if (kind === 'video') {
            if (typeof showToast === 'function') showToast('動画から最終フレームを抽出中...', 'info');
            fileToUpload = await extractLastFrameAsImageFile(file);
        }

        const uploaded = await uploadSimpleVideoFile(fileToUpload);

        const base = getSimpleVideoBaseURL();
        const filename = uploaded?.filename;
        if (!filename) throw new Error('Upload response missing filename');
        const previewUrl = `${base}/api/v1/files/${encodeURIComponent(filename)}`;

        const presetId = String(SimpleVideoUI.state.selectedPreset || '').trim();
        const desiredCount = Math.max(1, Number(SimpleVideoUI.state.sceneCount) || 1);
        const cur = ensureIntermediateImagesState({ presetId, desiredCount });
        if (!cur) throw new Error('中間画像の状態が初期化できません');

        cur.images[idx] = {
            source: 'uploaded',
            filename: String(filename),
            jobId: null,
            previewUrl,
            originalName: String(displayName || fileToUpload.name || ''),
        };

        saveSimpleVideoState();
        updateSimpleVideoUI();
        updateGenerateButtonState();
        if (typeof showToast === 'function') showToast(`中間画像 #${idx + 1} を置換しました`, 'success');
    } catch (err) {
        console.error('[SimpleVideo] Intermediate image upload failed:', err);
        if (typeof showToast === 'function') showToast('アップロードに失敗しました', 'error');
    } finally {
        if (tileEl) tileEl.classList.remove('uploading');
    }
}

async function extractLastFrameAsImageFile(videoFile) {
    const url = URL.createObjectURL(videoFile);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    try {
        await new Promise((resolve, reject) => {
            const onLoaded = () => resolve();
            const onError = () => reject(new Error('Failed to load video metadata'));
            video.addEventListener('loadedmetadata', onLoaded, { once: true });
            video.addEventListener('error', onError, { once: true });
        });

        const duration = Number(video.duration);
        if (!Number.isFinite(duration) || duration <= 0) {
            throw new Error('Invalid video duration');
        }

        // Seek near the end (some browsers fail at exactly duration)
        const candidates = [
            Math.max(0, duration - 0.01),
            Math.max(0, duration - 0.1),
            Math.max(0, duration - 0.25),
            Math.max(0, duration - 0.5),
        ];

        let sought = false;
        for (const t of candidates) {
            try {
                await new Promise((resolve, reject) => {
                    const onSeeked = () => resolve();
                    const onError = () => reject(new Error('seek failed'));
                    video.addEventListener('seeked', onSeeked, { once: true });
                    video.addEventListener('error', onError, { once: true });
                    video.currentTime = t;
                });
                sought = true;
                break;
            } catch (_e) {
                // try next candidate
            }
        }
        if (!sought) throw new Error('Failed to seek near end of video');

        // Ensure we have a frame to draw
        if (!video.videoWidth || !video.videoHeight) {
            throw new Error('Video has no dimensions');
        }

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas context unavailable');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
        });

        const baseName = String(videoFile.name || 'video').replace(/\.[^.]+$/, '');
        const outName = `${baseName}_lastframe.png`;
        return new File([blob], outName, { type: 'image/png' });
    } finally {
        try { URL.revokeObjectURL(url); } catch (_e) {}
        try { video.removeAttribute('src'); video.load(); } catch (_e) {}
    }
}

/* ========================================
   Preset Selection
   ======================================== */

function selectPreset(presetId) {
    const preset = VIDEO_PRESETS.find(p => p.id === presetId);
    if (!preset) return;

    // Prepared initial frame is tied to the preset/workflow choice; clear it if preset changes.
    const prepared = SimpleVideoUI.state.preparedVideoInitialImage;
    if (prepared && String(prepared.presetId || '') && String(prepared.presetId || '') !== String(presetId || '')) {
        SimpleVideoUI.state.preparedVideoInitialImage = null;
    }
    
    SimpleVideoUI.state.selectedPreset = presetId;
    saveSimpleVideoState();
    
    // Update select + description
    const seqSel = document.getElementById('simpleVideoSequenceSelect');
    if (seqSel) {
        try { seqSel.value = presetId; } catch (_e) {}
    }
    const descEl = document.getElementById('simpleVideoSequenceDesc');
    if (descEl) {
        const needsKeyImage = !!preset.requiresImage;
        const requirementNote = needsKeyImage ? '【キー画像必須】参照画像を先にアップロードしてください。' : '【キー画像任意】参照画像なしでも生成できます。';
        const desc = String(preset.description || '').trim();
        descEl.textContent = desc ? `${desc} ${requirementNote}` : requirementNote;
    }

    // Show/hide FLF quality for presets that use FLF workflow
    const flfQualityField = document.getElementById('simpleVideoFLFQualityField');
    if (flfQualityField) {
        // Only show FLF options for presets that actually use FLF workflow
        const rawStepsForFlf = Array.isArray(preset.steps) ? preset.steps : [];
        const usesFlfWorkflow = rawStepsForFlf.some(s => isFLFWorkflowId(s?.workflow)) || String(presetId || '').includes('flf');
        // Exclude scene_cut presets (they don't use FLF even if name matches)
        const showFlf = usesFlfWorkflow && !String(presetId || '').includes('scene_cut');
        flfQualityField.style.display = showFlf ? '' : 'none';
    }
    
    // Show/hide Reference Source select for presets that support it (char_edit_i2i_flf, char_edit_i2v_scene_cut)
    const refSourceField = document.getElementById('simpleVideoRefSourceField');
    if (refSourceField) {
        const showRefSource = !!preset.supportsRefSourceSelect;
        refSourceField.style.display = showRefSource ? '' : 'none';
    }
    
    // Show/hide I2I reference-role selector for image-refine presets (ext_i2i_*)
    const i2iRoleField = document.getElementById('simpleVideoI2IRefRoleField');
    const i2iRoleHint = document.getElementById('simpleVideoI2IRefRoleHint');
    const showRole = /^ext_i2i_/.test(String(presetId || ''));
    if (i2iRoleField) i2iRoleField.style.display = showRole ? '' : 'none';
    if (i2iRoleHint) i2iRoleHint.style.display = showRole ? '' : 'none';

    // Show/hide I2I settings button for I2I-based presets
    const i2iSettingsActions = document.getElementById('simpleVideoI2ISettingsActions');
    if (i2iSettingsActions) {
        const hasI2I = presetId.startsWith('char_') || presetId.startsWith('ext_i2i_') || preset.initialRefineWorkflow;
        i2iSettingsActions.style.display = hasI2I ? '' : 'none';
        
        // Restore I2I settings values
        if (hasI2I) {
            const wfEl = document.getElementById('simpleVideoI2IWorkflow');
            const denoiseEl = document.getElementById('simpleVideoI2IDenoise');
            const cfgEl = document.getElementById('simpleVideoI2ICfg');
            const denoiseValueEl = document.getElementById('simpleVideoI2IDenoiseValue');
            const cfgValueEl = document.getElementById('simpleVideoI2ICfgValue');
            const motionStrengthEl = document.getElementById('simpleVideoMotionStrength');
            
            if (wfEl) {
                const fixedWorkflow = getConfiguredSimpleVideoWorkflow('i2i', 'qwen_i2i_2511_bf16_lightning4');
                const selectedWorkflow = (SIMPLE_VIDEO_STANDALONE_CONFIG.lockI2IWorkflow === false)
                    ? String(SimpleVideoUI.state.i2iRefineWorkflow || fixedWorkflow)
                    : fixedWorkflow;
                try { wfEl.value = selectedWorkflow; } catch (_e) {}
                wfEl.disabled = SIMPLE_VIDEO_STANDALONE_CONFIG.lockI2IWorkflow !== false;
            }
            if (denoiseEl) {
                const d = parseFloat(SimpleVideoUI.state.i2iDenoise) || 1.0;
                denoiseEl.value = d;
                if (denoiseValueEl) denoiseValueEl.textContent = d.toFixed(3);
            }
            if (cfgEl) {
                const c = parseFloat(SimpleVideoUI.state.i2iCfg) || 1.0;
                cfgEl.value = c;
                if (cfgValueEl) cfgValueEl.textContent = c.toFixed(1);
            }
            if (motionStrengthEl) {
                try { motionStrengthEl.value = String(SimpleVideoUI.state.motionStrength || 'medium'); } catch (_e) {}
            }
            
            // Restore reference source select
            const refSourceVal = SimpleVideoUI.state.i2iRefSource || 'character';
            const refSourceSelect = document.getElementById('simpleVideoRefSource');
            if (refSourceSelect) {
                refSourceSelect.value = refSourceVal;
            }
        }
    }
    
    // Update LTX/audio option visibility based on preset
    const rawSteps = Array.isArray(preset.steps) ? preset.steps : [];
    const hasFLF = rawSteps.some(s => isFLFWorkflowId(s?.workflow)) || String(preset.id || '').includes('flf');
    const initialVideoWf = normalizeWorkflowAlias(preset.initialVideoWorkflow);
    const hasVideo = rawSteps.some(s => isVideoWorkflowId(s?.workflow)) || (initialVideoWf && isVideoWorkflowId(initialVideoWf));
    
    const fast = document.getElementById('simpleVideoOptFast');
    const ltxVariant = document.getElementById('simpleVideoLtxVariant');
    const audio = document.getElementById('simpleVideoOptAudio');
    
    if (fast) {
        if (!SIMPLE_VIDEO_STANDALONE_CONFIG.enableLtx) {
            fast.closest('.simple-video-sequence-flag').style.display = 'none';
            fast.disabled = true;
        } else if (hasFLF) {
            fast.closest('.simple-video-sequence-flag').style.display = 'none';
        } else {
            fast.closest('.simple-video-sequence-flag').style.display = '';
            const shouldDisable = !hasVideo;
            fast.disabled = shouldDisable;
            fast.closest('.simple-video-sequence-flag')?.classList.toggle('disabled', shouldDisable);
        }
    }

    if (ltxVariant) {
        if (!SIMPLE_VIDEO_STANDALONE_CONFIG.enableLtx) {
            ltxVariant.closest('.simple-video-sequence-flag').style.display = 'none';
            ltxVariant.disabled = true;
        } else if (hasFLF) {
            ltxVariant.closest('.simple-video-sequence-flag').style.display = 'none';
        } else {
            ltxVariant.closest('.simple-video-sequence-flag').style.display = '';
            const shouldDisable = !hasVideo || !SimpleVideoUI.state.useFast;
            ltxVariant.disabled = shouldDisable;
            ltxVariant.closest('.simple-video-sequence-flag')?.classList.toggle('disabled', shouldDisable);
        }
    }
    
    if (audio) {
        if (!SIMPLE_VIDEO_STANDALONE_CONFIG.showGenerateAudioOption) {
            audio.closest('.simple-video-sequence-flag').style.display = 'none';
            audio.disabled = true;
        } else if (hasFLF) {
            audio.closest('.simple-video-sequence-flag').style.display = 'none';
        } else {
            audio.closest('.simple-video-sequence-flag').style.display = '';
            audio.disabled = false;
            audio.closest('.simple-video-sequence-flag')?.classList.remove('disabled');
        }
    }
    
    updateGenerateButtonState();
    updateKeyImageAnalysisUI();
    
    console.log('[SimpleVideo] Selected preset:', presetId, 'hasFLF:', hasFLF, 'hasVideo:', hasVideo);
}

/**
 * Briefly highlight the preset selector to draw user attention.
 * Used after prompt generation completes when no preset is selected.
 */
function nudgePresetSelector() {
    const sel = document.getElementById('simpleVideoSequenceSelect');
    if (!sel) return;
    // Apply a pulsing highlight
    sel.style.transition = 'box-shadow 0.3s, border-color 0.3s';
    sel.style.boxShadow = '0 0 0 3px rgba(255, 165, 0, 0.7)';
    sel.style.borderColor = '#ffa500';
    // Scroll into view if needed
    try { sel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (_) {}
    // Remove after 4 seconds
    setTimeout(() => {
        sel.style.boxShadow = '';
        sel.style.borderColor = '';
    }, 4000);
}

/* ========================================
   UI State Updates
   ======================================== */

function updateSimpleVideoUI() {
    const { state } = SimpleVideoUI;
    enforceStandaloneConfigState();
    
    // Restore selected preset
    if (state.selectedPreset) {
        selectPreset(state.selectedPreset);
    }

    // Restore image prompt
    const imagePromptInput = document.getElementById('simpleVideoImagePrompt');
    if (imagePromptInput && state.imagePrompt) {
        imagePromptInput.value = state.imagePrompt;
    }

    const t2aTagsInput = document.getElementById('simpleVideoT2ATags');
    if (t2aTagsInput) {
        t2aTagsInput.value = String(state.t2aTags || '');
    }
    const t2aScenarioInput = document.getElementById('simpleVideoT2AScenario');
    if (t2aScenarioInput) {
        t2aScenarioInput.value = String(state.t2aScenario || '');
    }
    const t2aLyricsInput = document.getElementById('simpleVideoT2ALyrics');
    if (t2aLyricsInput) {
        t2aLyricsInput.value = String(state.t2aLyrics || '');
    }
    const t2aLanguageInput = document.getElementById('simpleVideoT2ALanguage');
    if (t2aLanguageInput) {
        try { t2aLanguageInput.value = normalizeT2ALanguage(state.t2aLanguage); } catch (_e) {}
    }
    const t2aDurationInput = document.getElementById('simpleVideoT2ADuration');
    if (t2aDurationInput) {
        t2aDurationInput.value = normalizeT2ANumber(state.t2aDuration, { fallback: 30, min: 1, max: 300, precision: 0 });
    }
    const t2aBpmInput = document.getElementById('simpleVideoT2ABpm');
    if (t2aBpmInput) {
        t2aBpmInput.value = normalizeT2ANumber(state.t2aBpm, { fallback: 120, min: 30, max: 240, precision: 0 });
    }
    const t2aTimesignatureInput = document.getElementById('simpleVideoT2ATimesignature');
    if (t2aTimesignatureInput) {
        try { t2aTimesignatureInput.value = normalizeT2ATimeSignature(state.t2aTimesignature); } catch (_e) {}
    }
    const t2aKeyscaleInput = document.getElementById('simpleVideoT2AKeyscale');
    if (t2aKeyscaleInput) {
        t2aKeyscaleInput.value = normalizeT2AKeyscale(state.t2aKeyscale);
    }
    const t2aStepsInput = document.getElementById('simpleVideoT2ASteps');
    if (t2aStepsInput) {
        t2aStepsInput.value = normalizeT2ANumber(state.t2aSteps, { fallback: 8, min: 1, max: 200, precision: 0 });
    }
    const t2aCfgInput = document.getElementById('simpleVideoT2ACfg');
    if (t2aCfgInput) {
        t2aCfgInput.value = normalizeT2ANumber(state.t2aCfg, { fallback: 1.0, min: 0.1, max: 30, precision: 2 });
    }
    const t2aSeedInput = document.getElementById('simpleVideoT2ASeed');
    if (t2aSeedInput) {
        t2aSeedInput.value = String(state.t2aSeed || '');
    }

    // Restore selected character highlight
    const row = document.getElementById('simpleVideoCharactersRow');
    if (row) {
        const selectedToken = getSimpleVideoCharacterToken(state.selectedCharacter);
        row.querySelectorAll('.simple-video-character-chip').forEach((el) => {
            el.classList.toggle('selected', selectedToken && String(el.dataset.token || '') === selectedToken);
        });
    }

    // Restore key image preview
    const keyPlaceholder = document.getElementById('simpleVideoKeyImagePlaceholder');
    const keyImg = document.getElementById('simpleVideoKeyImageImg');
    const keyMeta = document.getElementById('simpleVideoKeyImageMeta');
    const keyArea = document.getElementById('simpleVideoKeyImage');
    const keyDeleteBtn = document.getElementById('simpleVideoKeyImageDelete');
    const keyAnalyzeBtn = document.getElementById('simpleVideoKeyImageAnalyzeBtn');
    const key = state.keyImage || state.uploadedImage;
    if (keyPlaceholder && keyImg && keyMeta) {
        if (key?.previewUrl) {
            keyImg.src = key.previewUrl;
            keyImg.style.display = '';
            keyMeta.textContent = key.originalName || key.filename || '';
            keyMeta.style.display = '';
            keyPlaceholder.style.display = 'none';

            if (keyArea) keyArea.classList.add('has-image');
            if (keyDeleteBtn) keyDeleteBtn.style.display = '';
            if (keyAnalyzeBtn) keyAnalyzeBtn.style.display = '';
        } else {
            keyImg.src = '';
            keyImg.style.display = 'none';
            keyMeta.style.display = 'none';
            keyPlaceholder.style.display = '';

            if (keyArea) keyArea.classList.remove('has-image');
            if (keyDeleteBtn) keyDeleteBtn.style.display = 'none';
            if (keyAnalyzeBtn) keyAnalyzeBtn.style.display = 'none';
        }
    }
    
    // Update key image analysis section
    updateKeyImageAnalysisUI();

    // Restore drop slots preview
    const slots = Array.isArray(state.dropSlots) ? state.dropSlots : [null, null, null];
    document.querySelectorAll('.simple-video-drop-slot').forEach((slotEl) => {
        const idx = Number(slotEl.dataset.slot);
        if (!Number.isFinite(idx) || idx < 0 || idx > 2) return;

        const slot = slots[idx];
        const img = slotEl.querySelector('.simple-video-drop-img');
        const meta = slotEl.querySelector('.simple-video-drop-meta');
        const label = slotEl.querySelector('.simple-video-drop-label');
        const delBtn = slotEl.querySelector('.simple-video-drop-delete');

        if (slot?.previewUrl && img && meta && label) {
            img.src = slot.previewUrl;
            img.style.display = '';
            meta.textContent = slot.originalName || slot.filename || '';
            meta.style.display = '';
            label.style.display = 'none';
            slotEl.classList.add('has-file');
            if (delBtn) delBtn.style.display = '';
        } else {
            if (img) {
                img.src = '';
                img.style.display = 'none';
            }
            if (meta) meta.style.display = 'none';
            if (label) label.style.display = '';
            slotEl.classList.remove('has-file');
            if (delBtn) delBtn.style.display = 'none';
        }
    });

    // Restore ref3 mode row visibility and state
    const ref3ModeRow = document.getElementById('simpleVideoRef3ModeRow');
    const ref3HasImage = !!(slots[2]?.filename);
    if (ref3ModeRow) {
        ref3ModeRow.style.display = ref3HasImage ? '' : 'none';
    }
    const ref3EnabledEl = document.getElementById('simpleVideoRef3ModeEnabled');
    if (ref3EnabledEl) {
        try { ref3EnabledEl.checked = state.ref3ModeEnabled !== false; } catch (_e) {}
    }
    const ref3ModeSelEl = document.getElementById('simpleVideoRef3ModeSelect');
    if (ref3ModeSelEl) {
        try {
            ref3ModeSelEl.value = state.ref3UseMode || 'background';
            ref3ModeSelEl.disabled = !(state.ref3ModeEnabled !== false);
        } catch (_e) {}
    }

    // Restore scenario
    const scenarioInput = document.getElementById('simpleVideoScenario');
    if (scenarioInput && state.scenario) {
        scenarioInput.value = state.scenario;
    }

    // Restore LLM prompt output
    const llmPromptInput = document.getElementById('simpleVideoLLMPrompt');
    if (llmPromptInput) {
        llmPromptInput.value = String(state.llmPrompt || '');
    }

    // Restore scenario helper controls
    const scenarioUseLLM = document.getElementById('simpleVideoScenarioUseLLM');
    if (scenarioUseLLM) {
        try { scenarioUseLLM.checked = !!state.scenarioUseLLM; } catch (_e) {}
    }
    const promptComplexity = document.getElementById('simpleVideoPromptComplexity');
    if (promptComplexity) {
        try { promptComplexity.value = normalizePromptComplexity(state.promptComplexity); } catch (_e) {}
    }
    const flfEndConstraintEnabled = document.getElementById('simpleVideoFlfEndConstraintEnabled');
    if (flfEndConstraintEnabled) {
        try { flfEndConstraintEnabled.checked = state.flfEndConstraintEnabled !== false; } catch (_e) {}
    }

    // Toggle generated prompts/progress visibility (under progress bar)
    syncGeneratedPromptsVisibility();

    // Restore video settings
    const sceneCountSel = document.getElementById('simpleVideoSceneCount');
    if (sceneCountSel) {
        try { sceneCountSel.value = String(state.sceneCount || '3'); } catch (_e) {}
    }
    const sceneLengthSel = document.getElementById('simpleVideoSceneLength');
    if (sceneLengthSel) {
        try { sceneLengthSel.value = String(state.sceneLengthSec || '5'); } catch (_e) {}
    }

    updateSimpleVideoDerivedTotalLength();
    renderSimpleVideoM2VSourceUI();
    renderSimpleVideoV2MSourceUI();
    const sizeSel = document.getElementById('simpleVideoSize');
    if (sizeSel) {
        try {
            const normalized = normalizeVideoSize(state.videoSize);
            sizeSel.value = normalized;
        } catch (_e) {}
    }

    const adv = document.getElementById('simpleVideoAdvancedSettings');
    if (adv) {
        adv.style.display = state.showAdvancedSettings ? '' : 'none';
    }

    // Restore internal images section accordion state
    const internalImagesContent = document.getElementById('simpleVideoInternalImagesContent');
    const internalImagesIcon = document.getElementById('simpleVideoInternalImagesToggleIcon');
    if (internalImagesContent) {
        internalImagesContent.style.display = state.showInternalImagesSection !== false ? '' : 'none';
    }
    if (internalImagesIcon) {
        internalImagesIcon.textContent = state.showInternalImagesSection !== false ? '▼' : '▶';
    }

    // Restore video settings accordion state
    const videoSettingsContent = document.getElementById('simpleVideoVideoSettingsContent');
    const videoSettingsIcon = document.getElementById('simpleVideoVideoSettingsToggleIcon');
    if (videoSettingsContent) {
        videoSettingsContent.style.display = state.showVideoSettingsSection !== false ? '' : 'none';
    }
    if (videoSettingsIcon) {
        videoSettingsIcon.textContent = state.showVideoSettingsSection !== false ? '▼' : '▶';
    }

    // Restore character image generation group accordion state
    const charImgGroupContent = document.getElementById('simpleVideoCharacterImageGroupContent');
    const charImgGroupIcon = document.getElementById('simpleVideoCharacterImageGroupToggleIcon');
    if (charImgGroupContent) {
        charImgGroupContent.style.display = state.showCharacterImageGroup !== false ? '' : 'none';
    }
    if (charImgGroupIcon) {
        charImgGroupIcon.textContent = state.showCharacterImageGroup !== false ? '▼' : '▶';
    }
    
    // Restore characters list accordion state
    const charsContent = document.getElementById('simpleVideoCharactersContent');
    const charsIcon = document.getElementById('simpleVideoCharactersToggleIcon');
    if (charsContent) {
        charsContent.style.display = state.showCharactersList !== false ? '' : 'none';
    }
    if (charsIcon) {
        charsIcon.textContent = state.showCharactersList !== false ? '▼' : '▶';
    }

    // Restore I2I advanced settings visibility
    const i2iAdv = document.getElementById('simpleVideoI2IAdvancedSettings');
    if (i2iAdv) {
        i2iAdv.style.display = state.showI2IAdvancedSettings ? '' : 'none';
    }

    const fpsInput = document.getElementById('simpleVideoFps');
    if (fpsInput) {
        try { fpsInput.value = String(state.fps ?? ''); } catch (_e) {}
    }
    
    // Restore FLF quality
    const flfQualitySelect = document.getElementById('simpleVideoFLFQuality');
    if (flfQualitySelect) {
        try { flfQualitySelect.value = state.flfQuality || 'speed'; } catch (_e) {}
    }

    // Restore sequence-side options + enable/disable depending on preset
    const fast = document.getElementById('simpleVideoOptFast');
    const ltxVariant = document.getElementById('simpleVideoLtxVariant');
    const audio = document.getElementById('simpleVideoOptAudio');
    if (fast) {
        try { fast.checked = !!state.useFast; } catch (_e) {}
    }
    if (ltxVariant) {
        try { ltxVariant.value = normalizeLtxVariant(state.ltxVariant); } catch (_e) {}
        ltxVariant.disabled = !state.useFast || !SIMPLE_VIDEO_STANDALONE_CONFIG.enableLtx;
    }
    if (audio) {
        try { audio.checked = !!state.generateAudio; } catch (_e) {}
    }

    const preset = VIDEO_PRESETS.find(p => p.id === state.selectedPreset);
    if (preset) {
        const rawSteps = Array.isArray(preset.steps) ? preset.steps : [];
        const initialVideoWf = normalizeWorkflowAlias(preset.initialVideoWorkflow);
        const hasVideo = rawSteps.some(s => isVideoWorkflowId(s?.workflow)) || (initialVideoWf && isVideoWorkflowId(initialVideoWf));
        const hasFLF = rawSteps.some(s => isFLFWorkflowId(s?.workflow)) || String(preset.id || '').includes('flf');

        // I2I refine settings (only show when preset includes I2I refine)
        const hasI2I = !!preset.initialRefineWorkflow || rawSteps.some((s) => isI2IWorkflowId(s?.workflow));
        const i2iRow = document.getElementById('simpleVideoI2ISettingsRow');
        const i2iHint = document.getElementById('simpleVideoI2IHint');
        if (i2iRow) i2iRow.style.display = hasI2I ? '' : 'none';
        if (i2iHint) i2iHint.style.display = hasI2I ? '' : 'none';

        // Show I2I reference-role selector only for image-refine presets.
        const i2iRoleField = document.getElementById('simpleVideoI2IRefRoleField');
        const i2iRoleHint = document.getElementById('simpleVideoI2IRefRoleHint');
        const showRole = hasI2I && /^ext_i2i_/.test(String(preset.id || ''));
        if (i2iRoleField) i2iRoleField.style.display = showRole ? '' : 'none';
        if (i2iRoleHint) i2iRoleHint.style.display = showRole ? '' : 'none';
        
        // Show Reference Source select for presets that support it (char_edit_i2i_flf, char_edit_i2v_scene_cut)
        const refSourceField = document.getElementById('simpleVideoRefSourceField');
        if (refSourceField) {
            const showRefSource = !!preset.supportsRefSourceSelect;
            refSourceField.style.display = showRefSource ? '' : 'none';
        }

        if (hasI2I) {
            const wfEl = document.getElementById('simpleVideoI2IWorkflow');
            const denoiseEl = document.getElementById('simpleVideoI2IDenoise');
            const cfgEl = document.getElementById('simpleVideoI2ICfg');
            const roleEl = document.getElementById('simpleVideoI2IRefRole');
            if (wfEl) {
                const fixedWorkflow = getConfiguredSimpleVideoWorkflow('i2i', 'qwen_i2i_2511_bf16_lightning4');
                const selectedWorkflow = (SIMPLE_VIDEO_STANDALONE_CONFIG.lockI2IWorkflow === false)
                    ? String(state.i2iRefineWorkflow || 'auto')
                    : fixedWorkflow;
                try { wfEl.value = selectedWorkflow; } catch (_e) {}
                wfEl.disabled = SIMPLE_VIDEO_STANDALONE_CONFIG.lockI2IWorkflow !== false;
            }
            if (denoiseEl) {
                denoiseEl.value = String(state.i2iDenoise ?? '');
            }
            if (cfgEl) {
                cfgEl.value = String(state.i2iCfg ?? '');
            }
            if (roleEl) {
                try { roleEl.value = normalizeI2IRefRole(state.i2iRefRole); } catch (_e) {}
            }
        }

        if (fast) {
            if (!SIMPLE_VIDEO_STANDALONE_CONFIG.enableLtx) {
                fast.closest('.simple-video-sequence-flag').style.display = 'none';
                fast.disabled = true;
            } else if (hasFLF) {
                fast.closest('.simple-video-sequence-flag').style.display = 'none';
            } else {
                fast.closest('.simple-video-sequence-flag').style.display = '';
                const shouldDisable = !hasVideo;
                fast.disabled = shouldDisable;
                fast.closest('.simple-video-sequence-flag')?.classList.toggle('disabled', shouldDisable);
            }
        }

        if (ltxVariant) {
            if (!SIMPLE_VIDEO_STANDALONE_CONFIG.enableLtx) {
                ltxVariant.closest('.simple-video-sequence-flag').style.display = 'none';
                ltxVariant.disabled = true;
            } else if (hasFLF) {
                ltxVariant.closest('.simple-video-sequence-flag').style.display = 'none';
            } else {
                ltxVariant.closest('.simple-video-sequence-flag').style.display = '';
                const shouldDisable = !hasVideo || !state.useFast;
                ltxVariant.disabled = shouldDisable;
                ltxVariant.closest('.simple-video-sequence-flag')?.classList.toggle('disabled', shouldDisable);
            }
        }

        if (audio) {
            if (!SIMPLE_VIDEO_STANDALONE_CONFIG.showGenerateAudioOption) {
                audio.closest('.simple-video-sequence-flag').style.display = 'none';
                audio.disabled = true;
            } else if (hasFLF) {
                audio.closest('.simple-video-sequence-flag').style.display = 'none';
            } else {
                audio.closest('.simple-video-sequence-flag').style.display = '';
                audio.disabled = false;
                audio.closest('.simple-video-sequence-flag')?.classList.remove('disabled');
            }
        }
    } else {
        // No preset selected yet: keep enabled but reflect defaults
        if (fast) {
            if (!SIMPLE_VIDEO_STANDALONE_CONFIG.enableLtx) {
                fast.closest('.simple-video-sequence-flag').style.display = 'none';
                fast.disabled = true;
            } else {
                fast.closest('.simple-video-sequence-flag').style.display = '';
                fast.disabled = false;
                fast.closest('.simple-video-sequence-flag')?.classList.remove('disabled');
            }
        }
        if (ltxVariant) {
            if (!SIMPLE_VIDEO_STANDALONE_CONFIG.enableLtx) {
                ltxVariant.closest('.simple-video-sequence-flag').style.display = 'none';
                ltxVariant.disabled = true;
            } else {
                ltxVariant.closest('.simple-video-sequence-flag').style.display = '';
                ltxVariant.disabled = !state.useFast;
                ltxVariant.closest('.simple-video-sequence-flag')?.classList.toggle('disabled', !state.useFast);
            }
        }
        if (audio) {
            if (!SIMPLE_VIDEO_STANDALONE_CONFIG.showGenerateAudioOption) {
                audio.closest('.simple-video-sequence-flag').style.display = 'none';
                audio.disabled = true;
            } else {
                audio.closest('.simple-video-sequence-flag').style.display = '';
                audio.disabled = false;
                audio.closest('.simple-video-sequence-flag')?.classList.remove('disabled');
            }
        }
    }

    // Keep FPS in sync with current preset/options (LTX forces 24; leaving LTX restores backup)
    syncFpsForCurrentOptions({ forceUI: true });

    renderSimpleVideoIntermediateImagesUI();
    updateCharacterImageUI();
    updateInternalImagesUI();
    updateCurrentReferenceHint();
    
    updateGenerateButtonState();
}

function updateCurrentReferenceHint() {
    const hintEl = document.getElementById('simpleVideoCurrentRefHint');
    if (!hintEl) return;

    const state = SimpleVideoUI.state;
    const preset = VIDEO_PRESETS.find((p) => p.id === state.selectedPreset);

    if (!preset) {
        hintEl.textContent = '参照: 生成シーケンスを選択してください';
        return;
    }

    const dropSlots = Array.isArray(state.dropSlots) ? state.dropSlots : [];
    const hasCharacterImage = !!String(state.characterImage?.filename || '').trim();
    const hasKeyImage = !!String(state.uploadedImage?.filename || '').trim();
    const hasRef1 = !!String(dropSlots[0]?.filename || '').trim();

    let source = 'なし';

    if (preset.requiresCharacterImage) {
        if (hasCharacterImage) source = 'キャラ画像';
        else if (hasKeyImage) source = 'キー画像';
        else if (hasRef1) source = 'ref1';
    } else if (preset.requiresImage) {
        if (hasKeyImage) source = 'キー画像';
        else if (hasRef1) source = 'ref1';
    } else {
        // テキスト系プリセットでも、参照が存在すれば補助情報として表示
        if (hasKeyImage) source = 'キー画像';
        else if (hasRef1) source = 'ref1';
    }

    let tail = '';
    if (preset.supportsRefSourceSelect && source !== 'なし') {
        const refMode = normalizeI2IRefSource(state.i2iRefSource);
        tail = refMode === 'first_scene'
            ? '（シーン2以降: シーン1固定）'
            : '（シーン2以降: 同一参照を継続）';
    }

    hintEl.textContent = `現在の参照: ${source}${tail}`;
}

function escapeHtml(value) {
    const s = String(value ?? '');
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function updateInternalImagesUI() {
    const wrap = document.getElementById('simpleVideoInternalImagesWrap');
    const grid = document.getElementById('simpleVideoInternalImagesGrid');
    if (!wrap || !grid) return;

    const state = SimpleVideoUI.state;

    const items = [
        {
            key:   'characterImage',
            label: 'キャラクター合成画像',
            icon:  '👤',
            value: state.characterImage,
            getUrl(v) {
                if (v.previewUrl) return v.previewUrl;
                if (v.jobId) return getSimpleVideoDownloadURL(v.jobId, v.filename);
                return getSimpleVideoInputImageURL(v.filename);
            },
        },
        {
            key:   'preparedInitialImage',
            label: '準備済み初期画像',
            icon:  '🖼️',
            value: state.preparedInitialImage,
            getUrl(v) {
                if (v.previewUrl) return v.previewUrl;
                if (v.jobId) return getSimpleVideoDownloadURL(v.jobId, v.filename);
                return getSimpleVideoInputImageURL(v.filename);
            },
        },
        {
            key:   'preparedVideoInitialImage',
            label: '準備済み動画初期フレーム',
            icon:  '🎬',
            value: state.preparedVideoInitialImage,
            getUrl(v) {
                if (v.previewUrl) return v.previewUrl;
                if (v.jobId) return getSimpleVideoDownloadURL(v.jobId, v.filename);
                return getSimpleVideoInputImageURL(v.filename);
            },
        },
        {
            key:   'characterSheetImage',
            label: 'キャラクターシート',
            icon:  '🏃',
            value: state.characterSheetImage,
            getUrl(v) {
                if (v.previewUrl) return v.previewUrl;
                if (v.jobId) return getSimpleVideoDownloadURL(v.jobId, v.filename);
                return getSimpleVideoInputImageURL(v.filename);
            },
        },
    ];

    // Always show the section — images persist across reloads and can be cleared individually
    wrap.style.display = '';

    // Determine ref-toggle state based on items that have actual images
    const hasCharImage  = !!String(state.characterImage?.filename  || '').trim();
    const hasSheetImage = !!String(state.characterSheetImage?.filename || '').trim();
    const hasBothRefItems = hasCharImage && hasSheetImage;

    grid.innerHTML = items
        .map((item) => {
            const v = item.value;
            const hasImage = !!String(v?.filename || '').trim();

            // ---- empty slot ----
            if (!hasImage) {
                // For ref items, still show the slot so the toggle is always visible in context
                const isRefItem = item.key === 'characterImage' || item.key === 'characterSheetImage';
                const isActiveRef = isRefItem && (
                    (item.key === 'characterSheetImage' &&  state.useCharSheetAsRef) ||
                    (item.key === 'characterImage'       && !state.useCharSheetAsRef)
                );
                // Show a "use as reference" toggle on empty ref slots only when the OTHER ref slot has an image
                let refBadgeHtml = '';
                if (isRefItem && hasBothRefItems) {
                    refBadgeHtml = `<button class="simple-video-internal-image-use-ref${isActiveRef ? ' active' : ''}" data-key="${escapeHtml(item.key)}" type="button" title="シーンI2I参照として優先使用">${isActiveRef ? '📌 参照中' : '参照に使用'}</button>`;
                }
                return `
            <div class="simple-video-internal-image-item empty-slot${isActiveRef && hasBothRefItems ? ' active-ref' : ''}" data-key="${escapeHtml(item.key)}">
                <div class="simple-video-internal-image-thumb-wrap empty">
                    <span class="simple-video-internal-image-empty-icon">${escapeHtml(item.icon)}</span>
                </div>
                <div class="simple-video-internal-image-info">
                    <div class="simple-video-internal-image-label">${escapeHtml(item.icon)} ${escapeHtml(item.label)}</div>
                    <div class="simple-video-internal-image-filename muted">（未生成）</div>
                    ${refBadgeHtml}
                </div>
            </div>`;
            }

            // ---- item with image ----
            const imgUrl = item.getUrl(v);
            const name = String(v.filename || '').split('/').pop() || '(不明)';
            const p = v.prompt ? String(v.prompt) : '';
            const promptSnippet = p
                ? escapeHtml(p.length > 80 ? p.substring(0, 80) + '…' : p)
                : '';

            const isRefItem = item.key === 'characterImage' || item.key === 'characterSheetImage';
            const isActiveRef = isRefItem && (
                (item.key === 'characterSheetImage' &&  state.useCharSheetAsRef) ||
                (item.key === 'characterImage'       && !state.useCharSheetAsRef)
            );
            let refBadgeHtml = '';
            if (isRefItem) {
                if (hasBothRefItems) {
                    // Both exist: show clickable toggle
                    refBadgeHtml = `<button class="simple-video-internal-image-use-ref${isActiveRef ? ' active' : ''}" data-key="${escapeHtml(item.key)}" type="button" title="シーンI2I参照として優先使用">${isActiveRef ? '📌 参照中' : '参照に使用'}</button>`;
                } else {
                    // Only one has image: always-active static badge
                    refBadgeHtml = `<span class="simple-video-internal-image-use-ref active static">📌 参照中</span>`;
                }
            }

            return `
            <div class="simple-video-internal-image-item${isActiveRef ? ' active-ref' : ''}" data-key="${escapeHtml(item.key)}">
                <div class="simple-video-internal-image-thumb-wrap" title="クリックで拡大">
                    <img class="simple-video-internal-image-thumb" src="${escapeHtml(imgUrl)}" alt="${escapeHtml(item.label)}" loading="eager" />
                </div>
                <div class="simple-video-internal-image-info">
                    <div class="simple-video-internal-image-label">${escapeHtml(item.icon)} ${escapeHtml(item.label)}</div>
                    <div class="simple-video-internal-image-filename" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                    ${promptSnippet ? `<div class="simple-video-internal-image-prompt">${promptSnippet}</div>` : ''}
                    ${refBadgeHtml}
                </div>
                <button class="simple-video-internal-image-clear" data-key="${escapeHtml(item.key)}" type="button" title="${escapeHtml(item.label)}をクリア">✕</button>
            </div>`;
        })
        .join('');
}

function renderSimpleVideoIntermediateImagesUI() {
    const wrap = document.getElementById('simpleVideoIntermediateWrap');
    const grid = document.getElementById('simpleVideoIntermediateGrid');
    const titleEl = document.getElementById('simpleVideoIntermediateTitle');
    if (!wrap || !grid) return;

    const preset = VIDEO_PRESETS.find((p) => p.id === SimpleVideoUI.state.selectedPreset);
    // Show for char_i2i_flf, char_edit_i2i_flf, char_edit_i2v_scene_cut, or ext_i2i_i2v_scene_cut (presets with supportsPregenerateImages)
    const isFLF = String(preset?.id || '') === 'char_i2i_flf' || String(preset?.id || '') === 'char_edit_i2i_flf' || String(preset?.id || '') === 'char_edit_i2v_scene_cut';
    const show = !!preset && (isFLF || !!preset.supportsPregenerateImages);
    wrap.style.display = show ? '' : 'none';
    if (!show) return;
    
    // Update title based on preset type
    if (titleEl) {
        if (isFLF) {
            titleEl.innerHTML = '<i class="fas fa-images"></i> 🖼️ 中間画像（FLF用）';
        } else {
            titleEl.innerHTML = '<i class="fas fa-images"></i> 🖼️ シーン初期画像';
        }
    }

    let desiredCount = Math.max(1, Number(SimpleVideoUI.state.sceneCount) || 1);
    // FLF-only presets need N+1 images to produce N FLF transition segments
    if (preset?.flfOnly) desiredCount += 1;
    const inter = ensureIntermediateImagesState({ presetId: preset.id, desiredCount });
    const images = Array.isArray(inter?.images) ? inter.images : Array(desiredCount).fill(null);

    grid.innerHTML = images
        .slice(0, desiredCount)
        .map((entry, i) => {
            const url = getIntermediatePreviewUrl(entry);
            const has = !!url;
            const meta = entry ? (entry.originalName || entry.filename || '') : '';
            const badge = entry?.source === 'uploaded'
                ? 'UP'
                : (entry?.source === 'prepared' ? 'PRE' : (entry ? 'GEN' : ''));
            const canVideoRegen = !!entry && (!preset?.flfOnly || i < (desiredCount - 1));

            return `
                <div class="simple-video-intermediate-tile ${has ? 'has-file' : ''}" data-index="${i}">
                    <button class="simple-video-intermediate-video-regen simple-video-intermediate-delete" type="button" title="このシーン動画を再生成" data-index="${i}" style="${canVideoRegen ? 'right:30px;' : 'display:none;'}">🎬↻</button>
                    <button class="simple-video-intermediate-regen simple-video-intermediate-delete" type="button" title="この画像を再生成" data-index="${i}" style="${entry ? 'right:54px;' : 'display:none;'}">🖼️↻</button>
                    <button class="simple-video-intermediate-delete" type="button" title="削除" data-index="${i}" style="${entry ? '' : 'display:none;'}">×</button>
                    <div class="simple-video-intermediate-label">#${i + 1}${badge ? ` <span class=\"simple-video-intermediate-badge\">${badge}</span>` : ''}</div>
                    ${has
                        ? `<img class=\"simple-video-intermediate-img\" alt=\"Intermediate ${i + 1}\" src=\"${url}\" loading=\"lazy\" decoding=\"async\" />`
                        : `<div class=\"simple-video-intermediate-placeholder\">クリック/ドロップ</div>`}
                    <div class="simple-video-intermediate-meta" style="${meta ? '' : 'display:none;'}">${escapeHtml(meta)}</div>
                </div>
            `;
        })
        .join('');
}

/**
 * Update character composite image UI based on current state
 */
function updateCharacterImageUI() {
    // This function is now deprecated - use updateKeyImageAnalysisUI instead
    updateKeyImageAnalysisUI();
}

/**
 * Update key image analysis UI (analyze button visibility, analysis results)
 */
function updateKeyImageAnalysisUI() {
    const state = SimpleVideoUI.state;
    const keyImage = state.keyImage || state.uploadedImage;
    
    // Show/hide analyze button based on whether we have a key image
    const analyzeBtn = document.getElementById('simpleVideoKeyImageAnalyzeBtn');
    const deleteBtn = document.getElementById('simpleVideoKeyImageDelete');
    
    if (keyImage?.filename || keyImage?.previewUrl) {
        if (analyzeBtn) analyzeBtn.style.display = '';
        if (deleteBtn) deleteBtn.style.display = '';
    } else {
        if (analyzeBtn) analyzeBtn.style.display = 'none';
        if (deleteBtn) deleteBtn.style.display = 'none';
    }
    
    // Update key image analysis section visibility
    const analysisSection = document.getElementById('simpleVideoKeyImageAnalysis');
    if (analysisSection) {
        const hasAnalysis = !!state.keyImageAnalysis;
        analysisSection.style.display = hasAnalysis ? '' : 'none';
        
        if (hasAnalysis) {
            const textEl = document.getElementById('simpleVideoKeyImageAnalysisText');
            if (textEl) textEl.textContent = state.keyImageAnalysis || '';
        }
    }
}

/**
 * Clear character composite image
 */
function clearCharacterImage() {
    SimpleVideoUI.state.characterImage = null;
    SimpleVideoUI.state.characterImageAnalysis = null;
    saveSimpleVideoState();
    updateKeyImageAnalysisUI();
    updateGenerateButtonState();
    if (typeof showToast === 'function') showToast('キャラ画像をクリアしました', 'info');
}

/**
 * Parse VLM output to extract prompt and negative prompt
 */
function parseVLMOutput(rawOutput) {
    let prompt = '';
    let negativePrompt = '';
    
    const promptMarkers = [
        /\*\*Prompt:\*\*/i,
        /\*\*Image Generation Prompt:\*\*/i,
        /\*\*Video Generation Prompt:\*\*/i,
        /\*\*Generated Prompt:\*\*/i,
        /Prompt:/i
    ];
    
    const negativeMarkers = [
        /\*\*Negative Prompt:\*\*/i,
        /\*\*Negative:\*\*/i,
        /Negative Prompt:/i,
        /Negative:/i
    ];
    
    let text = rawOutput;
    
    // Find prompt marker and remove content before it
    for (const marker of promptMarkers) {
        const match = text.match(marker);
        if (match) {
            const index = text.indexOf(match[0]);
            text = text.substring(index + match[0].length).trim();
            break;
        }
    }
    
    // Separate negative prompt
    for (const marker of negativeMarkers) {
        const match = text.match(marker);
        if (match) {
            const index = text.indexOf(match[0]);
            prompt = text.substring(0, index).trim();
            negativePrompt = text.substring(index + match[0].length).trim();
            break;
        }
    }
    
    // If no negative prompt found
    if (!negativePrompt) {
        prompt = text.trim();
    }
    
    return { prompt, negativePrompt };
}

/**
 * Convert blob to base64 data URL string
 * Returns full data URL format: "data:image/...;base64,..."
 */
async function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            // Return full data URL (required for VLM API)
            resolve(reader.result || '');
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Analyze key image using VLM (same as full auto video)
 */
async function runKeyImageAnalysis() {
    const state = SimpleVideoUI.state;
    const keyImage = state.keyImage || state.uploadedImage;
    
    if (!keyImage?.filename && !keyImage?.previewUrl) {
        if (typeof showToast === 'function') showToast('解析するキー画像がありません', 'warning');
        return;
    }
    
    const analyzeBtn = document.getElementById('simpleVideoKeyImageAnalyzeBtn');
    const analysisSection = document.getElementById('simpleVideoKeyImageAnalysis');
    const statusEl = document.getElementById('simpleVideoKeyImageAnalysisStatus');
    const resultEl = document.getElementById('simpleVideoKeyImageAnalysisResult');
    const textEl = document.getElementById('simpleVideoKeyImageAnalysisText');
    const optionsWrap = analysisSection?.querySelector('.simple-video-character-analysis-options');
    
    if (analyzeBtn) {
        analyzeBtn.disabled = true;
        analyzeBtn.textContent = '⏳ 解析中...';
    }
    if (analysisSection) analysisSection.style.display = '';
    if (statusEl) {
        statusEl.style.display = '';
        statusEl.textContent = 'サーバーから画像を取得中...';
    }
    if (resultEl) resultEl.style.display = 'none';
    if (optionsWrap) optionsWrap.style.display = 'none';
    if (textEl) textEl.textContent = '';
    
    try {
        // Get image URL
        let imgUrl = keyImage.previewUrl;
        if (!imgUrl && keyImage.filename) {
            const api = window.app?.api;
            if (api?.baseURL) {
                imgUrl = `${api.baseURL}/view?filename=${encodeURIComponent(keyImage.filename)}&subfolder=${encodeURIComponent(keyImage.subfolder || '')}&type=${encodeURIComponent(keyImage.type || 'input')}`;
            } else {
                imgUrl = `/view?filename=${encodeURIComponent(keyImage.filename)}&subfolder=${encodeURIComponent(keyImage.subfolder || '')}&type=${encodeURIComponent(keyImage.type || 'input')}`;
            }
        }
        
        if (!imgUrl) {
            throw new Error('画像URLが取得できません');
        }
        
        // Fetch image and convert to base64
        const imgResp = await fetch(imgUrl);
        if (!imgResp.ok) {
            throw new Error(`画像の取得に失敗: ${imgResp.status}`);
        }
        const blob = await imgResp.blob();
        const imageBase64 = await blobToBase64(blob);
        
        if (statusEl) statusEl.textContent = 'VLMで解析中...';
        
        // Call VLM analyze API
        const api = window.app?.api;
        const apiUrl = api?.baseURL ? `${api.baseURL}/api/v1/vlm/analyze` : '/api/v1/vlm/analyze';
        
        const requestBody = {
            image_base64: imageBase64,
            mode: 'image',
            language: 'en'
        };
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        const result = await response.json();
        
        if (!result?.success) {
            throw new Error(result?.description || '画像解析に失敗しました');
        }
        
        const parsed = parseVLMOutput(result.description);
        
        // Store analysis result
        SimpleVideoUI.state.keyImageAnalysis = parsed.prompt || result.description || '';
        SimpleVideoUI.state.keyImageAnalysisRaw = {
            raw: result.description,
            prompt: parsed.prompt,
            negativePrompt: parsed.negativePrompt,
            elapsedTime: result.elapsed_time
        };
        saveSimpleVideoState();
        
        if (textEl) textEl.textContent = parsed.prompt || result.description || '';
        if (resultEl) resultEl.style.display = '';
        if (optionsWrap) optionsWrap.style.display = '';
        if (statusEl) statusEl.textContent = `✅ 解析完了 (${result.elapsed_time}秒)`;
        
        if (typeof showToast === 'function') showToast('✅ キー画像を解析しました', 'success');
        
    } catch (error) {
        console.error('[KeyImageAnalysis] Error:', error);
        if (statusEl) {
            statusEl.style.display = '';
            statusEl.textContent = `❌ エラー: ${error.message}`;
        }
        if (typeof showToast === 'function') showToast(`解析エラー: ${error.message}`, 'error');
    } finally {
        if (analyzeBtn) {
            analyzeBtn.disabled = false;
            analyzeBtn.textContent = '🔍 解析';
        }
    }
}

/**
 * Analyze character image using VLM
 * @deprecated Use runKeyImageAnalysis instead
 */
async function runCharacterImageAnalysis() {
    // Redirect to key image analysis
    return runKeyImageAnalysis();
}

/**
 * Generate character composite image using EDIT + I2I
 * Uses imagePrompt as EDIT prompt and dropSlots as ref1/ref2/ref3
 * Also supports @character tokens that resolve to registered character images
 */
async function runCharacterImageGeneration() {
    const state = SimpleVideoUI.state;
    const preset = VIDEO_PRESETS.find(p => p.id === state.selectedPreset);
    
    if (!preset?.requiresCharacterImage) {
        if (typeof showToast === 'function') showToast('このプリセットではキャラ画像生成は不要です', 'warning');
        return;
    }
    
    // Get drop slots as ref images
    const dropSlots = Array.isArray(state.dropSlots) ? state.dropSlots : [];
    const ref1 = dropSlots[0]?.filename || null;
    const ref2 = dropSlots[1]?.filename || null;
    const ref3 = dropSlots[2]?.filename || null;
    
    // Get EDIT prompt from imagePrompt field
    let editPrompt = String(state.imagePrompt || '').trim();
    
    // Check if prompt has character tokens (@name, 「name」, "name", etc.)
    const hasCharacterToken = /[@＠]|「[^」]+」|"[^"]+"|"[^"]+"/.test(editPrompt);
    
    // Require at least one reference image OR character token in prompt
    if (!ref1 && !hasCharacterToken) {
        if (typeof showToast === 'function') showToast('📥 画像ドロップに参照画像をドロップするか、プロンプトに@キャラ名を含めてください', 'warning');
        return;
    }
    
    // EDIT prompt is required when using character tokens
    if (!editPrompt && !ref1) {
        if (typeof showToast === 'function') showToast('EDITプロンプトを入力してください', 'warning');
        return;
    }
    
    // If no prompt provided but ref1 exists, use ref1 as-is
    if (!editPrompt) {
        // Use ref1 directly as character image
        const ref1PreviewUrl = dropSlots[0]?.previewUrl || getSimpleVideoInputImageURL(ref1);
        SimpleVideoUI.state.characterImage = {
            filename: ref1,
            subfolder: '',
            type: 'input',
            jobId: null,
            previewUrl: ref1PreviewUrl,
            presetId: preset.id
        };
        
        // Also set as key image for preview in key image area
        SimpleVideoUI.state.keyImage = {
            filename: ref1,
            subfolder: '',
            type: 'input',
            jobId: null,
            previewUrl: ref1PreviewUrl,
            originalName: dropSlots[0]?.originalName || ref1
        };
        
        saveSimpleVideoState();
        updateCharacterImageUI();
        updateSimpleVideoUI(); // Update key image area
        updateGenerateButtonState();
        if (typeof showToast === 'function') showToast('参照画像をキャラ画像として設定しました（EDITなし）', 'info');
        return;
    }
    
    // Expand @character tokens to character description/LoRA references
    // Also retrieves character image filenames if available
    const { expandedPrompt, characterImages } = await expandCharacterTokensInPrompt(editPrompt);
    editPrompt = expandedPrompt;
    
    // Build effective reference images
    // Priority: characterImages from @token FIRST, then dropSlots fill remaining slots
    // - @キャラ名 -> Picture 1 (input_image)
    // - ref1/ref2/ref3 (dropSlots) -> Picture 2, 3, 4 (input_image_2, 3, 4)
    let effectiveRef1 = null;
    let effectiveRef2 = null;
    let effectiveRef3 = null;
    let effectiveRef4 = null;
    
    let slotIndex = 0;
    
    // Track which Picture number each source maps to
    const pictureMapping = {
        // characterImages[i].originalToken -> Picture N
        // ref1/ref2/ref3 -> Picture N (based on actual slot assignment)
    };
    let nextPictureNum = 1;
    
    // First, fill with character images from @token
    if (characterImages.length > 0) {
        for (const charImg of characterImages) {
            if (!charImg?.filename) continue;
            const pictureNum = nextPictureNum++;
            
            // Store mapping from original token to Picture N
            if (charImg.originalToken) {
                pictureMapping[charImg.originalToken] = pictureNum;
            }
            
            if (!effectiveRef1) {
                effectiveRef1 = charImg.filename;
                console.log(`[CharacterImage] Using registered character image for Picture ${pictureNum}: ${effectiveRef1}`);
            } else if (!effectiveRef2) {
                effectiveRef2 = charImg.filename;
                console.log(`[CharacterImage] Using registered character image for Picture ${pictureNum}: ${effectiveRef2}`);
            } else if (!effectiveRef3) {
                effectiveRef3 = charImg.filename;
                console.log(`[CharacterImage] Using registered character image for Picture ${pictureNum}: ${effectiveRef3}`);
            } else if (!effectiveRef4) {
                effectiveRef4 = charImg.filename;
                console.log(`[CharacterImage] Using registered character image for Picture ${pictureNum}: ${effectiveRef4}`);
            }
        }
    }
    
    // Then, fill remaining slots with dropSlots (ref1/ref2/ref3)
    // Track which ref maps to which Picture number
    const refToPicture = {};
    const dropSlotRefs = [
        { ref: 'ref1', file: ref1 },
        { ref: 'ref2', file: ref2 },
        { ref: 'ref3', file: ref3 }
    ];
    
    for (const { ref, file } of dropSlotRefs) {
        if (!file) continue; // Skip empty slots
        
        const pictureNum = nextPictureNum++;
        refToPicture[ref] = pictureNum;
        
        if (!effectiveRef1) {
            effectiveRef1 = file;
            console.log(`[CharacterImage] Using ${ref} for Picture ${pictureNum}: ${effectiveRef1}`);
        } else if (!effectiveRef2) {
            effectiveRef2 = file;
            console.log(`[CharacterImage] Using ${ref} for Picture ${pictureNum}: ${effectiveRef2}`);
        } else if (!effectiveRef3) {
            effectiveRef3 = file;
            console.log(`[CharacterImage] Using ${ref} for Picture ${pictureNum}: ${effectiveRef3}`);
        } else if (!effectiveRef4) {
            effectiveRef4 = file;
            console.log(`[CharacterImage] Using ${ref} for Picture ${pictureNum}: ${effectiveRef4}`);
        }
    }
    
    // Validate that we have at least one image
    if (!effectiveRef1) {
        if (typeof showToast === 'function') showToast('参照画像が見つかりません。📥画像ドロップに画像をセットするか、登録済みのキャラクター名を確認してください', 'error');
        return;
    }
    
    console.log(`[CharacterImage] Picture mapping:`, pictureMapping);
    console.log(`[CharacterImage] Ref to Picture:`, refToPicture);
    
    // Replace character tokens with Picture N (e.g., "ももちゃん" -> "Picture 1")
    for (const [token, pictureNum] of Object.entries(pictureMapping)) {
        const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        editPrompt = editPrompt.replace(new RegExp(escapedToken, 'g'), `Picture ${pictureNum}`);
        console.log(`[CharacterImage] Replaced ${token} -> Picture ${pictureNum}`);
    }
    
    // Replace ref1/ref2/ref3 with their actual Picture numbers
    for (const [ref, pictureNum] of Object.entries(refToPicture)) {
        editPrompt = editPrompt.replace(new RegExp(`\\b${ref}\\b`, 'gi'), `Picture ${pictureNum}`);
        console.log(`[CharacterImage] Replaced ${ref} -> Picture ${pictureNum}`);
    }
    
    const genBtn = document.getElementById('simpleVideoCharacterImageGenBtn');
    if (genBtn) {
        genBtn.disabled = true;
        genBtn.textContent = '⏳ 生成中...';
    }
    
    try {
        const api = window.app?.api;
        if (!api || typeof api.generate !== 'function' || typeof api.monitorProgress !== 'function') {
            throw new Error('APIが利用できません');
        }
        
        const { width, height } = getEffectiveWH();
        
        // Use EDIT workflow (Qwen 2511 supports multi-image)
        const hasMultipleImages = !!effectiveRef2;
        let editWorkflow = normalizeWorkflowAlias(state.i2iRefineWorkflow || 'qwen_i2i_2511_bf16_lightning4');
        
        // Force to 2511 for multi-image support
        if (hasMultipleImages && (editWorkflow === 'qwen_i2i_2512_lightning4' || editWorkflow === 'qwen_i2i_fp8_lightning4')) {
            editWorkflow = 'qwen_i2i_2511_bf16_lightning4';
        }
        
        // Wrap prompt for Qwen 2511 EDIT format
        const finalPrompt = isQwen2511ImageEditWorkflowId(editWorkflow) 
            ? wrapQwen2511EditInstructionPrompt(editPrompt)
            : editPrompt;
        
        const params = {
            prompt: finalPrompt,
            input_image: effectiveRef1,
            denoise: Number(normalizeDenoise(state.i2iDenoise, '1.0')),
            cfg: Number(normalizeCfg(state.i2iCfg, '1.0'))
        };
        
        // Add additional reference images if available
        if (effectiveRef2) {
            params.input_image_2 = effectiveRef2;
        }
        if (effectiveRef3) {
            params.input_image_3 = effectiveRef3;
        }
        if (effectiveRef4) {
            params.input_image_4 = effectiveRef4;
        }
        
        if (width && height) {
            params.width = width;
            params.height = height;
        }
        
        if (typeof showToast === 'function') showToast('🎭 キャラ合成画像を生成中...', 'info');
        
        console.log('[CharacterImage] workflow:', editWorkflow);
        console.log('[CharacterImage] params:', JSON.stringify(params, null, 2));
        
        const job = await api.generate({ workflow: editWorkflow, ...params });
        const jobId = job?.job_id;
        if (!jobId) throw new Error('job_id が取得できません');
        
        // Monitor progress
        await new Promise((resolve, reject) => {
            let done = false;
            const finish = (fn) => (arg) => {
                if (done) return;
                done = true;
                fn(arg);
            };
            
            api.monitorProgress(
                jobId,
                (p) => {
                    // Progress callback
                },
                finish(() => resolve()),
                finish((err) => reject(err))
            );
        });
        
        // Get outputs
        const outputsPayload = (typeof api.getOutputs === 'function') ? await api.getOutputs(jobId) : null;
        const outputs = Array.isArray(outputsPayload?.outputs) ? outputsPayload.outputs : [];
        
        const imgOut = pickBestOutput(outputs, 'image');
        if (!imgOut?.filename) throw new Error('キャラ画像の出力が見つかりませんでした');
        
        const previewUrl = getSimpleVideoDownloadURL(jobId, imgOut.filename);
        
        SimpleVideoUI.state.characterImage = {
            filename: imgOut.filename,
            subfolder: imgOut.subfolder || '',
            type: imgOut.type || 'output',
            jobId,
            previewUrl,
            presetId: preset.id
        };
        
        // Also set as key image for preview in key image area
        SimpleVideoUI.state.keyImage = {
            filename: imgOut.filename,
            subfolder: imgOut.subfolder || '',
            type: imgOut.type || 'output',
            jobId,
            previewUrl,
            originalName: `キャラ合成: ${imgOut.filename}`
        };
        
        saveSimpleVideoState();
        updateCharacterImageUI();
        updateSimpleVideoUI(); // Update key image area
        updateGenerateButtonState();
        
        if (typeof showToast === 'function') showToast('✅ キャラ画像を生成しました', 'success');
        
    } catch (error) {
        console.error('[CharacterImage] Error:', error);
        if (typeof showToast === 'function') showToast(`エラー: ${error.message}`, 'error');
    } finally {
        if (genBtn) {
            genBtn.disabled = false;
            genBtn.textContent = '生成';
        }
    }
}

function updateGenerateButtonState() {
    const generateBtn = document.getElementById('simpleVideoGenerateBtn');
    const promptGenBtn = document.getElementById('simpleVideoPromptGenBtn');
    const videoInitBtn = document.getElementById('simpleVideoVideoInitImageBtn');
    const stopBtn = document.getElementById('simpleVideoStopBtn');
    const imageStopBtn = document.getElementById('simpleVideoImageStopBtn');
    const imageGenBtn = document.getElementById('simpleVideoImageGenBtn');
    const continueBtn = document.getElementById('simpleVideoContinueBtn');
    const pauseBtn = document.getElementById('simpleVideoPauseAtIntermediateBtn');
    if (!generateBtn) return;
    
    const { state } = SimpleVideoUI;
    const preset = VIDEO_PRESETS.find(p => p.id === state.selectedPreset);
    
    let canGenerate = true;
    
    // Must have a preset selected
    if (!preset) canGenerate = false;
    
    // Must have a scenario
    if (!state.scenario.trim()) canGenerate = false;
    
    // If preset requires image, must have uploaded key image OR a prepared video-initial frame
    // For char_edit_i2i_flf, dropSlots[0] (ref1) is used instead of key image
    const hasPreparedVideoInitialImage = !!String(state.preparedVideoInitialImage?.filename || '').trim();
    let desiredCount = Math.max(1, Number(state.sceneCount) || 1);
    // FLF-only presets need N+1 images to produce N FLF transition segments
    if (preset?.flfOnly) desiredCount += 1;
    const hasIntermediate = !!preset && hasCompleteIntermediateImagesForPreset({ presetId: preset.id, desiredCount });
    const dropSlots = Array.isArray(state.dropSlots) ? state.dropSlots : [];
    const hasRef1 = !!dropSlots[0]?.filename;
    const hasUploadedImage = !!state.uploadedImage?.filename;
    const hasReferenceImage = hasUploadedImage || hasRef1;
    const hasCharacterContext = !!state.selectedCharacter || !!String(state.characterImage?.filename || '').trim();
    const hasAnyRefImage = hasUploadedImage
        || hasRef1
        || !!String(state.characterImage?.filename || '').trim()
        || !!String(state.preparedInitialImage?.filename || '').trim();
    
    if (preset?.requiresCharacterImage) {
        if (!hasAnyRefImage && !hasPreparedVideoInitialImage && !hasIntermediate) canGenerate = false;
    } else if (preset?.requiresImage && !hasReferenceImage && !hasPreparedVideoInitialImage && !hasIntermediate) {
        // char_i2i_flf etc: require key image OR dropSlots[0]
        canGenerate = false;
    }
    
    // If preset requires character, must have selected character
    if (preset?.requiresCharacter && !hasCharacterContext) canGenerate = false;

    // If preset requires character image (char_edit_i2i_flf, char_edit_i2v_scene_cut),
    // it's only strictly needed when intermediate images aren't all ready yet.
    if (preset?.requiresCharacterImage && !hasAnyRefImage && !hasIntermediate) canGenerate = false;
    
    const isBusy = !!(
        state.isGenerating
        || state.isPromptGenerating
        || state.isImageGenerating
        || state.t2aIsGenerating
        || state.t2aIsComposingLyrics
        || state.t2aIsSuggestingTags
        || state.t2aIsAutoGenerating
    );

    // Can't generate while already generating (video or prompt-gen)
    if (isBusy) canGenerate = false;
    
    generateBtn.disabled = !canGenerate;

    // Update tooltip to show why generate is disabled
    if (!canGenerate && !isBusy) {
        const reasons = [];
        if (!preset) reasons.push('生成シーケンスを選択');
        if (!state.scenario.trim()) reasons.push('シナリオを入力');
        if (preset?.requiresCharacter && !hasCharacterContext) reasons.push('キャラクターを選択 or キャラ画像を生成');
        if (preset?.requiresCharacterImage && !hasAnyRefImage && !hasIntermediate) reasons.push('キー画像/キャラ画像/ref1 のいずれかを用意');
        if (preset?.requiresImage && !hasReferenceImage && !hasPreparedVideoInitialImage && !hasIntermediate) reasons.push('キー画像をアップロード');
        generateBtn.title = reasons.length > 0 ? `必要: ${reasons.join('、')}` : '';
    } else {
        generateBtn.title = isBusy ? '生成中...' : '動画を生成';
    }

    if (promptGenBtn) {
        // Prompt generation is available when scenario exists. Preset is optional.
        const canPromptGen = !!String(state.scenario || '').trim() && !isBusy;
        promptGenBtn.disabled = !canPromptGen;
    }

    if (videoInitBtn) {
        // Scene pre-generation button: same logic as midGenBtn
        // Enable for char_i2i_flf, char_edit_i2i_flf, char_edit_i2v_scene_cut, or ext_i2i_i2v_scene_cut (presets with supportsPregenerateImages)
        const isFLFPreset = String(preset?.id || '') === 'char_i2i_flf' || String(preset?.id || '') === 'char_edit_i2i_flf' || String(preset?.id || '') === 'char_edit_i2v_scene_cut';
        const supportsMidGen = !!preset && (isFLFPreset || !!preset.supportsPregenerateImages);
        // For ext_i2i_i2v_scene_cut, also require key image
        // char_edit_* presets use dropSlots[0] instead of uploadedImage;
        // also accept characterImage as a valid reference for scene pre-generation.
        const hasAnyRefImage = !!String(state.uploadedImage?.filename || '').trim()
            || !!dropSlots[0]?.filename
            || !!String(state.characterImage?.filename || '').trim();
        const needsKeyImage = preset?.requiresImage && !hasAnyRefImage;
        const canVideoInit = supportsMidGen
            && !!String(state.scenario || '').trim()
            && !needsKeyImage
            && !isBusy;
        videoInitBtn.disabled = !canVideoInit;
    }

    if (stopBtn) {
        // Always visible; enabled while the pipeline is running.
        stopBtn.disabled = !isBusy;
    }

    if (imageStopBtn) {
        imageStopBtn.disabled = !isBusy;
    }

    if (imageGenBtn) {
        const hasPrompt = !!String(state.imagePrompt || '').trim() || !!String(state.scenario || '').trim();
        imageGenBtn.disabled = isBusy || !hasPrompt;
    }

    if (continueBtn) {
        continueBtn.disabled = !simpleVideoContinueGateActive || !!state.isImageGenerating;
    }
    if (pauseBtn) {
        pauseBtn.disabled = !simpleVideoContinueGateActive || !!state.isImageGenerating;
    }
    const regenAllBtn = document.getElementById('simpleVideoRegenAllScenesBtn');
    if (regenAllBtn) {
        regenAllBtn.disabled = !simpleVideoContinueGateActive || !!state.isImageGenerating;
    }
    const restartBtn = document.getElementById('simpleVideoRestartM2VBtn');
    if (restartBtn) {
        restartBtn.disabled = !simpleVideoContinueGateActive || !!state.isImageGenerating;
    }

    updateSimpleVideoT2AButtonState();
}

function updateSimpleVideoT2AButtonState() {
    const { state } = SimpleVideoUI;
    const t2aBtn = document.getElementById('simpleVideoT2AGenBtn');
    const autoBtn = document.getElementById('simpleVideoT2AAutoBtn');
    const composeBtn = document.getElementById('simpleVideoT2AComposeLyricsBtn');
    const suggestBtn = document.getElementById('simpleVideoT2ASuggestTagsBtn');
    if (!t2aBtn && !autoBtn && !composeBtn && !suggestBtn) return;

    const isBusy = !!(
        state.isGenerating
        || state.isPromptGenerating
        || state.isImageGenerating
        || state.t2aIsGenerating
        || state.t2aIsComposingLyrics
        || state.t2aIsSuggestingTags
        || state.t2aIsAutoGenerating
    );
    const hasTags = !!String(state.t2aTags || '').trim();
    const hasLyrics = !!String(state.t2aLyrics || '').trim();
    const hasTheme = !!String(state.t2aScenario || '').trim()
        || !!String(state.scenario || '').trim()
        || !!String(state.imagePrompt || '').trim();

    if (t2aBtn) {
        t2aBtn.disabled = isBusy || !hasTags;
        t2aBtn.innerHTML = state.t2aIsGenerating
            ? '<i class="fas fa-hourglass-half"></i> 生成中...'
            : '<i class="fas fa-music"></i> 音楽を生成';
        t2aBtn.title = !hasTags ? 'Tagsを入力してください' : (isBusy ? '他の処理が実行中です' : 'ACE-Step 1.5でBGM生成');
    }

    if (autoBtn) {
        autoBtn.disabled = isBusy || !hasTheme;
        autoBtn.textContent = state.t2aIsAutoGenerating ? '⏳ AUTO中...' : '🚀 AUTO';
        autoBtn.title = !hasTheme ? '音楽シナリオ、動画シナリオ、または画像プロンプトを入力してください' : (isBusy ? '他の処理が実行中です' : '作詞→タグ提案→音楽生成を自動実行');
    }

    if (composeBtn) {
        composeBtn.disabled = isBusy || !hasTheme;
        composeBtn.textContent = state.t2aIsComposingLyrics ? '⏳ 作詞中...' : '🎼 作詞';
        composeBtn.title = !hasTheme ? '音楽シナリオ、動画シナリオ、または画像プロンプトを入力してください' : (isBusy ? '他の処理が実行中です' : 'シナリオから歌詞を生成');
    }

    if (suggestBtn) {
        suggestBtn.disabled = isBusy || !hasLyrics;
        suggestBtn.textContent = state.t2aIsSuggestingTags ? '⏳ 分析中...' : '🏷️ タグ提案';
        suggestBtn.title = !hasLyrics ? '歌詞を入力してください' : (isBusy ? '他の処理が実行中です' : '歌詞からタグを提案');
    }

    const m2vBtn = document.getElementById('simpleVideoM2VBtn');
    if (m2vBtn) {
        const hasAudio = !!pickPreferredM2VAudioSource(state);
        m2vBtn.disabled = isBusy || state.m2vIsRunning || !hasAudio;
        m2vBtn.innerHTML = state.m2vIsRunning
            ? '<i class="fas fa-hourglass-half"></i> M2V実行中...'
            : '<i class="fas fa-film"></i> 音楽→動画';
        m2vBtn.title = !hasAudio ? '音源（生成またはアップロード）を用意してください' : '音源尺を反映して動画を生成';
    }

    const v2mBtn = document.getElementById('simpleVideoV2MBtn');
    if (v2mBtn) {
        const hasVideoSource = !!pickPreferredV2MVideoSource(state);
        v2mBtn.disabled = isBusy || state.v2mIsRunning || !hasVideoSource;
        v2mBtn.innerHTML = state.v2mIsRunning
            ? '<i class="fas fa-hourglass-half"></i> V2M実行中...'
            : '<i class="fas fa-music"></i> 動画→音楽';
        v2mBtn.title = !hasVideoSource ? '動画入力（生成またはアップロード）を用意してください' : '動画尺を反映してBGMを生成';
    }
}

function getSimpleVideoBaseURL() {
    const host = String(window.location.hostname || '').toLowerCase();
    const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (!isLocalHost && window.location.origin) {
        return String(window.location.origin);
    }
    if (window.app && window.app.api && window.app.api.baseURL) {
        return String(window.app.api.baseURL);
    }
    return String(window.location.origin || '');
}

function getSimpleVideoClientSessionId() {
    try {
        if (typeof getEffectiveClientSessionId === 'function') return getEffectiveClientSessionId();
        if (typeof getClientSessionId === 'function') return getClientSessionId();
    } catch (_e) {}
    return null;
}

async function fileToBase64String(file) {
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.onload = () => {
            const result = String(reader.result || '');
            const idx = result.indexOf(',');
            resolve(idx >= 0 ? result.slice(idx + 1) : result);
        };
        reader.readAsDataURL(file);
    });
}

async function uploadSimpleVideoFile(file) {
    const uploadUrl = '/api/v1/upload';
    const uploadBase64Url = '/api/v1/upload/base64';

    const form = new FormData();
    form.append('file', file);
    form.append('original_name', String(file?.name || 'upload.bin'));
    const sessionId = getSimpleVideoClientSessionId();
    if (sessionId) form.append('client_session_id', String(sessionId));

    try {
        const resp = await fetch(uploadUrl, {
            method: 'POST',
            body: form,
            credentials: 'same-origin',
        });
        if (!resp.ok) throw new Error(`upload failed: ${resp.status}`);
        return await resp.json();
    } catch (multipartErr) {
        console.warn('[SimpleVideo] multipart upload failed, fallback to base64:', multipartErr?.message || multipartErr);
        try {
            const dataBase64 = await fileToBase64String(file);
            const payload = {
                filename: String(file?.name || 'upload.bin'),
                mime_type: String(file?.type || 'application/octet-stream'),
                data_base64: dataBase64,
                client_session_id: sessionId ? String(sessionId) : null,
            };

            const resp2 = await fetch(uploadBase64Url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                credentials: 'same-origin',
            });
            if (!resp2.ok) throw new Error(`upload(base64) failed: ${resp2.status}`);
            return await resp2.json();
        } catch (fallbackErr) {
            const msg = String(fallbackErr?.message || fallbackErr || '');
            const authLikely = msg.includes('401') || msg.includes('NetworkError') || msg.includes('Failed to fetch');
            if (authLikely) {
                try {
                    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
                    const authUrl = `/api/v1/auth-check?next=${encodeURIComponent(next)}`;
                    if (typeof showToast === 'function') {
                        showToast('認証が必要です。認証確認ページへ移動します...', 'warning');
                    }
                    setTimeout(() => {
                        window.location.href = authUrl;
                    }, 250);
                } catch (_e) {}
            }
            throw fallbackErr;
        }
    }
}

function toSimpleVideoBasename(filename) {
    return String(filename || '').split('/').pop() || '';
}

function formatSimpleVideoDuration(sec) {
    const n = Number(sec);
    if (!Number.isFinite(n) || n <= 0) return '-';
    const rounded = Math.round(n * 10) / 10;
    return `${rounded}秒`;
}

function getSimpleVideoInputFileURL(filename) {
    const base = getSimpleVideoBaseURL();
    if (!base || !filename) return '';
    return `${base}/api/v1/files/${encodeURIComponent(String(filename))}`;
}

async function probeSimpleVideoMediaDuration(url, kind = 'audio') {
    const targetUrl = String(url || '').trim();
    if (!targetUrl) return null;

    return await new Promise((resolve) => {
        const media = document.createElement(kind === 'video' ? 'video' : 'audio');
        media.preload = 'metadata';
        media.src = targetUrl;

        const done = (value) => {
            try {
                media.removeAttribute('src');
                media.load();
            } catch (_e) {}
            resolve(value);
        };

        media.onloadedmetadata = () => {
            const duration = Number(media.duration);
            if (Number.isFinite(duration) && duration > 0) {
                done(duration);
            } else {
                done(null);
            }
        };
        media.onerror = () => done(null);
    });
}

function pickPreferredM2VAudioSource(state) {
    const uploaded = state?.t2aUploadedAudio;
    const generated = state?.t2aGeneratedAudio;
    if (uploaded?.filename && isAudioFilename(uploaded.filename)) return { ...uploaded, source: 'uploaded' };
    if (generated?.filename && isAudioFilename(generated.filename)) return { ...generated, source: 'generated' };
    return null;
}

function pickPreferredV2MVideoSource(state) {
    const uploaded = state?.v2mUploadedVideo;
    const generated = state?.v2mGeneratedVideo;
    if (uploaded?.filename) return { ...uploaded, source: 'uploaded' };
    if (generated?.filename) return { ...generated, source: 'generated' };
    return null;
}

function allocateM2VSceneDurations(audioSec, sceneCount, options = {}) {
    const minSec = Number.isFinite(options.minSec) ? Number(options.minSec) : 2;
    const baseSec = Number.isFinite(options.baseSec) ? Number(options.baseSec) : 5;
    const maxSec = Number.isFinite(options.maxSec) ? Number(options.maxSec) : 7;

    const count = Math.max(1, Math.round(Number(sceneCount) || 1));
    const durations = Array.from({ length: count }, () => baseSec);

    const minTotal = count * minSec;
    const maxTotal = count * maxSec;
    let target = Math.round(Number(audioSec) || baseSec * count);
    target = Math.min(maxTotal, Math.max(minTotal, target));

    let delta = target - durations.reduce((sum, v) => sum + v, 0);
    let index = 0;
    while (delta !== 0) {
        if (delta > 0) {
            if (durations[index] < maxSec) {
                durations[index] += 1;
                delta -= 1;
            }
        } else {
            if (durations[index] > minSec) {
                durations[index] -= 1;
                delta += 1;
            }
        }
        index = (index + 1) % count;
    }

    return durations;
}

async function runSimpleVideoUtilityJob({ requestBody, progressPrefix = 'Utility', cancelSeqAtStart = null }) {
    const api = window.app?.api;
    if (!api || typeof api.generateUtility !== 'function' || typeof api.monitorProgress !== 'function') {
        throw new Error('APIが利用できません（app.api.generateUtility/monitorProgress）');
    }

    const job = await api.generateUtility(requestBody);
    const jobId = String(job?.job_id || '');
    if (!jobId) throw new Error('utility job_idが取得できません');

    SimpleVideoUI.state.activeJobId = jobId;
    saveSimpleVideoState();
    updateGenerateButtonState();

    try {
        await new Promise((resolve, reject) => {
            let done = false;
            const finish = (fn) => (arg) => {
                if (done) return;
                done = true;
                fn(arg);
            };

            api.monitorProgress(
                jobId,
                (p) => {
                    if (cancelSeqAtStart !== null && (Number(SimpleVideoUI.state.cancelSeq) || 0) !== Number(cancelSeqAtStart)) {
                        try { api.closeWebSocket?.(jobId); } catch (_e) {}
                        finish(reject)(new Error('Cancelled'));
                        return;
                    }
                    const local = normalizeProgress01(p?.progress);
                    setSimpleVideoProgress(`${progressPrefix}: ${p?.message || 'Processing...'}`, local);
                },
                finish(() => resolve(true)),
                finish((err) => reject(err instanceof Error ? err : new Error(String(err))))
            );
        });

        const outputsPayload = (typeof api.getOutputs === 'function') ? await api.getOutputs(jobId) : null;
        const outputs = Array.isArray(outputsPayload?.outputs) ? outputsPayload.outputs : [];
        return { jobId, outputs };
    } finally {
        if (String(SimpleVideoUI.state.activeJobId || '') === jobId) {
            SimpleVideoUI.state.activeJobId = null;
            saveSimpleVideoState();
            updateGenerateButtonState();
        }
    }
}

async function runSimpleVideoUtilityResultJob({ requestBody, progressPrefix = 'Utility', cancelSeqAtStart = null }) {
    const api = window.app?.api;
    if (!api || typeof api.generateUtility !== 'function' || typeof api.monitorProgress !== 'function' || typeof api.getJobStatus !== 'function') {
        throw new Error('APIが利用できません（app.api.generateUtility/monitorProgress/getJobStatus）');
    }

    const job = await api.generateUtility(requestBody);
    const jobId = String(job?.job_id || '');
    if (!jobId) throw new Error('utility job_idが取得できません');

    SimpleVideoUI.state.activeJobId = jobId;
    saveSimpleVideoState();
    updateGenerateButtonState();

    try {
        await new Promise((resolve, reject) => {
            let done = false;
            const finish = (fn) => (arg) => {
                if (done) return;
                done = true;
                fn(arg);
            };

            api.monitorProgress(
                jobId,
                (p) => {
                    if (cancelSeqAtStart !== null && (Number(SimpleVideoUI.state.cancelSeq) || 0) !== Number(cancelSeqAtStart)) {
                        try { api.closeWebSocket?.(jobId); } catch (_e) {}
                        finish(reject)(new Error('Cancelled'));
                        return;
                    }
                    const local = normalizeProgress01(p?.progress);
                    setSimpleVideoProgress(`${progressPrefix}: ${p?.message || 'Processing...'}`, local);
                },
                finish(() => resolve(true)),
                finish((err) => reject(err instanceof Error ? err : new Error(String(err))))
            );
        });

        const full = await api.getJobStatus(jobId);
        if (String(full?.status || '') !== 'completed') {
            const details = full?.error || full?.message || `status=${String(full?.status || 'unknown')}`;
            throw new Error(details);
        }

        const outputsPayload = (typeof api.getOutputs === 'function') ? await api.getOutputs(jobId) : null;
        const outputs = Array.isArray(outputsPayload?.outputs) ? outputsPayload.outputs : [];
        return { jobId, result: full?.result || null, outputs };
    } finally {
        if (String(SimpleVideoUI.state.activeJobId || '') === jobId) {
            SimpleVideoUI.state.activeJobId = null;
            saveSimpleVideoState();
            updateGenerateButtonState();
        }
    }
}

function buildM2VPromptFromSpec(spec) {
    if (!spec || typeof spec !== 'object') return '';

    const storySummary = String(spec.story_summary || '').trim();
    const beats = Array.isArray(spec.scene_beats) ? spec.scene_beats.map((v) => String(v || '').trim()).filter(Boolean) : [];
    const durations = Array.isArray(spec.scene_durations_sec) ? spec.scene_durations_sec : [];
    const motifs = Array.isArray(spec.visual_motifs) ? spec.visual_motifs.map((v) => String(v || '').trim()).filter(Boolean) : [];
    const moodCurve = Array.isArray(spec.mood_curve) ? spec.mood_curve.map((v) => String(v || '').trim()).filter(Boolean) : [];
    const language = String(spec.language || '').trim() || 'Japanese';

    const anchorSource = [
        String(spec.story_summary || ''),
        ...beats,
        ...motifs,
        ...moodCurve,
    ].join(' ').toLowerCase();

    const hasJapanAnchor = /日本|japan|tokyo|roppongi|shibuya|shinjuku|京都|大阪|六本木|東京/.test(anchorSource);
    const hasJapanesePersonAnchor = /日本人|japanese\s+(woman|man|person|girl|boy)|japanese\s+female|japanese\s+male/.test(anchorSource);

    const lines = [];
    lines.push('Music-to-video prompt generation spec:');
    if (storySummary) lines.push(`Story summary: ${storySummary}`);
    if (motifs.length > 0) lines.push(`Visual motifs: ${motifs.join(', ')}`);
    if (moodCurve.length > 0) lines.push(`Mood curve: ${moodCurve.join(' -> ')}`);
    lines.push(`Target language context: ${language}`);
    if (durations.length > 0) lines.push(`Scene durations (seconds): ${durations.join(', ')}`);
    if (beats.length > 0) {
        lines.push('Scene beats:');
        beats.forEach((beat, idx) => {
            const d = Number(durations[idx]);
            const ds = Number.isFinite(d) && d > 0 ? ` (${Math.round(d)}s)` : '';
            lines.push(`#${idx + 1}${ds}: ${beat}`);
        });
    }
    lines.push('Hard continuity constraints (must hold across ALL scenes):');
    if (hasJapanAnchor) {
        lines.push('- Keep the location in Japan (do not change to Europe/US or other countries).');
    }
    if (hasJapanesePersonAnchor) {
        lines.push('- Keep the main character as Japanese (do not change ethnicity/nationality).');
    }
    if (hasJapanAnchor || hasJapanesePersonAnchor) {
        lines.push('- Do not westernize names, streets, architecture, extras, or cultural context unless explicitly requested.');
    }
    lines.push('Generate scene prompts that align each scene content with its target duration.');
    lines.push('Keep continuity and avoid abrupt style changes between scenes.');
    return lines.join('\n');
}

function buildM2VFallbackPromptOverride({ lyricsText, sceneDurationsSec, targetDurationSec, language }) {
    const lyrics = String(lyricsText || '').trim();
    const durations = Array.isArray(sceneDurationsSec)
        ? sceneDurationsSec.map((v) => Math.max(1, Math.round(Number(v) || 0))).filter((v) => Number.isFinite(v) && v > 0)
        : [];
    const targetSec = Number(targetDurationSec);
    const lang = String(language || 'Japanese').trim() || 'Japanese';

    const lines = [];
    lines.push('Music-to-video prompt generation fallback spec:');
    lines.push(`Target language context: ${lang}`);
    if (durations.length > 0) lines.push(`Scene durations (seconds): ${durations.join(', ')}`);
    if (Number.isFinite(targetSec) && targetSec > 0) lines.push(`Target duration (seconds): ${Math.round(targetSec)}`);
    if (lyrics) {
        lines.push('Lyrics anchor (use as visual continuity source):');
        lines.push(lyrics.slice(0, 2400));
    } else {
        lines.push('No lyrics are available. Build a coherent cinematic progression from the audio mood.');
    }
    lines.push('Generate scene prompts aligned with each scene duration, preserving coherent narrative and visual continuity.');
    return lines.join('\n');
}

async function prepareM2VPromptSpec({ scenarioText, lyricsText, sceneDurationsSec, targetDurationSec, cancelSeqAtStart }) {
    const result = await runSimpleVideoUtilityResultJob({
        requestBody: {
            workflow: 'spec_generate',
            spec_mode: 'm2v',
            scenario: String(scenarioText || ''),
            lyrics: String(lyricsText || ''),
            scene_durations_sec: Array.isArray(sceneDurationsSec) ? sceneDurationsSec : [],
            target_duration_sec: Number.isFinite(Number(targetDurationSec)) ? Number(targetDurationSec) : null,
            language: mapSimpleVideoT2ALanguageToLyricsLanguage(SimpleVideoUI.state.t2aLanguage),
        },
        progressPrefix: '🧩 M2V仕様生成',
        cancelSeqAtStart,
    });
    return result?.result?.spec || null;
}

function renderSimpleVideoM2VSourceUI() {
    const state = SimpleVideoUI.state;
    const effectiveMode = state.t2aUploadedAudio?.filename ? 'uploaded' : 'generated';
    const modeSel = document.getElementById('simpleVideoM2VSourceMode');
    if (modeSel) {
        try { modeSel.value = effectiveMode; } catch (_e) {}
        modeSel.disabled = true;
        modeSel.title = 'Phase 1では uploaded 優先で自動選択されます';
    }

    const meta = document.getElementById('simpleVideoM2VSourceMeta');
    const dropWrap = document.getElementById('simpleVideoM2VAudioDrop');
    const ph = document.getElementById('simpleVideoM2VAudioDropPlaceholder');
    const dropMeta = document.getElementById('simpleVideoM2VAudioDropMeta');
    if (!meta || !dropWrap || !ph || !dropMeta) return;

    const uploaded = state.t2aUploadedAudio;
    const generated = state.t2aGeneratedAudio;
    const active = pickPreferredM2VAudioSource(state);
    const sourceLabel = active ? `${active.source} / ${toSimpleVideoBasename(active.filename)} / ${formatSimpleVideoDuration(active.durationSec)}` : 'なし';
    meta.textContent = `音源: ${sourceLabel}`;

    const showUpload = true;
    dropWrap.style.display = showUpload ? '' : 'none';
    if (showUpload && uploaded?.filename) {
        ph.style.display = 'none';
        dropMeta.style.display = '';
        dropMeta.textContent = `${uploaded.originalName || toSimpleVideoBasename(uploaded.filename)} / ${formatSimpleVideoDuration(uploaded.durationSec)}`;
    } else {
        ph.style.display = '';
        dropMeta.style.display = 'none';
    }

    if (state.t2aSourceMode === 'uploaded' && uploaded?.filename && generated?.filename && typeof showToast === 'function') {
        // no-op, keep quiet
    }
}

function renderSimpleVideoV2MSourceUI() {
    const state = SimpleVideoUI.state;
    const meta = document.getElementById('simpleVideoV2MSourceMeta');
    const dropWrap = document.getElementById('simpleVideoV2MVideoDrop');
    const ph = document.getElementById('simpleVideoV2MVideoDropPlaceholder');
    const dropMeta = document.getElementById('simpleVideoV2MVideoDropMeta');
    if (!meta || !dropWrap || !ph || !dropMeta) return;

    const uploaded = state.v2mUploadedVideo;
    const generated = state.v2mGeneratedVideo;
    const active = pickPreferredV2MVideoSource(state);
    const sourceLabel = active ? `${active.source} / ${toSimpleVideoBasename(active.filename)} / ${formatSimpleVideoDuration(active.durationSec)}` : 'なし';
    meta.textContent = `動画入力: ${sourceLabel}`;

    if (uploaded?.filename) {
        ph.style.display = 'none';
        dropMeta.style.display = '';
        dropMeta.textContent = `${uploaded.originalName || toSimpleVideoBasename(uploaded.filename)} / ${formatSimpleVideoDuration(uploaded.durationSec)}`;
    } else {
        ph.style.display = '';
        dropMeta.style.display = 'none';
    }

    if (generated?.filename && !uploaded?.filename) {
        dropWrap.style.opacity = '0.78';
    } else {
        dropWrap.style.opacity = '1';
    }
}

async function uploadM2VAudioSource(file) {
    const kind = inferMediaKindFromFile(file);
    if (kind !== 'audio') {
        if (typeof showToast === 'function') showToast('音声ファイルを選択してください', 'warning');
        return;
    }

    const wrap = document.getElementById('simpleVideoM2VAudioDrop');
    try {
        if (wrap) wrap.classList.add('uploading');

        const uploaded = await uploadSimpleVideoFile(file);

        const filename = String(uploaded?.filename || '').trim();
        if (!filename) throw new Error('Upload response missing filename');

        const previewUrl = getSimpleVideoInputFileURL(filename);
        const durationSec = await probeSimpleVideoMediaDuration(previewUrl, 'audio');

        SimpleVideoUI.state.t2aUploadedAudio = {
            filename,
            originalName: String(file.name || filename),
            previewUrl,
            durationSec: Number.isFinite(durationSec) ? durationSec : null,
        };
        saveSimpleVideoState();
        updateSimpleVideoUI();
        if (typeof showToast === 'function') showToast('外部音楽を取り込みました', 'success');
    } catch (error) {
        console.error('[SimpleVideo] uploadM2VAudioSource error:', error);
        if (typeof showToast === 'function') showToast(`音声アップロード失敗: ${String(error?.message || error)}`, 'error');
    } finally {
        if (wrap) wrap.classList.remove('uploading');
    }
}

async function uploadV2MVideoSource(file) {
    const kind = inferMediaKindFromFile(file);
    if (kind !== 'video') {
        if (typeof showToast === 'function') showToast('動画ファイルを選択してください', 'warning');
        return;
    }

    const wrap = document.getElementById('simpleVideoV2MVideoDrop');
    try {
        if (wrap) wrap.classList.add('uploading');

        const uploaded = await uploadSimpleVideoFile(file);

        const filename = String(uploaded?.filename || '').trim();
        if (!filename) throw new Error('Upload response missing filename');

        const previewUrl = getSimpleVideoInputFileURL(filename);
        const durationSec = await probeSimpleVideoMediaDuration(previewUrl, 'video');

        SimpleVideoUI.state.v2mUploadedVideo = {
            filename,
            originalName: String(file.name || filename),
            previewUrl,
            durationSec: Number.isFinite(durationSec) ? durationSec : null,
        };
        saveSimpleVideoState();
        updateSimpleVideoUI();
        if (typeof showToast === 'function') showToast('外部動画を取り込みました', 'success');
    } catch (error) {
        console.error('[SimpleVideo] uploadV2MVideoSource error:', error);
        if (typeof showToast === 'function') showToast(`動画アップロード失敗: ${String(error?.message || error)}`, 'error');
    } finally {
        if (wrap) wrap.classList.remove('uploading');
    }
}

async function startSimpleVideoMusicToVideo() {
    const { state } = SimpleVideoUI;
    const isBusy = !!(
        state.isGenerating || state.isPromptGenerating || state.isImageGenerating
        || state.t2aIsGenerating || state.t2aIsComposingLyrics || state.t2aIsSuggestingTags
        || state.t2aIsAutoGenerating || state.m2vIsRunning || state.v2mIsRunning
    );
    if (isBusy) {
        if (typeof showToast === 'function') showToast('他の処理が実行中です。完了後に再実行してください', 'warning');
        return;
    }

    const preset = VIDEO_PRESETS.find((p) => p.id === state.selectedPreset) || null;
    if (!preset) {
        if (typeof showToast === 'function') showToast('生成シーケンスを選択してください', 'warning');
        return;
    }

    const audioSource = pickPreferredM2VAudioSource(state);
    if (!audioSource?.filename) {
        if (typeof showToast === 'function') showToast('M2V音源がありません（生成またはアップロード）', 'warning');
        return;
    }

    const hasVideoScenario = !!String(state.scenario || '').trim();
    if (!hasVideoScenario) {
        const shouldContinueWithoutScenario = await askSimpleVideoM2VNoScenarioDialog({
            sourceType: String(audioSource.source || ''),
        });
        if (!shouldContinueWithoutScenario) {
            const scenarioEl = document.getElementById('simpleVideoScenario');
            if (scenarioEl) {
                scenarioEl.focus();
                try { scenarioEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_e) {}
            }
            if (typeof showToast === 'function') showToast('動画シナリオを入力してから再実行してください', 'info');
            return;
        }
    }

    state.m2vIsRunning = true;
    saveSimpleVideoState();
    updateGenerateButtonState();

    try {
        let audioDuration = Number(audioSource.durationSec);
        if (!Number.isFinite(audioDuration) || audioDuration <= 0) {
            audioDuration = await probeSimpleVideoMediaDuration(String(audioSource.previewUrl || ''), 'audio');
        }
        if (!Number.isFinite(audioDuration) || audioDuration <= 0) {
            throw new Error('音源長が取得できませんでした');
        }

        const roundedAudioSec = Math.max(1, Math.round(audioDuration));
        const autoSceneCount = Math.max(1, Math.round(roundedAudioSec / 5));
        const minSceneCountForPreset = preset?.flfOnly ? 2 : 1;
        const currentSceneCount = Math.max(minSceneCountForPreset, Math.min(24, autoSceneCount));
        const durations = allocateM2VSceneDurations(audioDuration, currentSceneCount, { minSec: 2, baseSec: 5, maxSec: 7 });
        const avg = Math.round(durations.reduce((sum, v) => sum + v, 0) / Math.max(1, durations.length));
        const fixedSceneLength = Math.min(7, Math.max(2, avg));

        state.sceneCount = String(currentSceneCount);
        state.sceneLengthSec = String(fixedSceneLength);
        state.m2vDurationPlan = durations.slice();
        saveSimpleVideoState();
        updateSimpleVideoUI();

        const preparedImageFilenameForM2V = String(state.preparedVideoInitialImage?.filename || '').trim();
        const desiredCountForM2V = preset?.flfOnly ? (currentSceneCount + 1) : currentSceneCount;
        const hasIntermediateForM2V = hasCompleteIntermediateImagesForPreset({
            presetId: String(preset.id || ''),
            desiredCount: Math.max(1, desiredCountForM2V),
        });
        const hasKeyImageForM2V = !!String(state.uploadedImage?.filename || '').trim() || !!preparedImageFilenameForM2V;
        if (preset?.requiresImage && !hasKeyImageForM2V && !hasIntermediateForM2V) {
            throw new Error('選択中の生成シーケンスはキー画像が必要です。🖼️キー画像をアップロードするか、初期フレームを生成してください');
        }

        try {
            setSimpleVideoProgressVisible(true);
            setSimpleVideoProgress('🧩 M2V仕様生成: 準備中...', 0.01);
            const m2vSpec = await prepareM2VPromptSpec({
                scenarioText: String(state.scenario || ''),
                lyricsText: String(state.t2aLyrics || ''),
                sceneDurationsSec: durations,
                targetDurationSec: audioDuration,
                cancelSeqAtStart: Number(state.cancelSeq) || 0,
            });
            const overrideText = buildM2VPromptFromSpec(m2vSpec);
            simpleVideoM2VPromptOverride = overrideText || null;
            simpleVideoForcePromptRegeneration = !!simpleVideoM2VPromptOverride;
            if (simpleVideoForcePromptRegeneration) {
                setSimpleVideoProgress('✅ M2V仕様生成: 完了', 0.06);
            }
        } catch (specError) {
            console.warn('[SimpleVideo] M2V spec generation failed; fallback to default prompt flow:', specError);
            simpleVideoM2VPromptOverride = buildM2VFallbackPromptOverride({
                lyricsText: String(state.t2aLyrics || ''),
                sceneDurationsSec: durations,
                targetDurationSec: audioDuration,
                language: mapSimpleVideoT2ALanguageToLyricsLanguage(state.t2aLanguage),
            });
            simpleVideoForcePromptRegeneration = !!String(simpleVideoM2VPromptOverride || '').trim();
            const specErrMsg = String(specError?.message || specError || 'unknown error');
            setSimpleVideoProgress(`⚠️ M2V仕様生成失敗: ${specErrMsg}（フォールバック仕様で継続）`, 0.05);
            if (typeof showToast === 'function') {
                showToast(`M2V仕様生成に失敗したためフォールバック仕様で継続します: ${specErrMsg}`, 'warning');
            }
        }

        if (!String(state.scenario || '').trim() && !String(simpleVideoM2VPromptOverride || '').trim()) {
            throw new Error('動画シナリオが未入力で、M2V仕様の生成にも失敗したため続行できません。動画シナリオを入力してください');
        }

        setSimpleVideoProgressVisible(true);
        setSimpleVideoProgress(`🎬 M2V: 動画生成を開始（音源 ${formatSimpleVideoDuration(audioDuration)} / ${currentSceneCount}シーン）`, 0.02);

        // Require a freshly generated video for this M2V run.
        state.v2mGeneratedVideo = null;
        saveSimpleVideoState();
        renderSimpleVideoV2MSourceUI();

        await startGeneration();

        const generatedVideo = state.v2mGeneratedVideo?.filename
            ? state.v2mGeneratedVideo
            : (pickPreferredV2MVideoSource(state)?.source === 'generated' ? pickPreferredV2MVideoSource(state) : null);
        if (!generatedVideo?.filename) {
            throw new Error('生成動画が見つからないため音声合成を実行できません');
        }

        const mergeVideo = toSimpleVideoBasename(generatedVideo.filename);
        const mergeAudio = toSimpleVideoBasename(audioSource.filename);
        if (!mergeVideo || !mergeAudio) {
            throw new Error('video/audio ファイル名が不正です');
        }
        if (!isAudioFilename(mergeAudio)) {
            throw new Error(`M2V音源が音声ファイルではありません: ${mergeAudio}`);
        }

        const merged = await runSimpleVideoUtilityJob({
            requestBody: { workflow: 'video_audio_merge', video: mergeVideo, audio: mergeAudio },
            progressPrefix: '🔗 M2V最終合成',
            cancelSeqAtStart: Number(state.cancelSeq) || 0,
        });

        renderSimpleVideoOutputMedia({
            jobId: merged.jobId,
            outputs: merged.outputs,
            title: 'M2V 最終結果（音声合成済み）',
            preferMedia: 'video',
        });
        setSimpleVideoProgress('✅ M2V完了（video_audio_merge実行済み）', 1);
        if (typeof showToast === 'function') showToast('✅ 音楽→動画を完了しました', 'success');
    } catch (error) {
        // Handle "restart from scratch" request triggered by the CONTINUE gate button
        if (simpleVideoContinueGateRestartM2V) {
            simpleVideoContinueGateRestartM2V = false;
            // finally will reset m2vIsRunning; schedule fresh M2V run after cleanup
            setTimeout(() => startSimpleVideoMusicToVideo(), 100);
            return;
        }
        const msg = String(error?.message || error || 'M2V failed');
        const reasonLabel = (
            msg === 'Cancelled'
                ? 'キャンセル'
                : (/動画シナリオが未入力/.test(msg)
                    ? '入力不足（動画シナリオ）'
                    : (/M2V音源がありません|音源長が取得できません/.test(msg)
                        ? '音源不備'
                        : (/生成動画が見つからない/.test(msg)
                            ? '動画未生成'
                            : (/APIが利用できません/.test(msg)
                                ? 'API未接続'
                                : '処理エラー'))))
        );
        console.error('[SimpleVideo] startSimpleVideoMusicToVideo error:', error);
        setSimpleVideoProgress(`エラー: ${msg}`, 0);
        if (typeof showToast === 'function') showToast(`M2Vエラー[${reasonLabel}]: ${msg}`, 'error');
    } finally {
        simpleVideoM2VPromptOverride = null;
        simpleVideoForcePromptRegeneration = false;
        state.m2vIsRunning = false;
        saveSimpleVideoState();
        updateGenerateButtonState();
    }
}

function roundVideoDurationForV2M(durationSec) {
    const raw = Number(durationSec);
    if (!Number.isFinite(raw) || raw <= 0) return 30;
    const rounded5 = Math.max(5, Math.round(raw / 5) * 5);
    const MAX_DURATION = 300;
    return Math.min(MAX_DURATION, rounded5);
}

function buildV2MFallbackScenario(videoSource, videoDurationSec) {
    const basename = toSimpleVideoBasename(videoSource?.originalName || videoSource?.filename || 'uploaded_video');
    const sec = Math.max(1, Math.round(Number(videoDurationSec) || 0));
    return [
        `Uploaded video: ${basename}`,
        `Length: about ${sec} seconds.`,
        'Create lyrics that match the video mood and pacing.',
        'Keep emotional flow natural from beginning to end, and avoid an early fade-out.',
    ].join('\n');
}

async function startSimpleVideoVideoToMusic() {
    const { state } = SimpleVideoUI;
    const isBusy = !!(
        state.isGenerating || state.isPromptGenerating || state.isImageGenerating
        || state.t2aIsGenerating || state.t2aIsComposingLyrics || state.t2aIsSuggestingTags
        || state.t2aIsAutoGenerating || state.m2vIsRunning || state.v2mIsRunning
    );
    if (isBusy) {
        if (typeof showToast === 'function') showToast('他の処理が実行中です。完了後に再実行してください', 'warning');
        return;
    }

    const videoSource = pickPreferredV2MVideoSource(state);
    if (!videoSource?.filename) {
        if (typeof showToast === 'function') showToast('動画入力がありません（生成またはアップロード）', 'warning');
        return;
    }

    state.v2mIsRunning = true;
    saveSimpleVideoState();
    updateGenerateButtonState();

    try {
        let videoDuration = Number(videoSource.durationSec);
        if (!Number.isFinite(videoDuration) || videoDuration <= 0) {
            videoDuration = await probeSimpleVideoMediaDuration(String(videoSource.previewUrl || ''), 'video');
        }
        if (!Number.isFinite(videoDuration) || videoDuration <= 0) {
            throw new Error('動画長が取得できませんでした');
        }

        state.t2aDuration = String(roundVideoDurationForV2M(videoDuration));

        if (!String(state.scenario || '').trim()) {
            const promptLines = parseScenePromptsFromText(state.llmPrompt);
            if (promptLines.length > 0) {
                state.scenario = promptLines.join('\n');
            }
        }
        if (!String(state.scenario || '').trim() && !String(state.imagePrompt || '').trim()) {
            state.scenario = buildV2MFallbackScenario(videoSource, videoDuration);
            if (typeof showToast === 'function') {
                showToast('シナリオ未入力のため、動画情報から作詞テーマを自動補完しました', 'info');
            }
        }

        saveSimpleVideoState();
        updateSimpleVideoUI();

        setSimpleVideoProgressVisible(true);
        setSimpleVideoProgress(`🎼 V2M: 音楽生成を開始（動画 ${formatSimpleVideoDuration(videoDuration)}）`, 0.02);
        await autoGenerateSimpleVideoT2A();

        const generatedAudio = pickPreferredM2VAudioSource(state)?.source === 'generated'
            ? pickPreferredM2VAudioSource(state)
            : state.t2aGeneratedAudio;
        if (!generatedAudio?.filename) {
            throw new Error('生成音楽が見つからないため最終合成を実行できません');
        }

        const mergeVideo = toSimpleVideoBasename(videoSource.filename);
        const mergeAudio = toSimpleVideoBasename(generatedAudio.filename);
        if (!mergeVideo || !mergeAudio) {
            throw new Error('video/audio ファイル名が不正です');
        }
        if (!isAudioFilename(mergeAudio)) {
            throw new Error(`V2M生成音楽が音声ファイルではありません: ${mergeAudio}`);
        }

        const merged = await runSimpleVideoUtilityJob({
            requestBody: { workflow: 'video_audio_merge', video: mergeVideo, audio: mergeAudio },
            progressPrefix: '🔗 V2M最終合成',
            cancelSeqAtStart: Number(state.cancelSeq) || 0,
        });

        renderSimpleVideoOutputMedia({
            jobId: merged.jobId,
            outputs: merged.outputs,
            title: 'V2M 最終結果（音声合成済み）',
            preferMedia: 'video',
        });
        setSimpleVideoProgress('✅ V2M完了（video_audio_merge実行済み）', 1);
        if (typeof showToast === 'function') showToast('✅ 動画→音楽を完了しました', 'success');
    } catch (error) {
        const msg = String(error?.message || error || 'V2M failed');
        console.error('[SimpleVideo] startSimpleVideoVideoToMusic error:', error);
        setSimpleVideoProgress(`エラー: ${msg}`, 0);
        if (typeof showToast === 'function') showToast(`V2Mエラー: ${msg}`, 'error');
    } finally {
        state.v2mIsRunning = false;
        saveSimpleVideoState();
        updateGenerateButtonState();
    }
}

/* ========================================
   Generation (Placeholder for Phase 4)
   ======================================== */

function setSimpleVideoProgressVisible(visible) {
    const wrap = document.getElementById('simpleVideoProgress');
    if (wrap) wrap.style.display = visible ? '' : 'none';
}

function setSimpleVideoProgress(statusText, overallProgress01) {
    const statusEl = document.getElementById('simpleVideoProgressStatus');
    const fillEl = document.getElementById('simpleVideoProgressFill');
    if (statusEl) statusEl.textContent = String(statusText || '');
    if (fillEl) {
        const p = Number(overallProgress01);
        const pct = Number.isFinite(p) ? Math.min(100, Math.max(0, Math.round(p * 100))) : 0;
        fillEl.style.width = `${pct}%`;
    }
}

function setSimpleVideoContinueGateVisible(visible, gateText = '') {
    const gateWrap = document.getElementById('simpleVideoContinueGate');
    const gateTextEl = document.getElementById('simpleVideoContinueGateText');
    if (!gateWrap || !gateTextEl) return;
    gateWrap.style.display = visible ? '' : 'none';
    if (visible) {
        gateTextEl.textContent = String(gateText || '中間画像を確認して CONTINUE してください。');
    } else {
        gateTextEl.textContent = '';
    }
}

function normalizeProgress01(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    // Some jobs report 0..1, others report 0..100.
    if (n > 1) return Math.min(1, Math.max(0, n / 100));
    return Math.min(1, Math.max(0, n));
}

async function confirmContinueAfterIntermediateImages({ preset, generatedCount, totalCount }) {
    const created = Math.max(0, Number(generatedCount) || 0);
    if (created <= 0) return true;

    const gateWrap = document.getElementById('simpleVideoContinueGate');
    const gateTextEl = document.getElementById('simpleVideoContinueGateText');
    const continueBtn = document.getElementById('simpleVideoContinueBtn');
    const pauseBtn = document.getElementById('simpleVideoPauseAtIntermediateBtn');
    if (!gateWrap || !gateTextEl || !continueBtn || !pauseBtn) {
        console.warn('[SimpleVideo] Continue gate UI is unavailable; proceeding without manual confirmation');
        return true;
    }

    const presetLabel = String(preset?.name || preset?.id || 'preset');
    const total = Math.max(0, Number(totalCount) || 0);
    const msg = `🖼️ 中間画像確認 (${presetLabel}) / 新規生成: ${created} / 全${total}シーン。必要ならシーン画像を再生成してから CONTINUE を押してください。`;
    setSimpleVideoContinueGateVisible(true, msg);
    simpleVideoContinueGateActive = true;
    updateGenerateButtonState();

    const ok = await new Promise((resolve) => {
        simpleVideoContinueGateResolver = (value) => resolve(!!value);
    });

    if (!ok) {
        setSimpleVideoProgress('⏸ 中間画像確認で停止しました（必要シーンを再生成後、再実行してください）', 0.35);
        if (typeof showToast === 'function') showToast('中間画像確認で停止しました。必要シーンを再生成して再実行してください', 'info');
    }
    simpleVideoContinueGateActive = false;
    setSimpleVideoContinueGateVisible(false);
    updateGenerateButtonState();
    return ok;
}

function clearSimpleVideoOutput() {
    const out = document.getElementById('simpleVideoOutput');
    if (!out) return;
    out.innerHTML = `
        <div class="simple-video-output-preview" id="simpleVideoOutputPreview" aria-label="初期画像プレビュー"></div>
        <div class="simple-video-output-placeholder">
            <i class="fas fa-film"></i>
            <div>生成された動画がここに表示されます</div>
        </div>
    `;
}

/**
 * If state.removeBgBeforeGenerate is ON, runs the remove_bg workflow on the given
 * filename and returns the resulting output filename.  Otherwise returns the original
 * filename unchanged.  Throws on error.
 */
async function removeBackgroundIfEnabled(inputFilename, forceRun = false) {
    const { state } = SimpleVideoUI;
    if (!forceRun && !state.removeBgBeforeGenerate) return inputFilename;
    if (!inputFilename) return inputFilename;

    setSimpleVideoProgress('🖼️ 背景削除中...', 0);

    const res = await runWorkflowStep({
        workflow: 'remove_bg_v1_0',
        label: '背景削除',
        requestParams: { input_image: inputFilename },
        stepIndex: 0,
        totalSteps: 1,
    });

    const outputs = Array.isArray(res.outputs) ? res.outputs : [];
    const imgOut = outputs.find((o) =>
        String(o?.filename || '').toLowerCase().includes('removebg')
    ) || outputs.filter((o) =>
        /\.(png|jpg|jpeg|webp)$/i.test(String(o?.filename || ''))
    ).pop() || null;

    if (!imgOut?.filename) throw new Error('背景削除: 出力画像が見つかりませんでした');
    return String(imgOut.filename);
}

async function generateCharacterSheet() {
    const { state } = SimpleVideoUI;
    const isBusy = !!(state.isGenerating || state.isPromptGenerating || state.isImageGenerating);
    if (isBusy) {
        if (typeof showToast === 'function') showToast('他の処理が実行中です。完了後に実行してください', 'warning');
        return;
    }

    // 入力画像: ref1 (dropSlots[0]) → keyImage → uploadedImage の優先順
    const ref1Slot = Array.isArray(state.dropSlots) ? state.dropSlots[0] : null;
    const inputFilename = ref1Slot?.filename
        || state.keyImage?.filename
        || state.uploadedImage?.filename
        || null;

    if (!inputFilename) {
        if (typeof showToast === 'function') showToast('📥 ref1（画像ドロップ欄）に参照画像をセットしてください', 'warning');
        return;
    }

    const api = window.app?.api;
    if (!api || typeof api.generate !== 'function' || typeof api.monitorProgress !== 'function') {
        if (typeof showToast === 'function') showToast('APIが利用できません', 'error');
        return;
    }

    const sheetBtn = document.getElementById('simpleVideoCharSheetGenBtn');
    const imgStopBtn = document.getElementById('simpleVideoImageStopBtn');

    state.isImageGenerating = true;
    saveSimpleVideoState();
    updateGenerateButtonState();
    if (sheetBtn) { sheetBtn.disabled = true; sheetBtn.textContent = '⏳ 生成中...'; }
    if (imgStopBtn) imgStopBtn.disabled = false;
    setSimpleVideoProgressVisible(true);
    setSimpleVideoProgress('🎭 キャラクターシート生成: 準備中...', 0);

    try {
        const useNobg = state.charSheetNobg;
        // charSheetNobg=true: force RMBG pre-process regardless of removeBgBeforeGenerate
        const effectiveFilename = await removeBackgroundIfEnabled(inputFilename, useNobg);
        const isMultiStep = useNobg || state.removeBgBeforeGenerate;
        const workflowName = useNobg
            ? 'character_sheet_card_v1_0_nobg'
            : 'character_sheet_card_v1_0';
        const res = await runWorkflowStep({
            workflow: workflowName,
            label: 'キャラクターシート生成',
            requestParams: { input_image: effectiveFilename },
            stepIndex: isMultiStep ? 1 : 0,
            totalSteps: isMultiStep ? 2 : 1,
        });

        // カード画像（CharSheet-CARD プレフィックス）を優先して取得
        const outputs = Array.isArray(res.outputs) ? res.outputs : [];
        const cardOut = outputs.find((o) =>
            String(o?.filename || '').includes('CharSheet-CARD')
        ) || outputs.filter((o) =>
            String(o?.media_type || '').toLowerCase() === 'image'
            || /\.(png|jpg|jpeg|webp)$/i.test(String(o?.filename || ''))
        ).pop() || null;

        if (!cardOut?.filename) throw new Error('キャラクターシート画像の出力が見つかりませんでした');

        const previewUrl = getSimpleVideoDownloadURL(res.jobId, cardOut.filename);

        state.characterSheetImage = {
            jobId: String(res.jobId),
            filename: String(cardOut.filename),
            previewUrl,
        };

        saveSimpleVideoState();
        updateInternalImagesUI();
        updateSimpleVideoUI();

        setSimpleVideoProgress('✅ キャラクターシート生成完了', 1);
        if (typeof showToast === 'function') showToast('✅ キャラクターシートを生成しました（内部参照画像に登録）', 'success');

        // 生成結果をモーダルで表示
        if (typeof showSimpleVideoImageModal === 'function') {
            showSimpleVideoImageModal(previewUrl, '🎭 キャラクターシート');
        }
    } catch (err) {
        console.error('[SimpleVideo] Character sheet generation error:', err);
        const msg = String(err?.message || err || 'Character sheet generation failed');
        if (msg === 'Cancelled') {
            setSimpleVideoProgress('⏹ 中止しました', 0);
            if (typeof showToast === 'function') showToast('キャラクターシート生成を中止しました', 'warning');
        } else {
            setSimpleVideoProgress(`エラー: ${msg}`, 0);
            if (typeof showToast === 'function') showToast(msg, 'error');
        }
    } finally {
        state.isImageGenerating = false;
        saveSimpleVideoState();
        updateGenerateButtonState();
        if (sheetBtn) {
            sheetBtn.disabled = false;
            sheetBtn.innerHTML = '<i class="fas fa-id-card"></i> キャラクターシート';
        }
        if (imgStopBtn) imgStopBtn.disabled = true;
    }
}

async function startInitialImageGeneration() {
    const { state } = SimpleVideoUI;
    const isBusy = !!(state.isGenerating || state.isPromptGenerating || state.isImageGenerating);
    if (isBusy) return;

    const prompt = String(state.imagePrompt || '').trim() || String(state.scenario || '').trim();
    if (!prompt) {
        if (typeof showToast === 'function') showToast('初期画像のプロンプト（左の入力欄）を入力してください', 'warning');
        return;
    }

    const api = window.app?.api;
    if (!api || typeof api.generate !== 'function' || typeof api.monitorProgress !== 'function') {
        if (typeof showToast === 'function') showToast('APIが利用できません（app.api.generate/monitorProgress）', 'error');
        return;
    }

    const preset = VIDEO_PRESETS.find((p) => p.id === state.selectedPreset) || null;
    
    // For character-composite presets, prefer Qwen I2I EDIT.
    // Otherwise use configured initial-image workflow.
    let wf = preset?.requiresCharacterImage
        ? normalizeWorkflowAlias(getConfiguredSimpleVideoWorkflow('i2i', 'qwen_i2i_2511_bf16_lightning4'))
        : normalizeWorkflowAlias(getConfiguredSimpleVideoWorkflow('initialImage', 'qwen_t2i_2512_lightning4'));
    if (!String(wf || '').trim() || String(wf || '').trim().toLowerCase() === 'auto') {
        wf = preset?.requiresCharacterImage
            ? normalizeWorkflowAlias(getConfiguredSimpleVideoWorkflow('i2i', 'qwen_i2i_2511_bf16_lightning4'))
            : normalizeWorkflowAlias(getConfiguredSimpleVideoWorkflow('t2i', 'qwen_t2i_2512_lightning4'));
    }

    state.isImageGenerating = true;
    state.currentStep = 0;
    state.totalSteps = 1;
    state.progress = 0;
    saveSimpleVideoState();
    updateGenerateButtonState();
    setSimpleVideoProgressVisible(true);
    setSimpleVideoProgress('🖼️ 初期画像生成: 準備中...', 0);

    const imgStopBtn = document.getElementById('simpleVideoImageStopBtn');
    if (imgStopBtn) imgStopBtn.disabled = false;

    try {
        // Ensure size is normalized before generating
        syncFpsForCurrentOptions({ forceUI: false });
        const { width, height } = getEffectiveWH();

        // Expand character tokens and ref mappings for I2I
        const { expandedPrompt, characterImages, pictureMapping, refToPicture } = await expandCharacterTokensForI2I({
            prompt,
            dropSlots: state.dropSlots,
        });

        const params = { prompt: expandedPrompt };
        if (width && height) {
            params.width = width;
            params.height = height;
        }

        // Set input images: key image first, then character images, then dropSlots.
        // If no key image exists, promote first character image to primary input.
        const characterImageFilenames = characterImages
            .map((img) => String(img?.filename || '').trim())
            .filter((name) => !!name);
        let primaryImage = state.uploadedImage?.filename || state.dropSlots?.[0]?.filename;
        if (!primaryImage && characterImageFilenames.length > 0) {
            primaryImage = characterImageFilenames[0];
        }
        // Remove background before generation if enabled
        if (primaryImage) primaryImage = await removeBackgroundIfEnabled(primaryImage);
        if (primaryImage) {
            params.input_image = primaryImage;
        }

        if (!primaryImage && isI2IWorkflowId(wf)) {
            const fallbackT2I = normalizeWorkflowAlias(getConfiguredSimpleVideoWorkflow('t2i', 'qwen_t2i_2512_lightning4'))
                || normalizeWorkflowAlias('qwen_t2i_2512_lightning4');
            if (!String(fallbackT2I || '').trim()) {
                throw new Error('I2I EDITには入力画像が必要です。🖼️キー画像を設定するか、キャラクタ画像を1枚以上登録してください。');
            }
            wf = fallbackT2I;
            console.log('[SimpleVideo] 初期画像生成: 入力画像なしのためT2Iへフォールバック:', wf);
            if (typeof showToast === 'function') {
                showToast('入力画像がないため、プロンプトから初期画像を生成します（T2I）', 'info');
            }
        }
        
        // Add character images as additional inputs
        let imgIndex = 2;
        const skipPrimaryCharAt = primaryImage && characterImageFilenames.length > 0 && primaryImage === characterImageFilenames[0] ? 1 : 0;
        for (let i = skipPrimaryCharAt; i < characterImageFilenames.length; i++) {
            const filename = characterImageFilenames[i];
            if (filename && imgIndex <= 9) {
                params[`input_image_${imgIndex}`] = filename;
                imgIndex++;
            }
        }
        // Add remaining dropSlots
        const startSlotIdx = state.uploadedImage?.filename ? 0 : 1;
        for (let i = startSlotIdx; i < (state.dropSlots?.length || 0); i++) {
            const slot = state.dropSlots[i];
            if (slot?.filename && imgIndex <= 9) {
                params[`input_image_${imgIndex}`] = slot.filename;
                imgIndex++;
            }
        }
        
        // Wrap prompt for Qwen 2511 EDIT format
        if (isQwen2511ImageEditWorkflowId(wf)) {
            params.prompt = wrapQwen2511EditInstructionPrompt(params.prompt);
        }
        
        // I2I settings
        params.denoise = Number(normalizeDenoise(state.i2iDenoise, '1.0'));
        params.cfg = Number(normalizeCfg(state.i2iCfg, '7.0'));

        // Run as a single-step workflow job
        const res = await runWorkflowStep({
            workflow: wf,
            label: '初期画像生成',
            requestParams: params,
            stepIndex: 0,
            totalSteps: 1,
        });

        const imageOut = pickBestOutput(res.outputs, 'image');
        if (!imageOut?.filename) throw new Error('初期画像の出力が見つかりませんでした');

        const previewUrl = getSimpleVideoDownloadURL(res.jobId, imageOut.filename);

        state.preparedInitialImage = {
            jobId: String(res.jobId),
            filename: String(imageOut.filename),
            prompt,
        };

        // Set generated image as the key image (display in 🖼️キー画像 area)
        state.keyImage = {
            jobId: String(res.jobId),
            filename: String(imageOut.filename),
            originalName: `初期画像_${new Date().toLocaleTimeString()}`,
            previewUrl,
        };
        // Also set as uploadedImage for downstream use
        state.uploadedImage = {
            jobId: String(res.jobId),
            filename: String(imageOut.filename),
            originalName: `初期画像_${new Date().toLocaleTimeString()}`,
            previewUrl,
        };

        // For presets requiring character composite image (char_edit_i2i_flf, char_edit_i2v_scene_cut),
        // also set the generated image as characterImage so downstream scene generation can use it.
        // This mirrors Full Auto Video's runFLFCompositeCharacterImage() behavior.
        if (preset?.requiresCharacterImage) {
            state.characterImage = {
                filename: String(imageOut.filename),
                subfolder: imageOut.subfolder || '',
                type: imageOut.type || 'output',
                jobId: String(res.jobId),
                previewUrl,
                presetId: String(preset.id || ''),
            };
            console.log('[SimpleVideo] 初期画像をキャラ合成画像としても設定:', imageOut.filename);
        }

        saveSimpleVideoState();

        // Update the key image area UI
        updateSimpleVideoUI();

        setSimpleVideoProgress('✅ 初期画像生成完了', 1);
        if (typeof showToast === 'function') showToast('✅ 初期画像を生成しました（🖼️キー画像に表示）', 'success');
    } catch (err) {
        console.error('[SimpleVideo] Initial image generation error:', err);
        const msg = String(err?.message || err || 'Initial image generation failed');
        if (msg === 'Cancelled') {
            setSimpleVideoProgress('⏹ 中止しました', 0);
            if (typeof showToast === 'function') showToast('初期画像生成を中止しました', 'warning');
        } else {
            setSimpleVideoProgress(`エラー: ${msg}`, 0);
            if (typeof showToast === 'function') showToast(msg, 'error');
        }
    } finally {
        state.isImageGenerating = false;
        saveSimpleVideoState();
        updateGenerateButtonState();
    }
}

async function startVideoInitialFrameGeneration() {
    const { state } = SimpleVideoUI;
    const isBusy = !!(state.isGenerating || state.isPromptGenerating || state.isImageGenerating);
    if (isBusy) return;

    const preset = VIDEO_PRESETS.find((p) => p.id === state.selectedPreset) || null;
    if (!preset) {
        if (typeof showToast === 'function') showToast('生成シーケンスを選択してください', 'warning');
        return;
    }

    // This button is only intended for refine-capable presets.
    const rawSteps = Array.isArray(preset?.steps) ? preset.steps : [];
    const supportsRefine = !!preset?.initialRefineWorkflow || rawSteps.some((s) => isI2IWorkflowId(s?.workflow));
    if (!supportsRefine) {
        if (typeof showToast === 'function') showToast('このシーケンスでは「初期フレーム生成（画像リファイン）」は使用できません', 'warning');
        return;
    }

    if (!String(state.scenario || '').trim()) {
        if (typeof showToast === 'function') showToast('シナリオを入力してください', 'warning');
        return;
    }

    if (!String(state.uploadedImage?.filename || '').trim()) {
        if (typeof showToast === 'function') showToast('キー画像をアップロードしてください（初期フレーム生成）', 'warning');
        return;
    }

    const cancelSeqAtStart = Number(state.cancelSeq) || 0;

    state.isImageGenerating = true;
    state.currentStep = 0;
    state.totalSteps = 1;
    state.progress = 0;
    saveSimpleVideoState();
    updateGenerateButtonState();
    setSimpleVideoProgressVisible(true);
    setSimpleVideoProgress('🖼️ 初期フレーム生成: 準備中...', 0);

    try {
        syncFpsForCurrentOptions({ forceUI: false });
        const { width, height } = getEffectiveWH();

        let scenePrompts = parseScenePromptsFromText(state.llmPrompt);
        if (!scenePrompts || scenePrompts.length === 0) {
            if (state.scenarioUseLLM) {
                if (typeof showToast === 'function') showToast('🤖 シーンプロンプトを生成中...', 'info');
                scenePrompts = await generateScenePromptsForCurrentSimpleVideoRun({ preset, cancelSeqAtStart });
            } else {
                const scenarioPrompt = String(state.scenario || '').trim();
                const count = Math.max(1, getEffectiveSceneCountForPromptGeneration());
                scenePrompts = buildScenePromptsFromScenarioText({ scenarioText: scenarioPrompt, desiredCount: count });

                const formatted = scenePrompts
                    .map((p, i) => `#${i + 1}: ${String(p || '').trim()}`)
                    .join('\n');

                state.llmPrompt = formatted;
                saveSimpleVideoState();

                const llmPromptEl = document.getElementById('simpleVideoLLMPrompt');
                if (llmPromptEl) llmPromptEl.value = formatted;

                const promptsWrap = document.getElementById('simpleVideoGeneratedPromptsWrap');
                if (promptsWrap) promptsWrap.style.display = '';
            }
        }

        if (!scenePrompts || scenePrompts.length === 0) {
            scenePrompts = [String(state.scenario || '').trim()].filter(Boolean);
        }

        const basePrompt = String(scenePrompts[0] || state.scenario || '').trim();
        if (!basePrompt) throw new Error('シーン1のプロンプトが空です');

        const imagePrompt = await generateImagePromptForInitialRefine({
            basePrompt,
            preset,
            cancelSeqAtStart,
        });

        const effectiveSteps = getEffectivePresetStepsForCurrentOptions(preset);

        const workflow = (String(state.i2iRefineWorkflow || '') !== 'auto' && String(state.i2iRefineWorkflow || '').trim())
            ? String(state.i2iRefineWorkflow)
            : String(preset.initialRefineWorkflow || (effectiveSteps || []).find((s) => isI2IWorkflowId(s?.workflow))?.workflow || '').trim();

        if (!workflow) throw new Error('I2Iワークフローがありません（初期フレーム生成）');

        const params = {};
        if (width && height) {
            params.width = width;
            params.height = height;
        }
        params.prompt = String(imagePrompt || basePrompt);
        params.input_image = String(state.uploadedImage.filename);

        if (isQwen2511ImageEditWorkflowId(workflow)) {
            params.prompt = wrapQwen2511EditInstructionPrompt(params.prompt);
        }

        params.denoise = Number(normalizeDenoise(state.i2iDenoise, '0.900'));
        params.cfg = Number(normalizeCfg(state.i2iCfg, '7.0'));

        const res = await runWorkflowStep({
            workflow,
            label: '初期フレーム生成',
            requestParams: params,
            stepIndex: 0,
            totalSteps: 1,
        });

        const imageOut = pickBestOutput(res.outputs, 'image');
        if (!imageOut?.filename) throw new Error('初期フレームの出力が見つかりませんでした');

        const previewUrl = getSimpleVideoDownloadURL(res.jobId, imageOut.filename);

        state.preparedVideoInitialImage = {
            jobId: String(res.jobId),
            filename: String(imageOut.filename),
            prompt: String(params.prompt || ''),
            presetId: String(preset.id || ''),
        };

        // Update key image with the refined result (display in 🖼️キー画像 area)
        state.keyImage = {
            jobId: String(res.jobId),
            filename: String(imageOut.filename),
            originalName: `初期フレーム_${new Date().toLocaleTimeString()}`,
            previewUrl,
        };
        state.uploadedImage = {
            jobId: String(res.jobId),
            filename: String(imageOut.filename),
            originalName: `初期フレーム_${new Date().toLocaleTimeString()}`,
            previewUrl,
        };

        // 初期フレーム更新後は、古いキャラ合成参照を無効化してゾンビ参照を防ぐ
        if (state.characterImage) {
            console.log('[SimpleVideo] Initial frame updated: clearing stale character composite image');
            state.characterImage = null;
        }
        saveSimpleVideoState();

        // Update the key image area UI
        updateSimpleVideoUI();

        setSimpleVideoProgress('✅ 初期フレーム生成完了', 1);
        if (typeof showToast === 'function') showToast('✅ 初期フレームを生成しました（🖼️キー画像に表示）', 'success');
    } catch (err) {
        console.error('[SimpleVideo] Video initial frame generation error:', err);
        const msg = String(err?.message || err || 'Video initial frame generation failed');
        if (msg === 'Cancelled') {
            setSimpleVideoProgress('⏹ 中止しました', 0);
            if (typeof showToast === 'function') showToast('初期フレーム生成を中止しました', 'warning');
        } else {
            setSimpleVideoProgress(`エラー: ${msg}`, 0);
            if (typeof showToast === 'function') showToast(msg, 'error');
        }
    } finally {
        state.isImageGenerating = false;
        saveSimpleVideoState();
        updateGenerateButtonState();
    }
}

async function startIntermediateImageGeneration(options = {}) {
    const { state } = SimpleVideoUI;
    const gateEditingAllowed = !!(simpleVideoContinueGateActive && state.isGenerating && !state.isPromptGenerating && !state.isImageGenerating);
    if ((state.isGenerating || state.isPromptGenerating || state.isImageGenerating) && !gateEditingAllowed) {
        if (typeof showToast === 'function') showToast('他の処理が実行中です。完了後に再実行してください', 'warning');
        return;
    }

    const forcedIndexes = Array.isArray(options?.forceSceneIndexes)
        ? options.forceSceneIndexes
            .map((v) => Number(v))
            .filter((v) => Number.isFinite(v) && v >= 0)
        : [];
    const isTargetedRegeneration = forcedIndexes.length > 0;

    const cancelSeqAtStart = Number(state.cancelSeq) || 0;
    const preset = VIDEO_PRESETS.find((p) => p.id === state.selectedPreset);
    // Support char_i2i_flf, char_edit_i2i_flf, char_edit_i2v_scene_cut, ext_i2i_i2v_scene_cut (or any preset with supportsPregenerateImages)
    const isFLFPreset = String(preset?.id || '') === 'char_i2i_flf' || String(preset?.id || '') === 'char_edit_i2i_flf' || String(preset?.id || '') === 'char_edit_i2v_scene_cut';
    const isSupported = !!preset && (isFLFPreset || !!preset.supportsPregenerateImages);
    if (!isSupported) {
        if (typeof showToast === 'function') showToast('事前画像生成に対応したプリセットを選択してください', 'warning');
        return;
    }
    if (!String(state.scenario || '').trim()) {
        if (typeof showToast === 'function') showToast('シナリオを入力してください', 'warning');
        return;
    }
    // For ext_i2i_i2v_scene_cut, key image is required
    if (preset.requiresImage && !state.uploadedImage?.filename) {
        if (typeof showToast === 'function') showToast('キー画像をドロップしてください', 'warning');
        return;
    }

    state.isImageGenerating = true;
    state.currentStep = 0;
    state.totalSteps = 0;
    saveSimpleVideoState();
    updateGenerateButtonState();
    setSimpleVideoProgressVisible(true);
    setSimpleVideoProgress('中間画像を準備中...', 0);

    try {
        const { width, height } = getEffectiveWH();
        const scenePrompts = await determineScenePromptsForCurrentSimpleVideoRun({
            preset,
            cancelSeqAtStart,
            allowLLMGeneration: !isTargetedRegeneration,
        });
        const sceneCount = Math.max(1, scenePrompts.length);

        const scenarioFP = computeScenarioFingerprint(state.scenario, scenePrompts);
        const inter = ensureIntermediateImagesState({
            presetId: preset.id,
            desiredCount: sceneCount,
            scenarioFingerprint: scenarioFP,
            skipFingerprintInvalidate: forcedIndexes.length > 0,
        });
        if (!inter) throw new Error('中間画像の状態が初期化できません');

        // If a prepared initial frame exists for this preset, use it as scene #1 unless overridden.
        const hasPreparedForThisPreset = !!(
            state.preparedVideoInitialImage?.filename
            && String(state.preparedVideoInitialImage?.presetId || '') === String(preset.id || '')
        );
        const prepared = hasPreparedForThisPreset ? state.preparedVideoInitialImage : null;
        if (prepared?.filename && !inter.images?.[0]?.filename) {
            inter.images[0] = {
                source: 'prepared',
                filename: String(prepared.filename),
                jobId: prepared.jobId ? String(prepared.jobId) : null,
                prompt: String(prepared.prompt || ''),
            };
        }

        const i2iWorkflowBase = (String(state.i2iRefineWorkflow || '') !== 'auto' && String(state.i2iRefineWorkflow || '').trim())
            ? normalizeWorkflowAlias(String(state.i2iRefineWorkflow))
            : normalizeWorkflowAlias(getConfiguredSimpleVideoWorkflow('i2i', 'qwen_i2i_2511_bf16_lightning4'));

        // Determine ref3 usage for scene I2I
        const { ref3Active, ref3Mode, adjustedWorkflow: i2iWorkflowFromRef3 } = computeRef3SceneI2IConfig(i2iWorkflowBase);
        const i2iWorkflow = i2iWorkflowFromRef3;

        const missingIndexes = [];
        for (let i = 0; i < sceneCount; i++) {
            const scenePrompt = String(scenePrompts[i] || '').trim();
            if (!scenePrompt) continue;
            if (!inter.images?.[i]?.filename) missingIndexes.push(i);
        }

        if (forcedIndexes.length > 0) {
            missingIndexes.length = 0;
            const uniq = Array.from(new Set(forcedIndexes));
            // The corresponding scene videos become stale when an image is regenerated.
            invalidateSceneVideosForImageIndexes({ preset, imageIndexes: uniq });
            for (const idx of uniq) {
                if (idx < 0 || idx >= sceneCount) continue;
                const scenePrompt = String(scenePrompts[idx] || '').trim();
                if (!scenePrompt) continue;
                inter.images[idx] = null;
                missingIndexes.push(idx);
            }
            if (missingIndexes.length === 0) {
                throw new Error('指定シーンの再生成対象が見つかりませんでした');
            }
            saveSimpleVideoState();
            renderSimpleVideoIntermediateImagesUI();
        }

        if (missingIndexes.length > 0 && !state.uploadedImage?.filename) {
            // For presets requiring character image (char_edit_i2i_flf, char_edit_i2v_scene_cut),
            // accept character image, key image, or dropSlots[0] as valid reference.
            const ds = Array.isArray(state.dropSlots) ? state.dropSlots : [];
            if (preset.requiresCharacterImage && (state.characterImage?.filename || ds[0]?.filename)) {
                // OK - will use character image or dropSlot as reference
            } else {
                throw new Error('キー画像がありません（中間画像生成にはキー画像が必要）');
            }
        }

        // For presets that need a character composite image, determine reference source.
        // If useCharSheetAsRef is set and characterSheetImage exists, use it; otherwise fall back to characterImage / key image / dropSlots[0].
        const usesCharacterImage = !!preset.requiresCharacterImage;
        const useSheetAsRef = usesCharacterImage && state.useCharSheetAsRef && !!state.characterSheetImage?.filename;
        let effectiveRefImage = null;
        if (usesCharacterImage) {
            if (useSheetAsRef) {
                effectiveRefImage = state.characterSheetImage.filename;
                console.log('[SimpleVideo] useCharSheetAsRef=true: キャラクターシートを参照に使用');
            } else if (state.characterImage?.filename) {
                effectiveRefImage = state.characterImage.filename;
            } else if (state.uploadedImage?.filename) {
                effectiveRefImage = state.uploadedImage.filename;
                console.log('[SimpleVideo] キャラ合成画像未生成のためキー画像を参照に使用');
            } else {
                const ds = Array.isArray(state.dropSlots) ? state.dropSlots : [];
                if (ds[0]?.filename) {
                    effectiveRefImage = ds[0].filename;
                    console.log('[SimpleVideo] キャラ合成画像未生成のためdropSlots[0]を参照に使用');
                } else {
                    throw new Error('参照画像がありません（キー画像またはキャラ合成画像が必要です）');
                }
            }
        }

        const totalSteps = Math.max(1, missingIndexes.length);
        state.totalSteps = totalSteps;
        saveSimpleVideoState();

        if (missingIndexes.length === 0 && forcedIndexes.length === 0) {
            // All images already exist - regenerate all without confirmation
            for (let i = 0; i < sceneCount; i++) {
                const scenePrompt = String(scenePrompts[i] || '').trim();
                if (!scenePrompt) continue;
                inter.images[i] = null;
                missingIndexes.push(i);
            }
            state.totalSteps = Math.max(1, missingIndexes.length);
            saveSimpleVideoState();
        }

        let stepCursor = 0;
        let firstSceneImageFilename = null; // For char_edit_i2i_flf with first_scene ref source
        const refSource = normalizeI2IRefSource(state.i2iRefSource);

        for (const sceneIndex of missingIndexes) {
            if ((Number(state.cancelSeq) || 0) !== cancelSeqAtStart) throw new Error('Cancelled');

            state.currentStep = stepCursor + 1;
            saveSimpleVideoState();

            const scenePrompt = String(scenePrompts[sceneIndex] || '').trim();
            if (!scenePrompt) continue;

            // Expand character tokens (@キャラ名) and build Picture N mapping
            const { expandedPrompt, characterImages, pictureMapping, refToPicture } = await expandCharacterTokensForI2I({
                prompt: scenePrompt,
                dropSlots: state.dropSlots,
            });

            const params = {};
            if (width && height) {
                params.width = width;
                params.height = height;
            }

            // Inject ref3 mode hint into prompt when active
            let finalExpandedPrompt = expandedPrompt;
            if (ref3Active) {
                const ref3PicNum = refToPicture['ref3'];
                const hint = buildRef3PromptHint(ref3Mode, ref3PicNum);
                if (hint) {
                    finalExpandedPrompt = hint + '\n' + finalExpandedPrompt;
                    console.log(`[SimpleVideo] ref3 mode=${ref3Mode}: injected hint`);
                }
            }
            params.prompt = finalExpandedPrompt;

            // For presets using character image (char_edit_i2i_flf, char_edit_i2v_scene_cut),
            // use character composite image (or fallback ref) as reference with refSource logic.
            if (usesCharacterImage) {
                let refForThisScene = effectiveRefImage;
                if (sceneIndex >= 1 && refSource === 'first_scene' && firstSceneImageFilename) {
                    refForThisScene = firstSceneImageFilename;
                }
                params.input_image = refForThisScene;
            } else {
                params.input_image = String(state.uploadedImage?.filename);
            }

            // Set additional input images from character images and dropSlots
            if (characterImages.length > 0 || (state.dropSlots && state.dropSlots.some(s => s?.filename))) {
                let imgIndex = 2; // Start from input_image_2
                // Add character images
                for (const charImg of characterImages) {
                    if (charImg?.filename && imgIndex <= 9) {
                        params[`input_image_${imgIndex}`] = charImg.filename;
                        imgIndex++;
                    }
                }
                // Add dropSlots
                for (const slot of (state.dropSlots || [])) {
                    if (slot?.filename && imgIndex <= 9) {
                        params[`input_image_${imgIndex}`] = slot.filename;
                        imgIndex++;
                    }
                }
            }

            if (isQwen2511ImageEditWorkflowId(i2iWorkflow)) {
                params.prompt = wrapQwen2511EditInstructionPrompt(params.prompt);
            }

            // Use denoise setting from UI (default 1.0 for full generation)
            params.denoise = Number(normalizeDenoise(state.i2iDenoise, '1.0'));
            params.cfg = Number(normalizeCfg(state.i2iCfg, '7.0'));

            const res = await runWorkflowStep({
                workflow: i2iWorkflow,
                label: `S${sceneIndex + 1}/${sceneCount} 中間画像(I2I)`,
                requestParams: params,
                stepIndex: stepCursor,
                totalSteps,
            });
            stepCursor++;

            renderSimpleVideoOutputMedia({ jobId: res.jobId, outputs: res.outputs, title: `中間画像 #${sceneIndex + 1}`, preferMedia: 'image' });

            const imgOut = pickBestOutput(res.outputs, 'image');
            if (!imgOut?.filename) throw new Error(`中間画像 #${sceneIndex + 1} の出力が見つかりませんでした`);

            inter.images[sceneIndex] = {
                source: 'generated',
                filename: String(imgOut.filename),
                jobId: String(res.jobId),
                prompt: String(params.prompt || ''),
                rawPrompt: scenePrompt,
                previewUrl: getSimpleVideoDownloadURL(res.jobId, imgOut.filename),
            };

            // Record first scene image for ref source logic (char_edit_* presets)
            if (sceneIndex === 0 && usesCharacterImage) {
                firstSceneImageFilename = String(imgOut.filename);
            }

            saveSimpleVideoState();
            renderSimpleVideoIntermediateImagesUI();

            const overall = stepCursor / Math.max(1, totalSteps);
            setSimpleVideoProgress(`(${stepCursor}/${totalSteps}) 中間画像生成`, overall);
        }

        renderSimpleVideoIntermediateImagesUI();
        setSimpleVideoProgress('✅ 中間画像の準備ができました', 1);
        const keepExistingGate = !!(isTargetedRegeneration && simpleVideoContinueGateActive && state.isGenerating);
        if (!keepExistingGate) {
            setSimpleVideoContinueGateVisible(true, '🖼️ 中間画像の準備ができました。内容を確認して CONTINUE で動画生成へ進みます。');
            simpleVideoContinueGateActive = true;
            updateGenerateButtonState();
            simpleVideoContinueGateResolver = async (value) => {
                simpleVideoContinueGateResolver = null;
                simpleVideoContinueGateActive = false;
                setSimpleVideoContinueGateVisible(false);
                updateGenerateButtonState();
                if (!value) return;
                await startGeneration();
            };
            if (typeof showToast === 'function') showToast('✅ 中間画像を用意しました（CONTINUEで動画生成へ進みます）', 'success');
        } else {
            if (typeof showToast === 'function') showToast('✅ 指定シーンの中間画像を再生成しました（CONTINUEで続行）', 'success');
        }
    } catch (err) {
        console.error('[SimpleVideo] Intermediate generation error:', err);
        const msg = String(err?.message || err || 'Intermediate generation failed');
        if (msg === 'Cancelled') {
            setSimpleVideoProgress('⏹ 中止しました', 0);
            if (typeof showToast === 'function') showToast('中間画像生成を中止しました', 'warning');
        } else {
            setSimpleVideoProgress(`エラー: ${msg}`, 0);
            if (typeof showToast === 'function') showToast(msg, 'error');
        }
    } finally {
        state.isImageGenerating = false;
        saveSimpleVideoState();
        updateGenerateButtonState();
    }
}

function setSimpleVideoOutputPreviewImage({ jobId, filename, title }) {
    const el = document.getElementById('simpleVideoOutputPreview');
    if (!el) return;
    if (!jobId || !filename) {
        el.style.display = 'none';
        el.innerHTML = '';
        return;
    }

    const baseUrl = (window.app && window.app.api && window.app.api.baseURL) ? window.app.api.baseURL : '';
    const toAbsoluteDownloadURL = (fn) => {
        if (!fn) return '';
        if (window.app?.api?.getDownloadURL) return window.app.api.getDownloadURL(jobId, fn);
        if (!baseUrl) return '';
        return `${baseUrl}/api/v1/download/${encodeURIComponent(String(jobId))}/${String(fn)
            .split('/')
            .map((seg) => encodeURIComponent(seg))
            .join('/')}`;
    };

    const url = toAbsoluteDownloadURL(filename);
    if (!url) {
        el.style.display = 'none';
        el.innerHTML = '';
        return;
    }

    el.style.display = 'block';
    el.innerHTML = `
        <div class="simple-video-output-preview-title">${String(title || '初期画像')}</div>
        <a href="${url}" download target="_blank" rel="noopener">
            <img src="${url}" alt="preview" />
        </a>
    `;
}

function ensureSimpleVideoOutputList() {
    const out = document.getElementById('simpleVideoOutput');
    if (!out) return null;

    let list = out.querySelector('.simple-video-output-list');
    if (!list) {
        out.innerHTML = `
            <div class="simple-video-output-list" style="display:flex;flex-direction:column;gap:14px;padding:12px;overflow:auto;height:100%;"></div>
        `;
        list = out.querySelector('.simple-video-output-list');
    }
    return list;
}

function appendSimpleVideoOutputMedia({ jobId, outputs, title }) {
    const list = ensureSimpleVideoOutputList();
    if (!list) return;

    const videoOut = pickBestOutput(outputs, 'video');
    const imageOut = pickBestOutput(outputs, 'image');

    const baseUrl = (window.app && window.app.api && window.app.api.baseURL) ? window.app.api.baseURL : '';
    const toAbsoluteDownloadURL = (filename) => {
        if (!filename) return '';
        if (window.app?.api?.getDownloadURL) return window.app.api.getDownloadURL(jobId, filename);
        if (!baseUrl) return '';
        return `${baseUrl}/api/v1/download/${encodeURIComponent(String(jobId))}/${String(filename)
            .split('/')
            .map((seg) => encodeURIComponent(seg))
            .join('/')}`;
    };

    const videoUrl = videoOut?.filename ? toAbsoluteDownloadURL(videoOut.filename) : '';
    const imageUrl = imageOut?.filename ? toAbsoluteDownloadURL(imageOut.filename) : '';

    const card = document.createElement('div');
    card.style.background = 'rgba(0,0,0,0.22)';
    card.style.border = '1px solid rgba(255,255,255,0.10)';
    card.style.borderRadius = '10px';
    card.style.padding = '10px';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = '10px';

    const heading = document.createElement('div');
    heading.className = 'simple-video-hint';
    heading.textContent = String(title || '生成結果');
    card.appendChild(heading);

    if (videoUrl) {
        const vid = document.createElement('video');
        vid.controls = true;
        vid.playsInline = true;
        vid.src = videoUrl;
        vid.style.maxWidth = '100%';
        vid.style.maxHeight = '360px';
        vid.style.objectFit = 'contain';
        card.appendChild(vid);

        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '10px';
        actions.style.flexWrap = 'wrap';

        const a = document.createElement('a');
        a.className = 'simple-video-btn';
        a.href = videoUrl;
        a.download = '';
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = '動画をダウンロード';
        actions.appendChild(a);
        card.appendChild(actions);
    } else if (imageUrl) {
        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = 'output';
        img.style.maxWidth = '100%';
        img.style.maxHeight = '360px';
        img.style.objectFit = 'contain';
        card.appendChild(img);

        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '10px';
        actions.style.flexWrap = 'wrap';

        const a = document.createElement('a');
        a.className = 'simple-video-btn';
        a.href = imageUrl;
        a.download = '';
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = '画像をダウンロード';
        actions.appendChild(a);
        card.appendChild(actions);
    } else {
        const empty = document.createElement('div');
        empty.className = 'simple-video-hint';
        empty.textContent = '出力が見つかりませんでした';
        card.appendChild(empty);
    }

    list.appendChild(card);
    loadSimpleVideoOutputFiles({ resetSelection: false });
}

function encodeSimpleVideoPath(pathValue) {
    return String(pathValue || '')
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/');
}

function formatSimpleVideoFileSize(bytes) {
    const n = Number(bytes || 0);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function setupSimpleVideoOutputBrowser() {
    if (simpleVideoOutputBrowserSetup) return;

    const openBtn = document.getElementById('simpleVideoFilesBtn');
    const modal = document.getElementById('outputBrowserModal');
    const closeBtn = document.getElementById('outputBrowserClose');
    const backdrop = modal?.querySelector('.output-browser-backdrop');
    const refreshBtn = document.getElementById('outputRefreshBtn');
    const selectAllBtn = document.getElementById('selectAllBtn');
    const deselectAllBtn = document.getElementById('deselectAllBtn');
    const deleteBtn = document.getElementById('deleteSelectedBtn');
    const body = document.getElementById('outputBrowserBody');

    if (!openBtn || !modal || !body) return;

    openBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        modal.classList.add('active');
        const filterEl = document.getElementById('outputFilterType');
        if (filterEl) filterEl.value = 'all';
        await loadSimpleVideoOutputFiles({ resetSelection: false, resetScroll: true });
    });

    closeBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        modal.classList.remove('active');
    });

    backdrop?.addEventListener('click', () => {
        modal.classList.remove('active');
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modal.classList.contains('active')) {
            modal.classList.remove('active');
        }
    });

    refreshBtn?.addEventListener('click', async () => {
        await loadSimpleVideoOutputFiles({ resetSelection: false, resetScroll: true });
    });

    ['outputFilterType', 'outputSortBy', 'outputSortOrder'].forEach((id) => {
        const el = document.getElementById(id);
        el?.addEventListener('change', async () => {
            await loadSimpleVideoOutputFiles({ resetSelection: true, resetScroll: true });
        });
    });

    selectAllBtn?.addEventListener('click', () => {
        simpleVideoOutputSelectedPaths.clear();
        simpleVideoOutputFiles.forEach((file) => {
            const path = String(file?.path || '').trim();
            if (path) simpleVideoOutputSelectedPaths.add(path);
        });
        renderSimpleVideoOutputFilesList();
    });

    deselectAllBtn?.addEventListener('click', () => {
        simpleVideoOutputSelectedPaths.clear();
        renderSimpleVideoOutputFilesList();
    });

    deleteBtn?.addEventListener('click', async () => {
        const targets = Array.from(simpleVideoOutputSelectedPaths);
        if (!targets.length) return;
        if (!confirm(`選択した${targets.length}件を削除しますか？`)) return;

        try {
            const base = (window.app?.api?.baseURL || '').replace(/\/$/, '');
            const res = await fetch(`${base}/api/v1/output-files`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ files: targets }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const payload = await res.json();
            const deletedCount = Number(payload?.deleted_count || 0);
            if (typeof showToast === 'function') showToast(`${deletedCount}件削除しました`, 'success');
            await loadSimpleVideoOutputFiles({ resetSelection: true, resetScroll: false });
        } catch (error) {
            if (typeof showToast === 'function') showToast(`削除に失敗: ${error?.message || error}`, 'error');
        }
    });

    body.addEventListener('click', async (event) => {
        const checkbox = event.target.closest('.output-file-checkbox');
        if (checkbox) {
            event.preventDefault();
            const path = String(checkbox.getAttribute('data-path') || '');
            if (path) {
                if (simpleVideoOutputSelectedPaths.has(path)) simpleVideoOutputSelectedPaths.delete(path);
                else simpleVideoOutputSelectedPaths.add(path);
                renderSimpleVideoOutputFilesList();
            }
            return;
        }

        const delBtn = event.target.closest('.output-file-action-btn.delete');
        if (delBtn) {
            event.preventDefault();
            const path = String(delBtn.getAttribute('data-path') || '');
            if (!path) return;
            if (!confirm(`削除しますか？\n${path}`)) return;

            try {
                const base = (window.app?.api?.baseURL || '').replace(/\/$/, '');
                const res = await fetch(`${base}/api/v1/output-files/${encodeSimpleVideoPath(path)}`, { method: 'DELETE' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                simpleVideoOutputSelectedPaths.delete(path);
                await loadSimpleVideoOutputFiles({ resetSelection: false, resetScroll: false });
            } catch (error) {
                if (typeof showToast === 'function') showToast(`削除に失敗: ${error?.message || error}`, 'error');
            }
            return;
        }

        const preview = event.target.closest('.output-file-preview');
        if (preview) {
            const fileType = String(preview.getAttribute('data-type') || '');
            const fileUrl = String(preview.getAttribute('data-url') || '');
            const fileName = String(preview.getAttribute('data-filename') || '');
            if (!fileUrl) return;
            if (fileType === 'image') {
                showSimpleVideoMediaModal({ mediaType: 'image', mediaUrl: fileUrl, title: fileName || 'image' });
                return;
            }
            if (fileType === 'video') {
                showSimpleVideoMediaModal({ mediaType: 'video', mediaUrl: fileUrl, title: fileName || 'video' });
                return;
            }
            if (fileType === 'audio') {
                showSimpleVideoMediaModal({ mediaType: 'audio', mediaUrl: fileUrl, title: fileName || 'audio' });
                return;
            }
            window.open(fileUrl, '_blank', 'noopener');
        }
    });

    simpleVideoOutputBrowserSetup = true;
}

function updateSimpleVideoOutputFilesSelectionMeta() {
    const countEl = document.getElementById('outputFileCount');
    const selectedWrap = document.getElementById('outputSelectedCount');
    const selectedNum = document.getElementById('selectedNum');
    const deleteBtn = document.getElementById('deleteSelectedBtn');
    const deselectBtn = document.getElementById('deselectAllBtn');
    const total = Array.isArray(simpleVideoOutputFiles) ? simpleVideoOutputFiles.length : 0;
    const selected = simpleVideoOutputSelectedPaths.size;

    if (countEl) countEl.textContent = `${total} files`;
    if (selectedNum) selectedNum.textContent = String(selected);
    if (selectedWrap) selectedWrap.style.display = selected > 0 ? 'inline' : 'none';
    if (deleteBtn) deleteBtn.style.display = selected > 0 ? 'inline-block' : 'none';
    if (deselectBtn) deselectBtn.style.display = selected > 0 ? 'inline-block' : 'none';
}

function renderSimpleVideoOutputFilesList() {
    const listEl = document.getElementById('outputBrowserBody');
    if (!listEl) return;

    if (!Array.isArray(simpleVideoOutputFiles) || simpleVideoOutputFiles.length === 0) {
        listEl.innerHTML = '<div class="output-empty"><div class="empty-icon">📂</div><p>ファイルがありません</p></div>';
        updateSimpleVideoOutputFilesSelectionMeta();
        return;
    }

    const base = (window.app?.api?.baseURL || '').replace(/\/$/, '');
    const rows = simpleVideoOutputFiles.map((file) => {
        const relPath = String(file?.path || '');
        const subfolder = String(file?.subfolder || '').trim();
        const mediaType = String(file?.media_type || 'other');
        const isMusicVideo = (mediaType === 'video' && subfolder === 'movie');
        const sizeText = formatSimpleVideoFileSize(file?.size);
        const fileUrl = `${base}/api/v1/files/${encodeSimpleVideoPath(relPath)}`;
        const selectedClass = simpleVideoOutputSelectedPaths.has(relPath) ? 'selected' : '';
        const icon = mediaType === 'video' ? '▶' : '';
        const preview = mediaType === 'image'
            ? `<img src="${fileUrl}" alt="${relPath}" loading="lazy"><span class="image-zoom-icon">🔍</span>`
            : (mediaType === 'video'
                ? `<video preload="metadata" muted loop playsinline src="${fileUrl}"></video><span class="video-play-icon">▶</span>`
                : `<span class="audio-icon">🎵</span>`);
        return `
            <div class="output-file-item ${selectedClass}" data-path="${relPath}" data-type="${mediaType}">
                <div class="output-file-checkbox" data-path="${relPath}"></div>
                <div class="output-file-actions">
                    <a href="${fileUrl}" download class="output-file-action-btn download" title="Download" target="_blank" rel="noopener">⬇</a>
                    <button class="output-file-action-btn delete" data-path="${relPath}" title="Delete">🗑</button>
                </div>
                <div class="output-file-preview" data-path="${relPath}" data-type="${mediaType}" data-url="${fileUrl}" data-filename="${relPath}">
                    ${preview}
                    ${icon ? `<span class="video-play-icon">${icon}</span>` : ''}
                </div>
                <div class="output-file-info">
                    <div class="output-file-name" title="${relPath}">${relPath}</div>
                    <div class="output-file-meta">
                        <span class="output-file-type ${mediaType}">${mediaType}</span>
                        ${isMusicVideo ? '<span class="output-file-type audio">🎵音声付き</span>' : ''}
                        ${subfolder ? `<span>folder: ${subfolder}</span>` : ''}
                        <span>${sizeText}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    listEl.innerHTML = `<div class="output-files-grid">${rows}</div>`;
    updateSimpleVideoOutputFilesSelectionMeta();
}

async function loadSimpleVideoOutputFiles({ resetSelection = false, resetScroll = false } = {}) {
    const listEl = document.getElementById('outputBrowserBody');
    if (!listEl) return;
    if (simpleVideoOutputFilesLoading) return;

    simpleVideoOutputFilesLoading = true;
    listEl.innerHTML = '<div class="output-loading">読み込み中...</div>';

    try {
        const base = (window.app?.api?.baseURL || '').replace(/\/$/, '');
        const filter = String(document.getElementById('outputFilterType')?.value || 'all');
        const sortBy = String(document.getElementById('outputSortBy')?.value || 'mtime');
        const sortOrder = String(document.getElementById('outputSortOrder')?.value || 'desc');
        const url = `${base}/api/v1/output-files?media_type=${encodeURIComponent(filter)}&sort_by=${encodeURIComponent(sortBy)}&sort_order=${encodeURIComponent(sortOrder)}&offset=0&limit=1000`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        const files = Array.isArray(payload?.files) ? payload.files : [];
        simpleVideoOutputFiles = files;

        if (resetSelection) {
            simpleVideoOutputSelectedPaths.clear();
        } else {
            const valid = new Set(files.map((f) => String(f?.path || '')).filter(Boolean));
            simpleVideoOutputSelectedPaths = new Set(Array.from(simpleVideoOutputSelectedPaths).filter((p) => valid.has(p)));
        }

        renderSimpleVideoOutputFilesList();
        if (resetScroll) listEl.scrollTop = 0;
    } catch (error) {
        listEl.innerHTML = `<div class="output-empty"><div class="empty-icon">❌</div><p>一覧取得に失敗しました</p><p style="font-size:0.8rem;color:var(--text-secondary);">${error?.message || error}</p></div>`;
    } finally {
        simpleVideoOutputFilesLoading = false;
    }
}

function parseScenePromptsFromText(text) {
    const raw = String(text || '');
    if (!raw.trim()) return [];

    return raw
        .split('\n')
        .map((line) => String(line || '').trim())
        .filter((line) => line.length > 0)
        .map((line) => {
            let cleaned = line;
            cleaned = cleaned.replace(/^[-・*]\s*/, '');
            // Accept "#1: ..." and "#1 ..." (optional colon / full-width colon)
            cleaned = cleaned.replace(/^#\d+\s*[:：]?\s*/, '');
            return cleaned.trim();
        })
        .filter((line) => line.length > 0);
}

function buildScenePromptsFromScenarioText({ scenarioText, desiredCount }) {
    const scenarioPrompt = String(scenarioText || '').trim();
    const parsed = parseScenePromptsFromText(scenarioPrompt);
    const base = (parsed && parsed.length > 0)
        ? parsed
        : (scenarioPrompt ? [scenarioPrompt] : []);

    const count = Number(desiredCount);
    if (!Number.isFinite(count) || count <= 0) return base;

    if (base.length >= count) return base.slice(0, count);

    // Pad by repeating the last prompt.
    const out = base.slice();
    while (out.length < count) out.push(out[out.length - 1]);
    return out;
}

async function generateScenePromptsForCurrentSimpleVideoRun({ preset, cancelSeqAtStart }) {
    const { state } = SimpleVideoUI;

    const scenarioPrompt = String(state.scenario || '').trim();
    const hasM2VOverride = !!String(simpleVideoM2VPromptOverride || '').trim();
    if (!scenarioPrompt && !hasM2VOverride) throw new Error('シナリオが空です');

    const api = window.app?.api;
    if (!api || typeof api.generateUtility !== 'function' || typeof api.monitorProgress !== 'function') {
        throw new Error('APIが利用できません（app.api.generateUtility/monitorProgress）');
    }

    const sceneCount = getEffectiveSceneCountForPromptGeneration();
    const outputType = pickPromptOutputTypeForPreset(preset);
    const targetWorkflow = preset ? pickTargetWorkflowForPromptGeneration(preset) : null;
    const promptProgressLabel = hasM2VOverride ? '🤖 プロンプト生成(M2V仕様)' : '🤖 プロンプト生成';
    // Map motionStrength to FLF motion level for prompt generation
    const flfMotionLevel = outputType === 'flf_sequence'
        ? (state.motionStrength || 'medium')
        : null;

    // If LLM is disabled, copy scenario text as-is to each scene.
    if (!state.scenarioUseLLM && !hasM2VOverride) {
        const prompts = buildScenePromptsFromScenarioText({ scenarioText: scenarioPrompt, desiredCount: sceneCount });

        const formatted = prompts
            .map((p, i) => `#${i + 1}: ${String(p || '').trim()}`)
            .join('\n');

        state.llmPrompt = formatted;
        saveSimpleVideoState();

        const llmPromptEl = document.getElementById('simpleVideoLLMPrompt');
        if (llmPromptEl) llmPromptEl.value = formatted;

        const promptsWrap = document.getElementById('simpleVideoGeneratedPromptsWrap');
        if (promptsWrap) promptsWrap.style.display = '';

        return prompts;
    }

    const requestBody = {
        workflow: 'prompt_generate',
        user_prompt: String(simpleVideoM2VPromptOverride || scenarioPrompt),
        scene_count: sceneCount,
        output_type: outputType,
            prompt_complexity: normalizePromptComplexity(state.promptComplexity),
        translation_mode: false,
    };
    if (targetWorkflow) requestBody.target_workflow = targetWorkflow;
    if (flfMotionLevel) requestBody.flf_motion_level = flfMotionLevel;

    let jobId = null;
    try {
        const job = await api.generateUtility(requestBody);
        jobId = job?.job_id;
        if (!jobId) throw new Error('job_idが取得できません');

        state.activeJobId = String(jobId);
        saveSimpleVideoState();
        updateGenerateButtonState();

        const result = await new Promise((resolve, reject) => {
            let done = false;
            const finish = (fn) => (arg) => {
                if (done) return;
                done = true;
                fn(arg);
            };

            api.monitorProgress(
                jobId,
                (p) => {
                    if ((Number(state.cancelSeq) || 0) !== cancelSeqAtStart) {
                        try { api.closeWebSocket?.(jobId); } catch (_e) {}
                        finish(reject)(new Error('Cancelled'));
                        return;
                    }
                    const local = Number(p?.progress) || 0;
                    setSimpleVideoProgress(`${promptProgressLabel}: ${p?.message || 'Processing...'}`, Math.min(1, Math.max(0, local)));
                },
                finish((data) => resolve(data)),
                finish((err) => reject(err))
            );
        });

        const prompts = extractPromptsFromPromptGenerateResult(result);
        if (!prompts || prompts.length === 0) {
            console.error('[SimpleVideo] prompt_generate raw result:', result);
            throw new Error('プロンプト生成結果の形式が不正です');
        }

        // Prompt generation finished; clear active job marker before starting actual generation jobs.
        if (String(state.activeJobId || '') === String(jobId)) {
            state.activeJobId = null;
            saveSimpleVideoState();
            updateGenerateButtonState();
        }

        const formatted = prompts
            .map((p, i) => `#${i + 1}: ${String(p || '').trim()}`)
            .join('\n');

        state.llmPrompt = formatted;
        saveSimpleVideoState();

        const llmPromptEl = document.getElementById('simpleVideoLLMPrompt');
        if (llmPromptEl) llmPromptEl.value = formatted;

        const promptsWrap = document.getElementById('simpleVideoGeneratedPromptsWrap');
        if (promptsWrap) promptsWrap.style.display = '';

        if (hasM2VOverride && typeof showToast === 'function') {
            showToast('M2V仕様を使ってシーンプロンプトを再生成しました', 'info');
        }

        return prompts.map((p) => String(p || '').trim()).filter((s) => s.length > 0);
    } catch (error) {
        const rawMessage = String(error?.message || error || '').trim();
        const reasonLabel = (
            rawMessage === 'Cancelled'
                ? 'キャンセル'
                : (/シナリオが空です/.test(rawMessage)
                    ? '入力不足（シナリオ/仕様）'
                    : (/APIが利用できません/.test(rawMessage)
                        ? 'API未接続'
                        : 'LLM/応答エラー'))
        );

        const fallbackSource = String(
            simpleVideoM2VPromptOverride
            || scenarioPrompt
            || state.t2aLyrics
            || state.t2aScenario
            || state.imagePrompt
            || 'cinematic scene progression'
        ).trim();

        const fallbackPrompts = buildScenePromptsFromScenarioText({
            scenarioText: fallbackSource,
            desiredCount: sceneCount,
        }).map((p) => String(p || '').trim()).filter(Boolean);

        if (fallbackPrompts.length === 0) {
            throw error;
        }

        const formatted = fallbackPrompts
            .map((p, i) => `#${i + 1}: ${String(p || '').trim()}`)
            .join('\n');
        state.llmPrompt = formatted;
        saveSimpleVideoState();

        const llmPromptEl = document.getElementById('simpleVideoLLMPrompt');
        if (llmPromptEl) llmPromptEl.value = formatted;

        const promptsWrap = document.getElementById('simpleVideoGeneratedPromptsWrap');
        if (promptsWrap) promptsWrap.style.display = '';

        console.warn('[SimpleVideo] prompt_generate failed; using fallback scene prompts:', { reasonLabel, error });
        if (typeof showToast === 'function') {
            const suffix = rawMessage ? `（${rawMessage}）` : '';
            showToast(`⚠️ プロンプト生成失敗: ${reasonLabel} → フォールバックで継続${suffix}`, 'warning');
        }

        return fallbackPrompts;
    } finally {
        if (jobId && String(state.activeJobId || '') === String(jobId)) {
            state.activeJobId = null;
            saveSimpleVideoState();
            updateGenerateButtonState();
        }
    }
}

async function generateImagePromptForInitialRefine({ basePrompt, preset, cancelSeqAtStart }) {
    const { state } = SimpleVideoUI;
    const scenarioOrScene = String(basePrompt || '').trim();
    if (!scenarioOrScene) return '';

    // If user disabled LLM, do not call prompt_generate.
    if (!state.scenarioUseLLM) return scenarioOrScene;

    const api = window.app?.api;
    if (!api || typeof api.generateUtility !== 'function' || typeof api.monitorProgress !== 'function') {
        return scenarioOrScene;
    }

    const targetWorkflow = preset ? pickTargetWorkflowForPromptGeneration(preset) : null;

    const refineWorkflowForPrompt = (String(state.i2iRefineWorkflow || '') !== 'auto' && String(state.i2iRefineWorkflow || '').trim())
        ? String(state.i2iRefineWorkflow)
        : String(preset?.initialRefineWorkflow || '');
    const isQwenEdit = isQwen2511ImageEditWorkflowId(refineWorkflowForPrompt);

    // Auto-determine refRole based on denoise value (boundary: 0.805)
    const refRole = getEffectiveI2IRefRole();
    const preserveHint = buildI2IStillPromptConvertHint({ isQwenEdit, refRole });

    const job = await api.generateUtility({
        workflow: 'prompt_generate',
        user_prompt: `${preserveHint}\n\n${scenarioOrScene}`,
        scene_count: 1,
        output_type: 'image',
        translation_mode: false,
        target_workflow: targetWorkflow || undefined,
    });

    const jobId = job?.job_id;
    if (!jobId) return scenarioOrScene;

    SimpleVideoUI.state.activeJobId = String(jobId);
    saveSimpleVideoState();
    updateGenerateButtonState();

    const result = await new Promise((resolve, reject) => {
        let done = false;
        const finish = (fn) => (arg) => {
            if (done) return;
            done = true;
            fn(arg);
        };

        api.monitorProgress(
            jobId,
            (p) => {
                if ((Number(SimpleVideoUI.state.cancelSeq) || 0) !== cancelSeqAtStart) {
                    try { api.closeWebSocket?.(jobId); } catch (_e) {}
                    finish(reject)(new Error('Cancelled'));
                    return;
                }
                const local = Number(p?.progress) || 0;
                setSimpleVideoProgress(`🤖 画像用プロンプト作成: ${p?.message || 'Processing...'}`, Math.min(1, Math.max(0, local)));
            },
            finish((data) => resolve(data)),
            finish((err) => reject(err instanceof Error ? err : new Error(String(err))))
        );
    }).catch((e) => {
        if (String(e?.message || '') === 'Cancelled') throw e;
        console.warn('[SimpleVideo] image prompt generation failed; fallback to base prompt:', e);
        return null;
    });

    try {
        const prompts = extractPromptsFromPromptGenerateResult(result);
        const first = Array.isArray(prompts) ? String(prompts[0] || '').trim() : '';
        const out = first || scenarioOrScene;
        return isQwenEdit ? wrapQwen2511EditInstructionPrompt(out) : out;
    } finally {
        if (String(SimpleVideoUI.state.activeJobId || '') === String(jobId)) {
            SimpleVideoUI.state.activeJobId = null;
            saveSimpleVideoState();
            updateGenerateButtonState();
        }
    }
}

async function generateImagePromptForSceneRefine({ scenePrompt, preset, cancelSeqAtStart }) {
    const { state } = SimpleVideoUI;
    const text = String(scenePrompt || '').trim();
    if (!text) return '';

    // If user disabled LLM, do not call prompt_generate.
    if (!state.scenarioUseLLM) return text;

    const api = window.app?.api;
    if (!api || typeof api.generateUtility !== 'function' || typeof api.monitorProgress !== 'function') {
        return text;
    }

    const targetWorkflow = preset ? pickTargetWorkflowForPromptGeneration(preset) : null;

    const refineWorkflowForPrompt = (String(state.i2iRefineWorkflow || '') !== 'auto' && String(state.i2iRefineWorkflow || '').trim())
        ? String(state.i2iRefineWorkflow)
        : String((preset?.steps || []).find((s) => isI2IWorkflowId(s?.workflow))?.workflow || preset?.initialRefineWorkflow || '');
    const isQwenEdit = isQwen2511ImageEditWorkflowId(refineWorkflowForPrompt);

    // Auto-determine refRole based on denoise value (boundary: 0.805)
    const refRole = getEffectiveI2IRefRole();
    const convertHint = buildI2IStillPromptConvertHint({ isQwenEdit, refRole });

    const job = await api.generateUtility({
        workflow: 'prompt_generate',
        user_prompt: `${convertHint}\n\n${text}`,
        scene_count: 1,
        output_type: 'image',
        translation_mode: false,
        target_workflow: targetWorkflow || undefined,
    });

    const jobId = job?.job_id;
    if (!jobId) return text;

    SimpleVideoUI.state.activeJobId = String(jobId);
    saveSimpleVideoState();
    updateGenerateButtonState();

    const result = await new Promise((resolve, reject) => {
        let done = false;
        const finish = (fn) => (arg) => {
            if (done) return;
            done = true;
            fn(arg);
        };

        api.monitorProgress(
            jobId,
            (p) => {
                if ((Number(SimpleVideoUI.state.cancelSeq) || 0) !== cancelSeqAtStart) {
                    try { api.closeWebSocket?.(jobId); } catch (_e) {}
                    finish(reject)(new Error('Cancelled'));
                    return;
                }
                const local = Number(p?.progress) || 0;
                setSimpleVideoProgress(`🤖 静止画プロンプト変換: ${p?.message || 'Processing...'}`, Math.min(1, Math.max(0, local)));
            },
            finish((data) => resolve(data)),
            finish((err) => reject(err instanceof Error ? err : new Error(String(err))))
        );
    }).catch((e) => {
        if (String(e?.message || '') === 'Cancelled') throw e;
        console.warn('[SimpleVideo] scene refine prompt conversion failed; fallback:', e);
        return null;
    });

    try {
        const prompts = extractPromptsFromPromptGenerateResult(result);
        const first = Array.isArray(prompts) ? String(prompts[0] || '').trim() : '';
        const out = first || text;
        return isQwenEdit ? wrapQwen2511EditInstructionPrompt(out) : out;
    } finally {
        if (String(SimpleVideoUI.state.activeJobId || '') === String(jobId)) {
            SimpleVideoUI.state.activeJobId = null;
            saveSimpleVideoState();
            updateGenerateButtonState();
        }
    }
}

function buildI2IStillPromptConvertHint({ isQwenEdit, refRole }) {
    const role = normalizeI2IRefRole(refRole);

    // Note: Qwen Image Edit requires a single instruction sentence.
    if (isQwenEdit) {
        if (role === 'mood') {
            return [
                '次の文章を「Qwen Image Edit」向けの編集指示プロンプトに変換してください。',
                '動画特有の要素（camera move, pan, zoom, motion, timelapse 等）は除去/静止画向けにしてください。',
                '出力は1つの短い指示文だけ。必ず picture 1 を参照して「Edit picture 1 ...」の形式にしてください。',
                '参照画像の雰囲気（ライティング/色/質感/画調）と大まかな構図は維持しつつ、指示された変更ははっきり反映してください。',
                '人物がいる場合、同一人物の固定は二次的（雰囲気優先）としつつ、破綻しない範囲で自然に一貫させてください。',
                'Convert the text into a Qwen Image Edit instruction prompt. Output ONE instruction sentence only.',
                'Use the exact style: "Edit picture 1 ...". Remove motion/camera directives.',
                'Preserve the mood/style/lighting/color palette and overall composition of picture 1. Apply edits clearly.',
            ].join('\n');
        }

        // role === 'character'
        return [
            '次の文章を「Qwen Image Edit」向けの編集指示プロンプトに変換してください。',
            '動画特有の要素（camera move, pan, zoom, motion, timelapse 等）は除去/静止画向けにしてください。',
            '出力は1つの短い指示文だけ。必ず picture 1 を参照して「Edit picture 1 ...」の形式にしてください。',
            '参照画像の同一性（顔/服/髪型/配色）と大まかな構図は維持しつつ、指示された変更ははっきり反映してください。',
            'Convert the text into a Qwen Image Edit instruction prompt. Output ONE instruction sentence only.',
            'Use the exact style: "Edit picture 1 ...". Remove motion/camera directives. Preserve identity/composition but apply edits clearly.',
        ].join('\n');
    }

    // Non-Qwen I2I prompt: return a still-image prompt.
    if (role === 'mood') {
        return [
            '次の文章を、静止画(I2I)向けのプロンプトに変換してください。',
            '動画特有の要素（camera move, pan, zoom, motion, timelapse 等）は除去/静止画向けにしてください。',
            '参照画像の雰囲気（ライティング/色/質感/画調）と大まかな構図を維持しつつ、指示された変更は反映してください。',
            'Convert the text into a still-image prompt for I2I. Remove motion/camera directives.',
            'Preserve mood/style/lighting/color palette and overall composition; apply the requested edits.',
        ].join('\n');
    }

    // role === 'character'
    return [
        '次の文章を、静止画(I2I)向けのプロンプトに変換してください。',
        '動画特有の要素（camera move, pan, zoom, motion, timelapse 等）は除去/静止画向けにしてください。',
        '参照画像の人物/被写体の同一性（顔/服/髪型/配色）と大まかな構図は維持しつつ、指示された変更は反映してください。',
        'Convert the text into a still-image prompt for I2I. Remove motion/camera directives. Preserve identity/composition but apply the requested edits.',
    ].join('\n');
}

function clearSimpleVideoGeneratedPrompts() {
    SimpleVideoUI.state.llmPrompt = '';
    saveSimpleVideoState();

    const llmPromptEl = document.getElementById('simpleVideoLLMPrompt');
    if (llmPromptEl) llmPromptEl.value = '';
    syncGeneratedPromptsVisibility();
}

function syncGeneratedPromptsVisibility() {
    const promptsWrap = document.getElementById('simpleVideoGeneratedPromptsWrap');
    const progressWrap = document.getElementById('simpleVideoProgress');
    const state = SimpleVideoUI?.state || {};

    const hasPrompts = !!String(state.llmPrompt || '').trim();
    const isBusy = !!(state.isGenerating || state.isPromptGenerating || state.isImageGenerating);

    if (promptsWrap) {
        promptsWrap.style.display = hasPrompts ? '' : 'none';
    }

    if (progressWrap) {
        progressWrap.style.display = (hasPrompts || isBusy) ? '' : 'none';
    }
}

async function translateSimpleVideoGeneratedPrompts(buttonId = 'simpleVideoScenarioTranslateBtn') {
    const llmPromptEl = document.getElementById('simpleVideoLLMPrompt');
    const btn = document.getElementById(buttonId);
    const text = String(llmPromptEl?.value || '').trim();
    if (!llmPromptEl || !text) {
        if (typeof showToast === 'function') showToast('翻訳する生成プロンプトがありません', 'warning');
        return;
    }

    const base = (window.app && window.app.api && window.app.api.baseURL)
        ? window.app.api.baseURL
        : (typeof baseURL !== 'undefined' ? baseURL : '');
    if (!base) {
        if (typeof showToast === 'function') showToast('API baseURL が取得できません', 'error');
        return;
    }

    const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text);
    const targetLang = hasJapanese ? 'English' : '日本語';
    const targetLanguageParam = hasJapanese ? 'en' : 'ja';

    if (btn) {
        btn.disabled = true;
        btn.textContent = '🔄...';
    }

    try {
        const resp = await fetch(`${base}/api/v1/translate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, target_language: targetLanguageParam }),
        });
        if (!resp.ok) {
            const t = await resp.text();
            throw new Error(`HTTP ${resp.status}: ${t}`);
        }
        const data = await resp.json();
        const out = String(data?.translated_text || '').trim();
        if (!out) throw new Error('翻訳結果が空です');

        llmPromptEl.value = out;
        SimpleVideoUI.state.llmPrompt = out;
        syncGeneratedPromptsVisibility();
        saveSimpleVideoState();
        updateGenerateButtonState();
        if (typeof showToast === 'function') showToast(`${targetLang}に翻訳しました`, 'success');
    } catch (e) {
        console.error('[SimpleVideo] translate generated prompts failed:', e);
        if (typeof showToast === 'function') showToast(`翻訳エラー: ${e.message || e}`, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🌐 翻訳';
        }
    }
}

async function expandScenarioPromptForSimpleVideo({ prompt, targetWorkflow, cancelSeqAtStart }) {
    const api = window.app?.api;
    if (!api || typeof api.generateUtility !== 'function' || typeof api.monitorProgress !== 'function' || typeof api.getJobStatus !== 'function') {
        throw new Error('APIが利用できません（app.api.generateUtility/monitorProgress/getJobStatus）');
    }

    const params = {
        workflow: 'prompt_expand',
        prompt: String(prompt || '').trim(),
        output_type: 'video',
        target_workflow: targetWorkflow || null,
    };

    if (!params.prompt) return '';

    const job = await api.generateUtility(params);
    const jobId = job?.job_id;
    if (!jobId) throw new Error('job_idが取得できません');

    SimpleVideoUI.state.activeJobId = String(jobId);
    saveSimpleVideoState();
    updateGenerateButtonState();

    await new Promise((resolve, reject) => {
        let done = false;
        const finish = (fn) => (arg) => {
            if (done) return;
            done = true;
            fn(arg);
        };

        api.monitorProgress(
            jobId,
            (p) => {
                if ((Number(SimpleVideoUI.state.cancelSeq) || 0) !== cancelSeqAtStart) {
                    try { api.closeWebSocket?.(jobId); } catch (_e) {}
                    finish(reject)(new Error('Cancelled'));
                    return;
                }
                const local = Number(p?.progress) || 0;
                setSimpleVideoProgress(`🤖 LLM拡張: ${p?.message || 'Processing...'}`, Math.min(1, Math.max(0, local)));
            },
            finish(() => resolve(true)),
            finish((err) => reject(err instanceof Error ? err : new Error(String(err))) )
        );
    });

    const full = await api.getJobStatus(jobId);
    const expanded = String(full?.result?.expanded_prompt || '').trim();
    if (!expanded) {
        const details = full?.error || full?.message || `status=${full?.status || 'unknown'}`;
        throw new Error(`LLM拡張に失敗しました: ${details}`);
    }

    if (String(SimpleVideoUI.state.activeJobId || '') === String(jobId)) {
        SimpleVideoUI.state.activeJobId = null;
        saveSimpleVideoState();
        updateGenerateButtonState();
    }

    return expanded;
}

function isVideoFilename(filename) {
    const f = String(filename || '').toLowerCase();
    return /\.(mp4|webm|mov|mkv|avi)$/i.test(f);
}

function isAudioFilename(filename) {
    const f = String(filename || '').toLowerCase();
    return /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(f);
}

function renderSimpleVideoT2AAudioOutput({ jobId, outputs, title = '生成音楽' }) {
    const wrap = document.getElementById('simpleVideoT2AAudioOutput');
    if (!wrap) return;

    const audioOut = pickBestOutput(outputs, 'audio');
    if (!audioOut?.filename) {
        wrap.innerHTML = '';
        return;
    }

    const baseUrl = (window.app && window.app.api && window.app.api.baseURL) ? window.app.api.baseURL : '';
    const toAbsoluteDownloadURL = (filename) => {
        if (!filename) return '';
        if (window.app?.api?.getDownloadURL) return window.app.api.getDownloadURL(jobId, filename);
        if (!baseUrl) return '';
        return `${baseUrl}/api/v1/download/${encodeURIComponent(String(jobId))}/${String(filename)
            .split('/')
            .map((seg) => encodeURIComponent(seg))
            .join('/')}`;
    };

    const audioUrl = toAbsoluteDownloadURL(audioOut.filename);
    if (!audioUrl) {
        wrap.innerHTML = '';
        return;
    }

    SimpleVideoUI.state.t2aGeneratedAudio = {
        filename: String(audioOut.filename),
        previewUrl: audioUrl,
        durationSec: Number.isFinite(Number(SimpleVideoUI.state.t2aGeneratedAudio?.durationSec))
            ? Number(SimpleVideoUI.state.t2aGeneratedAudio.durationSec)
            : null,
    };
    saveSimpleVideoState();
    renderSimpleVideoM2VSourceUI();
    updateGenerateButtonState();

    const bars = Array.from({ length: 14 }, () => '<span class="simple-video-t2a-eq-bar"></span>').join('');

    // Fetch audio as blob first, then use blob URL for the player.
    // This avoids Firefox aborting concurrent fetches to the same proxy URL
    // (one for the <audio> element, one for the duration probe).
    const renderPlayer = (playerUrl) => {
        wrap.innerHTML = `
            <div class="simple-video-hint">${String(title)}</div>
            <div class="simple-video-t2a-audio-layout" id="simpleVideoT2AAudioLayout">
                <div class="simple-video-t2a-audio-left">
                    <audio controls src="${playerUrl}" id="simpleVideoT2AAudioPlayer" style="width:100%;"></audio>
                    <div style="margin-top:8px;">
                        <a class="simple-video-btn" href="${audioUrl}" download target="_blank" rel="noopener">音声をダウンロード</a>
                    </div>
                </div>
                <div class="simple-video-t2a-audio-right" aria-hidden="true">
                    <div class="simple-video-t2a-eq-wrap" id="simpleVideoT2AEqWrap">
                        ${bars}
                    </div>
                </div>
            </div>
        `;

        const audioEl = document.getElementById('simpleVideoT2AAudioPlayer');
        const eqWrap = document.getElementById('simpleVideoT2AEqWrap');
        if (!audioEl || !eqWrap) return;

        const syncEqState = () => {
            eqWrap.classList.toggle('playing', !audioEl.paused && !audioEl.ended);
        };
        audioEl.addEventListener('play', syncEqState);
        audioEl.addEventListener('pause', syncEqState);
        audioEl.addEventListener('ended', syncEqState);
        syncEqState();

        // Probe duration from the already-loaded player element (no extra fetch)
        const tryProbeDuration = () => {
            const dur = audioEl.duration;
            if (Number.isFinite(dur) && dur > 0) {
                const current = SimpleVideoUI.state.t2aGeneratedAudio;
                if (current && String(current.filename || '') === String(audioOut.filename || '')) {
                    current.durationSec = dur;
                    saveSimpleVideoState();
                    renderSimpleVideoM2VSourceUI();
                    updateGenerateButtonState();
                }
            }
        };
        if (Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
            tryProbeDuration();
        } else {
            audioEl.addEventListener('loadedmetadata', tryProbeDuration, { once: true });
        }
    };

    // Try blob approach for proxy compatibility; fall back to direct URL
    fetch(audioUrl).then(r => {
        if (!r.ok) throw new Error('fetch failed');
        return r.blob();
    }).then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        renderPlayer(blobUrl);
    }).catch(() => {
        // Fallback: use direct URL (works on Chrome / localhost)
        renderPlayer(audioUrl);
    });
}

function isImageFilename(filename) {
    const f = String(filename || '').toLowerCase();
    return /\.(png|jpe?g|webp|gif|bmp)$/i.test(f);
}

function isQwen2511ImageEditWorkflowId(workflowId) {
    const id = String(workflowId || '');
    return (
        id.includes('i2i_qwen_image_edit_2511')
        || id.includes('qwen_i2i_2511')
        || id.includes('qwen_image_edit_2511')
    );
}

function isQwen2512I2IWorkflowId(workflowId) {
    const id = String(workflowId || '');
    return (
        id.includes('qwen_i2i_2512')
        || id.includes('qwen_2512_i2i')
    );
}

function countI2IInputImages(requestParams = {}) {
    let count = 0;
    const p = requestParams && typeof requestParams === 'object' ? requestParams : {};
    if (String(p.input_image || '').trim()) count += 1;
    for (let i = 2; i <= 9; i++) {
        if (String(p[`input_image_${i}`] || '').trim()) count += 1;
    }
    return count;
}

function resolveQwen2511WorkflowVariant(workflowId, requestParams = {}) {
    const wf = normalizeWorkflowAlias(workflowId);
    if (!isQwen2511ImageEditWorkflowId(wf)) return wf;
    if (/_1img$|_2img$|_3img$/i.test(String(wf))) return wf;

    const inputCount = countI2IInputImages(requestParams);
    const suffix = inputCount <= 1 ? '1img' : (inputCount === 2 ? '2img' : '3img');

    if (String(wf).includes('lightning4')) return `qwen_i2i_2511_bf16_lightning4_${suffix}`;
    if (String(wf).includes('qwen_i2i_2511_bf16')) return `qwen_i2i_2511_bf16_${suffix}`;
    return wf;
}

/**
 * Compute ref3 scene I2I configuration.
 * Returns { ref3Active, ref3Mode, adjustedWorkflow, ref3Filename }
 * - ref3Active: whether ref3 should be used in scene I2I
 * - ref3Mode: 'background' | 'style' | 'anime'
 * - adjustedWorkflow: workflow ID (auto-switched to 2511 if ref3 active + was 2512)
 * - ref3Filename: the filename of ref3 image (or null)
 */
function computeRef3SceneI2IConfig(baseWorkflow) {
    const state = SimpleVideoUI.state;
    const ref3Slot = Array.isArray(state.dropSlots) ? state.dropSlots[2] : null;
    const ref3Active = !!(ref3Slot?.filename && state.ref3ModeEnabled !== false);
    const ref3Mode = String(state.ref3UseMode || 'background');
    let adjustedWorkflow = baseWorkflow;
    if (ref3Active && isQwen2512I2IWorkflowId(adjustedWorkflow)) {
        adjustedWorkflow = normalizeWorkflowAlias('qwen_i2i_2511_bf16_lightning4');
        console.log('[SimpleVideo] ref3 active: auto-switched from 2512 to 2511 for multi-image support');
    }
    return { ref3Active, ref3Mode, adjustedWorkflow, ref3Filename: ref3Slot?.filename || null };
}

/**
 * Build a prompt hint indicating the reference image is a multi-angle character sheet.
 * Prepend this to scene prompts when useCharSheetAsRef is active.
 * @returns {string} hint text to prepend to prompt
 */
function buildCharSheetRefPromptHint() {
    // Must start with "Edit picture 1" so wrapQwen2511EditInstructionPrompt() recognises it
    // as a complete instruction and does NOT prepend "Preserve the subject identity and overall
    // composition" (which would cause the model to reproduce the multi-panel sheet layout).
    return [
        'Edit picture 1 to show this character in the scene described below.',
        'Picture 1 is a CHARACTER SHEET (multi-view reference showing the character from multiple angles: front, back, side, etc.).',
        'Use it ONLY to extract character identity: face, hair style, clothing, colors, body proportions.',
        'Generate ONE single scene image. Do NOT reproduce the character sheet layout.',
        'Do NOT output multiple panels, multiple views, or any reference sheet format.',
    ].join(' ');
}

/**
 * Build ref3 prompt hint based on mode.
 * @param {string} ref3Mode - 'background' | 'style' | 'anime'
 * @param {number|null} ref3PictureNum - Picture N number for ref3, or null
 * @returns {string} hint text to prepend to prompt
 */
function buildRef3PromptHint(ref3Mode, ref3PictureNum) {
    const picRef = ref3PictureNum ? `Picture ${ref3PictureNum}` : 'the reference image (ref3)';
    switch (ref3Mode) {
        case 'background':
            return `Place the subject in the scene/background shown in ${picRef}. Use ${picRef} as the background environment.`;
        case 'style':
            return `Apply the art style, color palette, and visual aesthetics from ${picRef} to this image.`;
        case 'anime':
            return `Convert this image to anime/illustration style, using ${picRef} as the style reference.`;
        default:
            return '';
    }
}

function wrapQwen2511EditInstructionPrompt(text) {
    const t = String(text || '').trim();
    if (!t) return '';

    // If it already references picture 1 explicitly, assume it's an edit instruction.
    if (/picture\s*1|画像\s*1|in\s+picture\s*1|edit\s+picture\s*1/i.test(t)) return t;

    // Qwen Image Edit 2511 expects an instruction prompt; a pure description often results in minimal/no change.
    return [
        'Edit picture 1 according to the instruction below.',
        'Preserve the subject identity and overall composition, but apply the edits clearly.',
        t,
    ].join('\n');
}

function pickBestOutput(outputs, kind /* 'video'|'image'|'audio' */) {
    const list = Array.isArray(outputs) ? outputs : [];
    if (!list.length) return null;

    const wantVideo = kind === 'video';
    const wantImage = kind === 'image';
    const wantAudio = kind === 'audio';

    // Prefer explicit media_type if present
    if (wantVideo) {
        const byType = list.find((o) => String(o?.media_type || o?.type || '').toLowerCase() === 'video');
        if (byType) return byType;
    }
    if (wantImage) {
        const byType = list.find((o) => String(o?.media_type || o?.type || '').toLowerCase() === 'image');
        if (byType) return byType;
    }
    if (wantAudio) {
        const byType = list.find((o) => String(o?.media_type || o?.type || '').toLowerCase() === 'audio');
        if (byType) return byType;
    }

    // Fallback to filename extension
    if (wantVideo) {
        const byExt = list.find((o) => isVideoFilename(o?.filename));
        if (byExt) return byExt;
    }
    if (wantImage) {
        const byExt = list.find((o) => isImageFilename(o?.filename));
        if (byExt) return byExt;
    }
    if (wantAudio) {
        const byExt = list.find((o) => isAudioFilename(o?.filename));
        if (byExt) return byExt;
    }

    return null;
}

function renderSimpleVideoOutputMedia({ jobId, outputs, title, preferMedia = 'video' }) {
    const out = document.getElementById('simpleVideoOutput');
    if (!out) return;

    const videoOut = pickBestOutput(outputs, 'video');
    const imageOut = pickBestOutput(outputs, 'image');
    const audioOut = pickBestOutput(outputs, 'audio');

    const baseUrl = (window.app && window.app.api && window.app.api.baseURL) ? window.app.api.baseURL : '';

    function toAbsoluteDownloadURL(filename) {
        if (!filename) return '';
        if (window.app?.api?.getDownloadURL) return window.app.api.getDownloadURL(jobId, filename);
        if (!baseUrl) return '';
        return `${baseUrl}/api/v1/download/${encodeURIComponent(String(jobId))}/${String(filename)
            .split('/')
            .map((seg) => encodeURIComponent(seg))
            .join('/')}`;
    }

    const videoUrl = videoOut?.filename ? toAbsoluteDownloadURL(videoOut.filename) : '';
    const imageUrl = imageOut?.filename ? toAbsoluteDownloadURL(imageOut.filename) : '';
    const audioUrl = audioOut?.filename ? toAbsoluteDownloadURL(audioOut.filename) : '';

    if (videoOut?.filename) {
        SimpleVideoUI.state.v2mGeneratedVideo = {
            filename: String(videoOut.filename),
            previewUrl: videoUrl,
            durationSec: Number.isFinite(Number(SimpleVideoUI.state.v2mGeneratedVideo?.durationSec))
                ? Number(SimpleVideoUI.state.v2mGeneratedVideo.durationSec)
                : null,
        };
        saveSimpleVideoState();
        if (videoUrl) {
            probeSimpleVideoMediaDuration(videoUrl, 'video').then((sec) => {
                if (!Number.isFinite(sec) || sec <= 0) return;
                const current = SimpleVideoUI.state.v2mGeneratedVideo;
                if (!current || String(current.filename || '') !== String(videoOut.filename || '')) return;
                current.durationSec = sec;
                saveSimpleVideoState();
                renderSimpleVideoV2MSourceUI();
                updateGenerateButtonState();
            }).catch(() => {});
        }
    }

    if (audioOut?.filename) {
        SimpleVideoUI.state.t2aGeneratedAudio = {
            filename: String(audioOut.filename),
            previewUrl: audioUrl,
            durationSec: Number.isFinite(Number(SimpleVideoUI.state.t2aGeneratedAudio?.durationSec))
                ? Number(SimpleVideoUI.state.t2aGeneratedAudio.durationSec)
                : null,
        };
        saveSimpleVideoState();
        if (audioUrl) {
            probeSimpleVideoMediaDuration(audioUrl, 'audio').then((sec) => {
                if (!Number.isFinite(sec) || sec <= 0) return;
                const current = SimpleVideoUI.state.t2aGeneratedAudio;
                if (!current || String(current.filename || '') !== String(audioOut.filename || '')) return;
                current.durationSec = sec;
                saveSimpleVideoState();
                renderSimpleVideoM2VSourceUI();
                updateGenerateButtonState();
            }).catch(() => {});
        }
    }

    renderSimpleVideoM2VSourceUI();
    renderSimpleVideoV2MSourceUI();
    updateGenerateButtonState();

    const heading = title ? `<div class="simple-video-hint">${String(title)}</div>` : '';

    // Some workflows may emit both image + video outputs. For "initial frame" previews,
    // we want to prefer the still image even if a video exists.
    const prefer = String(preferMedia || 'video').toLowerCase();

    if (prefer === 'audio' && audioUrl) {
        setSimpleVideoOutputPreviewImage({ jobId: null, filename: null });
        out.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;padding:12px;gap:10px;">
                ${heading}
                <audio controls src="${audioUrl}" style="width:min(100%, 520px);"></audio>
                <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
                    <a class="simple-video-btn" href="${audioUrl}" download target="_blank" rel="noopener">音声をダウンロード</a>
                </div>
            </div>
        `;
        return;
    }

    if (prefer === 'image' && imageUrl) {
        // If we are rendering an image as the main output, keep prepared states only when they match.
        const preparedLeft = SimpleVideoUI?.state?.preparedInitialImage;
        if (preparedLeft) {
            const preparedJobId = String(preparedLeft.jobId || '');
            const preparedFn = String(preparedLeft.filename || '');
            const currentFn = String(imageOut?.filename || '');
            if (preparedJobId !== String(jobId) || preparedFn !== currentFn) {
                SimpleVideoUI.state.preparedInitialImage = null;
                saveSimpleVideoState();
            }
        }

        const preparedVideo = SimpleVideoUI?.state?.preparedVideoInitialImage;
        if (preparedVideo) {
            const preparedJobId = String(preparedVideo.jobId || '');
            const preparedFn = String(preparedVideo.filename || '');
            const currentFn = String(imageOut?.filename || '');
            if (preparedJobId !== String(jobId) || preparedFn !== currentFn) {
                SimpleVideoUI.state.preparedVideoInitialImage = null;
                saveSimpleVideoState();
            }
        }

        // If we are rendering an image as the main output, also hide the temporary preview.
        setSimpleVideoOutputPreviewImage({ jobId: null, filename: null });
        out.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;padding:12px;gap:10px;">
                ${heading}
                <img src="${imageUrl}" alt="output" style="max-width:100%;max-height:100%;object-fit:contain;" />
                <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
                    <a class="simple-video-btn" href="${imageUrl}" download target="_blank" rel="noopener">画像をダウンロード</a>
                </div>
            </div>
        `;
        return;
    }

    if (videoUrl) {
        // Output has moved on to video; prepared still-images should no longer be used.
        if (SimpleVideoUI?.state?.preparedInitialImage || SimpleVideoUI?.state?.preparedVideoInitialImage) {
            SimpleVideoUI.state.preparedInitialImage = null;
            SimpleVideoUI.state.preparedVideoInitialImage = null;
            saveSimpleVideoState();
        }
        // Video is the primary output; hide any temporary image preview.
        setSimpleVideoOutputPreviewImage({ jobId: null, filename: null });
        out.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;padding:12px;gap:10px;">
                ${heading}
                <video controls playsinline src="${videoUrl}" style="max-width:100%;max-height:100%;object-fit:contain;"></video>
                <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
                    <a class="simple-video-btn" href="${videoUrl}" download target="_blank" rel="noopener">動画をダウンロード</a>
                </div>
            </div>
        `;
        return;
    }

    if (imageUrl) {
        // If we are rendering an image as the main output, keep prepared states only when they match.
        const preparedLeft = SimpleVideoUI?.state?.preparedInitialImage;
        if (preparedLeft) {
            const preparedJobId = String(preparedLeft.jobId || '');
            const preparedFn = String(preparedLeft.filename || '');
            const currentFn = String(imageOut?.filename || '');
            if (preparedJobId !== String(jobId) || preparedFn !== currentFn) {
                SimpleVideoUI.state.preparedInitialImage = null;
                saveSimpleVideoState();
            }
        }

        const preparedVideo = SimpleVideoUI?.state?.preparedVideoInitialImage;
        if (preparedVideo) {
            const preparedJobId = String(preparedVideo.jobId || '');
            const preparedFn = String(preparedVideo.filename || '');
            const currentFn = String(imageOut?.filename || '');
            if (preparedJobId !== String(jobId) || preparedFn !== currentFn) {
                SimpleVideoUI.state.preparedVideoInitialImage = null;
                saveSimpleVideoState();
            }
        }
        // If we are rendering an image as the main output, also hide the temporary preview.
        setSimpleVideoOutputPreviewImage({ jobId: null, filename: null });
        out.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;padding:12px;gap:10px;">
                ${heading}
                <img src="${imageUrl}" alt="output" style="max-width:100%;max-height:100%;object-fit:contain;" />
                <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
                    <a class="simple-video-btn" href="${imageUrl}" download target="_blank" rel="noopener">画像をダウンロード</a>
                </div>
            </div>
        `;
        return;
    }

    if (audioUrl) {
        setSimpleVideoOutputPreviewImage({ jobId: null, filename: null });
        out.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;padding:12px;gap:10px;">
                ${heading}
                <audio controls src="${audioUrl}" style="width:min(100%, 520px);"></audio>
                <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
                    <a class="simple-video-btn" href="${audioUrl}" download target="_blank" rel="noopener">音声をダウンロード</a>
                </div>
            </div>
        `;
        return;
    }

    out.innerHTML = `
        <div class="simple-video-output-placeholder">
            <i class="fas fa-film"></i>
            <div>出力が見つかりませんでした</div>
        </div>
    `;
}

function getEffectiveWH() {
    const size = getEffectiveVideoSize();
    if (!size || size === 'auto') return { width: null, height: null };
    const m = /^([0-9]+)x([0-9]+)$/.exec(String(size));
    if (!m) return { width: null, height: null };
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { width: null, height: null };
    return { width: w, height: h };
}

async function runWorkflowStep({ workflow, label, requestParams, stepIndex, totalSteps }) {
    let wf = normalizeWorkflowAlias(workflow);
    const wfAdjusted = resolveQwen2511WorkflowVariant(wf, requestParams);
    if (String(wfAdjusted) !== String(wf)) {
        console.log('[SimpleVideo] Auto-switched Qwen2511 workflow variant:', { from: wf, to: wfAdjusted, inputCount: countI2IInputImages(requestParams) });
        wf = wfAdjusted;
    }
    const api = window.app?.api;
    if (!api || typeof api.generate !== 'function' || typeof api.monitorProgress !== 'function' || typeof api.getJobStatus !== 'function') {
        throw new Error('API client is not available (window.app.api.generate/monitorProgress/getJobStatus)');
    }

    console.log('[SimpleVideo] runWorkflowStep:', { workflow: wf, requestParams });

    const cancelSeqAtStart = Number(SimpleVideoUI.state.cancelSeq) || 0;

    const job = await api.generate({ workflow: wf, ...requestParams });
    const jobId = job?.job_id;
    if (!jobId) throw new Error('Job response missing job_id');

    // Mark current job so Stop can interrupt it.
    SimpleVideoUI.state.activeJobId = jobId;
    updateGenerateButtonState();

    // completionData: WebSocket / status-poll resolution payload.
    // Both paths include job.result (which has outputs) — use it directly to avoid a redundant HTTP round-trip.
    const completionData = await new Promise((resolve, reject) => {
        let done = false;

        const pollCancel = () => {
            const now = Number(SimpleVideoUI.state.cancelSeq) || 0;
            return now !== cancelSeqAtStart;
        };

        if (pollCancel()) {
            try { api.closeWebSocket?.(jobId); } catch (_e) {}
            reject(new Error('Cancelled'));
            return;
        }

        const cancelTimer = setInterval(() => {
            if (done) return;
            if (pollCancel()) {
                done = true;
                clearInterval(cancelTimer);
                try { api.closeWebSocket?.(jobId); } catch (_e) {}
                reject(new Error('Cancelled'));
            }
        }, 250);

        const statusPollTimer = setInterval(async () => {
            if (done) return;
            if (pollCancel()) {
                done = true;
                clearInterval(cancelTimer);
                clearInterval(statusPollTimer);
                try { api.closeWebSocket?.(jobId); } catch (_e) {}
                reject(new Error('Cancelled'));
                return;
            }
            try {
                const st = await api.getJobStatus(jobId);
                if (done) return;
                const status = String(st?.status || '').toLowerCase();
                const local = normalizeProgress01(st?.progress);
                if (status === 'queued' || status === 'processing') {
                    const overall = (stepIndex + Math.min(1, Math.max(0, local))) / Math.max(1, totalSteps);
                    setSimpleVideoProgress(`(${stepIndex + 1}/${totalSteps}) ${label || wf}: ${st?.message || 'Processing...'}`, overall);
                    return;
                }
                if (status === 'completed') {
                    done = true;
                    clearInterval(cancelTimer);
                    clearInterval(statusPollTimer);
                    try { api.closeWebSocket?.(jobId); } catch (_e) {}
                    resolve(st);
                    return;
                }
                if (status === 'failed' || status === 'cancelled') {
                    done = true;
                    clearInterval(cancelTimer);
                    clearInterval(statusPollTimer);
                    try { api.closeWebSocket?.(jobId); } catch (_e) {}
                    const details = st?.error || st?.message || `status=${status}`;
                    reject(new Error(String(details || 'Job failed')));
                }
            } catch (_e) {
                // Keep websocket path as primary; ignore transient polling errors.
            }
        }, 1500);

        const finish = (fn) => (arg) => {
            if (done) return;
            done = true;
            clearInterval(cancelTimer);
            clearInterval(statusPollTimer);
            fn(arg);
        };

        api.monitorProgress(
            jobId,
            (p) => {
                if (pollCancel()) {
                    try { api.closeWebSocket?.(jobId); } catch (_e) {}
                    finish(reject)(new Error('Cancelled'));
                    return;
                }
                const local = Number(p?.progress) || 0;
                const overall = (stepIndex + Math.min(1, Math.max(0, local))) / Math.max(1, totalSteps);
                setSimpleVideoProgress(`(${stepIndex + 1}/${totalSteps}) ${label || wf}: ${p?.message || 'Processing...'}`, overall);
            },
            finish((data) => resolve(data)),
            finish((err) => reject(err))
        );
    });

    // Job finished; clear activeJobId (next step will set a new one)
    if (SimpleVideoUI.state.activeJobId === jobId) {
        SimpleVideoUI.state.activeJobId = null;
        updateGenerateButtonState();
    }

    // Primary: extract outputs directly from the completion payload.
    // Both the WebSocket path and the status-poll path (getJobStatus) return job.result which contains outputs.
    // This avoids an unnecessary HTTP call to /api/v1/outputs/{jobId} in the normal case.
    let outputs = Array.isArray(completionData?.result?.outputs) ? completionData.result.outputs : [];
    console.log('[SimpleVideo] outputs from completionData:', { jobId, count: outputs.length });

    // Fallback: call getOutputs only when completionData did not carry outputs.
    if (outputs.length === 0 && typeof api.getOutputs === 'function') {
        try {
            const overall = (stepIndex + 1) / Math.max(1, totalSteps);
            setSimpleVideoProgress(`(${stepIndex + 1}/${totalSteps}) ${label || wf}: 出力取得中...`, overall);
        } catch (_e) {}
        try {
            const outputsPayload = await api.getOutputs(jobId);
            outputs = Array.isArray(outputsPayload?.outputs) ? outputsPayload.outputs : [];
        } catch (outputsErr) {
            console.warn('[SimpleVideo] getOutputs failed, fallback to getJobStatus.result.outputs', { jobId, error: outputsErr });
            if (typeof api.getJobStatus === 'function') {
                try {
                    const st = await api.getJobStatus(jobId);
                    outputs = Array.isArray(st?.result?.outputs) ? st.result.outputs : [];
                } catch (statusErr) {
                    console.warn('[SimpleVideo] getJobStatus fallback for outputs failed', { jobId, error: statusErr });
                }
            }
        }
    }

    return { jobId, workflow: wf, outputs };
}

async function runUtilityExtractLastFrame({ videoBasename, label, stepIndex, totalSteps, cancelSeqAtStart }) {
    const api = window.app?.api;
    if (!api || typeof api.generateUtility !== 'function' || typeof api.monitorProgress !== 'function') {
        throw new Error('API client is not available (window.app.api.generateUtility)');
    }
    if (!videoBasename) throw new Error('extract_last_frame requires video filename');

    const job = await api.generateUtility({ workflow: 'extract_last_frame', video: String(videoBasename) });
    const jobId = job?.job_id;
    if (!jobId) throw new Error('Job response missing job_id');

    SimpleVideoUI.state.activeJobId = String(jobId);
    updateGenerateButtonState();

    await new Promise((resolve, reject) => {
        let done = false;
        const finish = (fn) => (arg) => {
            if (done) return;
            done = true;
            fn(arg);
        };

        api.monitorProgress(
            jobId,
            (p) => {
                if ((Number(SimpleVideoUI.state.cancelSeq) || 0) !== cancelSeqAtStart) {
                    try { api.closeWebSocket?.(jobId); } catch (_e) {}
                    finish(reject)(new Error('Cancelled'));
                    return;
                }
                const local01 = normalizeProgress01(p?.progress);
                const overall = (stepIndex + local01) / Math.max(1, totalSteps);
                setSimpleVideoProgress(`(${stepIndex + 1}/${totalSteps}) ${label || 'extract_last_frame'}: ${p?.message || 'Processing...'}`, overall);
            },
            finish(() => resolve()),
            finish((err) => reject(err))
        );
    });

    if (String(SimpleVideoUI.state.activeJobId || '') === String(jobId)) {
        SimpleVideoUI.state.activeJobId = null;
        updateGenerateButtonState();
    }

    const outputsPayload = (typeof api.getOutputs === 'function') ? await api.getOutputs(jobId) : null;
    const outputs = Array.isArray(outputsPayload?.outputs) ? outputsPayload.outputs : [];
    return { jobId, outputs };
}

async function determineScenePromptsForCurrentSimpleVideoRun({ preset, cancelSeqAtStart, allowLLMGeneration = true }) {
    const { state } = SimpleVideoUI;
    const desiredCount = Math.max(1, getEffectiveSceneCountForPromptGeneration());
    const forceRegenerate = !!simpleVideoForcePromptRegeneration;

    // Determine scene prompts:
    // - If LLM prompt box has numbered prompts, use them
    // - Otherwise auto-run prompt_generate like Full Auto Video
    let scenePrompts = forceRegenerate ? [] : parseScenePromptsFromText(state.llmPrompt);
    if (!scenePrompts || scenePrompts.length === 0) {
        if (state.scenarioUseLLM && allowLLMGeneration) {
            if (typeof showToast === 'function') showToast('🤖 シーンプロンプトを生成中...', 'info');
            scenePrompts = await generateScenePromptsForCurrentSimpleVideoRun({ preset, cancelSeqAtStart });
        } else {
            const scenarioPrompt = String(state.scenario || '').trim();
            const count = Math.max(1, getEffectiveSceneCountForPromptGeneration());
            scenePrompts = buildScenePromptsFromScenarioText({ scenarioText: scenarioPrompt, desiredCount: count });

            // During targeted regeneration, never overwrite the whole prompt editor
            // with scenario fallback-derived prompts.
            if (allowLLMGeneration) {
                const formatted = scenePrompts
                    .map((p, i) => `#${i + 1}: ${String(p || '').trim()}`)
                    .join('\n');

                state.llmPrompt = formatted;
                saveSimpleVideoState();

                const llmPromptEl = document.getElementById('simpleVideoLLMPrompt');
                if (llmPromptEl) llmPromptEl.value = formatted;

                const promptsWrap = document.getElementById('simpleVideoGeneratedPromptsWrap');
                if (promptsWrap) promptsWrap.style.display = '';
            }
        }
    }

    if (!scenePrompts || scenePrompts.length === 0) {
        scenePrompts = [String(state.scenario || '').trim()].filter(Boolean);
    }

    if (!scenePrompts || scenePrompts.length === 0) {
        scenePrompts = ['scene'];
    }

    if (scenePrompts.length !== desiredCount) {
        const normalized = scenePrompts.slice(0, desiredCount);
        while (normalized.length < desiredCount) {
            normalized.push(String(normalized[normalized.length - 1] || String(state.scenario || '').trim() || 'scene'));
        }
        scenePrompts = normalized;

        if (allowLLMGeneration) {
            const formatted = scenePrompts
                .map((p, i) => `#${i + 1}: ${String(p || '').trim()}`)
                .join('\n');
            state.llmPrompt = formatted;
            saveSimpleVideoState();

            const llmPromptEl = document.getElementById('simpleVideoLLMPrompt');
            if (llmPromptEl) llmPromptEl.value = formatted;
        }
    }

    return scenePrompts;
}

function composeFLFPromptWithEndIntent(startPrompt, endPrompt, useEndConstraint = true) {
    const start = String(startPrompt || '').trim();
    const end = String(endPrompt || '').trim();
    const fallback = start ? `${start}, transitioning to next scene` : 'smooth transition between scenes';
    if (!useEndConstraint || !end) return fallback;

    return [
        `Start intent: ${start || 'preserve current scene continuity'}.`,
        `End target (must be reflected near the end frame): ${end}.`,
        'Keep subject identity consistent and make camera direction/pose transition smooth and coherent.'
    ].join(' ');
}

function rememberSceneVideoBasenames({ presetId, sceneVideoBasenames }) {
    const pid = String(presetId || '').trim();
    if (!pid) return;
    const list = Array.isArray(sceneVideoBasenames)
        ? sceneVideoBasenames.map((v) => {
            const s = String(v || '').trim();
            return s || null;
        })
        : [];
    SimpleVideoUI.state.sceneVideos = { presetId: pid, videos: list };
    saveSimpleVideoState();
}

function setSceneVideoBasenameAtIndex({ presetId, index, basename }) {
    const pid = String(presetId || '').trim();
    const idx = Number(index);
    const base = String(basename || '').trim();
    if (!pid || !Number.isFinite(idx) || idx < 0 || !base) return;

    const cur = normalizeSceneVideos(SimpleVideoUI.state.sceneVideos);
    const next = (cur && String(cur.presetId || '') === pid)
        ? { presetId: pid, videos: Array.isArray(cur.videos) ? cur.videos.slice() : [] }
        : { presetId: pid, videos: [] };

    while (next.videos.length <= idx) next.videos.push(null);
    next.videos[idx] = base;

    SimpleVideoUI.state.sceneVideos = next;
    saveSimpleVideoState();
}

async function runSceneVideosConcatFromState({ presetId, title = '結合結果（再生成）' } = {}) {
    const pid = String(presetId || '').trim();
    const stateVideos = normalizeSceneVideos(SimpleVideoUI.state.sceneVideos);
    if (!stateVideos || String(stateVideos.presetId || '') !== pid) {
        throw new Error('結合対象のシーン動画一覧が見つかりません');
    }

    const raw = Array.isArray(stateVideos.videos) ? stateVideos.videos : [];
    const missingIndex = raw.findIndex((v) => !String(v || '').trim());
    if (missingIndex >= 0) {
        throw new Error(`結合対象が不足しています（#${missingIndex + 1} が未生成）`);
    }

    const videos = raw.map((v) => String(v || '').trim()).filter(Boolean);
    if (videos.length < 2) {
        throw new Error('結合には2本以上の動画が必要です');
    }

    const api = window.app?.api;
    if (!api || typeof api.generateUtility !== 'function' || typeof api.monitorProgress !== 'function') {
        throw new Error('APIが利用できません（app.api.generateUtility/monitorProgress）');
    }

    const fpsRaw = Number(SimpleVideoUI.state.fps);
    const concatFps = (Number.isFinite(fpsRaw) && fpsRaw > 0) ? Math.round(fpsRaw) : 16;

    if (typeof showToast === 'function') showToast(`🔗 動画を結合中...（${videos.length}本）`, 'info');

    const concatJob = await api.generateUtility({
        workflow: 'video_concat',
        videos,
        fps: concatFps,
        keep_audio: !!SimpleVideoUI.state.generateAudio,
    });
    const concatJobId = concatJob?.job_id;
    if (!concatJobId) throw new Error('結合ジョブ(job_id)が取得できません');

    SimpleVideoUI.state.activeJobId = String(concatJobId);
    saveSimpleVideoState();
    updateGenerateButtonState();

    await new Promise((resolve, reject) => {
        let done = false;
        const finish = (fn) => (arg) => {
            if (done) return;
            done = true;
            fn(arg);
        };

        api.monitorProgress(
            concatJobId,
            (p) => {
                const local01 = normalizeProgress01(p?.progress);
                setSimpleVideoProgress(`🔗 結合: ${p?.message || 'Processing...'}`, local01);
            },
            finish(() => resolve()),
            finish((err) => reject(err))
        );
    });

    if (String(SimpleVideoUI.state.activeJobId || '') === String(concatJobId)) {
        SimpleVideoUI.state.activeJobId = null;
        saveSimpleVideoState();
        updateGenerateButtonState();
    }

    const outputsPayload = (typeof api.getOutputs === 'function') ? await api.getOutputs(concatJobId) : null;
    const outputs = Array.isArray(outputsPayload?.outputs) ? outputsPayload.outputs : [];
    renderSimpleVideoOutputMedia({ jobId: concatJobId, outputs, title: `${title}（${videos.length}本）` });
}

async function startGeneration() {
    const { state } = SimpleVideoUI;
    if (state.isGenerating) return;

    simpleVideoContinueGateActive = false;
    simpleVideoContinueGateResolver = null;
    setSimpleVideoContinueGateVisible(false);
    updateGenerateButtonState();

    const preparedImageFilename = String(state.preparedVideoInitialImage?.filename || '').trim() || null;

    const cancelSeqAtStart = Number(state.cancelSeq) || 0;

    const preset = VIDEO_PRESETS.find((p) => p.id === state.selectedPreset);
    if (!preset) {
        if (typeof showToast === 'function') showToast('生成シーケンスを選択してください', 'warning');
        return;
    }
    const hasM2VOverride = !!String(simpleVideoM2VPromptOverride || '').trim();
    if (!String(state.scenario || '').trim() && !hasM2VOverride) {
        if (typeof showToast === 'function') showToast('シナリオを入力してください', 'warning');
        return;
    }
    const desiredCount = Math.max(1, Number(state.sceneCount) || 1);
    // FLF-only presets need N+1 images for N FLF segments
    const effectiveDesiredCount = (preset?.flfOnly) ? desiredCount + 1 : desiredCount;
    const hasIntermediate = hasCompleteIntermediateImagesForPreset({ presetId: preset.id, desiredCount: effectiveDesiredCount });
    if (preset.requiresImage && !state.uploadedImage && !preparedImageFilename && !hasIntermediate) {
        if (typeof showToast === 'function') showToast('画像（キー画像）をアップロードするか、初期フレームを生成してください', 'warning');
        return;
    }
    const hasCharacterContext = !!state.selectedCharacter || !!String(state.characterImage?.filename || '').trim();
    if (preset.requiresCharacter && !hasCharacterContext) {
        if (typeof showToast === 'function') showToast('キャラクタを選択するか、キャラ画像を生成してください', 'warning');
        return;
    }

    console.log('[SimpleVideo] Starting generation...');
    console.log('[SimpleVideo] Preset:', preset.id);

    // Validate and clear stale intermediate images to prevent invalid file references
    const currentIntermediateImages = state.intermediateImages;
    if (currentIntermediateImages) {
        const storedPresetId = String(currentIntermediateImages.presetId || '');
        const storedCount = Array.isArray(currentIntermediateImages.images) ? currentIntermediateImages.images.length : 0;
        const currentPresetId = String(preset.id || '');
        let currentDesiredCount = Math.max(1, Number(state.sceneCount) || 1);
        if (preset?.flfOnly) currentDesiredCount += 1; // FLF-only needs N+1 images
        
        // Clear intermediate images if preset ID or scene count changed
        if (storedPresetId !== currentPresetId || storedCount !== currentDesiredCount) {
            console.log(`[SimpleVideo] Clearing stale intermediateImages: stored preset=${storedPresetId} (count=${storedCount}) vs current preset=${currentPresetId} (count=${currentDesiredCount})`);
            state.intermediateImages = null;
        }
    }

    // Note: LTX workflows default to stripping audio unless strip_audio=false is passed.

    state.isGenerating = true;
    state.currentStep = 0;
    // totalSteps is set after scene prompts are determined
    state.totalSteps = 0;
    state.progress = 0;
    saveSimpleVideoState();
    updateGenerateButtonState();
    clearSimpleVideoOutput();
    setSimpleVideoProgressVisible(true);
    setSimpleVideoProgress('準備中...', 0);

    try {
        const { width, height } = getEffectiveWH();

        const scenePrompts = await determineScenePromptsForCurrentSimpleVideoRun({ preset, cancelSeqAtStart });

        const fallbackSceneSeconds = Math.max(1, Number(state.sceneLengthSec) || 5);
        const useM2VDurationPlan = !!(
            state.m2vIsRunning
            && Array.isArray(state.m2vDurationPlan)
            && state.m2vDurationPlan.length > 0
        );
        const getSceneSecondsForIndex = (sceneIndex) => {
            if (!useM2VDurationPlan) return fallbackSceneSeconds;
            const idx = Math.max(0, Number(sceneIndex) || 0);
            const raw = Number(state.m2vDurationPlan[idx]);
            if (!Number.isFinite(raw) || raw <= 0) return fallbackSceneSeconds;
            return Math.min(7, Math.max(2, Math.round(raw)));
        };
        const getSceneFramesForIndex = (sceneIndex, fps) => computeLTXFrames(getSceneSecondsForIndex(sceneIndex), fps);

        // Special pipeline: Full Auto style character video (I2I + FLF + I2V)
        if (String(preset.id || '') === 'char_i2i_flf') {
            // Ensure FPS is consistent with current options before running.
            syncFpsForCurrentOptions({ forceUI: true });

            const sceneCount = scenePrompts.length;
            const i2iWorkflowBase = (String(state.i2iRefineWorkflow || '') !== 'auto' && String(state.i2iRefineWorkflow || '').trim())
                ? normalizeWorkflowAlias(String(state.i2iRefineWorkflow))
                : normalizeWorkflowAlias(getConfiguredSimpleVideoWorkflow('i2i', 'qwen_i2i_2511_bf16_lightning4'));

            // ref3 scene I2I config
            const { ref3Active, ref3Mode, adjustedWorkflow: i2iWorkflowFromRef3d } = computeRef3SceneI2IConfig(i2iWorkflowBase);
            const i2iWorkflow = i2iWorkflowFromRef3d;

            // FLF品質設定: speed=4-step(高速), quality=20-step(高品質)
            const flfWorkflow = state.flfQuality === 'quality' ? 'wan22_flf2v' : 'wan22_smooth_first2last';

            const hasPreparedForThisPreset = !!(
                state.preparedVideoInitialImage?.filename
                && String(state.preparedVideoInitialImage?.presetId || '') === String(preset.id || '')
            );
            const prepared = hasPreparedForThisPreset ? state.preparedVideoInitialImage : null;

            const desiredMidCount = Math.max(1, sceneCount);
            const scenarioFP = computeScenarioFingerprint(state.scenario, scenePrompts);
            const inter = ensureIntermediateImagesState({ presetId: preset.id, desiredCount: desiredMidCount, scenarioFingerprint: scenarioFP });
            if (!inter) throw new Error('中間画像の状態が初期化できません');

            // If a prepared initial frame exists for this preset, use it as scene #1 unless overridden.
            if (prepared?.filename && !inter.images?.[0]?.filename) {
                inter.images[0] = {
                    source: 'prepared',
                    filename: String(prepared.filename),
                    jobId: prepared.jobId ? String(prepared.jobId) : null,
                    prompt: String(prepared.prompt || ''),
                };
                saveSimpleVideoState();
            }

            renderSimpleVideoIntermediateImagesUI();

            const missingCount = (Array.isArray(inter.images) ? inter.images : [])
                .slice(0, sceneCount)
                .filter((v) => !v || !String(v.filename || '').trim()).length;

            // Reference image: prefer uploadedImage, fallback to dropSlots[0]
            const referenceImageFilename = state.uploadedImage?.filename 
                || (Array.isArray(state.dropSlots) && state.dropSlots[0]?.filename) 
                || null;

            if (missingCount > 0 && !referenceImageFilename) {
                throw new Error('キー画像がありません（キャラクター動画: 中間画像のI2I生成に必要）。キー画像か📥画像ドロップにref1をセットしてください');
            }

            const imageJobsToRun = Math.max(0, missingCount);
            const flfJobsToRun = Math.max(0, sceneCount - 1);
            const totalSteps = Math.max(1, imageJobsToRun + flfJobsToRun + 1);
            state.totalSteps = totalSteps;
            saveSimpleVideoState();

            const sceneVideoBasenames = [];
            const sceneImages = [];
            const sceneImagePrompts = []; // Track prompts corresponding to each scene image
            let stepCursor = 0;

            // (A) Generate per-scene still images via I2I
            for (let sceneIndex = 0; sceneIndex < sceneCount; sceneIndex++) {
                if ((Number(state.cancelSeq) || 0) !== cancelSeqAtStart) throw new Error('Cancelled');

                const scenePrompt = String(scenePrompts[sceneIndex] || '').trim();
                if (!scenePrompt) continue;

                // If we already have an intermediate image (generated/uploaded/prepared), reuse it.
                const existing = inter.images?.[sceneIndex];
                if (existing?.filename) {
                    sceneImages.push(String(existing.filename));
                    sceneImagePrompts.push(scenePrompt); // Track the prompt for this image
                    continue;
                }

                state.currentStep = stepCursor + 1;
                saveSimpleVideoState();

                const params = {};
                if (width && height) {
                    params.width = width;
                    params.height = height;
                }

                params.prompt = scenePrompt;
                params.input_image = referenceImageFilename;

                // ref3: add as input_image_2 and inject prompt hint
                if (ref3Active && state.dropSlots?.[2]?.filename) {
                    params.input_image_2 = state.dropSlots[2].filename;
                    const hint = buildRef3PromptHint(ref3Mode, 2);
                    if (hint) params.prompt = hint + '\n' + params.prompt;
                }

                // Ensure Qwen Image Edit 2511 receives an instruction-style prompt.
                if (isQwen2511ImageEditWorkflowId(i2iWorkflow)) {
                    params.prompt = wrapQwen2511EditInstructionPrompt(params.prompt);
                }

                params.denoise = Number(normalizeDenoise(state.i2iDenoise, '0.750'));
                params.cfg = Number(normalizeCfg(state.i2iCfg, '7.0'));

                const label = `S${sceneIndex + 1}/${sceneCount} シーン画像(I2I)`;
                const res = await runWorkflowStep({
                    workflow: i2iWorkflow,
                    label,
                    requestParams: params,
                    stepIndex: stepCursor,
                    totalSteps,
                });
                stepCursor++;

                // Show the image for sanity
                renderSimpleVideoOutputMedia({ jobId: res.jobId, outputs: res.outputs, title: `シーン画像 #${sceneIndex + 1}`, preferMedia: 'image' });

                const imgOut = pickBestOutput(res.outputs, 'image');
                if (!imgOut?.filename) throw new Error(`シーン${sceneIndex + 1}のI2I出力画像が見つかりませんでした`);
                const filename = String(imgOut.filename);
                sceneImages.push(filename);
                sceneImagePrompts.push(scenePrompt); // Track the prompt for this image

                inter.images[sceneIndex] = {
                    source: 'generated',
                    filename,
                    jobId: String(res.jobId),
                    prompt: String(params.prompt || ''),
                    previewUrl: getSimpleVideoDownloadURL(res.jobId, filename),
                };
                saveSimpleVideoState();
                renderSimpleVideoIntermediateImagesUI();
            }

            if (sceneImages.length < 1) throw new Error('シーン画像が生成できませんでした');

            const continueAfterCheck = await confirmContinueAfterIntermediateImages({
                preset,
                generatedCount: imageJobsToRun,
                totalCount: sceneCount,
            });
            if (!continueAfterCheck) return;

            // Refresh sceneImages/sceneImagePrompts from inter.images to pick up any
            // images the user regenerated while the CONTINUE gate was open.
            {
                const refreshed = Array.isArray(inter.images) ? inter.images : [];
                for (let i = 0; i < sceneCount; i++) {
                    const entry = refreshed[i];
                    if (entry?.filename) {
                        sceneImages[i] = String(entry.filename);
                        const rp = String(entry.rawPrompt || entry.prompt || '').trim();
                        if (rp) sceneImagePrompts[i] = rp;
                    }
                }
            }

            // (B) Generate FLF videos between adjacent scene images
            const fpsRaw = Number(state.fps);
            const fallbackFps = getDefaultFpsForVideoWorkflow(flfWorkflow);
            const effectiveFps = (Number.isFinite(fpsRaw) && fpsRaw > 0) ? Math.round(fpsRaw) : fallbackFps;

            for (let i = 0; i < sceneImages.length - 1; i++) {
                if ((Number(state.cancelSeq) || 0) !== cancelSeqAtStart) throw new Error('Cancelled');

                state.currentStep = stepCursor + 1;
                saveSimpleVideoState();

                const startImage = String(sceneImages[i]);
                const endImage = String(sceneImages[i + 1]);
                // Use sceneImagePrompts which is synchronized with sceneImages
                const basePrompt = String(sceneImagePrompts[i] || '').trim();
                const endPrompt = String(sceneImagePrompts[i + 1] || '').trim();
                const flfPrompt = composeFLFPromptWithEndIntent(basePrompt, endPrompt, state.flfEndConstraintEnabled !== false);

                const params = {
                    prompt: flfPrompt,
                    input_image_start: startImage,
                    input_image_end: endImage,
                };
                if (width && height) {
                    params.width = width;
                    params.height = height;
                }

                // FLF workflows are video workflows
                params.fps = effectiveFps;
                const frames = getSceneFramesForIndex(i, effectiveFps);
                if (Number.isFinite(frames) && frames > 0) params.frames = frames;

                const label = `S${i + 1}→S${i + 2}/${sceneImages.length} FLF遷移`;
                const res = await runWorkflowStep({
                    workflow: flfWorkflow,
                    label,
                    requestParams: params,
                    stepIndex: stepCursor,
                    totalSteps,
                });
                stepCursor++;

                renderSimpleVideoOutputMedia({ jobId: res.jobId, outputs: res.outputs, title: `FLF ${i + 1}/${sceneImages.length - 1}` });

                const vid = pickBestOutput(res.outputs, 'video');
                if (vid?.filename) {
                    const base = String(vid.filename).split('/').pop();
                    if (base) sceneVideoBasenames.push(base);
                } else {
                    throw new Error(`FLF ${i + 1} の出力動画が見つかりませんでした`);
                }
            }

            // (C) [Removed] I2V is no longer used for char_i2i_flf; all transitions are FLF.

            // (D) Concat stage
            const concatStepIndex = Math.max(0, stepCursor);
            state.currentStep = concatStepIndex + 1;
            saveSimpleVideoState();

            if ((Number(state.cancelSeq) || 0) !== cancelSeqAtStart) throw new Error('Cancelled');

            const api = window.app?.api;
            if (!api || typeof api.generateUtility !== 'function' || typeof api.monitorProgress !== 'function') {
                throw new Error('APIが利用できません（app.api.generateUtility/monitorProgress）');
            }

            if (sceneVideoBasenames.length < 2) {
                const overall = (concatStepIndex + 1) / Math.max(1, totalSteps);
                setSimpleVideoProgress('✅ 結合スキップ（動画が2本未満）', overall);
            } else {
                rememberSceneVideoBasenames({ presetId: preset.id, sceneVideoBasenames });
                const concatFps = (Number.isFinite(fpsRaw) && fpsRaw > 0) ? Math.round(fpsRaw) : 16;

                if (typeof showToast === 'function') showToast(`🔗 動画を結合中...（${sceneVideoBasenames.length}本）`, 'info');

                const concatJob = await api.generateUtility({
                    workflow: 'video_concat',
                    videos: sceneVideoBasenames,
                    fps: concatFps,
                    keep_audio: !!state.generateAudio
                });
                const concatJobId = concatJob?.job_id;
                if (!concatJobId) throw new Error('結合ジョブ(job_id)が取得できません');

                state.activeJobId = String(concatJobId);
                saveSimpleVideoState();
                updateGenerateButtonState();

                await new Promise((resolve, reject) => {
                    let done = false;
                    const finish = (fn) => (arg) => {
                        if (done) return;
                        done = true;
                        fn(arg);
                    };

                    api.monitorProgress(
                        concatJobId,
                        (p) => {
                            if ((Number(state.cancelSeq) || 0) !== cancelSeqAtStart) {
                                try { api.closeWebSocket?.(concatJobId); } catch (_e) {}
                                finish(reject)(new Error('Cancelled'));
                                return;
                            }
                            const local01 = normalizeProgress01(p?.progress);
                            const overall = (concatStepIndex + local01) / Math.max(1, totalSteps);
                            setSimpleVideoProgress(`🔗 結合: ${p?.message || 'Processing...'}`, overall);
                        },
                        finish(() => resolve()),
                        finish((err) => reject(err))
                    );
                });

                if (String(state.activeJobId || '') === String(concatJobId)) {
                    state.activeJobId = null;
                    saveSimpleVideoState();
                    updateGenerateButtonState();
                }

                const outputsPayload = (typeof api.getOutputs === 'function') ? await api.getOutputs(concatJobId) : null;
                const outputs = Array.isArray(outputsPayload?.outputs) ? outputsPayload.outputs : [];
                renderSimpleVideoOutputMedia({ jobId: concatJobId, outputs, title: `結合結果（${sceneVideoBasenames.length}本）` });
            }

            setSimpleVideoProgress('完了', 1);
            if (typeof showToast === 'function') showToast(`生成が完了しました（${sceneVideoBasenames.length}セグメント・結合まで完了）`, 'success');
            return;
        }

        // Special pipeline: Character video with EDIT composite + Reference selection (char_edit_i2i_flf)
        if (String(preset.id || '') === 'char_edit_i2i_flf') {
            syncFpsForCurrentOptions({ forceUI: true });

            const sceneCount = scenePrompts.length;
            const i2iWorkflowBase = (String(state.i2iRefineWorkflow || '') !== 'auto' && String(state.i2iRefineWorkflow || '').trim())
                ? normalizeWorkflowAlias(String(state.i2iRefineWorkflow))
                : normalizeWorkflowAlias(getConfiguredSimpleVideoWorkflow('i2i', 'qwen_i2i_2511_bf16_lightning4'));

            // ref3 scene I2I config
            const { ref3Active, ref3Mode, adjustedWorkflow: i2iWorkflowFromRef3e } = computeRef3SceneI2IConfig(i2iWorkflowBase);
            const i2iWorkflow = i2iWorkflowFromRef3e;

            // FLF品質設定: speed=4-step(高速), quality=20-step(高品質)
            const flfWorkflow = state.flfQuality === 'quality' ? 'wan22_flf2v' : 'wan22_smooth_first2last';

            const desiredMidCount = Math.max(1, sceneCount);
            const scenarioFP = computeScenarioFingerprint(state.scenario, scenePrompts);
            const inter = ensureIntermediateImagesState({ presetId: preset.id, desiredCount: desiredMidCount, scenarioFingerprint: scenarioFP });
            if (!inter) throw new Error('中間画像の状態が初期化できません');

            renderSimpleVideoIntermediateImagesUI();

            const missingCount = (Array.isArray(inter.images) ? inter.images : [])
                .slice(0, sceneCount)
                .filter((v) => !v || !String(v.filename || '').trim()).length;

            // Scene-image generation fallback:
            // if character image is not registered, use key image (or ref1) as reference only for this run.
            const ds = Array.isArray(state.dropSlots) ? state.dropSlots : [];
            const fallbackRefImage = String(state.uploadedImage?.filename || '').trim() || String(ds[0]?.filename || '').trim();
            if (missingCount > 0 && !state.characterImage?.filename && !state.characterSheetImage?.filename && !fallbackRefImage) {
                throw new Error('参照画像がありません（キャラ画像・キャラクターシート・キー画像・ref1 のいずれかを用意してください）');
            }

            const imageJobsToRun = Math.max(0, missingCount);
            const flfJobsToRun = Math.max(0, sceneCount - 1);
            const totalSteps = Math.max(1, imageJobsToRun + flfJobsToRun + 1);
            state.totalSteps = totalSteps;
            saveSimpleVideoState();

            const sceneVideoBasenames = [];
            const sceneImages = [];
            const sceneImagePrompts = []; // Track prompts synchronized with sceneImages
            let stepCursor = 0;

            // Determine effective reference: character sheet takes priority when useCharSheetAsRef is set
            const useSheetAsRef2 = state.useCharSheetAsRef && !!state.characterSheetImage?.filename;
            const characterImageFilename = useSheetAsRef2
                ? state.characterSheetImage.filename
                : (state.characterImage?.filename || fallbackRefImage || null);
            const refSource = normalizeI2IRefSource(state.i2iRefSource);
            let firstSceneImageFilename = null;

            // (A) Generate per-scene still images via I2I with character image as reference
            for (let sceneIndex = 0; sceneIndex < sceneCount; sceneIndex++) {
                if ((Number(state.cancelSeq) || 0) !== cancelSeqAtStart) throw new Error('Cancelled');

                const scenePrompt = String(scenePrompts[sceneIndex] || '').trim();
                if (!scenePrompt) continue;

                // If we already have an intermediate image, reuse it
                const existing = inter.images?.[sceneIndex];
                if (existing?.filename) {
                    sceneImages.push(String(existing.filename));
                    sceneImagePrompts.push(scenePrompt); // Track the prompt for this image
                    if (sceneIndex === 0) firstSceneImageFilename = String(existing.filename);
                    continue;
                }

                state.currentStep = stepCursor + 1;
                saveSimpleVideoState();

                // Determine reference image for this scene
                let refForThisScene = characterImageFilename;
                if (sceneIndex >= 1 && refSource === 'first_scene' && firstSceneImageFilename) {
                    refForThisScene = firstSceneImageFilename;
                }

                const params = {};
                if (width && height) {
                    params.width = width;
                    params.height = height;
                }

                params.prompt = scenePrompt;
                params.input_image = refForThisScene;

                // ref3: add as input_image_2 and inject prompt hint
                if (ref3Active && state.dropSlots?.[2]?.filename) {
                    params.input_image_2 = state.dropSlots[2].filename;
                    const hint = buildRef3PromptHint(ref3Mode, 2);
                    if (hint) params.prompt = hint + '\n' + params.prompt;
                }

                // For Qwen 2512 (I2I), use prompt as-is (not EDIT instruction)
                // For Qwen 2511 (EDIT), wrap prompt
                if (isQwen2511ImageEditWorkflowId(i2iWorkflow)) {
                    params.prompt = wrapQwen2511EditInstructionPrompt(params.prompt);
                }

                params.denoise = Number(normalizeDenoise(state.i2iDenoise, '1.0'));
                params.cfg = Number(normalizeCfg(state.i2iCfg, '1.0'));

                const label = `S${sceneIndex + 1}/${sceneCount} シーン画像(I2I)`;
                const res = await runWorkflowStep({
                    workflow: i2iWorkflow,
                    label,
                    requestParams: params,
                    stepIndex: stepCursor,
                    totalSteps,
                });
                stepCursor++;

                renderSimpleVideoOutputMedia({ jobId: res.jobId, outputs: res.outputs, title: `シーン画像 #${sceneIndex + 1}`, preferMedia: 'image' });

                const imgOut = pickBestOutput(res.outputs, 'image');
                if (!imgOut?.filename) throw new Error(`シーン${sceneIndex + 1}のI2I出力画像が見つかりませんでした`);
                const filename = String(imgOut.filename);
                sceneImages.push(filename);
                sceneImagePrompts.push(scenePrompt); // Track the prompt for this image

                if (sceneIndex === 0) firstSceneImageFilename = filename;

                inter.images[sceneIndex] = {
                    source: 'generated',
                    filename,
                    jobId: String(res.jobId),
                    prompt: String(params.prompt || ''),
                    rawPrompt: scenePrompt,
                    previewUrl: getSimpleVideoDownloadURL(res.jobId, filename),
                };
                saveSimpleVideoState();
                renderSimpleVideoIntermediateImagesUI();
            }

            if (sceneImages.length < 1) throw new Error('シーン画像が生成できませんでした');

            setSimpleVideoProgress(`✅ 全${sceneImages.length}シーン画像の準備ができました。CONTINUE で動画生成へ進みます`, stepCursor / Math.max(1, totalSteps));
            if (typeof showToast === 'function') showToast('✅ 中間画像の準備ができました（CONTINUEで動画生成へ進みます）', 'success');

            const continueAfterCheck = await confirmContinueAfterIntermediateImages({
                preset,
                generatedCount: imageJobsToRun,
                totalCount: sceneCount,
            });
            if (!continueAfterCheck) return;

            // Refresh sceneImages/sceneImagePrompts from inter.images to pick up any
            // images the user regenerated while the CONTINUE gate was open.
            {
                const refreshed = Array.isArray(inter.images) ? inter.images : [];
                for (let i = 0; i < sceneCount; i++) {
                    const entry = refreshed[i];
                    if (entry?.filename) {
                        sceneImages[i] = String(entry.filename);
                        const rp = String(entry.rawPrompt || entry.prompt || '').trim();
                        if (rp) sceneImagePrompts[i] = rp;
                    }
                }
            }

            // (B) Generate FLF videos between adjacent scene images
            const fpsRaw = Number(state.fps);
            const fallbackFps = getDefaultFpsForVideoWorkflow(flfWorkflow);
            const effectiveFps = (Number.isFinite(fpsRaw) && fpsRaw > 0) ? Math.round(fpsRaw) : fallbackFps;

            for (let i = 0; i < sceneImages.length - 1; i++) {
                if ((Number(state.cancelSeq) || 0) !== cancelSeqAtStart) throw new Error('Cancelled');

                state.currentStep = stepCursor + 1;
                saveSimpleVideoState();

                const startImage = String(sceneImages[i]);
                const endImage = String(sceneImages[i + 1]);
                // Use sceneImagePrompts which is synchronized with sceneImages
                const basePrompt = String(sceneImagePrompts[i] || '').trim();
                const endPrompt = String(sceneImagePrompts[i + 1] || '').trim();
                const flfPrompt = composeFLFPromptWithEndIntent(basePrompt, endPrompt, state.flfEndConstraintEnabled !== false);

                const params = {
                    prompt: flfPrompt,
                    input_image_start: startImage,
                    input_image_end: endImage,
                };
                if (width && height) {
                    params.width = width;
                    params.height = height;
                }

                params.fps = effectiveFps;
                const frames = getSceneFramesForIndex(i, effectiveFps);
                if (Number.isFinite(frames) && frames > 0) params.frames = frames;

                const label = `S${i + 1}→S${i + 2}/${sceneCount} FLF遷移`;
                const res = await runWorkflowStep({
                    workflow: flfWorkflow,
                    label,
                    requestParams: params,
                    stepIndex: stepCursor,
                    totalSteps,
                });
                stepCursor++;

                renderSimpleVideoOutputMedia({ jobId: res.jobId, outputs: res.outputs, title: `FLF ${i + 1}/${sceneImages.length - 1}` });

                const vid = pickBestOutput(res.outputs, 'video');
                if (vid?.filename) {
                    const base = String(vid.filename).split('/').pop();
                    if (base) sceneVideoBasenames.push(base);
                } else {
                    throw new Error(`FLF ${i + 1} の出力動画が見つかりませんでした`);
                }
            }

            // (C) [Removed] I2V is no longer used for char_edit_i2i_flf; all transitions are FLF.

            // (D) Concat stage
            const concatStepIndex = Math.max(0, stepCursor);
            state.currentStep = concatStepIndex + 1;
            saveSimpleVideoState();

            if ((Number(state.cancelSeq) || 0) !== cancelSeqAtStart) throw new Error('Cancelled');

            const api = window.app?.api;
            if (!api || typeof api.generateUtility !== 'function' || typeof api.monitorProgress !== 'function') {
                throw new Error('APIが利用できません（app.api.generateUtility/monitorProgress）');
            }

            if (sceneVideoBasenames.length < 2) {
                const overall = (concatStepIndex + 1) / Math.max(1, totalSteps);
                setSimpleVideoProgress('✅ 結合スキップ（動画が2本未満）', overall);
            } else {
                rememberSceneVideoBasenames({ presetId: preset.id, sceneVideoBasenames });
                const concatFps = (Number.isFinite(fpsRaw) && fpsRaw > 0) ? Math.round(fpsRaw) : 16;

                if (typeof showToast === 'function') showToast(`🔗 動画を結合中...（${sceneVideoBasenames.length}本）`, 'info');

                const concatJob = await api.generateUtility({
                    workflow: 'video_concat',
                    videos: sceneVideoBasenames,
                    fps: concatFps,
                    keep_audio: !!state.generateAudio
                });
                const concatJobId = concatJob?.job_id;
                if (!concatJobId) throw new Error('結合ジョブ(job_id)が取得できません');

                state.activeJobId = String(concatJobId);
                saveSimpleVideoState();
                updateGenerateButtonState();

                await new Promise((resolve, reject) => {
                    let done = false;
                    const finish = (fn) => (arg) => {
                        if (done) return;
                        done = true;
                        fn(arg);
                    };

                    api.monitorProgress(
                        concatJobId,
                        (p) => {
                            if ((Number(state.cancelSeq) || 0) !== cancelSeqAtStart) {
                                try { api.closeWebSocket?.(concatJobId); } catch (_e) {}
                                finish(reject)(new Error('Cancelled'));
                                return;
                            }
                            const local01 = normalizeProgress01(p?.progress);
                            const overall = (concatStepIndex + local01) / Math.max(1, totalSteps);
                            setSimpleVideoProgress(`🔗 結合: ${p?.message || 'Processing...'}`, overall);
                        },
                        finish(() => resolve()),
                        finish((err) => reject(err))
                    );
                });

                if (String(state.activeJobId || '') === String(concatJobId)) {
                    state.activeJobId = null;
                    saveSimpleVideoState();
                    updateGenerateButtonState();
                }

                const outputsPayload = (typeof api.getOutputs === 'function') ? await api.getOutputs(concatJobId) : null;
                const outputs = Array.isArray(outputsPayload?.outputs) ? outputsPayload.outputs : [];
                renderSimpleVideoOutputMedia({ jobId: concatJobId, outputs, title: `結合結果（${sceneVideoBasenames.length}本）` });
            }

            setSimpleVideoProgress('完了', 1);
            if (typeof showToast === 'function') showToast(`生成が完了しました（${sceneVideoBasenames.length}セグメント・結合まで完了）`, 'success');
            return;
        }

        // Special pipeline: Character video with EDIT composite + scene-cut I2V (no FLF)
        if (String(preset.id || '') === 'char_edit_i2v_scene_cut') {
            syncFpsForCurrentOptions({ forceUI: true });

            const sceneCount = scenePrompts.length;
            const i2iWorkflowBase = (String(state.i2iRefineWorkflow || '') !== 'auto' && String(state.i2iRefineWorkflow || '').trim())
                ? normalizeWorkflowAlias(String(state.i2iRefineWorkflow))
                : normalizeWorkflowAlias(getConfiguredSimpleVideoWorkflow('i2i', 'qwen_i2i_2511_bf16_lightning4'));

            // ref3 scene I2I config
            const { ref3Active, ref3Mode, adjustedWorkflow: i2iWorkflowFromRef3c } = computeRef3SceneI2IConfig(i2iWorkflowBase);
            const i2iWorkflow = i2iWorkflowFromRef3c;

            // I2V workflow (LTX option applies here since no FLF)
            const i2vWorkflow = applyWorkflowSpeedOption('wan22_i2v_lightning', !!state.useFast);

            const desiredMidCount = Math.max(1, sceneCount);
            const scenarioFP = computeScenarioFingerprint(state.scenario, scenePrompts);
            const inter = ensureIntermediateImagesState({ presetId: preset.id, desiredCount: desiredMidCount, scenarioFingerprint: scenarioFP });
            if (!inter) throw new Error('中間画像の状態が初期化できません');

            renderSimpleVideoIntermediateImagesUI();

            const missingCount = (Array.isArray(inter.images) ? inter.images : [])
                .slice(0, sceneCount)
                .filter((v) => !v || !String(v.filename || '').trim()).length;

            // If I2I generation is needed, require at least one usable reference image.
            const ds = Array.isArray(state.dropSlots) ? state.dropSlots : [];
            const fallbackRefImage = String(state.uploadedImage?.filename || '').trim() || String(ds[0]?.filename || '').trim();
            if (missingCount > 0 && !state.characterImage?.filename && !state.characterSheetImage?.filename && !fallbackRefImage) {
                throw new Error('参照画像がありません（キャラ画像・キャラクターシート・キー画像・ref1 のいずれかを用意してください）');
            }

            const imageJobsToRun = Math.max(0, missingCount);
            const i2vJobsToRun = sceneCount;  // 各シーンでI2V（FLFなし）
            const totalSteps = Math.max(1, imageJobsToRun + i2vJobsToRun + 1);
            state.totalSteps = totalSteps;
            saveSimpleVideoState();

            const sceneVideoBasenames = [];
            const sceneImages = [];
            let stepCursor = 0;

            // Determine effective reference: character sheet takes priority when useCharSheetAsRef is set
            const useSheetAsRef3 = state.useCharSheetAsRef && !!state.characterSheetImage?.filename;
            const characterImageFilename = useSheetAsRef3
                ? state.characterSheetImage.filename
                : (state.characterImage?.filename || fallbackRefImage || null);
            const refSource = normalizeI2IRefSource(state.i2iRefSource);
            let firstSceneImageFilename = null;

            // (A) Generate per-scene still images via I2I with character image as reference
            for (let sceneIndex = 0; sceneIndex < sceneCount; sceneIndex++) {
                if ((Number(state.cancelSeq) || 0) !== cancelSeqAtStart) throw new Error('Cancelled');

                const scenePrompt = String(scenePrompts[sceneIndex] || '').trim();
                if (!scenePrompt) continue;

                // If we already have an intermediate image, reuse it
                const existing = inter.images?.[sceneIndex];
                if (existing?.filename) {
                    sceneImages.push(String(existing.filename));
                    if (sceneIndex === 0) firstSceneImageFilename = String(existing.filename);
                    continue;
                }

                state.currentStep = stepCursor + 1;
                saveSimpleVideoState();

                // Determine reference image for this scene
                let refForThisScene = characterImageFilename;
                if (sceneIndex >= 1 && refSource === 'first_scene' && firstSceneImageFilename) {
                    refForThisScene = firstSceneImageFilename;
                }

                const params = {};
                if (width && height) {
                    params.width = width;
                    params.height = height;
                }

                params.prompt = scenePrompt;
                params.input_image = refForThisScene;

                // ref3: add as input_image_2 and inject prompt hint
                if (ref3Active && state.dropSlots?.[2]?.filename) {
                    params.input_image_2 = state.dropSlots[2].filename;
                    const hint = buildRef3PromptHint(ref3Mode, 2);
                    if (hint) params.prompt = hint + '\n' + params.prompt;
                }

                if (isQwen2511ImageEditWorkflowId(i2iWorkflow)) {
                    params.prompt = wrapQwen2511EditInstructionPrompt(params.prompt);
                }

                params.denoise = Number(normalizeDenoise(state.i2iDenoise, '1.0'));
                params.cfg = Number(normalizeCfg(state.i2iCfg, '1.0'));

                const label = `S${sceneIndex + 1}/${sceneCount} シーン画像(I2I)`;
                const res = await runWorkflowStep({
                    workflow: i2iWorkflow,
                    label,
                    requestParams: params,
                    stepIndex: stepCursor,
                    totalSteps,
                });
                stepCursor++;

                renderSimpleVideoOutputMedia({ jobId: res.jobId, outputs: res.outputs, title: `シーン画像 #${sceneIndex + 1}`, preferMedia: 'image' });

                const imgOut = pickBestOutput(res.outputs, 'image');
                if (!imgOut?.filename) throw new Error(`シーン${sceneIndex + 1}のI2I出力画像が見つかりませんでした`);
                const filename = String(imgOut.filename);
                sceneImages.push(filename);

                if (sceneIndex === 0) firstSceneImageFilename = filename;

                inter.images[sceneIndex] = {
                    source: 'generated',
                    filename,
                    jobId: String(res.jobId),
                    prompt: String(params.prompt || ''),
                    rawPrompt: scenePrompt,
                    previewUrl: getSimpleVideoDownloadURL(res.jobId, filename),
                };
                saveSimpleVideoState();
                renderSimpleVideoIntermediateImagesUI();
            }

            if (sceneImages.length < 1) throw new Error('シーン画像が生成できませんでした');

            setSimpleVideoProgress(`✅ 全${sceneImages.length}シーン画像の準備ができました。CONTINUE で動画生成へ進みます`, stepCursor / Math.max(1, totalSteps));
            if (typeof showToast === 'function') showToast('✅ 中間画像の準備ができました（CONTINUEで動画生成へ進みます）', 'success');

            const continueAfterCheck = await confirmContinueAfterIntermediateImages({
                preset,
                generatedCount: imageJobsToRun,
                totalCount: sceneCount,
            });
            if (!continueAfterCheck) return;

            // Refresh sceneImages/scenePrompts from inter.images to pick up any
            // images the user regenerated while the CONTINUE gate was open.
            {
                const refreshed = Array.isArray(inter.images) ? inter.images : [];
                for (let i = 0; i < sceneCount; i++) {
                    const entry = refreshed[i];
                    if (entry?.filename) {
                        sceneImages[i] = String(entry.filename);
                        const rp = String(entry.rawPrompt || entry.prompt || '').trim();
                        if (rp) scenePrompts[i] = rp;
                    }
                }
            }

            // (B) Generate I2V video for each scene image (no FLF, scene-cut style)
            const fpsRaw = Number(state.fps);
            const fallbackFps = getDefaultFpsForVideoWorkflow(i2vWorkflow);
            const effectiveFps = (Number.isFinite(fpsRaw) && fpsRaw > 0) ? Math.round(fpsRaw) : fallbackFps;

            for (let i = 0; i < sceneImages.length; i++) {
                if ((Number(state.cancelSeq) || 0) !== cancelSeqAtStart) throw new Error('Cancelled');

                state.currentStep = stepCursor + 1;
                saveSimpleVideoState();

                const sceneImage = String(sceneImages[i]);
                const scenePrompt = String(scenePrompts[i] || '').trim();

                const params = {
                    prompt: scenePrompt,
                    input_image: sceneImage,
                };
                if (width && height) {
                    params.width = width;
                    params.height = height;
                }

                params.fps = effectiveFps;
                const frames = getSceneFramesForIndex(i, effectiveFps);
                if (Number.isFinite(frames) && frames > 0) params.frames = frames;

                // LTX audio setting
                if (String(i2vWorkflow || '').startsWith('ltx2_')) {
                    params.strip_audio = !state.generateAudio;
                    console.log('[SimpleVideo] LTX audio setting: generateAudio=', state.generateAudio, 'strip_audio=', params.strip_audio);
                }

                const label = `S${i + 1}/${sceneCount} シーン動画(I2V)`;
                const res = await runWorkflowStep({
                    workflow: i2vWorkflow,
                    label,
                    requestParams: params,
                    stepIndex: stepCursor,
                    totalSteps,
                });
                stepCursor++;

                renderSimpleVideoOutputMedia({ jobId: res.jobId, outputs: res.outputs, title: `シーン動画 #${i + 1}` });

                const vid = pickBestOutput(res.outputs, 'video');
                if (vid?.filename) {
                    const base = String(vid.filename).split('/').pop();
                    if (base) sceneVideoBasenames.push(base);
                } else {
                    throw new Error(`シーン${i + 1}のI2V出力動画が見つかりませんでした`);
                }
            }

            // (C) Concat stage
            const concatStepIndex = Math.max(0, stepCursor);
            state.currentStep = concatStepIndex + 1;
            saveSimpleVideoState();

            if ((Number(state.cancelSeq) || 0) !== cancelSeqAtStart) throw new Error('Cancelled');

            const api = window.app?.api;
            if (!api || typeof api.generateUtility !== 'function' || typeof api.monitorProgress !== 'function') {
                throw new Error('APIが利用できません（app.api.generateUtility/monitorProgress）');
            }

            if (sceneVideoBasenames.length < 2) {
                const overall = (concatStepIndex + 1) / Math.max(1, totalSteps);
                setSimpleVideoProgress('✅ 結合スキップ（動画が2本未満）', overall);
            } else {
                rememberSceneVideoBasenames({ presetId: preset.id, sceneVideoBasenames });
                const concatFps = (Number.isFinite(fpsRaw) && fpsRaw > 0) ? Math.round(fpsRaw) : 16;

                if (typeof showToast === 'function') showToast(`🔗 動画を結合中...（${sceneVideoBasenames.length}本）`, 'info');

                const concatJob = await api.generateUtility({
                    workflow: 'video_concat',
                    videos: sceneVideoBasenames,
                    fps: concatFps,
                    keep_audio: !!state.generateAudio
                });
                const concatJobId = concatJob?.job_id;
                if (!concatJobId) throw new Error('結合ジョブ(job_id)が取得できません');

                state.activeJobId = String(concatJobId);
                saveSimpleVideoState();
                updateGenerateButtonState();

                await new Promise((resolve, reject) => {
                    let done = false;
                    const finish = (fn) => (arg) => {
                        if (done) return;
                        done = true;
                        fn(arg);
                    };

                    api.monitorProgress(
                        concatJobId,
                        (p) => {
                            if ((Number(state.cancelSeq) || 0) !== cancelSeqAtStart) {
                                try { api.closeWebSocket?.(concatJobId); } catch (_e) {}
                                finish(reject)(new Error('Cancelled'));
                                return;
                            }
                            const local01 = normalizeProgress01(p?.progress);
                            const overall = (concatStepIndex + local01) / Math.max(1, totalSteps);
                            setSimpleVideoProgress(`🔗 結合: ${p?.message || 'Processing...'}`, overall);
                        },
                        finish(() => resolve()),
                        finish((err) => reject(err))
                    );
                });

                if (String(state.activeJobId || '') === String(concatJobId)) {
                    state.activeJobId = null;
                    saveSimpleVideoState();
                    updateGenerateButtonState();
                }

                const outputsPayload = (typeof api.getOutputs === 'function') ? await api.getOutputs(concatJobId) : null;
                const outputs = Array.isArray(outputsPayload?.outputs) ? outputsPayload.outputs : [];
                renderSimpleVideoOutputMedia({ jobId: concatJobId, outputs, title: `結合結果（${sceneVideoBasenames.length}本）` });
            }

            setSimpleVideoProgress('完了', 1);
            if (typeof showToast === 'function') showToast(`生成が完了しました（${sceneCount}シーン・シーンカット形式）`, 'success');
            return;
        }

        const effectiveSteps = getEffectivePresetStepsForCurrentOptions(preset);
        const stepsPerScene = effectiveSteps.length;

        if (stepsPerScene <= 0) {
            if (typeof showToast === 'function') showToast('この設定では実行できるステップがありません', 'warning');
            throw new Error('No runnable steps for the selected options');
        }

        // Ensure FPS is consistent with current options before running.
        syncFpsForCurrentOptions({ forceUI: true });

        const hasInitialImage = !!preset.initialImageWorkflow && !preparedImageFilename;
        const hasInitialVideo = !!preset.initialVideoWorkflow;
        const hasInitialRefine = !!preset.initialRefineWorkflow && !preparedImageFilename;
        const continuityMode = String(preset.sceneContinuity || '');
        const needsExtractBetweenScenes = continuityMode === 'last_frame' ? Math.max(0, scenePrompts.length - 1) : 0;
        const scenesToRun = Math.max(0, scenePrompts.length - (hasInitialVideo ? 1 : 0));
        const perSceneStepsTotal = scenesToRun * Math.max(1, stepsPerScene);
        // Always reserve 1 extra step for concat stage (even if we end up skipping due to <2 clips).
        // If the user prepared an initial frame via the "image refine" flow, skip only the first I2I refine step.
        // (Do not alter T2I-first sequences.)
        const firstStepWf = effectiveSteps?.[0]?.workflow;
        const willSkipFirstI2I = !!preparedImageFilename
            && !hasInitialVideo
            && !preset.initialImageWorkflow
            && !preset.initialRefineWorkflow
            && isI2IWorkflowId(firstStepWf);

        const totalSteps = Math.max(
            1,
            (hasInitialImage ? 1 : 0)
                + (hasInitialVideo ? 1 : 0)
                + (hasInitialRefine ? 1 : 0)
            + perSceneStepsTotal
                + needsExtractBetweenScenes
                + 1
        ) - (willSkipFirstI2I ? 1 : 0);
        state.totalSteps = totalSteps;
        saveSimpleVideoState();

        const sceneVideoBasenames = [];

        let currentImageFilename = preparedImageFilename ? String(preparedImageFilename) : null;
        let stepCursor = 0;
        let sceneStartIndex = 0;

        // Optional: generate the initial key image once (used for last-frame continuity mode).
        if (hasInitialImage) {
            if ((Number(state.cancelSeq) || 0) !== cancelSeqAtStart) throw new Error('Cancelled');

            const firstPrompt = String(scenePrompts[0] || state.scenario || '').trim();
            const params = {};
            if (width && height) {
                params.width = width;
                params.height = height;
            }
            params.prompt = firstPrompt;

            state.currentStep = stepCursor + 1;
            saveSimpleVideoState();

            const label = `S1/${scenePrompts.length} ${preset.initialImageLabel || '初期画像生成'}`;
            const r0 = await runWorkflowStep({
                workflow: preset.initialImageWorkflow,
                label,
                requestParams: params,
                stepIndex: stepCursor,
                totalSteps,
            });
            stepCursor++;

            const imageOut = pickBestOutput(r0.outputs, 'image');
            if (imageOut?.filename) {
                currentImageFilename = String(imageOut.filename);
            }
        }

        // If the user has prepared an initial image manually, use it as the starting frame.
        if (!hasInitialImage && preparedImageFilename) {
            currentImageFilename = String(preparedImageFilename);
        }

        // Optional: refine the key image once, then use it as the starting frame for I2V.
        if (hasInitialRefine) {
            if ((Number(state.cancelSeq) || 0) !== cancelSeqAtStart) throw new Error('Cancelled');
            if (!state.uploadedImage?.filename) throw new Error('キー画像がありません（画像リファイン）');

            const basePrompt = String(scenePrompts[0] || state.scenario || '').trim();
            const imagePrompt = await generateImagePromptForInitialRefine({
                basePrompt,
                preset,
                cancelSeqAtStart,
            });

            state.currentStep = stepCursor + 1;
            saveSimpleVideoState();

            const params = {};
            if (width && height) {
                params.width = width;
                params.height = height;
            }
            params.prompt = imagePrompt || basePrompt;
            params.input_image = state.uploadedImage.filename;

            const refineWorkflow = (String(state.i2iRefineWorkflow || '') !== 'auto' && String(state.i2iRefineWorkflow || '').trim())
                ? String(state.i2iRefineWorkflow)
                : String(preset.initialRefineWorkflow);

            // Ensure Qwen Image Edit 2511 receives an instruction-style prompt.
            if (isQwen2511ImageEditWorkflowId(refineWorkflow)) {
                params.prompt = wrapQwen2511EditInstructionPrompt(params.prompt);
            }

            // I2I refine strength.
            // Higher denoise => less reference dominance (more change).
            params.denoise = Number(normalizeDenoise(state.i2iDenoise, '0.900'));
            params.cfg = Number(normalizeCfg(state.i2iCfg, '7.0'));

            const label = `S1/${scenePrompts.length} ${preset.initialRefineLabel || '画像リファイン'}`;
            const r0 = await runWorkflowStep({
                workflow: refineWorkflow,
                label,
                requestParams: params,
                stepIndex: stepCursor,
                totalSteps,
            });
            stepCursor++;

            const imageOut = pickBestOutput(r0.outputs, 'image');
            if (imageOut?.filename) {
                // Keep the full path (may include session bucket subfolders).
                currentImageFilename = String(imageOut.filename);

                // Show as a small preview overlay while the first video is being generated.
                setSimpleVideoOutputPreviewImage({
                    jobId: r0.jobId,
                    filename: String(imageOut.filename),
                    title: '初期画像（リファイン結果）',
                });
            } else {
                throw new Error('画像リファイン結果が取得できませんでした');
            }
        }

        // Optional: generate the first scene as a video directly (no T2I), then continue via last-frame + I2V.
        if (hasInitialVideo) {
            if ((Number(state.cancelSeq) || 0) !== cancelSeqAtStart) throw new Error('Cancelled');

            const firstPrompt = String(scenePrompts[0] || state.scenario || '').trim();

            const wf0 = normalizeWorkflowAlias(preset.initialVideoWorkflow);
            const wf = applyWorkflowSpeedOption(wf0, !!state.useFast);

            state.currentStep = stepCursor + 1;
            saveSimpleVideoState();

            const params = {};
            if (width && height) {
                params.width = width;
                params.height = height;
            }
            params.prompt = firstPrompt;

            const fpsRaw = Number(state.fps);
            const fallbackFps = getDefaultFpsForVideoWorkflow(wf);
            const effectiveFps = (Number.isFinite(fpsRaw) && fpsRaw > 0) ? Math.round(fpsRaw) : fallbackFps;

            if (isVideoWorkflowId(wf)) {
                params.fps = effectiveFps;
                const frames = getSceneFramesForIndex(0, effectiveFps);
                if (Number.isFinite(frames) && frames > 0) params.frames = frames;
            }

            if (String(wf || '').startsWith('ltx2_')) {
                params.strip_audio = !state.generateAudio;
            }

            const label = `S1/${scenePrompts.length} ${preset.initialVideoLabel || '最初の動画生成'}`;
            const r0 = await runWorkflowStep({
                workflow: wf,
                label,
                requestParams: params,
                stepIndex: stepCursor,
                totalSteps,
            });
            stepCursor++;

            renderSimpleVideoOutputMedia({ jobId: r0.jobId, outputs: r0.outputs, title: 'Scene #1' });

            const vid0 = pickBestOutput(r0.outputs, 'video');
            if (vid0?.filename) {
                const base0 = String(vid0.filename).split('/').pop();
                if (base0) sceneVideoBasenames.push(base0);

                if (continuityMode === 'last_frame' && scenePrompts.length > 1) {
                    state.currentStep = stepCursor + 1;
                    saveSimpleVideoState();

                    const rlf0 = await runUtilityExtractLastFrame({
                        videoBasename: base0,
                        label: `S1/${scenePrompts.length} 最終フレーム抽出`,
                        stepIndex: stepCursor,
                        totalSteps,
                        cancelSeqAtStart,
                    });
                    stepCursor++;

                    const img0 = pickBestOutput(rlf0.outputs, 'image');
                    if (img0?.filename) {
                        currentImageFilename = String(img0.filename);
                    }
                }
            }

            // First scene is already generated.
            sceneStartIndex = 1;
        }

        for (let sceneIndex = sceneStartIndex; sceneIndex < scenePrompts.length; sceneIndex++) {
            if ((Number(state.cancelSeq) || 0) !== cancelSeqAtStart) throw new Error('Cancelled');

            const scenePrompt = String(scenePrompts[sceneIndex] || '').trim();
            if (!scenePrompt) continue;

            // Scene-cut presets start fresh per scene; continuity presets keep last-frame across scenes.
            // If a prepared initial frame exists for an I2I-first refine sequence, keep it for scene #1.
            const keepPreparedForScene1 = preparedImageFilename && sceneIndex === 0 && isI2IWorkflowId(firstStepWf);
            if (continuityMode !== 'last_frame' && !hasInitialImage && !keepPreparedForScene1) {
                currentImageFilename = null;
            }

            let lastJob = null;

            for (let stepIndex = 0; stepIndex < stepsPerScene; stepIndex++) {
                if ((Number(state.cancelSeq) || 0) !== cancelSeqAtStart) throw new Error('Cancelled');

                const step = effectiveSteps[stepIndex];
                let wf = normalizeWorkflowAlias(step.workflow);
                // Allow overriding the I2I refine workflow (e.g., switch away from Qwen Edit to Flux2 I2I)
                if (isI2IWorkflowId(wf) && String(state.i2iRefineWorkflow || '') !== 'auto' && String(state.i2iRefineWorkflow || '').trim()) {
                    wf = normalizeWorkflowAlias(String(state.i2iRefineWorkflow));
                }

                state.currentStep = stepCursor + 1;
                saveSimpleVideoState();

                const params = {};
                if (width && height) {
                    params.width = width;
                    params.height = height;
                }

                // Full Auto style: always use per-scene prompt
                params.prompt = scenePrompt;

                // Supply input image if required by workflow/preset
                const effectiveKeyImage = state.uploadedImage?.filename || preparedImageFilename;
                if (preset.requiresImage && stepIndex === 0 && effectiveKeyImage) {
                    // Continuous mode: only the first scene should start from the key image.
                    // Later scenes must use the extracted last frame.
                    if (continuityMode !== 'last_frame' || sceneIndex === 0) {
                        params.input_image = effectiveKeyImage;
                    }
                }

                // If the first step is I2I and we already have a prepared initial frame, skip refining again.
                if (preparedImageFilename && sceneIndex === 0 && stepIndex === 0 && isI2IWorkflowId(wf)) {
                    currentImageFilename = String(preparedImageFilename);
                    continue;
                }

                // For ext_i2i_i2v_scene_cut: check if pre-generated image exists for this scene
                if (isI2IWorkflowId(wf) && !!preset.supportsPregenerateImages) {
                    const inter = state.intermediateImages;
                    const pregenImage = inter?.presetId === preset.id && inter?.images?.[sceneIndex];
                    if (pregenImage?.filename) {
                        // Use pre-generated image, skip I2I step
                        console.log(`[SimpleVideo] Scene ${sceneIndex + 1}: Using pre-generated image:`, pregenImage.filename);
                        const rawFilename = String(pregenImage.filename);
                        currentImageFilename = rawFilename.includes('/') ? rawFilename.split('/').pop() : rawFilename;
                        continue;
                    }
                }

                // If this step is I2I, optionally convert the scene prompt into a still-image prompt.
                // (This is especially useful for "画像リファイン後動画生成（シーンカット）".)
                if (isI2IWorkflowId(wf) && String(preset.id || '') === 'ext_i2i_i2v_scene_cut') {
                    const stillPrompt = await generateImagePromptForSceneRefine({
                        scenePrompt,
                        preset,
                        cancelSeqAtStart,
                    });
                    if (stillPrompt) params.prompt = stillPrompt;

                    // AutoGen external_i2i style: ref1 -> Picture 1, ref2 -> Picture 2 conversion
                    if (isQwen2511ImageEditWorkflowId(wf) || isQwen2512I2IWorkflowId(wf)) {
                        params.prompt = params.prompt.replace(/\bref1\b/gi, 'Picture 1');
                        params.prompt = params.prompt.replace(/\bref2\b/gi, 'Picture 2');
                    }
                    
                    if (isQwen2511ImageEditWorkflowId(wf)) {
                        params.prompt = wrapQwen2511EditInstructionPrompt(params.prompt);
                    }

                    // I2I refine strength.
                    // Boundary for auto refRole: <0.805 = reference image dominant (mood), >=0.805 = prompt dominant (character)
                    if (params.denoise === undefined) params.denoise = Number(normalizeDenoise(state.i2iDenoise, '1.0'));
                    if (params.cfg === undefined) params.cfg = Number(normalizeCfg(state.i2iCfg, '7.0'));
                }

                // Chain previous image into I2V
                if (isI2VWorkflowId(wf)) {
                    // Always prefer the current still frame (prepared / refined / extracted last frame) if present.
                    if (currentImageFilename) {
                        params.input_image = currentImageFilename;
                    }
                    if (String(preset.sceneContinuity || '') === 'last_frame' && !params.input_image) {
                        throw new Error('連続モード: I2V の入力フレームがありません（初期画像/最終フレーム抽出に失敗した可能性）');
                    }
                }

                const fpsRaw = Number(state.fps);
                const fallbackFps = getDefaultFpsForVideoWorkflow(wf);
                const effectiveFps = (Number.isFinite(fpsRaw) && fpsRaw > 0) ? Math.round(fpsRaw) : fallbackFps;

                // Always send fps for video workflows; helps WAN/LTX be deterministic.
                if (isVideoWorkflowId(wf)) {
                    params.fps = effectiveFps;
                    const frames = getSceneFramesForIndex(sceneIndex, effectiveFps);
                    if (Number.isFinite(frames) && frames > 0) params.frames = frames;
                }

                // LTX: default server behavior is to strip audio unless explicitly disabled.
                if (String(wf || '').startsWith('ltx2_')) {
                    params.strip_audio = !state.generateAudio;
                    console.log('[SimpleVideo] LTX audio setting: generateAudio=', state.generateAudio, 'strip_audio=', params.strip_audio);
                }

                const label = `S${sceneIndex + 1}/${scenePrompts.length} ${step.label || wf}`;

                const res = await runWorkflowStep({
                    workflow: wf,
                    label,
                    requestParams: params,
                    stepIndex: stepCursor,
                    totalSteps,
                });

                stepCursor++;

                lastJob = res;

                const imageOut = pickBestOutput(res.outputs, 'image');
                if (imageOut?.filename) {
                    currentImageFilename = String(imageOut.filename);
                }
            }

            if (lastJob) {
                // UI spec: overwrite the top output area (no per-scene list).
                renderSimpleVideoOutputMedia({ jobId: lastJob.jobId, outputs: lastJob.outputs, title: `Scene #${sceneIndex + 1}` });

                // Collect per-scene video filename for concatenation.
                const vid = pickBestOutput(lastJob.outputs, 'video');
                if (vid?.filename) {
                    const base = String(vid.filename).split('/').pop();
                    if (base) sceneVideoBasenames.push(base);

                    // For continuity mode, extract last frame for the next scene.
                    if (continuityMode === 'last_frame' && sceneIndex < scenePrompts.length - 1) {
                        state.currentStep = stepCursor + 1;
                        saveSimpleVideoState();

                        const rlf = await runUtilityExtractLastFrame({
                            videoBasename: base,
                            label: `S${sceneIndex + 1}/${scenePrompts.length} 最終フレーム抽出`,
                            stepIndex: stepCursor,
                            totalSteps,
                            cancelSeqAtStart,
                        });
                        stepCursor++;

                        const img = pickBestOutput(rlf.outputs, 'image');
                        if (img?.filename) {
                            currentImageFilename = String(img.filename);
                        }
                    }
                }
            }
        }

        // Concat stage (always attempted; server requires >=2 videos).
        const concatStepIndex = Math.max(0, stepCursor);
        state.currentStep = concatStepIndex + 1;
        saveSimpleVideoState();

        if ((Number(state.cancelSeq) || 0) !== cancelSeqAtStart) throw new Error('Cancelled');

        const api = window.app?.api;
        if (!api || typeof api.generateUtility !== 'function' || typeof api.monitorProgress !== 'function') {
            throw new Error('APIが利用できません（app.api.generateUtility/monitorProgress）');
        }

        if (sceneVideoBasenames.length < 2) {
            const overall = (concatStepIndex + 1) / Math.max(1, totalSteps);
            setSimpleVideoProgress('✅ 結合スキップ（動画が2本未満）', overall);
        } else {
            rememberSceneVideoBasenames({ presetId: preset.id, sceneVideoBasenames });
            const fps = Number(state.fps);
            const concatFps = (Number.isFinite(fps) && fps > 0) ? Math.round(fps) : 16;

            if (typeof showToast === 'function') showToast(`🔗 動画を結合中...（${sceneVideoBasenames.length}本）`, 'info');

            const concatJob = await api.generateUtility({
                workflow: 'video_concat',
                videos: sceneVideoBasenames,
                fps: concatFps,
                keep_audio: !!state.generateAudio
            });
            const concatJobId = concatJob?.job_id;
            if (!concatJobId) throw new Error('結合ジョブ(job_id)が取得できません');

            state.activeJobId = String(concatJobId);
            saveSimpleVideoState();
            updateGenerateButtonState();

            await new Promise((resolve, reject) => {
                let done = false;
                const finish = (fn) => (arg) => {
                    if (done) return;
                    done = true;
                    fn(arg);
                };

                api.monitorProgress(
                    concatJobId,
                    (p) => {
                        if ((Number(state.cancelSeq) || 0) !== cancelSeqAtStart) {
                            try { api.closeWebSocket?.(concatJobId); } catch (_e) {}
                            finish(reject)(new Error('Cancelled'));
                            return;
                        }
                        const local01 = normalizeProgress01(p?.progress);
                        const overall = (concatStepIndex + local01) / Math.max(1, totalSteps);
                        setSimpleVideoProgress(`🔗 結合: ${p?.message || 'Processing...'}`, overall);
                    },
                    finish(() => resolve()),
                    finish((err) => reject(err))
                );
            });

            // Clear activeJobId
            if (String(state.activeJobId || '') === String(concatJobId)) {
                state.activeJobId = null;
                saveSimpleVideoState();
                updateGenerateButtonState();
            }

            const outputsPayload = (typeof api.getOutputs === 'function') ? await api.getOutputs(concatJobId) : null;
            const outputs = Array.isArray(outputsPayload?.outputs) ? outputsPayload.outputs : [];
            // Overwrite the top output area with final concatenated result.
            renderSimpleVideoOutputMedia({ jobId: concatJobId, outputs, title: `結合結果（${sceneVideoBasenames.length}本）` });
        }

        setSimpleVideoProgress('完了', 1);
        if (typeof showToast === 'function') showToast(`生成が完了しました（${scenePrompts.length}シーン・結合まで完了）`, 'success');
    } catch (err) {
        console.error('[SimpleVideo] Generation error:', err);
        const msg = String(err?.message || err || 'Generation failed');
        if (msg === 'Cancelled') {
            setSimpleVideoProgress('⏹ 中止しました', 0);
            if (typeof showToast === 'function') showToast('生成を中止しました', 'warning');
        } else {
            setSimpleVideoProgress(`エラー: ${msg}`, 0);
            if (typeof showToast === 'function') showToast(msg, 'error');
        }
    } finally {
        state.isGenerating = false;
        state.activeJobId = null;
        saveSimpleVideoState();
        updateGenerateButtonState();
    }
}

/* ========================================
   Exports
   ======================================== */

// Make available globally
window.initSimpleVideoUI = initSimpleVideoUI;
window.SimpleVideoUI = SimpleVideoUI;
window.VIDEO_PRESETS = VIDEO_PRESETS;

console.log('[SimpleVideo] Module loaded');
