

export const PAGE_MODELS = {
    chat: [
        { id: 'qwen3-coder:30b', name: 'Qwen 3 Coder (30B)' },
        { id: 'deepseek-r1:14b', name: 'DeepSeek R1 (14B)' },
        { id: 'qwen3:14b', name: 'Qwen 3 (14B)' },
        { id: 'qwen3.5:9b', name: 'Qwen 3.5 (9B)' },
        { id: 'qwen2.5:7b-instruct', name: 'Qwen 2.5 7B Instruct' },
        { id: 'llama3.1:8b', name: 'Llama 3.1 (8B)' },
    ],
    images: [
        { id: 'qwen3-coder:30b', name: 'Qwen 3 Coder (30B)' },
        { id: 'deepseek-r1:14b', name: 'DeepSeek R1 (14B)' },
        { id: 'qwen3:14b', name: 'Qwen 3 (14B)' },
        { id: 'qwen3.5:9b', name: 'Qwen 3.5 (9B)' },
        { id: 'qwen2.5:7b-instruct', name: 'Qwen 2.5 7B Instruct' },
        { id: 'llama3.1:8b', name: 'Llama 3.1 (8B)' },
    ],
  } as const;
  
  export type PageType = keyof typeof PAGE_MODELS;
  export type ModelItem = (typeof PAGE_MODELS)[PageType][number];