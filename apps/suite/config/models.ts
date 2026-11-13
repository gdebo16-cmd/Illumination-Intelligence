

export const PAGE_MODELS = {
    chat: [
        // Fun names say what each is for; "heavy" ones nearly fill (or overflow) the 16 GB card.
        { id: 'gemma4:12b', name: 'Big Brain Fish: Very Smart' },
        { id: 'qwen3.5:9b', name: 'Small Town Fish: Fast as Fish boi' },
        { id: 'qwen2.5-coder:7b', name: 'Pond Fish: quick code' },
        { id: 'gpt-oss:20b', name: 'Big City Fish: multi-task (Heavy)' },
        { id: 'devstral-small-2:24b', name: 'Harbor Fish: project code (Heavy)' },
        { id: 'qwen3-coder:30b', name: 'Deep Sea Fish: tough code (Heavy, Slow)' },
    ],
    images: [
    ],

  } as const;
  
  export type PageType = keyof typeof PAGE_MODELS;
  export type ModelItem = (typeof PAGE_MODELS)[PageType][number];

// Models that can look at pictures. The "add a photo" button in Lumen and in a Flicker's chat only
// shows while one of these is the model in use. Add a model's id here when you install one that
// can see images (Ollama lists "vision" for it in `ollama show <model>`).
export const VISION_MODELS: readonly string[] = ['gemma4:12b', 'qwen3.5:9b', 'devstral-small-2:24b'];
export const canSeeImages = (modelId: string) => VISION_MODELS.includes(modelId);

// Models that can think a problem through before answering (Ollama lists "thinking" for them in
// `ollama show <model>`). A Flicker's "Think before answering" switch only works with these.
export const THINKING_MODELS: readonly string[] = ['gemma4:12b', 'qwen3.5:9b', 'gpt-oss:20b'];
export const canThink = (modelId: string) => THINKING_MODELS.includes(modelId);

// Photos in chat: how many one message can carry, and where the browser loads a saved one from.
export const MAX_PHOTOS = 4;
export const chatImageUrl = (id: string) => `/api/chat-images/${id}`;
