// Builds a Lottie animation (the .json file) from a shape and the moves you picked.
//
// A Lottie file is a list of layers. Ours has one: the shape, plus its "transform" (where it is,
// how it's turned, how big, how see-through). We animate the transform by working out all four
// for every frame (config/halo.ts has the recipes) and writing each frame down as a keyframe.
// Anything that never changes is written once instead, to keep the file small.

import { CANVAS, FRAME_RATE, MOVES, SHAPE_SIZE, type Motion, type Pivot } from '@/config/halo';
import { fitPaths, type Bezier } from './path';

export interface MoveSetting {
  on: boolean;
  /** 0 to 1. */
  strength: number;
}

export interface AnimationSpec {
  name: string;
  paths: Bezier[];
  /** "#rrggbb". */
  color: string;
  moves: Record<string, MoveSetting>;
  seconds: number;
  pivot: Pivot;
}

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

const round = (n: number) => Math.round(n * 100) / 100;

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

const hexToRgb = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export function buildLottie(spec: AnimationSpec) {
  const frames = Math.round(spec.seconds * FRAME_RATE);
  const fitted = fitPaths(spec.paths, SHAPE_SIZE);
  // The pivot is the point the shape turns and grows around: its middle, or the middle of its base.
  const pivotY = spec.pivot === 'bottom' ? round(fitted.bottom) : 0;
  const centre = CANVAS / 2;

  const position: number[][] = [];
  const rotation: number[][] = [];
  const scale: number[][] = [];
  const opacity: number[][] = [];
  for (let f = 0; f <= frames; f++) {
    const m = motionAt(f / frames, spec.moves);
    position.push([round(centre + m.x), round(centre + pivotY + m.y), 0]);
    rotation.push([round(m.rotate)]);
    scale.push([round(m.scaleX * 100), round(m.scaleY * 100), 100]);
    opacity.push([round(m.opacity * 100)]);
  }

  const outlines = fitted.paths.map((p, n) => ({
    ty: 'sh',
    nm: `Outline ${n + 1}`,
    ks: { a: 0, k: { c: p.closed, v: p.v.map((pt) => pt.map(round)), i: p.i.map((pt) => pt.map(round)), o: p.o.map((pt) => pt.map(round)) } },
  }));

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
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4, // a shape layer
        nm: spec.name,
        sr: 1,
        ks: {
          o: property(opacity),
          r: property(rotation),
          p: property(position),
          a: { a: 0, k: [0, pivotY, 0] },
          s: property(scale),
        },
        ao: 0,
        shapes: [
          {
            ty: 'gr',
            nm: 'Shape',
            it: [
              ...outlines,
              { ty: 'fl', nm: 'Fill', c: { a: 0, k: [...hexToRgb(spec.color), 1] }, o: { a: 0, k: 100 }, r: 1 },
              {
                ty: 'tr',
                p: { a: 0, k: [0, 0] },
                a: { a: 0, k: [0, 0] },
                s: { a: 0, k: [100, 100] },
                r: { a: 0, k: 0 },
                o: { a: 0, k: 100 },
                sk: { a: 0, k: 0 },
                sa: { a: 0, k: 0 },
              },
            ],
          },
        ],
        ip: 0,
        op: frames,
        st: 0,
        bm: 0,
      },
    ],
  };
}

export type LottieAnimation = ReturnType<typeof buildLottie>;
