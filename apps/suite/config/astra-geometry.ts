// config/astra-geometry.ts — measuring and drawing characters, shared by the page and the font file.
//
//   inkSpan      how wide a character's ink is, so each one takes up only the room it needs
//   curveFlags / shapePath   traced outlines drawn as smooth curves between their sharp corners
//   kerning      how much closer two characters can sit when their shapes leave a gap (like "AV")

import { GLYPH_SIZE, type Glyph, type Point } from './astra';

// ── Width ───────────────────────────────────────────────────────────────────────────────────────

/** The leftmost and rightmost ink of a character on the grid (pen strokes count their thickness).
 *  Null if there's no ink at all. Its width in text is this span plus SIDE_SPACE on each side. */
export function inkSpan(glyph: Glyph, penWidth: number): { left: number; right: number } | null {
  let left = Infinity;
  let right = -Infinity;
  for (const stroke of glyph.strokes) {
    for (const [x] of stroke) {
      left = Math.min(left, x - penWidth / 2);
      right = Math.max(right, x + penWidth / 2);
    }
  }
  for (const shape of glyph.shapes) {
    for (const [x] of shape) {
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  return left <= right ? { left, right } : null;
}

// ── Smooth curves ───────────────────────────────────────────────────────────────────────────────
//
// A traced outline is a list of points. Drawing straight lines between them looks slightly faceted
// on big round letters, so instead each point is either:
//   • a CORNER: the outline goes exactly through it (sharp turns, and the ends of long straight edges), or
//   • a GUIDE:  the outline curves smoothly past it, like a magnet pulling the line towards it.
// Between two guides the curve passes through the halfway point. This is exactly how TrueType fonts
// store curves, so the font file uses the same flags and looks the same as the page.

const CORNER_TURN = (35 * Math.PI) / 180; // turning more sharply than this makes a corner
const LONG_EDGE = 80; // an edge longer than this is a straight line, so both its ends are corners

/** For each point of a traced outline: true = a sharp corner, false = a smooth guide point. */
export function curveFlags(shape: Point[]): boolean[] {
  const n = shape.length;
  return shape.map((point, i) => {
    if (n < 4) return true;
    const before = shape[(i - 1 + n) % n];
    const after = shape[(i + 1) % n];
    const inX = point[0] - before[0];
    const inY = point[1] - before[1];
    const outX = after[0] - point[0];
    const outY = after[1] - point[1];
    const inLength = Math.hypot(inX, inY);
    const outLength = Math.hypot(outX, outY);
    if (inLength > LONG_EDGE || outLength > LONG_EDGE || inLength === 0 || outLength === 0) return true;
    const cos = (inX * outX + inY * outY) / (inLength * outLength);
    return Math.acos(Math.max(-1, Math.min(1, cos))) > CORNER_TURN;
  });
}

/** One traced outline as an SVG path ("M … Q … L … Z"), smooth between its corners. */
export function shapePath(shape: Point[]): string {
  const n = shape.length;
  if (n < 3) return '';
  const corner = curveFlags(shape);
  const at = ([x, y]: Point) => `${round(x)} ${round(y)}`;
  const halfway = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = corner.indexOf(true);

  if (start === -1) {
    // All smooth (like an O): start halfway between the last and first points, curve all the way round.
    let d = `M${at(halfway(shape[n - 1], shape[0]))}`;
    for (let i = 0; i < n; i++) d += `Q${at(shape[i])} ${at(halfway(shape[i], shape[(i + 1) % n]))}`;
    return `${d}Z`;
  }

  let d = `M${at(shape[start])}`;
  let guide: Point | null = null;
  for (let k = 1; k <= n; k++) {
    const point = shape[(start + k) % n];
    if (corner[(start + k) % n]) {
      d += guide ? `Q${at(guide)} ${at(point)}` : `L${at(point)}`;
      guide = null;
    } else {
      if (guide) d += `Q${at(guide)} ${at(halfway(guide, point))}`;
      guide = point;
    }
  }
  return `${d}Z`;
}

const round = (n: number) => Math.round(n * 10) / 10;

// ── Kerning ─────────────────────────────────────────────────────────────────────────────────────
//
// Every character is spaced as a box: its ink plus SIDE_SPACE on each side. For most pairs that's
// right, but some shapes leave a big empty gap next to each other: the slope of an A beside the
// slope of a V, or the arm of a T over a short o. Kerning slides such a pair closer together.
//
// How: cut both characters into thin horizontal bands. In each band, measure the empty room between
// the right edge of the first character's box and its ink, plus the empty room between the left
// edge of the second one's box and its ink. Where the two come closest, that's how much extra air
// there is; the pair is moved together by part of it. They never end up closer than normal spacing.

const BAND = 20; // band height, in grid units
const BANDS = Math.ceil(GLYPH_SIZE / BAND);
const KERN_SHARE = 0.6; // how much of the extra air to take away
const KERN_REACH = 2; // a band also counts its neighbours this many bands away (for slanted edges)
const KERN_SMALLEST = 15; // closer than this isn't worth it

/** How much empty room there is on each side of a character, band by band (Infinity = no ink there). */
export type Profile = { left: Float64Array; right: Float64Array; width: number };

export function profileOf(glyph: Glyph, penWidth: number): Profile | null {
  const span = inkSpan(glyph, penWidth);
  if (!span) return null;
  const lo = new Float64Array(BANDS).fill(Infinity); // leftmost ink in each band
  const hi = new Float64Array(BANDS).fill(-Infinity); // rightmost ink in each band
  const mark = (x1: number, x2: number, y1: number, y2: number) => {
    for (let b = Math.max(0, Math.floor(y1 / BAND)); b <= Math.min(BANDS - 1, Math.floor(y2 / BAND)); b++) {
      lo[b] = Math.min(lo[b], x1);
      hi[b] = Math.max(hi[b], x2);
    }
  };
  // Walk along every edge in small steps, marking the bands each step touches.
  const walk = (a: Point, b: Point, radius: number) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 8));
    for (let s = 0; s <= steps; s++) {
      const x = a[0] + ((b[0] - a[0]) * s) / steps;
      const y = a[1] + ((b[1] - a[1]) * s) / steps;
      mark(x - radius, x + radius, y - radius, y + radius);
    }
  };
  for (const shape of glyph.shapes) shape.forEach((point, i) => walk(point, shape[(i + 1) % shape.length], 0));
  for (const stroke of glyph.strokes) {
    if (stroke.length === 1) walk(stroke[0], stroke[0], penWidth / 2);
    for (let i = 0; i + 1 < stroke.length; i++) walk(stroke[i], stroke[i + 1], penWidth / 2);
  }
  const left = new Float64Array(BANDS);
  const right = new Float64Array(BANDS);
  for (let b = 0; b < BANDS; b++) {
    left[b] = lo[b] === Infinity ? Infinity : lo[b] - span.left;
    right[b] = hi[b] === -Infinity ? Infinity : span.right - hi[b];
  }
  return { left, right, width: span.right - span.left };
}

/** How much to move `second` towards `first` (a negative number, in grid units), or 0. */
export function kernBetween(first: Profile, second: Profile): number {
  let closest = Infinity;
  for (let b = 0; b < BANDS; b++) {
    if (first.right[b] === Infinity) continue;
    for (let o = Math.max(0, b - KERN_REACH); o <= Math.min(BANDS - 1, b + KERN_REACH); o++) {
      closest = Math.min(closest, first.right[b] + second.left[o]);
    }
  }
  if (closest === Infinity) return 0; // their ink is never at the same height: leave them be
  const kern = -Math.min(closest * KERN_SHARE, Math.min(first.width, second.width) * 0.5);
  return kern <= -KERN_SMALLEST ? Math.round(kern / 5) * 5 : 0;
}

/** Profiles for each character a font has, measured once and reused for every pair. */
export function profilesOf(glyphs: Record<string, Glyph>, penWidth: number): Map<string, Profile> {
  const profiles = new Map<string, Profile>();
  for (const [char, glyph] of Object.entries(glyphs)) {
    const profile = profileOf(glyph, penWidth);
    if (profile) profiles.set(char, profile);
  }
  return profiles;
}
