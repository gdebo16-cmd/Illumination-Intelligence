// Umbra settings: the flame avatars and the models a bot can think with.
// Safe to import from both the browser and the server.

import flameClips from './umbra-flame-clips.json';

// The eight flame spirits, cut from assets/flicker-idle.mp4 by scripts/make-flame-sprites.py.
const FLAMES = [
  { id: 'violet', name: 'Violet', color: '#a77bff' },
  { id: 'cyan', name: 'Cyan', color: '#4fe3f0' },
  { id: 'amber', name: 'Amber', color: '#ffb547' },
  { id: 'jade', name: 'Jade', color: '#5fe0a8' },
  { id: 'rose', name: 'Rose', color: '#ff6fd8' },
  { id: 'ember', name: 'Ember', color: '#ff5a5a' },
  { id: 'azure', name: 'Azure', color: '#5b7bff' },
  { id: 'pearl', name: 'Pearl', color: '#e8e8f0' },
] as const;


// ------------------------------------------------------------------ shapes and colors
//
// What you pick for a Flicker: one of six shapes, and any color.
// Every shape has a white (pearl) picture (the "clean palette"); the app tints it with your color in
// the browser, so no extra pictures are needed per color. 'art' is the picture's file name in
// public/umbra/flames: a square 512x512 still (.png) and a resting animation (.avif and .webp).
// Gabriel designed the six shapes and Art drew them and their idle loops (droplet bubbles, sprout
// pollen, star sparkles, gem glints, flame embers). `words` is how the Flicker is told what it looks like.
export const SHAPES = [
  { id: 'flame', name: 'Flame', art: 'flame', words: 'flame spirit' },
  { id: 'droplet', name: 'Droplet', art: 'droplet', words: 'water droplet spirit' },
  { id: 'sprout', name: 'Sprout', art: 'sprout', words: 'leaf sprout spirit' },
  { id: 'star', name: 'Star', art: 'star', words: 'star spirit' },
  { id: 'gem', name: 'Gem', art: 'gem', words: 'crystal gem spirit' },
  { id: 'wispy-flame', name: 'Wispy flame', art: 'wispy-flame', words: 'wispy shadow flame spirit' },
] as const;

// Shape ids saved before the shapes got their final names. A Flicker saved as "leaf#aabbcc" is a
// Sprout now, "stone" a Gem and "umbra" a Wispy flame. They are not offered in the picker.
const SHAPE_ALIASES: Record<string, string> = { leaf: 'sprout', stone: 'gem', umbra: 'wispy-flame' };

// The color a new Flicker starts with, and the color of an untinted (white) one.
export const DEFAULT_FLAME_COLOR = '#a77bff';
const WHITE = '#e8e8f0';

// A Flicker's look is saved as one short piece of text in its "flame" setting:
//   "star#ff8800"  a shape in a color you picked      (what the picker saves)
//   "star"         a shape left white
//   "#ff8800"      a flame in a color you picked
//   "violet"       one of the eight original flames, drawn with its own full-color pictures
//                  (Flickers made before the shape picker keep looking exactly as they did)
function read(flame: unknown): { shape: (typeof SHAPES)[number]; original?: (typeof FLAMES)[number]; tint?: string } | null {
  // Shape ids are lowercase words, joined by hyphens ("wispy-flame").
  const parts = typeof flame === 'string' ? /^([a-z]+(?:-[a-z]+)*)?(#[0-9a-f]{6})?$/i.exec(flame) : null;
  if (!parts || (!parts[1] && !parts[2])) return null;
  const tint = parts[2]?.toLowerCase();
  const original = tint ? undefined : FLAMES.find((f) => f.id === parts[1]);
  if (original) return { shape: SHAPES[0], original };
  const id = parts[1] ? (SHAPE_ALIASES[parts[1]] ?? parts[1]) : undefined;
  const shape = id ? SHAPES.find((s) => s.id === id) : SHAPES[0];
  return shape ? { shape, tint } : null;
}

/** True for any look the app knows how to draw. */
export const isFlame = (flame: unknown): flame is string => read(flame) !== null;
/** The shape's id, e.g. 'star' (the eight original flames are all 'flame'). */
export const flameShape = (flame: string): string => (read(flame)?.shape ?? SHAPES[0]).id;
/** The color you picked, when the white picture should be tinted; nothing for white or an original flame. */
export const flameTint = (flame: string): string | undefined => read(flame)?.tint;
/** The accent color that goes with a look (buttons, borders, glow). */
export function flameColor(flame: string): string {
  const look = read(flame);
  return look?.tint ?? look?.original?.color ?? (look ? WHITE : DEFAULT_FLAME_COLOR);
}
/** The saved text for a shape in a color. */
export const makeFlame = (shapeId: string, color: string) => `${shapeId}${color.toLowerCase()}`;
/** What the Flicker is told it looks like, e.g. "violet flame spirit" or "water droplet spirit". */
export function flameWords(flame: string): string {
  const look = read(flame);
  if (look?.original) return `${look.original.id} flame spirit`;
  return (look?.shape ?? SHAPES[0]).words;
}

// The picture file (without its ending) a look is drawn from.
const flameArt = (flame: string): string => {
  const look = read(flame);
  return look?.original?.id ?? (look?.shape ?? SHAPES[0]).art;
};

// A flicker's pictures. 'idle' is the resting animation; 'dance' plays while its bot is working.
// Each animation comes as a small .avif (what phones load) and a .webp for older browsers.
// The .png is the still picture.
export type FlameClip = 'idle' | 'dance';
export const flameStill = (flame: string) => `/umbra/flames/${flameArt(flame)}.png`;
export const flameAnimation = (flame: string, clip: FlameClip = 'idle') => {
  const file = `/umbra/flames/${flameArt(flame)}${clip === 'dance' ? '-dance' : ''}`;
  return { avif: `${file}.avif`, webp: `${file}.webp` };
};
// Width of a flicker picture for each pixel of height. The eight original flames are tall (161x246);
// the six shapes are square (512x512).
const FLAME_ASPECT = flameClips.width / flameClips.height;
export const flameAspect = (flame: string): number => (read(flame)?.original ? FLAME_ASPECT : 1);
/** True when this look has a resting animation (all eight original flames and all six shapes do). */
export const hasAnimation = (flame: string) => {
  const art = flameArt(flame);
  return FLAMES.some((f) => f.id === art) || SHAPES.some((s) => s.art === art);
};
// True once a dance clip has been made for this look (the script fills in the list).
// Until then the app makes the resting animation hop and sway instead.
export const hasDanceClip = (flame: string) => (flameClips.dance as string[]).includes(flameArt(flame));
// Local models a bot can use. All of them can use tools (needed from Stage 2 on).
// The first one is the default for new bots.
export const BOT_MODELS = [
  { id: 'gemma4:12b', name: 'Big Brain Fish: smart all-rounder, can see images' },
  { id: 'qwen3.5:9b', name: 'Little Eyed Fish: quick, can see images' },
  { id: 'qwen2.5-coder:7b', name: 'Small Code Fish: quick code help' },
  { id: 'gpt-oss:20b', name: 'Big City Task Fish: multi-step tasks (heavy)' },
  { id: 'devstral-small-2:24b', name: 'Harbor Code Fish: explores and edits a project, can see images (heavy)' },
  { id: 'qwen3-coder:30b', name: 'Deep Sea Code Fish: best code (heavy, slow)' },
] as const;

export const isBotModel = (id: unknown): boolean => BOT_MODELS.some((m) => m.id === id);

// Models that used to be in the list, and the one that took each one's place. A Flicker still set
// to an old model is moved to the new one when the app starts (lib/db.ts), so it keeps working
// and its settings can still be saved.
export const RETIRED_BOT_MODELS: Record<string, string> = {
  'qwen3:14b': 'gemma4:12b', // the old Big Brain Fish
  'qwen3:8b': 'qwen3.5:9b', // Quick Chatter Fish
  'llama3.1:8b': 'qwen3.5:9b', // Little Chatter Fish
};

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
  { id: 'refract', name: 'Refract workshop', description: 'Copies repos into the virtual machine, edits and runs commands there, and can snapshot or roll back that work. The host PC stays untouched.' },
] as const;

export type ToolId = (typeof BOT_TOOLS)[number]['id'];
const ALL_TOOL_IDS: ToolId[] = BOT_TOOLS.map((t) => t.id);
export const isToolId = (id: unknown): id is ToolId => BOT_TOOLS.some((t) => t.id === id);
// New Flickers start with these. The Code helper stays off until you pick a folder for it.
// The Refract workshop is on: it works in the virtual machine and does not need a folder.
export const DEFAULT_TOOL_IDS: ToolId[] = ALL_TOOL_IDS.filter((id) => id !== 'code');

// Limits for the bot form.
export const BOT_LIMITS = { name: 40, personality: 2000, purpose: 1000 };
