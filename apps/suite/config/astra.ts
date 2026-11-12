// config/astra.ts — Astra's shared settings, used by both the page and the server.

/** The letters a font has, in the order the grid shows them. */
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
export const isLetter = (text: string) => LETTERS.includes(text);

/** Each letter is drawn on a square GLYPH_SIZE × GLYPH_SIZE grid. Font files use 1000 too. */
export const GLYPH_SIZE = 1000;
/** Guide lines on the drawing pad: the top of capital letters, and the line letters sit on. */
export const CAP_LINE = 200;
export const BASELINE = 800;
/** How thick the pen draws, on that same grid. */
export const PEN_WIDTH = 60;

/** Limits, so one letter can't fill up the database. */
export const MAX_STROKES = 200;
export const MAX_POINTS = 2000;
export const MAX_SHAPES = 100;
export const MAX_SHAPE_POINTS = 2000;

/** One point on the grid: [across, down]. */
export type Point = [number, number];
/** One pen stroke: every point from putting the pen down to lifting it. */
export type Stroke = Point[];
/** One filled outline, traced from an uploaded picture. The last point joins back to the first.
 *  Outer edges go clockwise and holes (like the middle of an O) go the other way. */
export type Shape = Point[];
/** One letter: pen strokes, traced shapes, or both. */
export type Glyph = { strokes: Stroke[]; shapes: Shape[] };
/** A font's letters, e.g. { A: { strokes: [...], shapes: [] } }. Letters not made yet are left out. */
export type Glyphs = Record<string, Glyph>;

export const EMPTY_GLYPH: Glyph = { strokes: [], shapes: [] };
export const isEmptyGlyph = (glyph: Glyph) => glyph.strokes.length === 0 && glyph.shapes.length === 0;

// ── Spacing: how much room each letter takes up in a line of text ──

/** Empty room kept on each side of a letter, so neighbours don't touch. */
export const SIDE_SPACE = 60;
/** How wide a space between words is. */
export const SPACE_WIDTH = 320;
/** How wide a letter that hasn't been made yet is, in the preview. */
export const MISSING_WIDTH = 600;

/** The leftmost and rightmost ink of a letter on the grid (pen strokes count their thickness).
 *  Null if there's no ink at all. A letter's width in text is this span plus SIDE_SPACE on each side. */
export function inkSpan(glyph: Glyph): { left: number; right: number } | null {
  let left = Infinity;
  let right = -Infinity;
  for (const stroke of glyph.strokes) {
    for (const [x] of stroke) {
      left = Math.min(left, x - PEN_WIDTH / 2);
      right = Math.max(right, x + PEN_WIDTH / 2);
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
