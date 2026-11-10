// Umbra settings: the flame avatars and the models a bot can think with.
// Safe to import from both the browser and the server.

// The eight flame spirits, cut from assets/flames.mp4 by scripts/make-flame-sprites.py.
export const FLAMES = [
  { id: 'violet', name: 'Violet', color: '#a77bff' },
  { id: 'cyan', name: 'Cyan', color: '#4fe3f0' },
  { id: 'amber', name: 'Amber', color: '#ffb547' },
  { id: 'jade', name: 'Jade', color: '#5fe0a8' },
  { id: 'rose', name: 'Rose', color: '#ff6fd8' },
  { id: 'ember', name: 'Ember', color: '#ff5a5a' },
  { id: 'azure', name: 'Azure', color: '#5b7bff' },
  { id: 'pearl', name: 'Pearl', color: '#e8e8f0' },
] as const;

export type FlameId = (typeof FLAMES)[number]['id'];

export const flameImage = (id: string, animated = true) => `/umbra/flames/${id}.${animated ? 'webp' : 'png'}`;
export const isFlame = (id: unknown): id is FlameId => FLAMES.some((f) => f.id === id);
export const flameColor = (id: string) => FLAMES.find((f) => f.id === id)?.color ?? '#a77bff';

// Local models a bot can use. All of them can use tools (needed from Stage 2 on).
// The first one is the default for new bots.
export const BOT_MODELS = [
  { id: 'qwen3:14b', name: 'Qwen 3 14B: smart all-rounder' },
  { id: 'qwen3.5:9b', name: 'Qwen 3.5 9B: faster, can see images' },
  { id: 'gpt-oss:20b', name: 'GPT-OSS 20B: best at multi-step tasks' },
  { id: 'qwen3:8b', name: 'Qwen 3 8B: quick and light' },
  { id: 'llama3.1:8b', name: 'Llama 3.1 8B: quick and light' },
  { id: 'qwen3-coder:30b', name: 'Qwen 3 Coder 30B: best for code (slower)' },
] as const;

export const isBotModel = (id: unknown): boolean => BOT_MODELS.some((m) => m.id === id);

// Tools a bot can be given (Stage 2). The creator shows these as checkboxes.
// The code behind each one lives in lib/umbra/tools.ts.
export const BOT_TOOLS = [
  { id: 'datetime', name: 'Date & time', description: 'Knows today’s date and time, and counts days until a date.' },
  { id: 'calculator', name: 'Calculator', description: 'Does exact math.' },
  { id: 'web_search', name: 'Web search', description: 'Searches the web (through SearXNG on your PC).' },
  { id: 'read_webpage', name: 'Read web page', description: 'Opens a link and reads the page.' },
  { id: 'make_image', name: 'Make image', description: 'Paints a picture with Prism.' },
  { id: 'notes', name: 'Notes', description: 'Remembers things about you between chats.' },
  { id: 'code', name: 'Code helper', description: 'Reads and searches one project folder, and suggests changes for you to approve.' },
] as const;

export type ToolId = (typeof BOT_TOOLS)[number]['id'];
export const ALL_TOOL_IDS: ToolId[] = BOT_TOOLS.map((t) => t.id);
export const isToolId = (id: unknown): id is ToolId => BOT_TOOLS.some((t) => t.id === id);
// New Flickers start with these. The Code helper stays off until you pick a folder for it.
export const DEFAULT_TOOL_IDS: ToolId[] = ALL_TOOL_IDS.filter((id) => id !== 'code');

// Limits for the bot form.
export const BOT_LIMITS = { name: 40, personality: 2000, purpose: 1000 };
