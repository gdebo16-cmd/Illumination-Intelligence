// Halo: the shapes you can start from, and the moves you can add to them.
//
// Every move is a recipe: given how far through the loop we are (t, from 0 at the start to 1 at the
// end) and how strong you set it (strength, 0 to 1), it says how to change the shape at that moment.
// Halo asks every move you've turned on, once per frame, and adds the answers together, so moves mix:
// sway + pulse + fade all happen at once. lib/halo/lottie.ts does the adding.
//
// A recipe should end where it started (the same answer at t = 0 and t = 1) so the loop has no jump.

/** How a move changes the shape at one moment. Leave out anything the move doesn't touch. */
export interface Motion {
  /** Sideways, in pixels (the picture is 512 across). Positive = right. */
  x?: number;
  /** Up and down, in pixels. Positive = DOWN (screens count downwards). */
  y?: number;
  /** Turn, in degrees. Positive = clockwise. */
  rotate?: number;
  /** Width, as a multiplier: 1 = normal, 1.2 = 20% wider. */
  scaleX?: number;
  /** Height, as a multiplier. */
  scaleY?: number;
  /** See-through-ness, as a multiplier: 1 = solid, 0 = invisible. */
  opacity?: number;
}

export interface Move {
  id: string;
  name: string;
  description: string;
  apply: (t: number, strength: number) => Motion;
}

/** A smooth back-and-forth, `times` times per loop. Goes 0 → 1 → 0 → -1 → 0. */
export const wave = (t: number, times = 1) => Math.sin(2 * Math.PI * times * t);
/** A smooth swell, `times` times per loop. Goes 0 → 1 → 0, never below 0. */
export const swell = (t: number, times = 1) => 0.5 - 0.5 * Math.cos(2 * Math.PI * times * t);

export const MOVES: readonly Move[] = [
  {
    id: 'spin',
    name: 'Spin',
    description: 'Turns all the way round. Stronger = more turns per loop.',
    apply: (t, s) => ({ rotate: 360 * t * Math.max(1, Math.round(s * 3)) }),
  },
  {
    id: 'pulse',
    name: 'Pulse',
    description: 'Grows and shrinks, like a heartbeat.',
    apply: (t, s) => {
      const size = 1 + 0.3 * s * swell(t);
      return { scaleX: size, scaleY: size };
    },
  },
  {
    id: 'bounce',
    name: 'Bounce',
    description: 'Jumps up and lands.',
    apply: (t, s) => ({ y: -140 * s * Math.abs(Math.sin(Math.PI * t)) }),
  },
  {
    id: 'float',
    name: 'Float',
    description: 'Drifts gently up and down.',
    apply: (t, s) => ({ y: 30 * s * wave(t) }),
  },
  {
    id: 'sway',
    name: 'Sway',
    description: 'Rocks side to side. Set the pivot to "bottom" for a flame or a plant.',
    apply: (t, s) => ({ rotate: 15 * s * wave(t) }),
  },
  {
    id: 'wiggle',
    name: 'Wiggle',
    description: 'A quick shake in the middle of the loop, like it wants attention.',
    apply: (t, s) => ({ rotate: 14 * s * wave(t, 6) * swell(t) }),
  },
  {
    id: 'fade',
    name: 'Fade',
    description: 'Fades out and back in.',
    apply: (t, s) => ({ opacity: 1 - s * swell(t) }),
  },
  {
    id: 'flicker',
    name: 'Flicker',
    description: 'Restless, uneven stretching and dimming, like firelight.',
    apply: (t, s) => {
      // Three waves at uneven speeds (3, 7 and 13 per loop) added together, so the pattern never looks
      // like a steady beat. Whole numbers of waves, so the loop still ends where it started.
      const jitter = wave(t, 3) + 0.5 * wave(t, 7) + 0.25 * wave(t, 13);
      return {
        scaleY: 1 + 0.07 * s * jitter, // reaches up…
        scaleX: 1 - 0.035 * s * jitter, // …and gets thinner as it does, like a real flame
        rotate: 2.5 * s * wave(t, 5), // a small nervous lean
        opacity: 1 - 0.2 * s * swell(t, 4) * swell(t, 9), // brief dips in brightness
      };
    },
  },
];

export interface StartShape {
  id: string;
  name: string;
  /** SVG path text, drawn in a 100 × 100 box. */
  d: string;
}

/** An oval as four curves (SVG arcs aren't supported, so circles are built from curves). */
export const ovalPath = (cx: number, cy: number, rx: number, ry: number) => {
  const kx = rx * 0.5523; // how far the handles reach to make a near-perfect circle
  const ky = ry * 0.5523;
  return (
    `M${cx - rx} ${cy} C${cx - rx} ${cy - ky} ${cx - kx} ${cy - ry} ${cx} ${cy - ry} ` +
    `C${cx + kx} ${cy - ry} ${cx + rx} ${cy - ky} ${cx + rx} ${cy} ` +
    `C${cx + rx} ${cy + ky} ${cx + kx} ${cy + ry} ${cx} ${cy + ry} ` +
    `C${cx - kx} ${cy + ry} ${cx - rx} ${cy + ky} ${cx - rx} ${cy} Z`
  );
};

const starPath = (points: number, outer: number, inner: number) =>
  Array.from({ length: points * 2 }, (_, n) => {
    const r = n % 2 ? inner : outer;
    const angle = (Math.PI * n) / points - Math.PI / 2;
    return `${n ? 'L' : 'M'}${(50 + r * Math.cos(angle)).toFixed(2)} ${(50 + r * Math.sin(angle)).toFixed(2)}`;
  }).join(' ') + ' Z';

export const START_SHAPES: readonly StartShape[] = [
  {
    id: 'flame',
    name: 'Flame',
    d: 'M50 0 C60 20 85 35 85 62 C85 85 68 100 50 100 C32 100 15 85 15 62 C15 45 28 38 32 22 C40 32 40 40 46 44 C50 30 48 14 50 0 Z',
  },
  { id: 'drop', name: 'Drop', d: 'M50 0 C50 0 85 45 85 65 C85 85 69 100 50 100 C31 100 15 85 15 65 C15 45 50 0 50 0 Z' },
  { id: 'star', name: 'Star', d: starPath(5, 50, 21) },
  {
    id: 'heart',
    name: 'Heart',
    d: 'M50 90 C20 70 0 50 0 30 C0 12 14 0 28 0 C38 0 46 6 50 14 C54 6 62 0 72 0 C86 0 100 12 100 30 C100 50 80 70 50 90 Z',
  },
  { id: 'bolt', name: 'Bolt', d: 'M58 0 L15 58 H45 L38 100 L85 38 H55 Z' },
  { id: 'circle', name: 'Circle', d: ovalPath(50, 50, 50, 50) },
  {
    id: 'square',
    name: 'Square',
    d: 'M15 0 H85 C93 0 100 7 100 15 V85 C100 93 93 100 85 100 H15 C7 100 0 93 0 85 V15 C0 7 7 0 15 0 Z',
  },
];

/** The picture's size in pixels, and how big the shape is drawn inside it. */
export const CANVAS = 512;
export const SHAPE_SIZE = 320;
export const FRAME_RATE = 30;
export const MIN_SECONDS = 1;
export const MAX_SECONDS = 6;

export type Pivot = 'center' | 'bottom';
