window.SimpleVideoStandaloneConfig = {
    enableLtx: false,
    showGenerateAudioOption: false,
    lockI2IWorkflow: true,
    workflows: {
        // 初期画像生成（T2I）
        initialImage: 'qwen_t2i_2512_lightning4',
        // 動画生成時の固定ワークフロー
        t2i: 'qwen_t2i_2512_lightning4',
        i2i: 'qwen_i2i_2511_bf16_lightning4',
        t2v: 'wan22_t2v_gguf_lightning4',
        i2v: 'wan22_i2v_lightning',
        flf: 'wan22_smooth_first2last',
    },
};
