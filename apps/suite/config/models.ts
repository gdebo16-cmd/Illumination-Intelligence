

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
const VISION_MODELS: readonly string[] = ['gemma4:12b', 'qwen3.5:9b', 'devstral-small-2:24b'];
export const canSeeImages = (modelId: string) => VISION_MODELS.includes(modelId);

// Models that can think a problem through before answering (Ollama lists "thinking" for them in
// `ollama show <model>`). A Flicker's "Think before answering" switch only works with these.
const THINKING_MODELS: readonly string[] = ['gemma4:12b', 'qwen3.5:9b', 'gpt-oss:20b'];
export const canThink = (modelId: string) => THINKING_MODELS.includes(modelId);

// "Thinking" models (Qwen 3, Gemma 4, GPT-OSS) reason privately before answering. For a bot (lib/umbra/agent.ts) that's slow
// (20-90 s per step) and, in testing, often made them *describe* a tool instead of using it.
// So unless a bot has "Think before answering" switched on, it uses the quick, decisive mode:
// thinking off, or as low as the model allows.
export function thinkSetting(model: string, think: boolean): { think?: boolean | 'low' | 'medium' } {
  // GPT-OSS can't stop thinking; it takes an effort level instead of on/off.
  if (model.startsWith('gpt-oss')) return { think: think ? 'medium' : 'low' };
  if (think) return { think: true };
  if (model.startsWith('qwen3') || model.startsWith('gemma4')) return { think: false };
  return {};
}

// The model Aegis asks to write up its suggestions, until you pick another on the page.
export const AEGIS_DEFAULT_MODEL = 'gemma4:12b';

// Photos in chat: how many one message can carry, and where the browser loads a saved one from.
export const MAX_PHOTOS = 4;
export const chatImageUrl = (id: string) => `/api/chat-images/${id}`;
