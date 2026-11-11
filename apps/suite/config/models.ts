

export const PAGE_MODELS = {
    chat: [
        // Fun names say what each is for; "heavy" ones nearly fill (or overflow) the 16 GB card.
        { id: 'qwen3:14b', name: 'Big Brain Fish: smart all-rounder' },
        { id: 'qwen3.5:9b', name: 'Little Eyed Fish: quick, can see images' },
        { id: 'qwen3:8b', name: 'Quick Chatter Fish: quick, a bit smarter' },
        { id: 'llama3.1:8b', name: 'Little Chatter Fish: quick everyday chat' },
        { id: 'qwen2.5:7b-instruct', name: 'Little Errand Fish: short, does exactly what you ask' },
        { id: 'qwen2.5-coder:7b', name: 'Small Code Fish: quick code help' },
        { id: 'deepseek-r1:14b', name: 'Big Puzzle Fish: thinks hard on logic and math' },
        { id: 'gpt-oss:20b', name: 'Big City Task Fish: multi-step tasks (heavy)' },
        { id: 'qwen3-coder:30b', name: 'Deep Sea Code Fish: best code (heavy, slow)' },
    ],
    images: [
    ],

  } as const;
  
  export type PageType = keyof typeof PAGE_MODELS;
  export type ModelItem = (typeof PAGE_MODELS)[PageType][number];