// lib/halo/describe.ts — Halo's "describe it" box. You write what you want ("a flame that flickers
// and sways"), and a local model picks from Halo's menu: a shape, which moves to turn on and how
// strong, a colour, how long a loop lasts, and the pivot. It never writes the Lottie file itself;
// the page fills in its usual controls with the picks, and lib/halo/lottie.ts builds the file.
//
// Picking from a fixed menu is what keeps this reliable: a strange pick gives an odd animation,
// never a broken one. Anything the model gets wrong is cleaned up or dropped in clean() below.

import 'server-only';
import { BACKGROUND_MODEL, thinkSetting } from '@/config/models';
import { MAX_SECONDS, MIN_SECONDS, MOVES, START_SHAPES, type Pivot } from '@/config/halo';
import { gpuQueue, OLLAMA_KEEP_ALIVE, OLLAMA_NUM_CTX, OLLAMA_URL } from '@/lib/queue';
import { MAX_INNER_LAYERS, type InnerLayer } from './lottie';
import { defaultValues, TEMPLATES, type TemplateSetting, type TemplateValues } from './templates';

export const MAX_DESCRIPTION = 400;
const TIMEOUT_MS = 3 * 60_000;

/** What the page gets back: the same things its controls hold. Either a shape set up with moves… */
export interface DescribedShape {
  kind: 'shape';
  name: string;
  shape: string; // a START_SHAPES id
  color: string; // #rrggbb
  seconds: number;
  pivot: Pivot;
  moves: { id: string; strength: number }[]; // only the moves to turn on
  shade: string | null; // second colour for shading, or null for flat
  outline: string | null; // outline colour, or null for none
  inner: InnerLayer[]; // smaller copies on top, biggest first
}

/** …or one of the ready-made templates (lib/halo/templates.ts) with its settings filled in. */
export interface DescribedTemplate {
  kind: 'template';
  name: string;
  template: string; // a TEMPLATES id
  values: TemplateValues;
}

export type DescribedAnimation = DescribedShape | DescribedTemplate;

/** One template setting, described for the model: its id, what it is, and what it accepts. */
function settingLine(s: TemplateSetting): string {
  if (s.kind === 'color') return `${s.id} (${s.label}): a hex colour`;
  if (s.kind === 'toggle') return `${s.id} (${s.label}): "true" or "false"`;
  if (s.kind === 'choice') return `${s.id} (${s.label}): one of ${s.options.map((o) => `"${o.value}"`).join(', ')}`;
  return `${s.id} (${s.label}): a number from ${s.min} to ${s.max}${s.unit ? ` ${s.unit === 's' ? 'seconds' : s.unit}` : ''}`;
}

const SYSTEM = `You set up an animation in an app called Halo. The user describes what they want; you choose settings from the menus below. You never write animation code.

First decide: is it one of these ready-made templates? If so, set template to its id, and in settings give only the ones the description is about; leave out the rest so they keep their defaults. For example "a purple switch" sets the on colour, and leaves the knob white and the off colour grey. Otherwise set template to "none" and set up a shape as described further down.
${TEMPLATES.map((t) => `- ${t.id}: ${t.name}. ${t.description}\n  settings: ${t.settings.map(settingLine).join('; ')}`).join('\n')}

When template is not "none", still fill in the shape fields below (any values); they're ignored.

Setting up a shape:

Shapes: ${START_SHAPES.map((s) => `${s.id} (${s.name.toLowerCase()})`).join(', ')}.

Moves (turn on 1 to 4 that fit; they all play at once and add together):
${MOVES.map((m) => `- ${m.id}: ${m.description}`).join('\n')}

Strength is 0.05 to 1: about 0.3 for subtle, 0.5 for normal, 0.8 or more for strong.
seconds: how long one loop lasts, ${MIN_SECONDS} to ${MAX_SECONDS}. Calm things are slower (3 to 5), lively things faster (1 to 2).
pivot: "bottom" for things rooted at their base (flames, plants, candles), otherwise "center".
color: a hex colour like "#f2a33a" that suits the description.
name: a short title for the animation, 1 to 4 words.

Detail (use it when it suits; simple icons can stay flat):
shade: a second hex colour; the shape fades from color at the top to shade at the bottom. "" for a flat colour.
outline: a hex colour for a line round the shape, usually a dark version of color. "" for none.
inner: 0 to ${MAX_INNER_LAYERS} smaller copies drawn on top, biggest first, each lighter or brighter than the one under it (a flame's yellow middle and white-hot core, a heart's pale highlight). Each has color, size (0.2 to 0.9) and lively (0 to 1: how much more than the outside it moves; flames 0.4 to 0.8, solid objects 0).

Answer with JSON only, in the given shape.

Example: "a blue loading spinner, quite fast" →
{"template":"spinner","settings":[{"id":"color","value":"#3b82f6"},{"id":"seconds","value":"0.9"}],"name":"Blue spinner","shape":"circle","color":"#3b82f6","seconds":2,"pivot":"center","moves":[{"id":"spin","strength":0.5}],"shade":"","outline":"","inner":[]}

Example: "a candle flame, gently flickering" →
{"template":"none","settings":[],"name":"Candle flame","shape":"flame","color":"#f2a33a","seconds":2,"pivot":"bottom","moves":[{"id":"flicker","strength":0.5},{"id":"sway","strength":0.3}],"shade":"#c2410c","outline":"","inner":[{"color":"#ffd04a","size":0.6,"lively":0.5},{"color":"#fff7d6","size":0.3,"lively":0.7}]}`;

const SCHEMA = {
  type: 'object',
  properties: {
    template: { type: 'string', enum: ['none', ...TEMPLATES.map((t) => t.id)] },
    settings: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' }, value: { type: 'string' } }, required: ['id', 'value'] },
    },
    name: { type: 'string' },
    shape: { type: 'string', enum: START_SHAPES.map((s) => s.id) },
    color: { type: 'string' },
    seconds: { type: 'number' },
    pivot: { type: 'string', enum: ['center', 'bottom'] },
    moves: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string', enum: MOVES.map((m) => m.id) }, strength: { type: 'number' } },
        required: ['id', 'strength'],
      },
    },
    shade: { type: 'string' },
    outline: { type: 'string' },
    inner: {
      type: 'array',
      items: {
        type: 'object',
        properties: { color: { type: 'string' }, size: { type: 'number' }, lively: { type: 'number' } },
        required: ['color', 'size', 'lively'],
      },
    },
  },
  required: ['template', 'settings', 'name', 'shape', 'color', 'seconds', 'pivot', 'moves', 'shade', 'outline', 'inner'],
};

/** "#rrggbb" in lower case, or null if it isn't one. */
const hex = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : null);

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** A template's settings: start from its defaults, and take each answer only if it fits that setting. */
function cleanTemplate(o: Record<string, unknown>): DescribedTemplate | null {
  const template = TEMPLATES.find((t) => t.id === o.template);
  if (!template) return null;
  const values = defaultValues(template);
  for (const item of Array.isArray(o.settings) ? o.settings : []) {
    const { id, value } = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const setting = template.settings.find((s) => s.id === id);
    const text = typeof value === 'string' ? value.trim() : String(value ?? '');
    if (!setting) continue;
    if (setting.kind === 'color') {
      const c = hex(text);
      if (c) values[setting.id] = c;
    } else if (setting.kind === 'toggle') {
      if (text === 'true' || text === 'false') values[setting.id] = text === 'true';
    } else if (setting.kind === 'choice') {
      if (setting.options.some((x) => x.value === text)) values[setting.id] = text;
    } else {
      const n = Number(text);
      if (Number.isFinite(n)) values[setting.id] = Math.round(Math.round(clamp(n, setting.min, setting.max) / setting.step) * setting.step * 100) / 100;
    }
  }
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 60) : template.name;
  return { kind: 'template', name, template: template.id, values };
}

/** Keep only picks that are on the menu, and pull numbers back into range. */
function clean(raw: unknown): DescribedAnimation {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const asTemplate = cleanTemplate(o);
  if (asTemplate) return asTemplate;
  const shape = START_SHAPES.some((s) => s.id === o.shape) ? (o.shape as string) : START_SHAPES[0].id;
  const color = hex(o.color) ?? '#f2a33a';
  const inner = (Array.isArray(o.inner) ? o.inner : [])
    .map((l) => (l && typeof l === 'object' ? (l as Record<string, unknown>) : {}))
    .filter((l) => hex(l.color))
    .map((l) => ({
      color: hex(l.color)!,
      size: Math.round(clamp(num(l.size, 0.5), 0.2, 0.9) * 20) / 20,
      lively: Math.round(clamp(num(l.lively, 0.4), 0, 1) * 20) / 20,
    }))
    .sort((a, b) => b.size - a.size) // biggest first, so none hides a smaller one
    .slice(0, MAX_INNER_LAYERS);
  const seen = new Set<string>();
  const moves = (Array.isArray(o.moves) ? o.moves : [])
    .map((m) => (m && typeof m === 'object' ? (m as Record<string, unknown>) : {}))
    .filter((m) => typeof m.id === 'string' && MOVES.some((x) => x.id === m.id) && !seen.has(m.id) && seen.add(m.id))
    .map((m) => ({ id: m.id as string, strength: Math.round(clamp(num(m.strength, 0.5), 0.05, 1) * 20) / 20 }))
    .slice(0, 4);
  if (!moves.length) throw new Error('The model didn’t pick any moves. Try describing how it should move.');
  return {
    kind: 'shape',
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 60) : 'Halo animation',
    shape,
    color,
    seconds: Math.round(clamp(num(o.seconds, 2), MIN_SECONDS, MAX_SECONDS) * 2) / 2, // the slider moves in halves
    pivot: o.pivot === 'bottom' ? 'bottom' : 'center',
    moves,
    shade: hex(o.shade),
    outline: hex(o.outline),
    inner,
  };
}

/** Ask the local model to pick Halo's settings for a description. Throws a plain-English error if it can't. */
export async function describeAnimation(description: string, userId: string): Promise<DescribedAnimation> {
  const model = BACKGROUND_MODEL;
  const reply = await gpuQueue.add(async () => {
    let res: Response;
    try {
      res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: description },
          ],
          stream: false,
          format: SCHEMA,
          options: { num_ctx: OLLAMA_NUM_CTX, temperature: 0.4 }, // same context size as other jobs, so the model isn't reloaded
          keep_alive: OLLAMA_KEEP_ALIVE,
          ...thinkSetting(model, false),
        }),
      });
    } catch {
      throw new Error('Couldn’t reach Ollama. Is it running?');
    }
    if (!res.ok) throw new Error(`Ollama answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as { message?: { content?: string } };
  }, 'high', 'ollama', { userId, model });
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.message?.content ?? '');
  } catch {
    throw new Error('The model didn’t answer with valid JSON. Try again.');
  }
  return clean(parsed);
}
