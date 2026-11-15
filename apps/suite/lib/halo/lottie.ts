// Builds a Lottie animation (the .json file) from a shape and the moves you picked.
//
// A Lottie file is a list of layers. Ours has the main shape, plus its "transform" (where it is,
// how it's turned, how big, how see-through), and up to three smaller inner layers riding on it. We animate the transform by working out all four
// for every frame (config/halo.ts has the recipes) and writing each frame down as a keyframe.
// Anything that never changes is written once instead, to keep the file small.

import { CANVAS, FRAME_RATE, MOVES, SHAPE_SIZE, type Motion, type Pivot } from '@/config/halo';
import { fitPaths, type Bezier } from './path';

export interface MoveSetting {
  on: boolean;
  /** 0 to 1. */
  strength: number;
}

/** A smaller copy of the shape drawn on top, like the yellow inside a flame. */
export interface InnerLayer {
  /** "#rrggbb". */
  color: string;
  /** How big, compared to the main shape: 0.2 to 0.9. */
  size: number;
  /** 0 to 1: how much MORE than the main shape this layer moves. 0 = it just rides along. */
  lively: number;
}

export interface AnimationSpec {
  name: string;
  paths: Bezier[];
  /** "#rrggbb". */
  color: string;
  moves: Record<string, MoveSetting>;
  seconds: number;
  pivot: Pivot;
  /** Shading: the main colour blends into this one from top to bottom. Leave out for a flat colour. */
  shade?: string | null;
  /** A line round the main shape. Leave out for none. */
  outline?: { color: string; width: number } | null;
  /** Drawn on top of the main shape, biggest first. */
  inner?: InnerLayer[];
}

export const MAX_INNER_LAYERS = 3;

/** Every move you turned on, at one moment, added together. */
export function motionAt(t: number, moves: Record<string, MoveSetting>): Required<Motion> {
  const total = { x: 0, y: 0, rotate: 0, scaleX: 1, scaleY: 1, opacity: 1 };
  for (const move of MOVES) {
    const setting = moves[move.id];
    if (!setting?.on) continue;
    const m = move.apply(t, setting.strength);
    // Movement and turning add up; size and see-through-ness multiply (two 10% growths = 21%).
    total.x += m.x ?? 0;
    total.y += m.y ?? 0;
    total.rotate += m.rotate ?? 0;
    total.scaleX *= m.scaleX ?? 1;
    total.scaleY *= m.scaleY ?? 1;
    total.opacity *= m.opacity ?? 1;
  }
  total.opacity = Math.min(1, Math.max(0, total.opacity));
  return total;
}

export const round = (n: number) => Math.round(n * 100) / 100;

// One property: fixed if it never changes, otherwise one straight-line keyframe per frame.
function property(values: number[][]) {
  const same = values.every((v) => v.every((n, k) => n === values[0][k]));
  if (same) return { a: 0, k: values[0].length === 1 ? values[0][0] : values[0] };
  return {
    a: 1,
    k: values.map((s, t) =>
      t === values.length - 1 ? { t, s } : { t, s, i: { x: [1], y: [1] }, o: { x: [0], y: [0] } },
    ),
  };
}

export const hexToRgb = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

// Moves an inner layer adds on top of riding along: only changes of shape and tilt, never travel
// or full spins (those would pull it out of the main shape).
const INNER_SKIPS = new Set(['spin']);

const transformItem = () => ({
  ty: 'tr',
  p: { a: 0, k: [0, 0] },
  a: { a: 0, k: [0, 0] },
  s: { a: 0, k: [100, 100] },
  r: { a: 0, k: 0 },
  o: { a: 0, k: 100 },
  sk: { a: 0, k: 0 },
  sa: { a: 0, k: 0 },
});

const flatFill = (hex: string) => ({ ty: 'fl', nm: 'Fill', c: { a: 0, k: [...hexToRgb(hex), 1] }, o: { a: 0, k: 100 }, r: 1 });

/** Shading: a straight blend from `top` (at the top of the shape) to `bottom` (at its base). */
const gradientFill = (top: string, bottom: string, topY: number, bottomY: number) => ({
  ty: 'gf',
  nm: 'Shading',
  t: 1, // 1 = straight line, 2 = circular
  s: { a: 0, k: [0, round(topY)] },
  e: { a: 0, k: [0, round(bottomY)] },
  g: { p: 2, k: { a: 0, k: [0, ...hexToRgb(top), 1, ...hexToRgb(bottom)] } },
  o: { a: 0, k: 100 },
  r: 1,
});

const stroke = (hex: string, width: number) => ({
  ty: 'st',
  nm: 'Outline',
  c: { a: 0, k: [...hexToRgb(hex), 1] },
  o: { a: 0, k: 100 },
  w: { a: 0, k: width },
  lc: 2, // round ends
  lj: 2, // round corners
});

function shapeLayer(ind: number, nm: string, frames: number, ks: object, items: object[], parent?: number) {
  return {
    ddd: 0,
    ind,
    ty: 4, // a shape layer
    nm,
    sr: 1,
    ...(parent ? { parent } : {}),
    ks,
    ao: 0,
    shapes: [{ ty: 'gr', nm: 'Shape', it: [...items, transformItem()] }],
    ip: 0,
    op: frames,
    st: 0,
    bm: 0,
  };
}

export function buildLottie(spec: AnimationSpec) {
  const frames = Math.round(spec.seconds * FRAME_RATE);
  const fitted = fitPaths(spec.paths, SHAPE_SIZE);
  // The pivot is the point the shape turns and grows around: its middle, or the middle of its base.
  const pivotY = spec.pivot === 'bottom' ? round(fitted.bottom) : 0;
  const centre = CANVAS / 2;
  const inner = (spec.inner ?? []).slice(0, MAX_INNER_LAYERS);

  const position: number[][] = [];
  const rotation: number[][] = [];
  const scale: number[][] = [];
  const opacity: number[][] = [];
  // Per inner layer: its extra tilt and size on top of the main shape's.
  const innerRotation: number[][][] = inner.map(() => []);
  const innerScale: number[][][] = inner.map(() => []);
  const innerMoves = Object.fromEntries(
    Object.entries(spec.moves).filter(([id]) => !INNER_SKIPS.has(id)),
  );
  for (let f = 0; f <= frames; f++) {
    const t = f / frames;
    const m = motionAt(t, spec.moves);
    position.push([round(centre + m.x), round(centre + pivotY + m.y), 0]);
    rotation.push([round(m.rotate)]);
    scale.push([round(m.scaleX * 100), round(m.scaleY * 100), 100]);
    opacity.push([round(m.opacity * 100)]);
    inner.forEach((layer, n) => {
      const extra = layer.lively > 0 ? motionAt(t, scaleMoves(innerMoves, layer.lively)) : null;
      innerRotation[n].push([round(extra?.rotate ?? 0)]);
      innerScale[n].push([round(layer.size * (extra?.scaleX ?? 1) * 100), round(layer.size * (extra?.scaleY ?? 1) * 100), 100]);
    });
  }

  // A fresh copy for every layer: the lottie-web player edits shape data in place as it loads, so
  // layers sharing one copy would each bend it again.
  const outlines = () => fitted.paths.map((p, n) => ({
    ty: 'sh',
    nm: `Outline ${n + 1}`,
    ks: { a: 0, k: { c: p.closed, v: p.v.map((pt) => pt.map(round)), i: p.i.map((pt) => pt.map(round)), o: p.o.map((pt) => pt.map(round)) } },
  }));

  const mainPaint = [
    ...(spec.outline ? [stroke(spec.outline.color, spec.outline.width)] : []),
    spec.shade ? gradientFill(spec.color, spec.shade, -fitted.bottom, fitted.bottom) : flatFill(spec.color),
  ];
  const main = shapeLayer(
    1,
    spec.name,
    frames,
    {
      o: property(opacity),
      r: property(rotation),
      p: property(position),
      a: { a: 0, k: [0, pivotY, 0] },
      s: property(scale),
    },
    [...outlines(), ...mainPaint],
  );

  // Inner layers hang off the main one ("parent"), so they follow its every move. They shrink towards
  // the same pivot, so a flame's core sits at its base. Lottie doesn't pass see-through-ness down to
  // children, so each copies the main layer's.
  const children = inner.map((layer, n) =>
    shapeLayer(
      n + 2,
      `Inner ${n + 1}`,
      frames,
      {
        o: property(opacity.map((v) => [...v])), // its own copy, like outlines()
        r: property(innerRotation[n]),
        p: { a: 0, k: [0, pivotY, 0] },
        a: { a: 0, k: [0, pivotY, 0] },
        s: property(innerScale[n]),
      },
      [...outlines(), flatFill(layer.color)],
      1,
    ),
  );

  return {
    v: '5.7.4',
    nm: spec.name,
    fr: FRAME_RATE,
    ip: 0,
    op: frames,
    w: CANVAS,
    h: CANVAS,
    ddd: 0,
    assets: [],
    // Lottie draws the first layer on top, so the smallest inner layer goes first.
    layers: [...children.reverse(), main],
  };
}

/** The same moves, each at `factor` of its strength. */
function scaleMoves(moves: Record<string, MoveSetting>, factor: number): Record<string, MoveSetting> {
  return Object.fromEntries(Object.entries(moves).map(([id, m]) => [id, { ...m, strength: m.strength * factor }]));
}

export type LottieAnimation = ReturnType<typeof buildLottie>;
