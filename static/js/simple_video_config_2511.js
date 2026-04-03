window.SimpleVideoStandaloneConfig = {
    enableLtx: true,
    showGenerateAudioOption: false,
    lockI2IWorkflow: true,
    workflows: {
        // 2511 のみで運用（2512 モデル不要）
        initialImage: 'qwen_i2i_2511_bf16_lightning4',
        t2i: 'qwen_i2i_2511_bf16_lightning4',
        i2i: 'qwen_i2i_2511_bf16_lightning4',
        t2v: 'wan22_t2v_gguf_lightning4',
        i2v: 'wan22_i2v_lightning',
        flf: 'wan22_smooth_first2last',
    },
};
