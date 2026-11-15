// Halo's templates: ready-made animations for everyday uses (a switch, a loading spinner, a success
// tick, a moving background). Each one is a recipe: it takes a few settings (colours, speed, size)
// and builds the whole Lottie file itself, because these need things the shape maker can't do:
// several parts, colour changes, lines that draw themselves, or a wide canvas.
//
// Lottie words used below:
// - "rc" / "el" / "sh": a rounded rectangle, an ellipse, a free path.
// - "fl" / "gf" / "st": a fill, a gradient fill, a line (stroke).
// - "tm": trim. Shows only part of a line (start % to end %); animating it makes a line draw itself.
// - "gr" + "tr": a group of parts, and the group's own position/size/turn (which can animate).
// - markers: named bookmarks in the timeline ("turn on" = frames 0–15) that apps can play.

import { FRAME_RATE } from '@/config/halo';
import { hexToRgb, round } from './lottie';

// ---------- Settings ----------

export type TemplateSetting =
  | { id: string; label: string; kind: 'color'; default: string }
  | { id: string; label: string; kind: 'number'; min: number; max: number; step: number; default: number; unit?: string }
  | { id: string; label: string; kind: 'toggle'; default: boolean }
  | { id: string; label: string; kind: 'choice'; options: { value: string; label: string }[]; default: string };

export type TemplateValues = Record<string, string | number | boolean>;

export interface Template {
  id: string;
  name: string;
  description: string;
  /** Shown under the settings: how to use the file in an app. */
  howToUse: string;
  settings: TemplateSetting[];
  build: (v: TemplateValues, name: string) => object;
}

export const defaultValues = (t: Template): TemplateValues =>
  Object.fromEntries(t.settings.map((s) => [s.id, s.default]));

// Read one setting, falling back to its default if it's missing or the wrong kind.
const num = (v: TemplateValues, id: string, fallback: number) => (typeof v[id] === 'number' ? (v[id] as number) : fallback);
const str = (v: TemplateValues, id: string, fallback: string) => (typeof v[id] === 'string' ? (v[id] as string) : fallback);
const bool = (v: TemplateValues, id: string, fallback: boolean) => (typeof v[id] === 'boolean' ? (v[id] as boolean) : fallback);

// ---------- Lottie pieces ----------

const fixed = <T,>(k: T) => ({ a: 0, k });
const rgba = (hex: string, alpha = 1) => [...hexToRgb(hex), alpha];

type Key = { t: number; v: number[] };
/** Keyframes that ease in and out (slow, fast, slow), like real things moving. */
function eased(keys: Key[]) {
  return {
    a: 1,
    k: keys.map((key, n) =>
      n === keys.length - 1
        ? { t: key.t, s: key.v }
        : { t: key.t, s: key.v, o: { x: [0.4], y: [0] }, i: { x: [0.2], y: [1] } },
    ),
  };
}
/** Keyframes at a steady speed. */
function linear(keys: Key[]) {
  return {
    a: 1,
    k: keys.map((key, n) =>
      n === keys.length - 1 ? { t: key.t, s: key.v } : { t: key.t, s: key.v, o: { x: [0], y: [0] }, i: { x: [1], y: [1] } },
    ),
  };
}
/** A smooth path through the loop, worked out every few frames (enough for slow drifting). */
function sampled(frames: number, step: number, at: (t: number) => number[]) {
  const keys: Key[] = [];
  for (let f = 0; f < frames; f += step) keys.push({ t: f, v: at(f / frames).map(round) });
  keys.push({ t: frames, v: at(1).map(round) });
  return linear(keys);
}

const rect = (x: number, y: number, w: number, h: number, radius: number) => ({
  ty: 'rc', d: 1, p: fixed([x, y]), s: fixed([w, h]), r: fixed(radius),
});
const ellipse = (x: number, y: number, w: number, h = w) => ({ ty: 'el', d: 1, p: fixed([x, y]), s: fixed([w, h]) });
const straightPath = (points: number[][]) => ({
  ty: 'sh',
  ks: fixed({ c: false, v: points, i: points.map(() => [0, 0]), o: points.map(() => [0, 0]) }),
});
const fill = (hex: string | object, alpha = 100) => ({
  ty: 'fl', c: typeof hex === 'string' ? fixed(rgba(hex)) : hex, o: fixed(alpha), r: 1,
});
const line = (hex: string, width: number, alpha = 100) => ({
  ty: 'st', c: fixed(rgba(hex)), o: fixed(alpha), w: fixed(width), lc: 2, lj: 2, // round ends and corners
});
const trim = (start: object, end: object) => ({ ty: 'tm', s: start, e: end, o: fixed(0), m: 1 });

interface GroupMotion { p?: object; s?: object; r?: object; a?: number[] }
/** A group: its parts, then its own transform. Earlier groups are drawn on top of later ones. */
const group = (nm: string, items: object[], motion: GroupMotion = {}) => ({
  ty: 'gr',
  nm,
  it: [
    ...items,
    {
      ty: 'tr',
      p: motion.p ?? fixed([0, 0]),
      a: fixed(motion.a ?? [0, 0]),
      s: motion.s ?? fixed([100, 100]),
      r: motion.r ?? fixed(0),
      o: fixed(100),
      sk: fixed(0),
      sa: fixed(0),
    },
  ],
});

interface LayerMotion { p?: object; r?: object; a?: number[] }
function file(name: string, w: number, h: number, frames: number, groups: object[], motion: LayerMotion = {}, markers: object[] = []) {
  return {
    v: '5.7.4',
    nm: name,
    fr: FRAME_RATE,
    ip: 0,
    op: frames,
    w,
    h,
    ddd: 0,
    assets: [],
    markers,
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: name,
        sr: 1,
        ks: {
          o: fixed(100),
          r: motion.r ?? fixed(0),
          p: motion.p ?? fixed([0, 0, 0]),
          a: fixed(motion.a ?? [0, 0, 0]),
          s: fixed([100, 100, 100]),
        },
        ao: 0,
        shapes: groups,
        ip: 0,
        op: frames,
        st: 0,
        bm: 0,
      },
    ],
  };
}

// ---------- The templates ----------

const toggleSwitch: Template = {
  id: 'switch',
  name: 'Switch',
  description: 'An on/off toggle. The knob slides across and the track changes colour.',
  howToUse:
    'The file has two named parts (markers): “turn on” and “turn off”. In your app, play “turn on” when it’s tapped on and “turn off” when it’s tapped off. The preview plays both in a row.',
  settings: [
    { id: 'on', label: 'Colour when on', kind: 'color', default: '#34c759' },
    { id: 'off', label: 'Colour when off', kind: 'color', default: '#5b5b66' },
    { id: 'knob', label: 'Knob colour', kind: 'color', default: '#ffffff' },
    { id: 'speed', label: 'One flip takes', kind: 'number', min: 0.15, max: 1, step: 0.05, default: 0.3, unit: 's' },
    { id: 'squish', label: 'Knob stretches as it slides', kind: 'toggle', default: true },
  ],
  build(v, name) {
    const flip = Math.max(3, Math.round(num(v, 'speed', 0.3) * FRAME_RATE));
    const W = 220, H = 120, trackW = 200, trackH = 100, knob = 84;
    const offX = (W - trackW) / 2 + trackH / 2;
    const onX = W - offX;
    const on = rgba(str(v, 'on', '#34c759'));
    const off = rgba(str(v, 'off', '#5b5b66'));
    const mid = Math.round(flip / 2);
    const stretch = bool(v, 'squish', true) ? 125 : 100; // knob width, in %, halfway through a flip
    const knobGroup = group('Knob', [ellipse(0, 0, knob), fill(str(v, 'knob', '#ffffff'))], {
      p: eased([
        { t: 0, v: [offX, H / 2] },
        { t: flip, v: [onX, H / 2] },
        { t: flip * 2, v: [offX, H / 2] },
      ]),
      s: eased([
        { t: 0, v: [100, 100] },
        { t: mid, v: [stretch, 100] },
        { t: flip, v: [100, 100] },
        { t: flip + mid, v: [stretch, 100] },
        { t: flip * 2, v: [100, 100] },
      ]),
    });
    const track = group('Track', [
      rect(W / 2, H / 2, trackW, trackH, trackH / 2),
      fill(eased([
        { t: 0, v: off },
        { t: flip, v: on },
        { t: flip * 2, v: off },
      ])),
    ]);
    return file(name, W, H, flip * 2, [knobGroup, track], {}, [
      { tm: 0, cm: 'turn on', dr: flip },
      { tm: flip, cm: 'turn off', dr: flip },
    ]);
  },
};

const spinner: Template = {
  id: 'spinner',
  name: 'Loading spinner',
  description: 'A line that chases itself round a circle, growing and shrinking as it goes.',
  howToUse: 'Loop it for as long as something is loading.',
  settings: [
    { id: 'color', label: 'Colour', kind: 'color', default: '#f2c14e' },
    { id: 'thickness', label: 'Thickness', kind: 'number', min: 4, max: 24, step: 1, default: 12 },
    { id: 'track', label: 'Faint ring behind it', kind: 'toggle', default: true },
    { id: 'seconds', label: 'One lap takes', kind: 'number', min: 0.6, max: 3, step: 0.1, default: 1.4, unit: 's' },
  ],
  build(v, name) {
    const frames = Math.max(10, Math.round(num(v, 'seconds', 1.4) * FRAME_RATE));
    const half = Math.round(frames / 2);
    const S = 200, size = 140;
    const color = str(v, 'color', '#f2c14e');
    const width = num(v, 'thickness', 12);
    // First half: the front of the line races ahead (5% → 80%). Second half: the back catches up
    // (0% → 75%). That leaves the line where it started but 75% of the way round, so the whole layer
    // turns an extra 450° (75% of a lap + 450° = two full laps) and the loop joins up with no jump.
    const arc = group('Arc', [
      ellipse(0, 0, size),
      trim(
        eased([{ t: 0, v: [0] }, { t: half, v: [0] }, { t: frames, v: [75] }]),
        eased([{ t: 0, v: [5] }, { t: half, v: [80] }, { t: frames, v: [80] }]),
      ),
      line(color, width),
    ]);
    const groups = bool(v, 'track', true) ? [arc, group('Track', [ellipse(0, 0, size), line(color, width, 18)])] : [arc];
    return file(name, S, S, frames, groups, {
      p: fixed([S / 2, S / 2, 0]),
      r: linear([{ t: 0, v: [-90] }, { t: frames, v: [360] }]), // -90: start at the top, like a clock
    });
  },
};

const successCheck: Template = {
  id: 'check',
  name: 'Success tick',
  description: 'A circle draws itself, then a tick. For “Saved!” or “Done”.',
  howToUse: 'Play it once when something succeeds. It ends on the finished tick, so set your app not to loop it.',
  settings: [
    {
      id: 'style',
      label: 'Style',
      kind: 'choice',
      options: [
        { value: 'ring', label: 'Line circle' },
        { value: 'filled', label: 'Filled circle' },
      ],
      default: 'filled',
    },
    { id: 'color', label: 'Colour', kind: 'color', default: '#34c759' },
    { id: 'tick', label: 'Tick colour (filled style)', kind: 'color', default: '#ffffff' },
    { id: 'thickness', label: 'Line thickness', kind: 'number', min: 4, max: 20, step: 1, default: 10 },
    { id: 'seconds', label: 'Whole thing takes', kind: 'number', min: 0.6, max: 3, step: 0.1, default: 1.2, unit: 's' },
  ],
  build(v, name) {
    const frames = Math.max(12, Math.round(num(v, 'seconds', 1.2) * FRAME_RATE));
    const at = (share: number) => Math.round(frames * share);
    const S = 200, size = 150;
    const color = str(v, 'color', '#34c759');
    const width = num(v, 'thickness', 10);
    const filled = str(v, 'style', 'filled') === 'filled';
    const tickPoints = [[-36, 2], [-12, 26], [38, -24]];
    const tick = group('Tick', [
      straightPath(tickPoints),
      trim(fixed(0), eased([{ t: 0, v: [0] }, { t: at(0.35), v: [0] }, { t: at(0.7), v: [100] }])),
      line(filled ? str(v, 'tick', '#ffffff') : color, width),
    ], { p: fixed([S / 2, S / 2]) });
    const circle = filled
      ? group('Circle', [ellipse(0, 0, size), fill(color)], {
          p: fixed([S / 2, S / 2]),
          // Pops in: grows a little too big, then settles.
          s: eased([{ t: 0, v: [0, 0] }, { t: at(0.3), v: [110, 110] }, { t: at(0.42), v: [100, 100] }]),
        })
      : group('Circle', [
          ellipse(0, 0, size),
          trim(fixed(0), eased([{ t: 0, v: [0] }, { t: at(0.4), v: [100] }])),
          line(color, width),
        ], { p: fixed([S / 2, S / 2]), r: fixed(-90) });
    return file(name, S, S, frames, [tick, circle]);
  },
};

const SIZES: Record<string, [number, number]> = { wide: [1920, 1080], tall: [1080, 1920], square: [1080, 1080] };

const background: Template = {
  id: 'background',
  name: 'Background',
  description: 'Soft blobs of colour drifting slowly over a base colour. For behind a page or a login screen.',
  howToUse: 'Loop it behind your content, stretched to cover the screen.',
  settings: [
    {
      id: 'size',
      label: 'Shape',
      kind: 'choice',
      options: [
        { value: 'wide', label: 'Wide (1920 × 1080)' },
        { value: 'tall', label: 'Tall, for phones (1080 × 1920)' },
        { value: 'square', label: 'Square (1080 × 1080)' },
      ],
      default: 'wide',
    },
    { id: 'base', label: 'Base colour', kind: 'color', default: '#14101f' },
    { id: 'blob1', label: 'Blob 1', kind: 'color', default: '#7c3aed' },
    { id: 'blob2', label: 'Blob 2', kind: 'color', default: '#f2c14e' },
    { id: 'blob3', label: 'Blob 3', kind: 'color', default: '#0ea5e9' },
    { id: 'drift', label: 'How far they drift', kind: 'number', min: 0.1, max: 1, step: 0.05, default: 0.5 },
    { id: 'seconds', label: 'One loop takes', kind: 'number', min: 4, max: 20, step: 1, default: 10, unit: 's' },
  ],
  build(v, name) {
    const [W, H] = SIZES[str(v, 'size', 'wide')] ?? SIZES.wide;
    const frames = Math.round(num(v, 'seconds', 10) * FRAME_RATE);
    const drift = num(v, 'drift', 0.5);
    const D = Math.max(W, H) * 0.75; // blob size
    // Where each blob sits, and how it wanders: whole numbers of laps per loop so the loop joins up.
    const blobs = [
      { id: 'blob1', x: 0.25, y: 0.3, lapsX: 1, lapsY: 1, phase: 0 },
      { id: 'blob2', x: 0.75, y: 0.45, lapsX: 1, lapsY: 2, phase: 0.33 },
      { id: 'blob3', x: 0.45, y: 0.85, lapsX: 2, lapsY: 1, phase: 0.66 },
    ];
    const TAU = 2 * Math.PI;
    const groups = blobs.map((b) => {
      const c = hexToRgb(str(v, b.id, '#ffffff'));
      return group(b.id, [
        ellipse(0, 0, D),
        {
          ty: 'gf', // circular gradient: solid colour in the middle, fading to see-through at the edge
          t: 2,
          s: fixed([0, 0]),
          e: fixed([D / 2, 0]),
          h: fixed(0),
          a: fixed(0),
          g: { p: 2, k: fixed([0, ...c, 1, ...c, 0, 0.8, 1, 0]) },
          o: fixed(100),
          r: 1,
        },
      ], {
        p: sampled(frames, 3, (t) => [
          W * b.x + W * 0.2 * drift * Math.sin(TAU * (b.lapsX * t + b.phase)),
          H * b.y + H * 0.2 * drift * Math.cos(TAU * (b.lapsY * t + b.phase)),
        ]),
        s: sampled(frames, 3, (t) => {
          const k = 100 + 15 * drift * Math.sin(TAU * (t + b.phase));
          return [k, k];
        }),
      });
    });
    const base = group('Base', [rect(W / 2, H / 2, W, H, 0), fill(str(v, 'base', '#14101f'))]);
    return file(name, W, H, frames, [...groups, base]);
  },
};

export const TEMPLATES: readonly Template[] = [toggleSwitch, spinner, successCheck, background];
