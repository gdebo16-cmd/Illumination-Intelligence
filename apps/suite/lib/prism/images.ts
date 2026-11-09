// lib/prism/images.ts — saving and finding Prism's pictures.
//
// Each picture is two things:
//   - the PNG file, in data/prism/images/<id>.png
//   - a row in the PrismImage table: who made it, and the prompt/style/seed/size used

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
  createdAt: string;
  /** Where the browser loads the picture from. */
  url: string;
}

type Row = Omit<PrismImage, 'url'>;
const withUrl = (row: Row): PrismImage => ({ ...row, url: `/api/prism/images/${row.id}` });

/** Save a finished picture and its details. */
export function saveImage(userId: string, prompt: string, style: string, result: ImageResult): PrismImage {
  const id = crypto.randomUUID();
  const file = path.join(IMAGE_DIR, `${id}.png`);
  fs.writeFileSync(file, result.image);

  const createdAt = new Date().toISOString();
  try {
    db.prepare(
      `INSERT INTO PrismImage (id, user_id, prompt, style, seed, width, height, seconds, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, userId, prompt, style, result.seed, result.width, result.height, result.seconds, createdAt);
  } catch (err) {
    // Don't leave a picture file behind with no record of it.
    fs.rmSync(file, { force: true });
    throw err;
  }

  return withUrl({ id, prompt, style, seed: result.seed, width: result.width, height: result.height, seconds: result.seconds, createdAt });
}

/** A profile's pictures, newest first. */
export function listImages(userId: string, limit = 60): PrismImage[] {
  const rows = db
    .prepare(
      `SELECT id, prompt, style, seed, width, height, seconds, createdAt
       FROM PrismImage WHERE user_id = ? ORDER BY createdAt DESC LIMIT ?`,
    )
    .all(userId, limit) as Row[];
  return rows.map(withUrl);
}

/** The PNG file for one picture, only if it belongs to this profile. */
export function readImageFile(userId: string, id: string): Buffer | null {
  const row = db.prepare('SELECT user_id FROM PrismImage WHERE id = ?').get(id) as { user_id: string } | undefined;
  if (!row || row.user_id !== userId) return null;
  const file = path.join(IMAGE_DIR, `${id}.png`);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}
