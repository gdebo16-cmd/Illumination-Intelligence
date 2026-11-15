// Halo's templates: ready-made animations for everyday uses (a switch, a loading spinner, a success
// tick, a moving background). Each one is a recipe: it takes a few settings (colours, speed, size)
// and builds the whole Lottie file itself, because these need things the shape maker can't do:
// several parts, colour changes, lines that draw themselves, or a wide canvas.
//
// Every template is made of named parts (the switch's Knob and Track, say). Each part gets the same
// layer options, applied in part() below: show or hide, see-through-ness, shading and an outline.
//
// Lottie words used below:
// - "rc" / "el" / "sh": a rounded rectangle, an ellipse, a free path.
// - "fl" / "gf": a fill, a gradient fill. "st" / "gs": a line (stroke), a gradient line.
// - "tm": trim. Shows only part of a line (start % to end %); animating it makes a line draw itself.
// - "gr" + "tr": a group of parts, and the group's own position/size/turn/opacity (which can animate).
// - markers: named bookmarks in the timeline ("turn on" = frames 0–15) that apps can play.

import { FRAME_RATE } from '@/config/halo';
import { hexToRgb, round } from './lottie';

// ---------- Settings ----------

export type TemplateSetting = (
  | { id: string; label: string; kind: 'color'; default: string }
  | { id: string; label: string; kind: 'number'; min: number; max: number; step: number; default: number; unit?: string }
  | { id: string; label: string; kind: 'toggle'; default: boolean }
  | { id: string; label: string; kind: 'choice'; options: { value: string; label: string }[]; default: string }
) & {
  /** Only shown when this says so (a setting that only matters for one style, say). Shown always if left out. */
  when?: (v: TemplateValues) => boolean;
};

export type TemplateValues = Record<string, string | number | boolean>;

/** The options every part of a template has. */
export interface LayerOptions {
  visible: boolean;
  /** 0 to 100: how solid it is. */
  opacity: number;
  /** Shading: the part's colour blends into this one from top to bottom. null = flat. */
  shade: string | null;
  /** A line round the part. null = none. */
  outline: { color: string; width: number } | null;
}
export type TemplateLayers = Record<string, LayerOptions>;
export const DEFAULT_LAYER: LayerOptions = { visible: true, opacity: 100, shade: null, outline: null };

export interface TemplatePart {
  id: string;
  name: string;
  /** Whether shading and an outline make sense for this part (a soft blob has no edge to outline). */
  canShade: boolean;
  canOutline: boolean;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  /** Shown under the settings: how to use the file in an app. */
  howToUse: string;
  settings: TemplateSetting[];
  /** Listed top to bottom, the way they're stacked. Can depend on the settings (each style has its own parts). */
  parts: TemplatePart[] | ((v: TemplateValues) => TemplatePart[]);
  build: (v: TemplateValues, name: string, layers: TemplateLayers) => object;
}

export const defaultValues = (t: Template): TemplateValues =>
  Object.fromEntries(t.settings.map((s) => [s.id, s.default]));

/** A template's parts for these settings. */
export const partsOf = (t: Template, v: TemplateValues): TemplatePart[] =>
  typeof t.parts === 'function' ? t.parts({ ...defaultValues(t), ...v }) : t.parts;

/** Whether a setting should be shown for these settings. */
export const settingShown = (t: Template, s: TemplateSetting, v: TemplateValues) =>
  !s.when || s.when({ ...defaultValues(t), ...v });

// Read one setting, falling back to its default if it's missing or the wrong kind.
const num = (v: TemplateValues, id: string, fallback: number) => (typeof v[id] === 'number' ? (v[id] as number) : fallback);
const str = (v: TemplateValues, id: string, fallback: string) => (typeof v[id] === 'string' ? (v[id] as string) : fallback);
const bool = (v: TemplateValues, id: string, fallback: boolean) => (typeof v[id] === 'boolean' ? (v[id] as boolean) : fallback);

// ---------- Lottie pieces ----------

const fixed = <T,>(k: T) => ({ a: 0, k });
const rgba = (hex: string, alpha = 1) => [...hexToRgb(hex), alpha];

type Key = { t: number; v: number[] };
// Fresh objects every time: the lottie-web player edits what it's given, so nothing may be shared.
const EASE = () => ({ o: { x: [0.4], y: [0] }, i: { x: [0.2], y: [1] } });
const STEADY = () => ({ o: { x: [0], y: [0] }, i: { x: [1], y: [1] } });
/** Keyframes that ease in and out (slow, fast, slow), like real things moving. */
const eased = (keys: Key[]) => ({ a: 1, k: keys.map((key, n) => (n === keys.length - 1 ? { t: key.t, s: key.v } : { t: key.t, s: key.v, ...EASE() })) });
/** Keyframes at a steady speed. */
const linear = (keys: Key[]) => ({ a: 1, k: keys.map((key, n) => (n === keys.length - 1 ? { t: key.t, s: key.v } : { t: key.t, s: key.v, ...STEADY() })) });
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
const trim = (start: object, end: object) => ({ ty: 'tm', s: start, e: end, o: fixed(0), m: 1 });

/** A colour that stays put ("#rrggbb"), or one that changes over time (keyframes of "#rrggbb"). */
type Colour = string | { t: number; hex: string }[];
const colourProp = (c: Colour) => (typeof c === 'string' ? fixed(rgba(c)) : eased(c.map((k) => ({ t: k.t, v: rgba(k.hex) }))));
/** Two-colour blend from `top` to `bottom`; follows `top` if that one changes over time. */
const blendProp = (top: Colour, bottom: string) => {
  const stops = (hex: string) => [0, ...hexToRgb(hex), 1, ...hexToRgb(bottom)];
  return { p: 2, k: typeof top === 'string' ? fixed(stops(top)) : eased(top.map((k) => ({ t: k.t, v: stops(k.hex) }))) };
};
const ROUND = { lc: 2, lj: 2 }; // round line ends and corners

/** How a part is painted: filled in, or drawn as a line. */
type Paint =
  | { kind: 'fill'; color: Colour }
  | { kind: 'line'; color: Colour; width: number; alpha?: number }
  /** Two colours side by side (first, second, first), between points s and e (which can move). */
  | { kind: 'gradient'; colors: [string, string]; s: object; e: object };

/** Like eased(), but drops any keyframe that isn't later than the one before (short animations can round two to the same frame). */
const easedU = (keys: Key[]) => eased(keys.filter((k, n) => n === 0 || k.t > keys[n - 1].t));
/** Slow, fast, slow, for a share of the way (0–1). */
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** Smooth curve handles through a row of points (each handle points from the point before to the one after). Ends get none. */
function smoothHandles(points: number[][]) {
  return points.map((_, n) => {
    const prev = points[n - 1], next = points[n + 1];
    return prev && next ? [(next[0] - prev[0]) / 6, (next[1] - prev[1]) / 6] : [0, 0];
  });
}
/** A closed shape: a smooth top edge left to right, then a smooth bottom edge back. The corners where they meet stay sharp. */
function ribbon(top: number[][], bottom: number[][]) {
  const o = [...smoothHandles(top), ...smoothHandles(bottom)].map((h) => h.map(round));
  return { c: true, v: [...top, ...bottom].map((p) => p.map(round)), i: o.map(([x, y]) => [-x, -y]), o };
}

interface PartSpec {
  id: string;
  shapes: object[];
  paint: Paint;
  /** Where shading runs from (its top) and to (its bottom), in the part's own coordinates. */
  shadeFrom: number[];
  shadeTo: number[];
  /** Goes between the shapes and the paint (a trim, for lines that draw themselves). */
  trim?: object;
  p?: object;
  s?: object;
  r?: object;
  /** See-through-ness over time (0–100 keyframes); the layer's Solid setting scales it. */
  fade?: { t: number; v: number }[];
}

const clampOpacity = (n: number) => Math.max(0, Math.min(100, n));
const optionsFor = (id: string, layers: TemplateLayers): LayerOptions => ({ ...DEFAULT_LAYER, ...layers[id] });

/** A group's own position/size/turn/opacity. */
function transform(t: { p?: object; s?: object; r?: object; o?: object }) {
  return { ty: 'tr', p: t.p ?? fixed([0, 0]), a: fixed([0, 0]), s: t.s ?? fixed([100, 100]), r: t.r ?? fixed(0), o: t.o ?? fixed(100), sk: fixed(0), sa: fixed(0) };
}

/** The paint for a part (fill or line), with its shading and outline options. Earlier items draw on top. */
function paints(paint: Paint, opts: LayerOptions, shadeFrom: number[], shadeTo: number[]) {
  const ends = { s: fixed(shadeFrom), e: fixed(shadeTo), t: 1 };
  const [c1, c2] = paint.kind === 'gradient' ? paint.colors.map(hexToRgb) : [[], []];
  const main =
    paint.kind === 'gradient'
      ? { ty: 'gf', t: 1, s: paint.s, e: paint.e, g: { p: 3, k: fixed([0, ...c1, 0.5, ...c2, 1, ...c1]) }, o: fixed(100), r: 1 }
      : paint.kind === 'fill'
      ? opts.shade
        ? { ty: 'gf', ...ends, g: blendProp(paint.color, opts.shade), o: fixed(100), r: 1 }
        : { ty: 'fl', c: colourProp(paint.color), o: fixed(100), r: 1 }
      : opts.shade
        ? { ty: 'gs', ...ends, g: blendProp(paint.color, opts.shade), o: fixed(paint.alpha ?? 100), w: fixed(paint.width), ...ROUND }
        : { ty: 'st', c: colourProp(paint.color), o: fixed(paint.alpha ?? 100), w: fixed(paint.width), ...ROUND };
  // Earlier items are drawn on top. A filled part's outline sits on top of its edge; a line's outline
  // is a wider line underneath, so it shows on both sides.
  const outline = opts.outline
    ? { ty: 'st', c: fixed(rgba(opts.outline.color)), o: fixed(100), w: fixed(paint.kind === 'line' ? paint.width + opts.outline.width * 2 : opts.outline.width), ...ROUND }
    : null;
  return (paint.kind === 'line' ? [main, outline] : [outline, main]).filter(Boolean) as object[];
}

/** One part, with its layer options applied. null if it's hidden. */
function part(spec: PartSpec, layers: TemplateLayers) {
  const opts = optionsFor(spec.id, layers);
  if (!opts.visible) return null;
  const solid = clampOpacity(opts.opacity);
  return {
    ty: 'gr',
    nm: spec.id,
    it: [
      ...spec.shapes,
      ...(spec.trim ? [spec.trim] : []),
      ...paints(spec.paint, opts, spec.shadeFrom, spec.shadeTo),
      transform({
        p: spec.p,
        s: spec.s,
        r: spec.r,
        o: spec.fade ? eased(spec.fade.map((k) => ({ t: k.t, v: [round((k.v * solid) / 100)] }))) : fixed(solid),
      }),
    ],
  };
}

interface LayerMotion { p?: object; r?: object }
function file(name: string, w: number, h: number, frames: number, groups: (object | null)[], motion: LayerMotion = {}, markers: object[] = [], fps = FRAME_RATE) {
  return {
    v: '5.7.4',
    nm: name,
    fr: fps,
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
          a: fixed([0, 0, 0]),
          s: fixed([100, 100, 100]),
        },
        ao: 0,
        shapes: groups.filter(Boolean),
        ip: 0,
        op: frames,
        st: 0,
        bm: 0,
      },
    ],
  };
}

const solidPart = (id: string, name: string): TemplatePart => ({ id, name, canShade: true, canOutline: true });

// ---------- The templates ----------

const toggleSwitch: Template = {
  id: 'switch',
  name: 'Switch',
  description: 'An on/off toggle. The knob slides across and the track changes colour. Styles: plain, day and night (sun to moon), tick and cross, or a squishy bounce.',
  howToUse:
    'The file has two named parts (markers): “turn on” and “turn off”. In your app, play “turn on” when it’s tapped on and “turn off” when it’s tapped off. The preview plays both in a row.',
  settings: [
    {
      id: 'style',
      label: 'Style',
      kind: 'choice',
      options: [
        { value: 'plain', label: 'Plain' },
        { value: 'daynight', label: 'Day and night (sun → moon)' },
        { value: 'icons', label: 'Tick and cross in the knob' },
        { value: 'bouncy', label: 'Squishy bounce' },
      ],
      default: 'plain',
    },
    {
      id: 'shape',
      label: 'Shape',
      kind: 'choice',
      options: [
        { value: 'pill', label: 'Pill (round knob)' },
        { value: 'rounded', label: 'Rounded square' },
        { value: 'square', label: 'Square' },
        { value: 'slim', label: 'Slim track, big knob' },
      ],
      default: 'pill',
    },
    { id: 'on', label: 'Colour when on', kind: 'color', default: '#34c759', when: (v) => v.style !== 'daynight' },
    { id: 'off', label: 'Colour when off', kind: 'color', default: '#5b5b66', when: (v) => v.style !== 'daynight' },
    { id: 'knob', label: 'Knob colour', kind: 'color', default: '#ffffff', when: (v) => v.style !== 'daynight' },
    { id: 'day', label: 'Day sky (off)', kind: 'color', default: '#6ec3f4', when: (v) => v.style === 'daynight' },
    { id: 'night', label: 'Night sky (on)', kind: 'color', default: '#1f2452', when: (v) => v.style === 'daynight' },
    { id: 'sun', label: 'Sun', kind: 'color', default: '#ffd23f', when: (v) => v.style === 'daynight' },
    { id: 'moon', label: 'Moon', kind: 'color', default: '#eef0f7', when: (v) => v.style === 'daynight' },
    { id: 'speed', label: 'One flip takes', kind: 'number', min: 0.15, max: 1, step: 0.05, default: 0.3, unit: 's' },
    { id: 'squish', label: 'Knob stretches as it slides', kind: 'toggle', default: true, when: (v) => v.style !== 'bouncy' },
  ],
  parts: (v) =>
    v.style === 'daynight'
      ? [{ id: 'stars', name: 'Stars', canShade: false, canOutline: false }, solidPart('knob', 'Sun / moon'), solidPart('track', 'Sky (track)')]
      : v.style === 'icons'
        ? [solidPart('icon', 'Tick and cross'), solidPart('knob', 'Knob'), solidPart('track', 'Track')]
        : [solidPart('knob', 'Knob'), solidPart('track', 'Track')],
  build(v, name, layers) {
    const style = str(v, 'style', 'plain');
    const flip = Math.max(6, Math.round(num(v, 'speed', 0.3) * FRAME_RATE));
    const at = (share: number) => Math.round(flip * share);
    const W = 220, H = 120, trackW = 200;
    // Each shape: how tall the track is, how big the knob is, and how round their corners are
    // (null = a circle). The knob's resting spot is worked out so it sits inside the track's end.
    const shapes: Record<string, { trackH: number; trackR: number; knob: number; knobR: number | null }> = {
      pill: { trackH: 100, trackR: 50, knob: 84, knobR: null },
      rounded: { trackH: 100, trackR: 24, knob: 80, knobR: 16 },
      square: { trackH: 100, trackR: 4, knob: 80, knobR: 2 },
      slim: { trackH: 52, trackR: 26, knob: 100, knobR: null },
    };
    const { trackH, trackR, knob, knobR } = shapes[str(v, 'shape', 'pill')] ?? shapes.pill;
    const offX = (W - trackW) / 2 + Math.max(trackH, knob) / 2 - (knob > trackH ? 10 : 0);
    const onX = W - offX;
    const daynight = style === 'daynight';
    const on = daynight ? str(v, 'night', '#1f2452') : str(v, 'on', '#34c759');
    const off = daynight ? str(v, 'day', '#6ec3f4') : str(v, 'off', '#5b5b66');
    const sky: Colour = [{ t: 0, hex: off }, { t: flip, hex: on }, { t: flip * 2, hex: off }];
    const mid = Math.round(flip / 2);
    const bouncy = style === 'bouncy';
    const stretch = bool(v, 'squish', true) ? 125 : 100; // knob width, in %, halfway through a flip
    const y = H / 2;

    // Where the knob is. Bouncy overshoots the end and wobbles back. A function: each part needs its own copy.
    const slide = () =>
      bouncy
        ? easedU([
            { t: 0, v: [offX, y] },
            { t: at(0.6), v: [onX + 10, y] },
            { t: at(0.8), v: [onX - 4, y] },
            { t: flip, v: [onX, y] },
            { t: flip + at(0.6), v: [offX - 10, y] },
            { t: flip + at(0.8), v: [offX + 4, y] },
            { t: flip * 2, v: [offX, y] },
          ])
        : eased([{ t: 0, v: [offX, y] }, { t: flip, v: [onX, y] }, { t: flip * 2, v: [offX, y] }]);
    // Its shape as it goes: stretched while sliding, or (bouncy) squashed flat when it hits the end.
    const squash = () =>
      bouncy
        ? easedU([
            { t: 0, v: [100, 100] },
            { t: at(0.6), v: [80, 116] },
            { t: at(0.8), v: [110, 93] },
            { t: flip, v: [100, 100] },
            { t: flip + at(0.6), v: [80, 116] },
            { t: flip + at(0.8), v: [110, 93] },
            { t: flip * 2, v: [100, 100] },
          ])
        : eased([
            { t: 0, v: [100, 100] },
            { t: mid, v: [stretch, 100] },
            { t: flip, v: [100, 100] },
            { t: flip + mid, v: [stretch, 100] },
            { t: flip * 2, v: [100, 100] },
          ]);

    const knobPart = part({
      id: 'knob',
      shapes: [knobR === null ? ellipse(0, 0, knob) : rect(0, 0, knob, knob, knobR)],
      paint: {
        kind: 'fill',
        color: daynight
          ? [{ t: 0, hex: str(v, 'sun', '#ffd23f') }, { t: flip, hex: str(v, 'moon', '#eef0f7') }, { t: flip * 2, hex: str(v, 'sun', '#ffd23f') }]
          : str(v, 'knob', '#ffffff'),
      },
      shadeFrom: [0, -knob / 2],
      shadeTo: [0, knob / 2],
      p: slide(),
      s: squash(),
    }, layers);
    const trackPart = part({
      id: 'track',
      shapes: [rect(W / 2, H / 2, trackW, trackH, trackR)],
      paint: { kind: 'fill', color: sky },
      shadeFrom: [0, (H - trackH) / 2],
      shadeTo: [0, (H + trackH) / 2],
    }, layers);

    const extras: (object | null)[] = [];
    if (daynight) {
      // The moon: a circle the colour of the sky grows over the top-right of the knob, leaving a crescent.
      const knobOpts = optionsFor('knob', layers);
      if (knobOpts.visible)
        extras.push({
          ty: 'gr',
          nm: 'moon bite',
          it: [
            {
              ty: 'gr',
              it: [
                ellipse(0, 0, knob * 0.8),
                { ty: 'fl', c: colourProp(sky), o: fixed(100), r: 1 },
                transform({
                  p: fixed([round(knob * 0.3), round(-knob * 0.22)]),
                  s: eased([{ t: 0, v: [0, 0] }, { t: mid, v: [0, 0] }, { t: flip, v: [100, 100] }, { t: flip + mid, v: [0, 0] }, { t: flip * 2, v: [0, 0] }]),
                }),
              ],
            },
            transform({ p: slide(), o: fixed(clampOpacity(knobOpts.opacity)) }),
          ],
        });
      // Three little stars come out on the left of the track at night.
      const spots = [[-0.36, -0.2], [-0.12, 0.22], [0.02, -0.12]];
      extras.unshift(
        colourGroup(
          'stars',
          spots.map(([dx, dy], n): Piece => ({
            shapes: [{ ty: 'sr', sy: 1, d: 1, pt: fixed(4), p: fixed([0, 0]), r: fixed(0), ir: fixed(n === 1 ? 2 : 3), is: fixed(0), or: fixed(n === 1 ? 6 : 9), os: fixed(0) }],
            paint: { kind: 'fill', color: '#ffffff' },
            size: 16,
            p: fixed([round(W / 2 + dx * trackW), round(y + dy * trackH)]),
            o: eased([{ t: 0, v: [0] }, { t: mid, v: [0] }, { t: flip, v: [100] }, { t: flip + mid, v: [0] }, { t: flip * 2, v: [0] }]),
          })),
          layers,
        ),
      );
    }
    if (style === 'icons') {
      // A tick draws itself in the knob as it turns on; a cross draws itself as it turns off.
      const k = knob / 84;
      const pts = (a: number[][]) => a.map(([px, py]) => [round(px * k), round(py * k)]);
      const icon = (paths: number[][][], color: string, ends: Key[]) =>
        part({
          id: 'icon',
          shapes: paths.map((p) => straightPath(pts(p))),
          trim: trim(fixed(0), easedU(ends)),
          paint: { kind: 'line', color, width: round(7 * k) },
          shadeFrom: [0, -12 * k],
          shadeTo: [0, 12 * k],
          p: slide(),
        }, layers);
      extras.push(
        icon([[[-14, 1], [-4, 11], [15, -10]]], on, [{ t: 0, v: [0] }, { t: mid, v: [0] }, { t: flip, v: [100] }, { t: flip + mid, v: [0] }, { t: flip * 2, v: [0] }]),
        icon([[[-10, -10], [10, 10]], [[10, -10], [-10, 10]]], off, [{ t: 0, v: [100] }, { t: mid, v: [0] }, { t: flip + mid, v: [0] }, { t: flip * 2, v: [100] }]),
      );
    }
    return file(name, W, H, flip * 2, [...extras, knobPart, trackPart], {}, [
      { tm: 0, cm: 'turn on', dr: flip },
      { tm: flip, cm: 'turn off', dr: flip },
    ]);
  },
};

const SPINNER_STYLES = [
  { value: 'arc', label: 'Chasing line' },
  { value: 'bounce', label: 'Bouncing dots' },
  { value: 'pulse', label: 'Pulsing dots in a circle' },
  { value: 'bars', label: 'Bars (like an equaliser)' },
  { value: 'orbit', label: 'Orbiting dots' },
];

const spinner: Template = {
  id: 'spinner',
  name: 'Loading spinner',
  description: 'Something that moves for as long as a thing is loading: a line chasing itself round a circle, bouncing dots, pulsing dots, equaliser bars, or orbiting dots.',
  howToUse: 'Loop it for as long as something is loading.',
  settings: [
    { id: 'style', label: 'Style', kind: 'choice', options: SPINNER_STYLES, default: 'arc' },
    { id: 'color', label: 'Colour', kind: 'color', default: '#f2c14e' },
    { id: 'thickness', label: 'Thickness', kind: 'number', min: 4, max: 24, step: 1, default: 12, when: (v) => v.style === 'arc' },
    { id: 'seconds', label: 'One loop takes', kind: 'number', min: 0.6, max: 3, step: 0.1, default: 1.4, unit: 's' },
  ],
  parts: (v) =>
    v.style === 'arc'
      ? [solidPart('arc', 'Arc'), solidPart('ring', 'Faint ring')]
      : [solidPart('dots', v.style === 'bars' ? 'Bars' : 'Dots')],
  build(v, name, layers) {
    const frames = Math.max(18, Math.round(num(v, 'seconds', 1.4) * FRAME_RATE));
    const at = (share: number) => Math.round(frames * share);
    const S = 200, c = S / 2;
    const color = str(v, 'color', '#f2c14e');
    const style = str(v, 'style', 'arc');
    const dot = (size: number, extra: Partial<Piece>): Piece => ({ shapes: [ellipse(0, 0, size)], paint: { kind: 'fill', color }, size, ...extra });
    /** 1 at the top of its wave, 0 at the bottom, `delay` of a loop behind the first one. */
    const wave = (t: number, delay: number) => 0.5 + 0.5 * Math.cos(TAU * (t - delay));

    if (style === 'arc') {
      const size = 140;
      const width = num(v, 'thickness', 12);
      const ends = { shadeFrom: [0, -size / 2], shadeTo: [0, size / 2] };
      const half = Math.round(frames / 2);
      // First half: the front of the line races ahead (5% → 80%). Second half: the back catches up
      // (0% → 75%). That leaves the line where it started but 75% of the way round, so the whole layer
      // turns an extra 450° (75% of a lap + 450° = two full laps) and the loop joins up with no jump.
      const arc = part({
        id: 'arc',
        shapes: [ellipse(0, 0, size)],
        trim: trim(
          eased([{ t: 0, v: [0] }, { t: half, v: [0] }, { t: frames, v: [75] }]),
          eased([{ t: 0, v: [5] }, { t: half, v: [80] }, { t: frames, v: [80] }]),
        ),
        paint: { kind: 'line', color, width },
        ...ends,
      }, layers);
      const ring = part({ id: 'ring', shapes: [ellipse(0, 0, size)], paint: { kind: 'line', color, width, alpha: 18 }, ...ends }, layers);
      return file(name, S, S, frames, [arc, ring], {
        p: fixed([c, c, 0]),
        r: linear([{ t: 0, v: [-90] }, { t: frames, v: [360] }]), // -90: start at the top, like a clock
      });
    }

    let pieces: Piece[];
    if (style === 'bounce') {
      // Three dots hop one after another, then all rest.
      pieces = [0, 1, 2].map((n) => {
        const x = c + (n - 1) * 40, d = n * 0.12;
        return dot(26, {
          p: easedU([{ t: 0, v: [x, c] }, { t: at(d), v: [x, c] }, { t: at(d + 0.2), v: [x, c - 34] }, { t: at(d + 0.4), v: [x, c] }, { t: frames, v: [x, c] }]),
        });
      });
    } else if (style === 'pulse') {
      // Eight dots round a circle; a wave of "bigger and brighter" runs round them.
      pieces = Array.from({ length: 8 }, (_, n) => {
        const a = (n / 8) * TAU - TAU / 4;
        return dot(22, {
          p: fixed([round(c + 58 * Math.cos(a)), round(c + 58 * Math.sin(a))]),
          s: sampled(frames, 2, (t) => { const k = 45 + 55 * wave(t, n / 8); return [k, k]; }),
          o: sampled(frames, 2, (t) => [25 + 75 * wave(t, n / 8)]),
        });
      });
    } else if (style === 'bars') {
      // Five bars grow and shrink from their middles, each a little behind the one before.
      pieces = Array.from({ length: 5 }, (_, n) => ({
        shapes: [rect(0, 0, 18, 90, 9)],
        paint: { kind: 'fill', color } as Paint,
        size: 90,
        p: fixed([c + (n - 2) * 28, c]),
        s: sampled(frames, 2, (t) => [100, 30 + 70 * wave(t, n * 0.12)]),
      }));
    } else {
      // Four dots, big to small, race round a circle: they bunch up as they speed through, spread out as they slow.
      pieces = [24, 19, 14, 10].map((size, n) =>
        dot(size, {
          p: sampled(frames, 1, (t) => {
            const u = t - n * 0.11;
            const a = TAU * (Math.floor(u) + easeInOut(u - Math.floor(u))) - TAU / 4;
            return [c + 60 * Math.cos(a), c + 60 * Math.sin(a)];
          }),
        }),
      );
    }
    return file(name, S, S, frames, [colourGroup('dots', pieces, layers)]);
  },
};

const ICONS = [
  { value: 'tick', label: 'Tick (success)' },
  { value: 'cross', label: 'Cross (error), with a shake' },
  { value: 'warning', label: 'Warning (triangle and !)' },
];

const successCheck: Template = {
  id: 'check',
  name: 'Success tick',
  description: 'A shape draws itself, then a symbol: a tick for “Done”, a cross for an error, or a warning sign. Can end with a burst of sparks.',
  howToUse: 'Play it once when something happens. It ends on the finished symbol, so set your app not to loop it.',
  settings: [
    { id: 'icon', label: 'Symbol', kind: 'choice', options: ICONS, default: 'tick' },
    {
      id: 'style',
      label: 'Style',
      kind: 'choice',
      options: [
        { value: 'ring', label: 'Line shape' },
        { value: 'filled', label: 'Filled shape' },
      ],
      default: 'filled',
    },
    { id: 'color', label: 'Colour', kind: 'color', default: '#34c759' },
    { id: 'tick', label: 'Symbol colour', kind: 'color', default: '#ffffff', when: (v) => v.style === 'filled' },
    { id: 'thickness', label: 'Line thickness', kind: 'number', min: 4, max: 20, step: 1, default: 10 },
    { id: 'burst', label: 'Sparks when it lands', kind: 'toggle', default: false },
    { id: 'sparks', label: 'Spark colour', kind: 'color', default: '#ffd23f', when: (v) => v.burst === true },
    { id: 'seconds', label: 'Whole thing takes', kind: 'number', min: 0.6, max: 3, step: 0.1, default: 1.2, unit: 's' },
  ],
  parts: (v) => [
    ...(v.burst ? [{ id: 'sparks', name: 'Sparks', canShade: false, canOutline: false }] : []),
    solidPart('tick', v.icon === 'cross' ? 'Cross' : v.icon === 'warning' ? 'Exclamation mark' : 'Tick'),
    solidPart('circle', v.icon === 'warning' ? 'Triangle' : 'Circle'),
  ],
  build(v, name, layers) {
    const frames = Math.max(18, Math.round(num(v, 'seconds', 1.2) * FRAME_RATE));
    const at = (share: number) => Math.round(frames * share);
    const burst = bool(v, 'burst', false);
    const S = burst ? 260 : 200, size = 150; // more room for the sparks
    const centre = () => fixed([S / 2, S / 2]);
    const color = str(v, 'color', '#34c759');
    const width = num(v, 'thickness', 10);
    const filled = str(v, 'style', 'filled') === 'filled';
    const icon = str(v, 'icon', 'tick');
    const symbolColour = filled ? str(v, 'tick', '#ffffff') : color;
    /** A line of the symbol that draws itself between two shares of the animation. */
    const stroke = (points: number[][], from: number, to: number) =>
      part({
        id: 'tick',
        shapes: [straightPath(points)],
        trim: trim(fixed(0), easedU([{ t: 0, v: [0] }, { t: at(from), v: [0] }, { t: at(to), v: [100] }])),
        paint: { kind: 'line', color: symbolColour, width },
        shadeFrom: [0, -30],
        shadeTo: [0, 30],
        p: centre(),
      }, layers);

    const symbol =
      icon === 'cross'
        ? [stroke([[-28, -28], [28, 28]], 0.35, 0.52), stroke([[28, -28], [-28, 28]], 0.52, 0.7)]
        : icon === 'warning'
          ? [
              stroke([[0, -24], [0, 10]], 0.35, 0.58),
              part({
                id: 'tick',
                shapes: [ellipse(0, 0, width * 1.5)],
                paint: { kind: 'fill', color: symbolColour },
                shadeFrom: [0, -width],
                shadeTo: [0, width],
                p: fixed([S / 2, S / 2 + 32]),
                s: easedU([{ t: 0, v: [0, 0] }, { t: at(0.58), v: [0, 0] }, { t: at(0.68), v: [130, 130] }, { t: at(0.75), v: [100, 100] }]),
              }, layers),
            ]
          : [stroke([[-36, 2], [-12, 26], [38, -24]], 0.35, 0.7)];

    // The shape behind: a circle, or (warning) a triangle with rounded corners.
    const triangle = icon === 'warning';
    const outlineShape = () =>
      triangle
        ? [{ ty: 'sh', ks: fixed({ c: true, v: [[0, -68], [74, 58], [-74, 58]], i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]] }) }, { ty: 'rd', r: fixed(14) }]
        : [ellipse(0, 0, size)];
    const container = filled
      ? part({
          id: 'circle',
          shapes: outlineShape(),
          paint: { kind: 'fill', color },
          shadeFrom: [0, -size / 2],
          shadeTo: [0, size / 2],
          p: centre(),
          // Pops in: grows a little too big, then settles.
          s: easedU([{ t: 0, v: [0, 0] }, { t: at(0.3), v: [110, 110] }, { t: at(0.42), v: [100, 100] }]),
        }, layers)
      : part({
          id: 'circle',
          shapes: outlineShape(),
          trim: trim(fixed(0), easedU([{ t: 0, v: [0] }, { t: at(0.4), v: [100] }])),
          paint: { kind: 'line', color, width },
          // A circle is turned -90° so it draws from the top, so "top to bottom" turns with it.
          shadeFrom: triangle ? [0, -68] : [size / 2, 0],
          shadeTo: triangle ? [0, 58] : [-size / 2, 0],
          p: centre(),
          r: fixed(triangle ? 0 : -90),
        }, layers);

    // Sparks fly out from the edge just as the symbol finishes.
    const sparkColour = str(v, 'sparks', '#ffd23f');
    const sparks = burst
      ? colourGroup(
          'sparks',
          Array.from({ length: 10 }, (_, n): Piece => {
            const a = (n / 10) * TAU - TAU / 4;
            const spot = (r: number) => [round(S / 2 + r * Math.cos(a)), round(S / 2 + r * Math.sin(a))];
            return {
              shapes: [ellipse(0, 0, n % 2 ? 10 : 14)],
              paint: { kind: 'fill', color: n % 2 ? color : sparkColour },
              size: 14,
              p: easedU([{ t: 0, v: spot(80) }, { t: at(0.62), v: spot(80) }, { t: at(0.95), v: spot(122) }, { t: frames, v: spot(122) }]),
              s: easedU([{ t: 0, v: [0, 0] }, { t: at(0.62), v: [0, 0] }, { t: at(0.7), v: [100, 100] }, { t: at(0.95), v: [0, 0] }, { t: frames, v: [0, 0] }]),
            };
          }),
          layers,
        )
      : null;

    // An error gives a quick "no" shake at the end.
    const shake =
      icon === 'cross'
        ? {
            p: easedU([
              { t: 0, v: [0, 0, 0] },
              { t: at(0.72), v: [0, 0, 0] },
              { t: at(0.78), v: [-9, 0, 0] },
              { t: at(0.84), v: [9, 0, 0] },
              { t: at(0.9), v: [-5, 0, 0] },
              { t: at(0.96), v: [0, 0, 0] },
              { t: frames, v: [0, 0, 0] },
            ]),
          }
        : {};
    return file(name, S, S, frames, [sparks, ...symbol, container], shake);
  },
};

const SIZES: Record<string, [number, number]> = { wide: [1920, 1080], tall: [1080, 1920], square: [1080, 1080] };
const COLOUR_IDS = ['blob1', 'blob2', 'blob3']; // the three colours (named for the first pattern, blobs)
const TAU = 2 * Math.PI;

/** The same "random" numbers every time, so a pattern doesn't reshuffle whenever a setting changes. */
function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
const between = (rand: () => number, lo: number, hi: number) => lo + (hi - lo) * rand();
const whole = (rand: () => number, lo: number, hi: number) => Math.floor(between(rand, lo, hi + 1));

/**
 * Up-and-down travel that wraps round: from `from` to `to`, `laps` times per loop, starting `phase`
 * (0–1) of the way along. At the end it jumps straight back to the start; both ends are off screen,
 * so nobody sees the jump. Only needs a few keyframes, because the travel is at a steady speed.
 */
function travel(frames: number, from: number, to: number, laps: number, phase: number) {
  const at = (share: number) => [0, round(from + (to - from) * share)];
  const k: object[] = [{ t: 0, s: at(phase), ...STEADY() }];
  for (let j = 1; j <= laps; j++) {
    const t = round(((j - phase) / laps) * frames); // when it reaches the end
    if (t <= 0 || t >= frames) continue;
    k.push({ t, s: at(1), h: 1 }); // "hold": stay at the end, then jump at the next keyframe
    k.push({ t: round(t + 0.01), s: at(0), ...STEADY() });
  }
  const last = (laps + phase) % 1;
  k.push({ t: frames, s: at(last === 0 ? 1 : last) });
  return { a: 1, k };
}

/** Swinging between two values `times` times per loop, easing at each end (like a pendulum). */
function swing(frames: number, low: number[], high: number[], times: number, startHigh = false) {
  const keys: Key[] = [];
  const steps = times * 2;
  for (let n = 0; n <= steps; n++) keys.push({ t: round((n / steps) * frames), v: (n % 2 === 0) === startHigh ? high : low });
  return eased(keys);
}

/** One small shape in a pattern (a bubble, a star), with its own motion. */
interface Piece {
  shapes: object[];
  paint: Paint;
  size: number;
  /** A faint fill inside a line (a bubble's soapy middle): how solid, 0–100. */
  wash?: number;
  /** Drawn on top, unpainted by the piece's own paint (a bubble's shine). */
  shine?: object;
  p?: object;
  s?: object;
  r?: object;
  o?: object;
  /** Side-to-side sway, in a wrapper group, so it adds to the up-and-down travel. */
  sway?: object;
  /** Where shading runs, if not top to bottom of `size` round the piece's middle. */
  shadeFrom?: number[];
  shadeTo?: number[];
}

function pieceGroup(pc: Piece, opts: LayerOptions) {
  const { paint } = pc;
  const body = {
    ty: 'gr',
    it: [
      ...pc.shapes,
      ...paints(paint, opts, pc.shadeFrom ?? [0, -pc.size / 2], pc.shadeTo ?? [0, pc.size / 2]),
      ...(pc.wash && paint.kind !== 'gradient' ? [{ ty: 'fl', c: colourProp(paint.color), o: fixed(pc.wash), r: 1 }] : []),
      transform({}),
    ],
  };
  const moving = { ty: 'gr', it: [...(pc.shine ? [pc.shine] : []), body, transform({ p: pc.p, s: pc.s, r: pc.r, o: pc.o })] };
  return pc.sway ? { ty: 'gr', it: [moving, transform({ p: pc.sway })] } : moving;
}

/** All the pieces in one colour, as one part (so its layer options apply to every one of them). */
function colourGroup(id: string, pieces: Piece[], layers: TemplateLayers) {
  const opts = optionsFor(id, layers);
  if (!opts.visible || !pieces.length) return null;
  return { ty: 'gr', nm: id, it: [...pieces.map((pc) => pieceGroup(pc, opts)), transform({ o: fixed(clampOpacity(opts.opacity)) })] };
}

const PATTERNS = [
  { value: 'blobs', label: 'Soft blobs' },
  { value: 'bubbles', label: 'Bubbles rising' },
  { value: 'stars', label: 'Twinkling stars' },
  { value: 'snow', label: 'Snow falling' },
  { value: 'confetti', label: 'Confetti falling' },
  { value: 'waves', label: 'Waves rolling' },
  { value: 'fireflies', label: 'Fireflies' },
  { value: 'rain', label: 'Rain' },
  { value: 'shapes', label: 'Floating shapes' },
  { value: 'aurora', label: 'Aurora ribbons' },
];
const PIECE_NAMES: Record<string, string> = {
  blobs: 'Blob', bubbles: 'Bubbles', stars: 'Stars', snow: 'Snow', confetti: 'Confetti',
  waves: 'Wave', fireflies: 'Fireflies', rain: 'Rain', shapes: 'Shapes', aurora: 'Ribbon',
};
/** Patterns made of one big thing per colour (so there's no "how many"), and those whose movement "drift" sets. */
const ONE_PER_COLOUR = ['blobs', 'waves', 'aurora'];

/** Waves: three rolling bands across the bottom, each a smooth wavy edge sliding sideways. */
function waves(v: TemplateValues, W: number, H: number, frames: number): Piece[][] {
  const drift = num(v, 'drift', 0.5);
  const unit = Math.min(W, H) / 1080;
  return [0, 1, 2].map((n) => {
    const period = W * (0.55 - n * 0.1); // one bump-and-dip
    const A = (20 + 40 * drift) * unit * (1 - n * 0.15); // how tall the bumps are
    const y0 = H * (0.82 - n * 0.13); // colour 1 is the front wave, lowest down
    const top: number[][] = [];
    // From one wave off the left edge to one off the right, a peak or dip every half wave.
    for (let x = -period, k = 0; x <= W + period + 1; x += period / 2, k++) top.push([x, y0 + (k % 2 ? A : -A)]);
    const bottom = [[W + period, H + 20], [-period, H + 20]];
    const laps = n + 1; // slides along this many whole waves per loop, so the loop joins up
    const way = n % 2 ? 1 : -1;
    return [{
      shapes: [{ ty: 'sh', ks: fixed(ribbon(top, bottom)) }],
      paint: { kind: 'fill', color: str(v, COLOUR_IDS[n], '#ffffff') },
      size: H,
      shadeFrom: [0, y0 - A],
      shadeTo: [0, H],
      p: linear([{ t: 0, v: [0, 0] }, { t: frames, v: [round(way * period * laps), 0] }]),
    }];
  });
}

/** Aurora: three soft ribbons of light that sway, fading out at their top and bottom edges. */
function aurora(v: TemplateValues, layers: TemplateLayers, W: number, H: number, frames: number) {
  const drift = num(v, 'drift', 0.5);
  return COLOUR_IDS.map((id, n) => {
    const opts = optionsFor(id, layers);
    if (!opts.visible) return null;
    const base = H * (0.18 + n * 0.14);
    const A = H * 0.07 * (0.5 + drift);
    const T = H * 0.24;
    const xs = Array.from({ length: 8 }, (_, k) => -0.1 * W + (k / 7) * 1.2 * W);
    // The ribbon at one moment (phase 0–1): a wavy top edge, and a bottom edge that waves a bit differently.
    const shape = (phase: number) => {
      const top = xs.map((x, k) => [x, base + A * Math.sin(TAU * (k / 5 + phase + n * 0.3))]);
      const bottom = [...xs].reverse().map((x, k) => {
        const kk = xs.length - 1 - k;
        return [x, top[kk][1] + T + A * 0.6 * Math.sin(TAU * (kk / 4 + phase * 2))];
      });
      return ribbon(top, bottom);
    };
    const c = hexToRgb(str(v, id, '#ffffff'));
    const solid = clampOpacity(opts.opacity);
    return {
      ty: 'gr',
      nm: id,
      it: [
        // Changing shape: from one ribbon to another and back (fresh objects each time).
        { ty: 'sh', ks: { a: 1, k: [{ t: 0, s: [shape(0)], ...EASE() }, { t: Math.round(frames / 2), s: [shape(0.5)], ...EASE() }, { t: frames, s: [shape(0)] }] } },
        {
          ty: 'gf',
          t: 1,
          s: fixed([0, round(base - A)]),
          e: fixed([0, round(base + T + A * 1.6)]),
          // colours, then see-through-ness: clear at the top, strongest in the middle, clear at the bottom
          g: { p: 3, k: fixed([0, ...c, 0.5, ...c, 1, ...c, 0, 0, 0.5, 0.75, 1, 0]) },
          o: fixed(100),
          r: 1,
        },
        transform({ o: swing(frames, [round(solid * 0.55)], [solid], 2, n % 2 === 0) }), // slowly brightening and dimming
      ],
    };
  });
}

/** The soft blobs: three big fuzzy circles wandering round. */
function blobs(v: TemplateValues, layers: TemplateLayers, W: number, H: number, frames: number) {
  const drift = num(v, 'drift', 0.5);
  const D = Math.max(W, H) * 0.75; // blob size
  // Where each blob sits, and how it wanders: whole numbers of laps per loop so the loop joins up.
  const spots = [
    { x: 0.25, y: 0.3, lapsX: 1, lapsY: 1, phase: 0 },
    { x: 0.75, y: 0.45, lapsX: 1, lapsY: 2, phase: 0.33 },
    { x: 0.45, y: 0.85, lapsX: 2, lapsY: 1, phase: 0.66 },
  ];
  return spots.map((b, n) => {
    const id = COLOUR_IDS[n];
    const opts = optionsFor(id, layers);
    if (!opts.visible) return null;
    const c = hexToRgb(str(v, id, '#ffffff'));
    return {
      ty: 'gr',
      nm: id,
      it: [
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
        transform({
          p: sampled(frames, 3, (t) => [
            W * b.x + W * 0.2 * drift * Math.sin(TAU * (b.lapsX * t + b.phase)),
            H * b.y + H * 0.2 * drift * Math.cos(TAU * (b.lapsY * t + b.phase)),
          ]),
          s: sampled(frames, 3, (t) => {
            const k = 100 + 15 * drift * Math.sin(TAU * (t + b.phase));
            return [k, k];
          }),
          o: fixed(clampOpacity(opts.opacity)),
        }),
      ],
    };
  });
}

/** Bubbles, stars, snow or confetti: lots of small pieces, shared out between the three colours. */
function pieces(pattern: string, v: TemplateValues, W: number, H: number, frames: number): Piece[][] {
  const rand = seeded(pattern.length * 7919 + 17);
  const count = Math.round(num(v, 'amount', 24));
  const unit = Math.min(W, H) / 1080; // sizes are for a 1080-tall screen, scaled to fit
  const out: Piece[][] = [[], [], []];
  for (let n = 0; n < count; n++) {
    const colour = str(v, COLOUR_IDS[n % 3], '#ffffff');
    const x = between(rand, 0.03, 0.97) * W;
    let pc: Piece;
    if (pattern === 'bubbles') {
      const r = between(rand, 18, 64) * unit;
      const margin = r + 40 * unit;
      pc = {
        shapes: [ellipse(0, 0, r * 2)],
        paint: { kind: 'line', color: colour, width: Math.max(2, 4 * unit), alpha: 85 },
        wash: 14,
        shine: { ty: 'gr', it: [ellipse(-r * 0.4, -r * 0.4, r * 0.45, r * 0.3), { ty: 'fl', c: fixed([1, 1, 1, 1]), o: fixed(55), r: 1 }, transform({ r: fixed(-40) })] },
        size: r * 2,
        p: travel(frames, H + margin, -margin, r < 34 * unit ? 2 : 1, rand()), // small ones rise faster
        sway: swing(frames, [x - between(rand, 15, 45) * unit, 0], [x + between(rand, 15, 45) * unit, 0], whole(rand, 2, 5), rand() < 0.5),
      };
    } else if (pattern === 'snow') {
      const r = between(rand, 4, 13) * unit;
      const margin = r + 30 * unit;
      pc = {
        shapes: [ellipse(0, 0, r * 2)],
        paint: { kind: 'fill', color: colour },
        size: r * 2,
        p: travel(frames, -margin, H + margin, r > 9 * unit ? 2 : 1, rand()), // big flakes are nearer, so faster
        sway: swing(frames, [x - between(rand, 10, 40) * unit, 0], [x + between(rand, 10, 40) * unit, 0], whole(rand, 2, 5), rand() < 0.5),
      };
    } else if (pattern === 'confetti') {
      const w = between(rand, 16, 28) * unit, h = between(rand, 9, 14) * unit;
      const margin = w + 30 * unit;
      const start = between(rand, 0, 360);
      const turns = whole(rand, 1, 3) * (rand() < 0.5 ? -1 : 1);
      pc = {
        shapes: [rect(0, 0, w, h, 2 * unit)],
        paint: { kind: 'fill', color: colour },
        size: h,
        p: travel(frames, -margin, H + margin, whole(rand, 1, 2), rand()),
        r: linear([{ t: 0, v: [start] }, { t: frames, v: [start + 360 * turns] }]),
        s: swing(frames, [-100, 100], [100, 100], whole(rand, 3, 8)), // flipping over as it falls
        sway: swing(frames, [x - between(rand, 20, 60) * unit, 0], [x + between(rand, 20, 60) * unit, 0], whole(rand, 2, 4), rand() < 0.5),
      };
    } else if (pattern === 'rain') {
      // Thin streaks falling fast; longer ones are nearer, so they fall faster.
      const len = between(rand, 30, 70) * unit;
      pc = {
        shapes: [straightPath([[0, round(-len / 2)], [0, round(len / 2)]])],
        paint: { kind: 'line', color: colour, width: Math.max(2, 3 * unit), alpha: 75 },
        size: len,
        p: fixed([round(x), 0]),
        sway: travel(frames, -len - 20, H + len + 20, len > 50 * unit ? 5 : whole(rand, 3, 4), rand()),
      };
    } else if (pattern === 'fireflies') {
      // A small bright dot inside a soft glow, wandering slowly and blinking.
      const r = between(rand, 3, 6) * unit, glow = r * 6;
      const y = between(rand, 0.05, 0.95) * H;
      const c = hexToRgb(colour);
      const [wx, wy] = [between(rand, 40, 120) * unit, between(rand, 30, 90) * unit];
      const [kx, ky, px, py] = [whole(rand, 1, 2), whole(rand, 1, 2), rand(), rand()];
      pc = {
        shapes: [ellipse(0, 0, r * 2)],
        paint: { kind: 'fill', color: colour },
        size: r * 2,
        shine: {
          ty: 'gr',
          it: [
            ellipse(0, 0, glow * 2),
            { ty: 'gf', t: 2, s: fixed([0, 0]), e: fixed([round(glow), 0]), h: fixed(0), a: fixed(0), g: { p: 2, k: fixed([0, ...c, 1, ...c, 0, 0.55, 1, 0]) }, o: fixed(100), r: 1 },
            transform({}),
          ],
        },
        p: sampled(frames, 6, (t) => [x + wx * Math.sin(TAU * (kx * t + px)), y + wy * Math.cos(TAU * (ky * t + py))]),
        o: swing(frames, [15], [100], whole(rand, 2, 5), rand() < 0.5),
      };
    } else if (pattern === 'shapes') {
      // Outlined circles, triangles and squares drifting up, slowly turning.
      const size = between(rand, 30, 80) * unit;
      const kind = n % 3;
      const margin = size + 30 * unit;
      const start = between(rand, 0, 360);
      pc = {
        shapes: [
          kind === 0
            ? ellipse(0, 0, size)
            : kind === 1
              ? { ty: 'sr', sy: 2, d: 1, pt: fixed(3), p: fixed([0, 0]), r: fixed(0), or: fixed(round(size * 0.6)), os: fixed(0) }
              : rect(0, 0, size * 0.85, size * 0.85, 4 * unit),
        ],
        paint: { kind: 'line', color: colour, width: Math.max(2, 5 * unit), alpha: 85 },
        size,
        p: travel(frames, H + margin, -margin, 1, rand()),
        r: linear([{ t: 0, v: [start] }, { t: frames, v: [start + 360 * (rand() < 0.5 ? -1 : 1)] }]),
        sway: swing(frames, [x - between(rand, 20, 60) * unit, 0], [x + between(rand, 20, 60) * unit, 0], whole(rand, 1, 3), rand() < 0.5),
      };
    } else {
      // stars: four-pointed sparkles that stay put and twinkle (grow and brighten, then fade)
      const big = rand() < 0.2;
      const R = (big ? between(rand, 28, 44) : between(rand, 10, 22)) * unit;
      const y = between(rand, 0.03, 0.97) * H;
      const times = whole(rand, 1, 4);
      const high = rand() < 0.5;
      pc = {
        shapes: [{ ty: 'sr', sy: 1, d: 1, pt: fixed(4), p: fixed([0, 0]), r: fixed(0), ir: fixed(R * 0.3), is: fixed(0), or: fixed(R), os: fixed(0) }],
        paint: { kind: 'fill', color: colour },
        size: R * 2,
        p: fixed([round(x), round(y)]),
        r: fixed(round(between(rand, -15, 15))),
        s: swing(frames, [45, 45], [100, 100], times, high),
        o: swing(frames, [25], [100], times, high),
      };
    }
    out[n % 3].push(pc);
  }
  return out;
}

const background: Template = {
  id: 'background',
  name: 'Background',
  description: 'A moving backdrop over a base colour: soft blobs, bubbles, stars, snow, confetti, waves, fireflies, rain, floating shapes or aurora ribbons. For behind a page or a login screen.',
  howToUse: 'Loop it behind your content, stretched to cover the screen.',
  settings: [
    { id: 'pattern', label: 'Pattern', kind: 'choice', options: PATTERNS, default: 'blobs' },
    {
      id: 'size',
      label: 'Canvas',
      kind: 'choice',
      options: [
        { value: 'wide', label: 'Wide (1920 × 1080)' },
        { value: 'tall', label: 'Tall, for phones (1080 × 1920)' },
        { value: 'square', label: 'Square (1080 × 1080)' },
      ],
      default: 'wide',
    },
    { id: 'base', label: 'Base colour', kind: 'color', default: '#14101f' },
    { id: 'blob1', label: 'Colour 1', kind: 'color', default: '#7c3aed' },
    { id: 'blob2', label: 'Colour 2', kind: 'color', default: '#f2c14e' },
    { id: 'blob3', label: 'Colour 3', kind: 'color', default: '#0ea5e9' },
    { id: 'drift', label: 'How much they move', kind: 'number', min: 0.1, max: 1, step: 0.05, default: 0.5, when: (v) => ONE_PER_COLOUR.includes(String(v.pattern)) },
    { id: 'amount', label: 'How many', kind: 'number', min: 6, max: 60, step: 1, default: 24, when: (v) => !ONE_PER_COLOUR.includes(String(v.pattern)) },
    { id: 'seconds', label: 'One loop takes', kind: 'number', min: 4, max: 20, step: 1, default: 10, unit: 's' },
  ],
  parts: (v) => {
    const pattern = str(v, 'pattern', 'blobs');
    const name = PIECE_NAMES[pattern] ?? 'Blob';
    const detailed = ['bubbles', 'stars', 'confetti', 'waves', 'shapes'].includes(pattern);
    return [
      ...COLOUR_IDS.map((id, n) => ({
        id,
        name: ONE_PER_COLOUR.includes(pattern) ? `${name} ${n + 1}` : `${name} in colour ${n + 1}`,
        canShade: detailed,
        canOutline: detailed,
      })),
      { id: 'base', name: 'Base', canShade: true, canOutline: false },
    ];
  },
  build(v, name, layers) {
    const [W, H] = SIZES[str(v, 'size', 'wide')] ?? SIZES.wide;
    const frames = Math.round(num(v, 'seconds', 10) * FRAME_RATE);
    const pattern = str(v, 'pattern', 'blobs');
    const groups =
      pattern === 'blobs'
        ? blobs(v, layers, W, H, frames)
        : pattern === 'aurora'
          ? aurora(v, layers, W, H, frames)
          : (pattern === 'waves' ? waves(v, W, H, frames) : pieces(pattern, v, W, H, frames)).map((list, n) => colourGroup(COLOUR_IDS[n], list, layers));
    const base = part({
      id: 'base',
      shapes: [rect(W / 2, H / 2, W, H, 0)],
      paint: { kind: 'fill', color: str(v, 'base', '#14101f') },
      shadeFrom: [0, 0],
      shadeTo: [0, H],
    }, layers);
    return file(name, W, H, frames, [...groups, base]);
  },
};

// The button shapes: width, height and corner roundness.
const BUTTON_SHAPES: Record<string, { w: number; h: number; r: number }> = {
  rounded: { w: 240, h: 80, r: 16 },
  pill: { w: 240, h: 80, r: 40 },
  square: { w: 240, h: 80, r: 4 },
  round: { w: 110, h: 110, r: 55 },
};

const button: Template = {
  id: 'button',
  name: 'Button',
  description: 'A button with an effect: a squishy press, a tap ripple, a pulsing glow, a heartbeat, a shine sweeping across, flowing colours, a line running round the edge, or a wiggle.',
  howToUse:
    'Put your own label or icon on top in your app (Lottie files don’t carry fonts). “Press” and “Ripple” have a marker called “press”: play it when tapped. The others loop on their own to draw attention.',
  settings: [
    {
      id: 'effect',
      label: 'Effect',
      kind: 'choice',
      options: [
        { value: 'press', label: 'Press (squish and bounce)' },
        { value: 'ripple', label: 'Ripple (spreads from the middle)' },
        { value: 'pulse', label: 'Pulsing glow' },
        { value: 'heartbeat', label: 'Heartbeat' },
        { value: 'shine', label: 'Shine sweep' },
        { value: 'gradient', label: 'Flowing colours' },
        { value: 'border', label: 'Line running round the edge' },
        { value: 'wiggle', label: 'Attention wiggle' },
      ],
      default: 'press',
    },
    {
      id: 'shape',
      label: 'Shape',
      kind: 'choice',
      options: [
        { value: 'rounded', label: 'Rounded' },
        { value: 'pill', label: 'Pill' },
        { value: 'square', label: 'Square corners' },
        { value: 'round', label: 'Round (for an icon)' },
      ],
      default: 'rounded',
    },
    { id: 'color', label: 'Button colour', kind: 'color', default: '#f2c14e' },
    { id: 'color2', label: 'Second colour', kind: 'color', default: '#ff6b9d', when: (v) => v.effect === 'gradient' },
    { id: 'glow', label: 'Glow / line colour', kind: 'color', default: '#ffffff', when: (v) => v.effect === 'pulse' || v.effect === 'border' },
    { id: 'shine', label: 'Shine / ripple colour', kind: 'color', default: '#ffffff', when: (v) => v.effect === 'shine' || v.effect === 'ripple' },
    { id: 'seconds', label: 'Effect takes', kind: 'number', min: 0.3, max: 4, step: 0.1, default: 1.2, unit: 's' },
  ],
  parts: (v) => [
    ...(v.effect === 'shine' || v.effect === 'ripple'
      ? [{ id: 'shine', name: v.effect === 'ripple' ? 'Ripple' : 'Shine', canShade: false, canOutline: false }]
      : []),
    ...(v.effect === 'border' ? [{ id: 'glow', name: 'Running line', canShade: false, canOutline: false }] : []),
    // Flowing colours paint the button with its own two-colour blend, so it has no shading option.
    { id: 'button', name: 'Button', canShade: v.effect !== 'gradient', canOutline: true },
    ...(v.effect === 'pulse' ? [{ id: 'glow', name: 'Glow ring', canShade: false, canOutline: false }] : []),
  ],
  build(v, name, layers) {
    const frames = Math.max(8, Math.round(num(v, 'seconds', 1.2) * FRAME_RATE));
    const at = (share: number) => round(frames * share);
    const effect = str(v, 'effect', 'press');
    const { w, h, r } = BUTTON_SHAPES[str(v, 'shape', 'rounded')] ?? BUTTON_SHAPES.rounded;
    const pad = 40; // room round the button for the glow and the bounce
    const W = w + pad * 2, H = h + pad * 2;
    const centre = () => fixed([W / 2, H / 2]); // a fresh copy for each part
    const color = str(v, 'color', '#f2c14e');

    const motion: { s?: object; r?: object } = {};
    if (effect === 'press')
      motion.s = eased([
        { t: 0, v: [100, 100] },
        { t: at(0.2), v: [92, 90] },
        { t: at(0.5), v: [104, 105] },
        { t: at(0.75), v: [99, 99] },
        { t: frames, v: [100, 100] },
      ]);
    if (effect === 'wiggle')
      motion.r = eased([
        { t: 0, v: [0] },
        { t: at(0.08), v: [-7] },
        { t: at(0.16), v: [7] },
        { t: at(0.24), v: [-5] },
        { t: at(0.32), v: [4] },
        { t: at(0.4), v: [0] },
        { t: frames, v: [0] },
      ]);
    if (effect === 'heartbeat')
      // Two quick beats (ba-dum), then a rest.
      motion.s = easedU([
        { t: 0, v: [100, 100] },
        { t: at(0.1), v: [108, 108] },
        { t: at(0.2), v: [100, 100] },
        { t: at(0.3), v: [106, 106] },
        { t: at(0.45), v: [100, 100] },
        { t: frames, v: [100, 100] },
      ]);
    // Flowing colours: a first–second–first blend twice the button's width, sliding back and forth under it.
    const flowing: Paint = {
      kind: 'gradient',
      colors: [color, str(v, 'color2', '#ff6b9d')],
      s: swing(frames, [-w * 1.5, 0], [-w * 0.5, 0], 1),
      e: swing(frames, [w * 0.5, 0], [w * 1.5, 0], 1),
    };
    const buttonPart = part({
      id: 'button',
      shapes: [rect(0, 0, w, h, r)],
      paint: effect === 'gradient' ? flowing : { kind: 'fill', color },
      shadeFrom: [0, -h / 2],
      shadeTo: [0, h / 2],
      p: centre(),
      ...motion,
    }, layers);

    // A line running round the edge: a quarter of the outline shown, with where it starts going round.
    const lineOpts = optionsFor('glow', layers);
    const border =
      effect === 'border' && lineOpts.visible
        ? {
            ty: 'gr',
            nm: 'glow',
            it: [
              rect(0, 0, w, h, r),
              { ty: 'tm', s: fixed(0), e: fixed(25), o: linear([{ t: 0, v: [0] }, { t: frames, v: [360] }]), m: 1 },
              { ty: 'st', c: fixed(rgba(str(v, 'glow', color))), o: fixed(100), w: fixed(5), ...ROUND },
              transform({ p: centre(), o: fixed(clampOpacity(lineOpts.opacity)) }),
            ],
          }
        : null;

    // Pulse: a ring the same shape as the button grows outwards and fades.
    const grow = 30;
    const glowOpts = optionsFor('glow', layers);
    const glow =
      effect === 'pulse' && glowOpts.visible
        ? {
            ty: 'gr',
            nm: 'glow',
            it: [
              {
                ty: 'rc',
                d: 1,
                p: fixed([0, 0]),
                s: eased([{ t: 0, v: [w, h] }, { t: at(0.8), v: [w + grow * 2, h + grow * 2] }, { t: frames, v: [w + grow * 2, h + grow * 2] }]),
                r: eased([{ t: 0, v: [r] }, { t: at(0.8), v: [r + grow] }, { t: frames, v: [r + grow] }]),
              },
              { ty: 'st', c: fixed(rgba(str(v, 'glow', color))), o: fixed(100), w: fixed(6), ...ROUND },
              transform({
                p: centre(),
                o: eased([{ t: 0, v: [round(0.8 * clampOpacity(glowOpts.opacity))] }, { t: at(0.8), v: [0] }, { t: frames, v: [0] }]),
              }),
            ],
          }
        : null;

    // Shine: a see-through gradient over the button with one bright band in it; moving the
    // gradient's ends sweeps the band across. It's the button's own shape, so it never spills over.
    const shineOpts = optionsFor('shine', layers);
    const sc = hexToRgb(str(v, 'shine', '#ffffff'));
    const sweep = (x: number) => [x - h, -h / 2]; // a slanted band: the gradient runs corner-ish to corner
    const shine =
      effect === 'shine' && shineOpts.visible
        ? {
            ty: 'gr',
            nm: 'shine',
            it: [
              rect(0, 0, w, h, r),
              {
                ty: 'gf',
                t: 1,
                s: eased([{ t: 0, v: sweep(-w) }, { t: at(0.6), v: sweep(w * 0.6) }, { t: frames, v: sweep(w * 0.6) }]),
                e: eased([{ t: 0, v: [-w + h, h / 2] }, { t: at(0.6), v: [w * 0.6 + h, h / 2] }, { t: frames, v: [w * 0.6 + h, h / 2] }]),
                // colours, then see-through-ness: clear, a bright band in the middle, clear
                g: { p: 3, k: fixed([0, ...sc, 0.5, ...sc, 1, ...sc, 0, 0, 0.4, 0, 0.5, 0.75, 0.6, 0, 1, 0]) },
                o: fixed(100),
                r: 1,
              },
              transform({ p: centre(), o: fixed(clampOpacity(shineOpts.opacity)) }),
            ],
          }
        : null;

    // Ripple: a see-through disc spreads from the middle and fades. It's painted onto a copy of the
    // button's shape (a round gradient whose edge grows), so it never spills past the edge.
    const ripple =
      effect === 'ripple' && shineOpts.visible
        ? {
            ty: 'gr',
            nm: 'shine',
            it: [
              rect(0, 0, w, h, r),
              {
                ty: 'gf',
                t: 2,
                s: fixed([0, 0]),
                e: easedU([{ t: 0, v: [2, 0] }, { t: at(0.7), v: [round(w * 0.75), 0] }, { t: frames, v: [round(w * 0.75), 0] }]),
                h: fixed(0),
                a: fixed(0),
                // colours, then see-through-ness: a half-clear disc with a soft rim, clear outside it
                g: { p: 2, k: fixed([0, ...sc, 1, ...sc, 0, 0.45, 0.94, 0.45, 1, 0]) },
                o: fixed(100),
                r: 1,
              },
              transform({
                p: centre(),
                o: easedU([{ t: 0, v: [clampOpacity(shineOpts.opacity)] }, { t: at(0.7), v: [0] }, { t: frames, v: [0] }]),
              }),
            ],
          }
        : null;

    const tapped = effect === 'press' || effect === 'ripple';
    return file(name, W, H, frames, [border, shine, ripple, buttonPart, glow], {}, tapped ? [{ tm: 0, cm: 'press', dr: frames }] : []);
  },
};

/** A heart about 80 wide and 70 tall at size 1, centred on 0,0. Six points joined by curves (an SVG heart, moved to the middle). */
function heartPath(k: number) {
  const pts = (a: number[][]) => a.map(([x, y]) => [round(x * k), round(y * k)]);
  return {
    ty: 'sh',
    ks: fixed({
      c: true,
      v: pts([[0, -20], [-20, -35], [-40, -10], [0, 35], [40, -10], [20, -35]]),
      // Each point's curve handles: i = the way the line comes in, o = the way it leaves.
      i: pts([[0, -5], [15, 0], [0, 0], [-20, -15], [0, 15], [20, 0]]),
      o: pts([[0, -5], [-20, 0], [0, 15], [20, -15], [0, 0], [-15, 0]]),
    }),
  };
}
const starShape = (R: number) => ({ ty: 'sr', sy: 1, d: 1, pt: fixed(5), p: fixed([0, 0]), r: fixed(0), ir: fixed(R * 0.45), is: fixed(0), or: fixed(R), os: fixed(0) });

const like: Template = {
  id: 'like',
  name: 'Like heart',
  description: 'An empty heart (or star) that fills in with a pop when tapped, and empties again when tapped off.',
  howToUse:
    'The file has two markers: “like” and “unlike”. Play “like” when it’s tapped on and “unlike” when it’s tapped off. The preview plays both in a row.',
  settings: [
    { id: 'shape', label: 'Shape', kind: 'choice', options: [{ value: 'heart', label: 'Heart' }, { value: 'star', label: 'Star (favourite)' }], default: 'heart' },
    { id: 'style', label: 'Style', kind: 'choice', options: [{ value: 'burst', label: 'Pop with a burst of sparks' }, { value: 'pop', label: 'Just a pop' }], default: 'burst' },
    { id: 'color', label: 'Colour when liked', kind: 'color', default: '#ff3b5c' },
    { id: 'off', label: 'Outline when not liked', kind: 'color', default: '#8a8a99' },
    { id: 'sparks', label: 'Spark colour', kind: 'color', default: '#ffb340', when: (v) => v.style === 'burst' },
    { id: 'seconds', label: 'One tap takes', kind: 'number', min: 0.4, max: 2, step: 0.1, default: 0.8, unit: 's' },
  ],
  parts: (v) => {
    const name = v.shape === 'star' ? 'Star' : 'Heart';
    return [
      ...(v.style === 'burst' ? [{ id: 'sparks', name: 'Sparks', canShade: false, canOutline: false }] : []),
      solidPart('heart', `${name} (filled)`),
      ...(v.style === 'burst' ? [{ id: 'ring', name: 'Burst ring', canShade: false, canOutline: false }] : []),
      { id: 'empty', name: `${name} outline (not liked)`, canShade: true, canOutline: false },
    ];
  },
  build(v, name, layers) {
    const F = Math.max(12, Math.round(num(v, 'seconds', 0.8) * FRAME_RATE));
    const at = (share: number) => Math.round(F * share);
    const S = 200;
    const centre = fixed([S / 2, S / 2]);
    const star = str(v, 'shape', 'heart') === 'star';
    const shape = () => (star ? starShape(60) : heartPath(1.4)); // a fresh one each time
    const burst = str(v, 'style', 'burst') === 'burst';
    const color = str(v, 'color', '#ff3b5c');
    const sparkColour = str(v, 'sparks', '#ffb340');

    // Like: the filled one grows from nothing, a bit too big, then settles. Unlike: it shrinks away.
    const heart = part({
      id: 'heart',
      shapes: [shape()],
      paint: { kind: 'fill', color },
      shadeFrom: [0, -50],
      shadeTo: [0, 50],
      p: centre,
      s: eased([
        { t: 0, v: [0, 0] },
        { t: at(0.15), v: [0, 0] },
        { t: at(0.5), v: burst ? [115, 115] : [125, 125] },
        { t: at(0.7), v: [100, 100] },
        { t: F, v: [100, 100] },
        { t: F + at(0.4), v: [0, 0] },
        { t: F * 2, v: [0, 0] },
      ]),
    }, layers);
    // The empty outline shows when it's not liked: it fades as the fill arrives, and back after.
    const empty = part({
      id: 'empty',
      shapes: [shape()],
      paint: { kind: 'line', color: str(v, 'off', '#8a8a99'), width: 6 },
      shadeFrom: [0, -50],
      shadeTo: [0, 50],
      p: centre,
      fade: [{ t: 0, v: 100 }, { t: at(0.3), v: 0 }, { t: F + at(0.3), v: 0 }, { t: F + at(0.5), v: 100 }, { t: F * 2, v: 100 }],
    }, layers);

    // A ring that bursts outwards and thins to nothing, just as the heart arrives.
    const ringOpts = optionsFor('ring', layers);
    const ring =
      burst && ringOpts.visible
        ? {
            ty: 'gr',
            nm: 'ring',
            it: [
              { ty: 'el', d: 1, p: fixed([0, 0]), s: eased([{ t: 0, v: [20, 20] }, { t: at(0.4), v: [170, 170] }, { t: F * 2, v: [170, 170] }]) },
              { ty: 'st', c: fixed(rgba(sparkColour)), o: fixed(100), w: eased([{ t: 0, v: [24] }, { t: at(0.4), v: [1] }, { t: F * 2, v: [1] }]), ...ROUND },
              transform({
                p: centre,
                o: eased([{ t: 0, v: [clampOpacity(ringOpts.opacity)] }, { t: at(0.4), v: [0] }, { t: F * 2, v: [0] }]),
              }),
            ],
          }
        : null;

    // Eight sparks fly out in a circle and shrink away, alternating the spark and like colours.
    const sparks = burst
      ? colourGroup(
          'sparks',
          Array.from({ length: 8 }, (_, n): Piece => {
            const angle = (n / 8) * TAU - TAU / 4;
            const spot = (r: number) => [round(S / 2 + r * Math.cos(angle)), round(S / 2 + r * Math.sin(angle))];
            return {
              shapes: [ellipse(0, 0, n % 2 ? 12 : 16)],
              paint: { kind: 'fill', color: n % 2 ? color : sparkColour },
              size: 16,
              p: eased([{ t: 0, v: spot(45) }, { t: at(0.3), v: spot(45) }, { t: at(0.75), v: spot(92) }, { t: F * 2, v: spot(92) }]),
              s: eased([{ t: 0, v: [0, 0] }, { t: at(0.3), v: [100, 100] }, { t: at(0.75), v: [0, 0] }, { t: F * 2, v: [0, 0] }]),
            };
          }),
          layers,
        )
      : null;

    return file(name, S, S, F * 2, [sparks, heart, ring, empty], {}, [
      { tm: 0, cm: 'like', dr: F },
      { tm: F, cm: 'unlike', dr: F },
    ]);
  },
};

const progress: Template = {
  id: 'progress',
  name: 'Progress bar',
  description: 'A bar (or ring, or row of blocks) that fills from 0 to 100%. Your app can stop it at any point to show real progress.',
  howToUse:
    'The file is exactly 100 frames long, so frame 40 shows 40% done. In your app, jump to the frame that matches the real progress (in lottie-web: anim.goToAndStop(40, true)). The preview just plays it filling up.',
  settings: [
    {
      id: 'style',
      label: 'Style',
      kind: 'choice',
      options: [
        { value: 'bar', label: 'Bar' },
        { value: 'ring', label: 'Ring' },
        { value: 'blocks', label: 'Row of blocks' },
      ],
      default: 'bar',
    },
    { id: 'color', label: 'Progress colour', kind: 'color', default: '#34c759' },
    { id: 'track', label: 'Empty colour', kind: 'color', default: '#2e2e38' },
    { id: 'thickness', label: 'Thickness', kind: 'number', min: 6, max: 40, step: 1, default: 18, when: (v) => v.style !== 'blocks' },
    { id: 'seconds', label: 'Preview fills in', kind: 'number', min: 1, max: 10, step: 0.5, default: 3, unit: 's' },
  ],
  parts: (v) =>
    v.style === 'blocks' ? [solidPart('fill', 'Blocks')] : [solidPart('fill', 'Progress'), solidPart('track', 'Track (empty part)')],
  build(v, name, layers) {
    const frames = 100;
    const fps = frames / num(v, 'seconds', 3); // 100 frames over however long the preview should take
    const style = str(v, 'style', 'bar');
    const color = str(v, 'color', '#34c759');
    const track = str(v, 'track', '#2e2e38');
    const width = num(v, 'thickness', 18);
    // Steady speed, so frame number = percentage.
    const fill = () => trim(fixed(0), linear([{ t: 0, v: [0] }, { t: frames, v: [100] }]));

    if (style === 'blocks') {
      const W = 400, H = 80, count = 10, gap = 6;
      const blockW = (W - 40 - gap * (count - 1)) / count;
      const blocks = Array.from({ length: count }, (_, n) => {
        // Each block lights up during its own tenth: block 1 from 0–10%, block 2 from 10–20%…
        const keys = [{ t: 0, hex: track }, { t: n * 10, hex: track }, { t: n * 10 + 10, hex: color }, { t: frames, hex: color }];
        return part({
          id: 'fill',
          shapes: [rect(20 + blockW / 2 + n * (blockW + gap), H / 2, blockW, 40, 6)],
          paint: { kind: 'fill', color: keys.filter((k, i) => i === 0 || k.t > keys[i - 1].t) },
          shadeFrom: [0, H / 2 - 20],
          shadeTo: [0, H / 2 + 20],
        }, layers);
      });
      return file(name, W, H, frames, blocks, {}, [], fps);
    }

    if (style === 'ring') {
      const S = 200, size = 140;
      const ends = { shadeFrom: [size / 2, 0], shadeTo: [-size / 2, 0], p: fixed([S / 2, S / 2]), r: fixed(-90) }; // turned to start at the top
      const progressPart = part({ id: 'fill', shapes: [ellipse(0, 0, size)], trim: fill(), paint: { kind: 'line', color, width }, ...ends }, layers);
      const trackPart = part({ id: 'track', shapes: [ellipse(0, 0, size)], paint: { kind: 'line', color: track, width }, ...ends }, layers);
      return file(name, S, S, frames, [progressPart, trackPart], {}, [], fps);
    }

    const W = 400, H = 80;
    const line = () => straightPath([[40, H / 2], [W - 40, H / 2]]);
    const ends = { shadeFrom: [0, H / 2 - width / 2], shadeTo: [0, H / 2 + width / 2] };
    const progressPart = part({ id: 'fill', shapes: [line()], trim: fill(), paint: { kind: 'line', color, width }, ...ends }, layers);
    const trackPart = part({ id: 'track', shapes: [line()], paint: { kind: 'line', color: track, width }, ...ends }, layers);
    return file(name, W, H, frames, [progressPart, trackPart], {}, [], fps);
  },
};

const LINE_IDS = ['top', 'middle', 'bottom'];

const menu: Template = {
  id: 'menu',
  name: 'Menu to close',
  description: 'The three-line menu icon turns into an X (or a back arrow) and back again.',
  howToUse:
    'The file has two markers: “open” (lines → X) and “close” (X → lines). Play “open” when the menu opens and “close” when it shuts. The preview plays both in a row.',
  settings: [
    { id: 'style', label: 'Turns into', kind: 'choice', options: [{ value: 'cross', label: 'An X' }, { value: 'arrow', label: 'A back arrow' }], default: 'cross' },
    { id: 'color', label: 'Colour', kind: 'color', default: '#ffffff' },
    { id: 'thickness', label: 'Line thickness', kind: 'number', min: 4, max: 14, step: 1, default: 8 },
    { id: 'speed', label: 'One change takes', kind: 'number', min: 0.15, max: 1, step: 0.05, default: 0.35, unit: 's' },
  ],
  parts: [solidPart('top', 'Top line'), solidPart('middle', 'Middle line'), solidPart('bottom', 'Bottom line')],
  build(v, name, layers) {
    const F = Math.max(4, Math.round(num(v, 'speed', 0.35) * FRAME_RATE));
    const S = 120, half = 36; // each line is 72 long, centred on its group
    const color = str(v, 'color', '#ffffff');
    const width = num(v, 'thickness', 8);
    const arrow = str(v, 'style', 'cross') === 'arrow';
    // The arrow's two short lines meet the middle line's left end (24, 60), slanting 45° up and down.
    const slant = (half / 2) * Math.SQRT1_2;
    // Where each line ends up: position, turn, and width (in %).
    const goal: Record<string, { p: number[]; r: number; s: number; fade?: boolean }> = arrow
      ? {
          top: { p: [24 + slant, 60 - slant], r: -45, s: 50 },
          middle: { p: [60, 60], r: 0, s: 100 },
          bottom: { p: [24 + slant, 60 + slant], r: 45, s: 50 },
        }
      : {
          top: { p: [60, 60], r: 45, s: 100 },
          middle: { p: [60, 60], r: 0, s: 0, fade: true },
          bottom: { p: [60, 60], r: -45, s: 100 },
        };
    const there = (from: number[], to: number[]) => eased([{ t: 0, v: from }, { t: F, v: to }, { t: F * 2, v: from }]);
    const lines = LINE_IDS.map((id, n) => {
      const g = goal[id];
      const start = [60, 36 + n * 24];
      return part({
        id,
        shapes: [straightPath([[-half, 0], [half, 0]])],
        paint: { kind: 'line', color, width },
        shadeFrom: [0, -width / 2],
        shadeTo: [0, width / 2],
        p: there(start, g.p),
        r: there([0], [g.r]),
        s: there([100, 100], [g.s, 100]),
        fade: g.fade ? [{ t: 0, v: 100 }, { t: F, v: 0 }, { t: F * 2, v: 100 }] : undefined,
      }, layers);
    });
    return file(name, S, S, F * 2, lines, {}, [
      { tm: 0, cm: 'open', dr: F },
      { tm: F, cm: 'close', dr: F },
    ]);
  },
};

export const TEMPLATES: readonly Template[] = [toggleSwitch, button, like, menu, progress, spinner, successCheck, background];
