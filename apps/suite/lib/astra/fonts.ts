// lib/astra/fonts.ts — Astra's fonts: list, create, rename, delete, and save drawn letters.
// Each font belongs to one profile (user_id), so everyone only sees their own.

import 'server-only';
import crypto from 'node:crypto';
import db from '@/lib/db';
import {
  GLYPH_SIZE,
  MAX_POINTS,
  MAX_SHAPE_POINTS,
  MAX_SHAPES,
  MAX_STROKES,
  isEmptyGlyph,
  type Glyph,
  type Glyphs,
  type Point,
} from '@/config/astra';

export interface Font {
  id: string;
  name: string;
  /** The drawn letters. Letters not drawn yet are left out. */
  glyphs: Glyphs;
  createdAt: string;
  updatedAt: string;
}

const COLUMNS = 'id, name, glyphs, createdAt, updatedAt';
const NAME_LIMIT = 60;

// The database keeps the letters as JSON text; turn that back into an object.
type FontRow = Omit<Font, 'glyphs'> & { glyphs: string };
const fromRow = (row: FontRow): Font => {
  let glyphs: unknown = {};
  try {
    glyphs = JSON.parse(row.glyphs);
  } catch {}
  const ok = glyphs !== null && typeof glyphs === 'object' && !Array.isArray(glyphs);
  if (!ok) return { ...row, glyphs: {} };
  // Letters saved before pictures could be traced were just a list of strokes.
  const tidy: Glyphs = {};
  for (const [letter, glyph] of Object.entries(glyphs as Record<string, unknown>)) {
    tidy[letter] = Array.isArray(glyph) ? { strokes: glyph, shapes: [] } : (glyph as Glyph);
  }
  return { ...row, glyphs: tidy };
};

/** Tidy a name the page sent: trim the spaces, cap the length. Gives null if it's empty or not text. */
export function cleanName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const name = input.trim().slice(0, NAME_LIMIT);
  return name || null;
}

/** Check a list of point lists (strokes or shapes): at most `maxLists` lists of at most `maxPoints`
 *  [x, y] numbers each. Points are rounded and kept inside the grid. Lists shorter than `minPoints`
 *  are dropped. Gives null if it isn't shaped right. */
function cleanPointLists(input: unknown, maxLists: number, maxPoints: number, minPoints: number): Point[][] | null {
  if (!Array.isArray(input) || input.length > maxLists) return null;
  const inGrid = (n: number) => Math.round(Math.min(GLYPH_SIZE, Math.max(0, n)));
  const lists: Point[][] = [];
  for (const list of input) {
    if (!Array.isArray(list) || list.length > maxPoints) return null;
    const points: Point[] = [];
    for (const point of list) {
      if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
      points.push([inGrid(point[0]), inGrid(point[1])]);
    }
    if (points.length >= minPoints) lists.push(points);
  }
  return lists;
}

/** Check a letter the page sent: { strokes, shapes }. Gives null if it isn't shaped right. */
export function cleanGlyph(input: unknown): Glyph | null {
  if (input === null || typeof input !== 'object') return null;
  const { strokes, shapes } = input as Record<string, unknown>;
  const cleanStrokes = cleanPointLists(strokes ?? [], MAX_STROKES, MAX_POINTS, 1);
  const cleanShapes = cleanPointLists(shapes ?? [], MAX_SHAPES, MAX_SHAPE_POINTS, 3); // a shape needs 3 corners
  return cleanStrokes && cleanShapes ? { strokes: cleanStrokes, shapes: cleanShapes } : null;
}

/** All of this profile's fonts, most recently changed first. */
export function listFonts(userId: string): Font[] {
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM AstraFont WHERE user_id = ? ORDER BY updatedAt DESC`)
    .all(userId) as FontRow[];
  return rows.map(fromRow);
}

/** One font, or null if it doesn't exist or belongs to someone else. */
export function getFont(userId: string, id: string): Font | null {
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM AstraFont WHERE user_id = ? AND id = ?`)
    .get(userId, id) as FontRow | undefined;
  return row ? fromRow(row) : null;
}

/** Make a new, empty font. */
export function createFont(userId: string, name: string): Font {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO AstraFont (id, user_id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, name, now, now);
  return { id, name, glyphs: {}, createdAt: now, updatedAt: now };
}

/** Give a font a new name. Returns the updated font, or null if it wasn't found. */
export function renameFont(userId: string, id: string, name: string): Font | null {
  const result = db
    .prepare('UPDATE AstraFont SET name = ?, updatedAt = ? WHERE user_id = ? AND id = ?')
    .run(name, new Date().toISOString(), userId, id);
  return result.changes > 0 ? getFont(userId, id) : null;
}

/** Save one letter (nothing drawn or traced = erase it). Returns the updated font, or null if it wasn't found. */
export function saveGlyph(userId: string, id: string, letter: string, glyph: Glyph): Font | null {
  const font = getFont(userId, id);
  if (!font) return null;
  const glyphs = { ...font.glyphs };
  if (isEmptyGlyph(glyph)) delete glyphs[letter];
  else glyphs[letter] = glyph;
  db.prepare('UPDATE AstraFont SET glyphs = ?, updatedAt = ? WHERE user_id = ? AND id = ?')
    .run(JSON.stringify(glyphs), new Date().toISOString(), userId, id);
  return { ...font, glyphs };
}

/** Delete a font. Returns true if one was deleted. */
export function deleteFont(userId: string, id: string): boolean {
  return db.prepare('DELETE FROM AstraFont WHERE user_id = ? AND id = ?').run(userId, id).changes > 0;
}