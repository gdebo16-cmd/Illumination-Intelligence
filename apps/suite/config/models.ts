

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
  
// "Auto" in Lumen's picker: the app chooses one of the local chat models above for each message
// (lib/auto-model.ts). It is not a real model, so it is never sent to Ollama.
export const AUTO_MODEL = 'auto';

// "Cloud Fish": big models that run on Ollama's servers, not on this machine (lib/cloud-model.ts).
// Only used when picked by hand: the chat leaves the house and each message costs a little.
// The app chooses between the two for each message: `strong` for code and involved questions,
// `everyday` (about a third of the price) for the rest.
export const CLOUD_MODEL = 'cloud';
export const CLOUD_MODELS = { strong: 'kimi-k3.1-pro', everyday: 'mistral-large-4' } as const;
const CLOUD_NAMES: Record<string, string> = { 'kimi-k3.1-pro': 'Kimi K3.1 Pro', 'mistral-large-4': 'Mistral Large 4' };
export const CLOUD_LABEL = 'Cloud Fish: huge models, online (costs a little)';
export const isCloudModel = (modelId: string) => modelId === CLOUD_MODEL || modelId in CLOUD_NAMES;
// The local model for the work around a cloud chat (memory, summaries), which never goes online.
export const BACKGROUND_MODEL = 'qwen3.5:9b';
export const localOnly = (modelId: string) => (isCloudModel(modelId) ? BACKGROUND_MODEL : modelId);
export type LocalModelId = (typeof PAGE_MODELS.chat)[number]['id'];
/** What Lumen's picker lists: Auto first (the default), then each local model to pick by hand. */
export const LUMEN_MODELS: readonly { id: string; name: string }[] = [
  { id: AUTO_MODEL, name: 'Auto: picks a fish for you' },
  ...PAGE_MODELS.chat,
  { id: CLOUD_MODEL, name: CLOUD_LABEL },
];
/** A model's short name, e.g. "Pond Fish", for the note under a reply that says who answered. */
export const shortModelName = (modelId: string) =>
  CLOUD_NAMES[modelId] ?? PAGE_MODELS.chat.find((m) => m.id === modelId)?.name.split(':')[0] ?? modelId;

  export type PageType = keyof typeof PAGE_MODELS;
  export type ModelItem = (typeof PAGE_MODELS)[PageType][number];

// Models that can look at pictures. The "add a photo" button in Lumen and in a Flicker's chat only
// shows while one of these is the model in use. Add a model's id here when you install one that
// can see images (Ollama lists "vision" for it in `ollama show <model>`).
const VISION_MODELS: readonly string[] = ['gemma4:12b', 'qwen3.5:9b', 'devstral-small-2:24b'];
// Auto can always take a photo: it switches to a model that can see when one is attached.
export const canSeeImages = (modelId: string) => modelId === AUTO_MODEL || isCloudModel(modelId) || VISION_MODELS.includes(modelId);

// Models that can think a problem through before answering (Ollama lists "thinking" for them in
// `ollama show <model>`). A Flicker's "Think before answering" switch only works with these.
const THINKING_MODELS: readonly string[] = ['gemma4:12b', 'qwen3.5:9b', 'gpt-oss:20b'];
// On Auto the switch can stay on: it takes effect whenever Auto chooses a model that can think.
export const canThink = (modelId: string) => modelId === AUTO_MODEL || isCloudModel(modelId) || THINKING_MODELS.includes(modelId);

// "Thinking" models (Qwen 3, Gemma 4, GPT-OSS) reason privately before answering. For a bot (lib/umbra/agent.ts) that's slow
// (20-90 s per step) and, in testing, often made them *describe* a tool instead of using it.
// So unless a bot has "Think before answering" switched on, it uses the quick, decisive mode:
// thinking off, or as low as the model allows.
export function thinkSetting(model: string, think: boolean): { think?: boolean | 'low' | 'medium' } {
  // GPT-OSS can't stop thinking; it takes an effort level instead of on/off.
  if (model.startsWith('gpt-oss')) return { think: think ? 'medium' : 'low' };
  // Cloud models all think, and thinking is billed, so it is always said outright.
  if (isCloudModel(model)) return { think };
  if (think) return { think: true };
  if (model.startsWith('qwen3') || model.startsWith('gemma4')) return { think: false };
  return {};
}

// The model Aegis asks to write up its suggestions, until you pick another on the page.
export const AEGIS_DEFAULT_MODEL = 'gemma4:12b';

// Photos in chat: how many one message can carry, and where the browser loads a saved one from.
export const MAX_PHOTOS = 4;
export const chatImageUrl = (id: string) => `/api/chat-images/${id}`;
