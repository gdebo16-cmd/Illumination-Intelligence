// config/astra.ts — Astra's shared settings, used by both the page and the server.
// The geometry helpers (letter widths, smooth curves, kerning) are in config/astra-geometry.ts.

// ── The characters a font can have ──────────────────────────────────────────────────────────────

export type CharacterGroup = { id: string; name: string; characters: string[] };

/** The characters a font can have, in the groups (and order) the page shows them. */
export const CHARACTER_GROUPS: CharacterGroup[] = [
  { id: 'capitals', name: 'Capitals', characters: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'] },
  { id: 'lowercase', name: 'Lowercase', characters: [...'abcdefghijklmnopqrstuvwxyz'] },
  { id: 'numbers', name: 'Numbers', characters: [...'0123456789'] },
  { id: 'punctuation', name: 'Punctuation', characters: [...'.,!?\'"-:;()&@#$%*+=/_'] },
];
export const CHARACTERS = CHARACTER_GROUPS.flatMap((group) => group.characters);
export const isCharacter = (text: string) => CHARACTERS.includes(text);
/** The capitals A to Z. */
export const LETTERS = CHARACTER_GROUPS[0].characters;

/** A lowercase letter that hasn't been made yet borrows its capital. Everything else has no stand-in. */
export const fallbackFor = (char: string): string | null => {
  const upper = char.toUpperCase();
  return upper !== char && LETTERS.includes(upper) ? upper : null;
};

// ── The drawing grid ────────────────────────────────────────────────────────────────────────────

/** Each character is drawn on a square GLYPH_SIZE × GLYPH_SIZE grid. Font files use 1000 too.
 *  y goes DOWN the grid (0 at the top). */
export const GLYPH_SIZE = 1000;
/** Guide lines on the drawing pad, from the top down: */
export const CAP_LINE = 200; // the top of capitals, numbers, and tall lowercase like b, d, h
export const X_LINE = 380; // the top of short lowercase like a, c, e, x (the "x-height")
export const BASELINE = 800; // the line everything sits on
export const DESCENT_LINE = 950; // how far tails like g, j, p, q, y hang below

/** Where a character's ink normally reaches, top to bottom, on the grid. Used to place a traced
 *  picture of it (the picture is scaled so its ink fills this height). */
export function characterBox(char: string): { top: number; bottom: number } {
  const box = (top: number, bottom: number) => ({ top, bottom });
  if (LETTERS.includes(char)) return char === 'Q' ? box(CAP_LINE, 860) : box(CAP_LINE, BASELINE);
  if (/[0-9]/.test(char)) return box(CAP_LINE, BASELINE);
  if (/[bdfhkl]/.test(char)) return box(CAP_LINE, BASELINE);
  if (char === 't') return box(260, BASELINE);
  if (char === 'i') return box(230, BASELINE);
  if (char === 'j') return box(230, DESCENT_LINE);
  if (/[gpqy]/.test(char)) return box(X_LINE, DESCENT_LINE);
  if (/[a-z]/.test(char)) return box(X_LINE, BASELINE);
  const punctuation: Record<string, [number, number]> = {
    '.': [710, BASELINE], ',': [710, 890], '!': [CAP_LINE, BASELINE], '?': [CAP_LINE, BASELINE],
    "'": [CAP_LINE, 400], '"': [CAP_LINE, 400], '-': [530, 590], ':': [X_LINE, BASELINE], ';': [X_LINE, 890],
    '(': [170, 920], ')': [170, 920], '&': [CAP_LINE, BASELINE], '@': [260, 880], '#': [CAP_LINE, BASELINE],
    '$': [150, 850], '%': [CAP_LINE, BASELINE], '*': [CAP_LINE, 470], '+': [X_LINE, 740], '=': [470, 670],
    '/': [170, 880], '_': [880, 930],
  };
  const [top, bottom] = punctuation[char] ?? [CAP_LINE, BASELINE];
  return box(top, bottom);
}

/** How a character is described to the AI painter. */
export function characterName(char: string): string {
  if (LETTERS.includes(char)) return `the capital letter ${char}`;
  if (/[a-z]/.test(char)) return `the lowercase letter ${char}`;
  if (/[0-9]/.test(char)) return `the number ${char}`;
  const names: Record<string, string> = {
    '.': 'a full stop (period)', ',': 'a comma', '!': 'an exclamation mark', '?': 'a question mark',
    "'": 'an apostrophe', '"': 'a double quotation mark', '-': 'a hyphen', ':': 'a colon', ';': 'a semicolon',
    '(': 'an opening parenthesis', ')': 'a closing parenthesis', '&': 'an ampersand (&)', '@': 'an at sign (@)',
    '#': 'a hash sign (#)', '$': 'a dollar sign', '%': 'a percent sign', '*': 'an asterisk', '+': 'a plus sign',
    '=': 'an equals sign', '/': 'a forward slash', '_': 'an underscore',
  };
  return names[char] ?? `the character ${char}`;
}

// ── The pen ─────────────────────────────────────────────────────────────────────────────────────

/** How thick the pen draws, on the grid. Each font has its own; new fonts start here. */
export const DEFAULT_PEN_WIDTH = 60;
export const MIN_PEN_WIDTH = 20;
export const MAX_PEN_WIDTH = 160;

// ── Limits, so one character can't fill up the database ─────────────────────────────────────────

export const MAX_STROKES = 200;
export const MAX_POINTS = 2000;
export const MAX_SHAPES = 100;
export const MAX_SHAPE_POINTS = 2000;

// ── What a character is made of ─────────────────────────────────────────────────────────────────

/** One point on the grid: [across, down]. */
export type Point = [number, number];
/** One pen stroke: every point from putting the pen down to lifting it. */
export type Stroke = Point[];
/** One filled outline, traced from a picture. The last point joins back to the first. Outer edges
 *  go clockwise and holes (like the middle of an O) go the other way. Between sharp corners the
 *  outline is drawn as a smooth curve (see config/astra-geometry.ts). */
export type Shape = Point[];
/** One character: pen strokes, traced shapes, or both. */
export type Glyph = { strokes: Stroke[]; shapes: Shape[] };
/** A font's characters, e.g. { A: { strokes: [...], shapes: [] }, "?": {...} }. Ones not made yet are left out. */
export type Glyphs = Record<string, Glyph>;

export const EMPTY_GLYPH: Glyph = { strokes: [], shapes: [] };
export const isEmptyGlyph = (glyph: Glyph) => glyph.strokes.length === 0 && glyph.shapes.length === 0;

// ── Spacing: how much room each character takes up in a line of text ──

/** Empty room kept on each side of a character, so neighbours don't touch. */
export const SIDE_SPACE = 60;
/** How wide a space between words is. */
export const SPACE_WIDTH = 320;
/** How wide a character that hasn't been made yet is, in the preview. */
export const MISSING_WIDTH = 600;
