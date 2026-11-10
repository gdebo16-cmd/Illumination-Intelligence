// lib/prism/images.ts — saving and finding Prism's pictures.
//
// Each picture is two things:
//   - the PNG file, in data/prism/images/<id>.png
//   - a row in the PrismImage table: who made it, and the prompt/style/seed/size/model used

import 'server-only';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import db from '@/lib/db';
import type { ImageResult } from './comfy';

const IMAGE_DIR = path.join(process.cwd(), 'data', 'prism', 'images');
fs.mkdirSync(IMAGE_DIR, { recursive: true });

export interface PrismImage {
  id: string;
  prompt: string;
  style: string;
  seed: number;
  width: number;
  height: number;
  seconds: number | null;
  /** The model that painted it: an id from config/prism-models.ts. */
  model: string;
  /** What the prompt expander turned your prompt into. null when it wasn't used. */
  expandedPrompt: string | null;
  /**
   * 'create' = made from words; 'edit' = an edited picture (prompt is the instruction);
   * 'upscale' = a bigger copy of another picture (it keeps that picture's prompt and settings).
   */
  mode: 'create' | 'edit' | 'upscale';
  /** For an edit or an upscale of one of your Prism pictures: which one. */
  sourceId: string | null;
  createdAt: string;
  /** Where the browser loads the picture from. */
  url: string;
}

type Row = Omit<PrismImage, 'url'>;
const withUrl = (row: Row): PrismImage => ({ ...row, url: `/api/prism/images/${row.id}` });

/**
 * Save a finished picture and its details. Pass `from` when it was made from another picture:
 * by editing it (the usual case) or, with mode 'upscale', by making it bigger.
 */
export function saveImage(
  userId: string,
  prompt: string,
  style: string,
  result: Omit<ImageResult, 'machine'>,
  from?: { sourceId: string | null; mode?: 'edit' | 'upscale' },
): PrismImage {
  const mode = from ? (from.mode ?? 'edit') : 'create';
  const sourceId = from?.sourceId ?? null;
  const id = crypto.randomUUID();
  const file = path.join(IMAGE_DIR, `${id}.png`);
  fs.writeFileSync(file, result.image);

  const createdAt = new Date().toISOString();
  try {
    db.prepare(
      `INSERT INTO PrismImage (id, user_id, prompt, style, seed, width, height, seconds, model, expanded_prompt, mode, source_id, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, userId, prompt, style, result.seed, result.width, result.height, result.seconds, result.model, result.expandedPrompt,
      mode, sourceId, createdAt,
    );
  } catch (err) {
    // Don't leave a picture file behind with no record of it.
    fs.rmSync(file, { force: true });
    throw err;
  }

  return withUrl({
    id, prompt, style, seed: result.seed, width: result.width, height: result.height, seconds: result.seconds,
    model: result.model, expandedPrompt: result.expandedPrompt, mode, sourceId, createdAt,
  });
}

/** A profile's pictures, newest first. */
export function listImages(userId: string, limit = 60): PrismImage[] {
  const rows = db
    .prepare(
      `SELECT id, prompt, style, seed, width, height, seconds, model, expanded_prompt AS expandedPrompt, mode,
              source_id AS sourceId, createdAt
       FROM PrismImage WHERE user_id = ? ORDER BY createdAt DESC LIMIT ?`,
    )
    .all(userId, limit) as Row[];
  return rows.map(withUrl);
}

/** One picture's details, only if it belongs to this profile. */
export function getImage(userId: string, id: string): PrismImage | null {
  const row = db
    .prepare(
      `SELECT id, prompt, style, seed, width, height, seconds, model, expanded_prompt AS expandedPrompt, mode,
              source_id AS sourceId, createdAt
       FROM PrismImage WHERE id = ? AND user_id = ?`,
    )
    .get(id, userId) as Row | undefined;
  return row ? withUrl(row) : null;
}

/** The PNG file for one picture, only if it belongs to this profile. */
export function readImageFile(userId: string, id: string): Buffer | null {
  const row = db.prepare('SELECT user_id FROM PrismImage WHERE id = ?').get(id) as { user_id: string } | undefined;
  if (!row || row.user_id !== userId) return null;
  const file = path.join(IMAGE_DIR, `${id}.png`);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}
