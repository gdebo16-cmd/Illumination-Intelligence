// lib/chat-images.ts — photos attached to chat messages, in Lumen and in a Flicker's chat.
//
// Each photo is two things:
//   - a JPEG file, in data/chat-images/<id>.jpg
//   - a row in the ChatImage table: whose it is, and which chat it belongs to
// A message keeps the ids of its photos as a JSON list in its `images` column.
//
// Only models that can see images are ever sent photos (config/models.ts, canSeeImages).

import 'server-only';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import db from '@/lib/db';
import { MAX_PHOTOS } from '@/config/models';

const IMAGE_DIR = path.join(process.cwd(), 'data', 'chat-images');
fs.mkdirSync(IMAGE_DIR, { recursive: true });

/** Biggest upload we accept, in bytes (phone photos are 3–12 MB). */
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
// Photos are shrunk so the longer side is at most this many pixels: plenty for a model to read
// text in a photo, without filling its context window (a bigger picture costs more of it).
const MAX_SIDE = 1280;
/** Roughly how much context room one photo takes, in characters of text (about 1,500 tokens). */
export const PHOTO_CONTEXT_CHARS = 4500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fileFor = (id: string) => path.join(IMAGE_DIR, `${id}.jpg`);

/** Which chat a photo belongs to. */
export const chatKey = {
  lumen: (conversationId: string) => `lumen:${conversationId}`,
  umbra: (botId: string) => `umbra:${botId}`,
};

/** A problem with an upload that the person can fix; its message is safe to show them. */
export class PhotoError extends Error {}

/** The photo files in a submitted form (sent under the name "image"). */
export function uploadedPhotos(form: FormData): File[] {
  return form.getAll('image').filter((value): value is File => typeof value !== 'string' && value.size > 0);
}

/**
 * Get uploaded photos ready for a model: upright (phones store "rotate me" as a note instead of
 * rotating the pixels), see-through parts on white, shrunk, and saved as JPEG.
 * Throws a PhotoError if there are too many, one is too big, or one isn't a picture.
 */
export async function preparePhotos(uploads: File[]): Promise<Buffer[]> {
  if (uploads.length > MAX_PHOTOS) throw new PhotoError(`Add up to ${MAX_PHOTOS} photos per message.`);
  return Promise.all(
    uploads.map(async (upload) => {
      if (upload.size > MAX_PHOTO_BYTES) throw new PhotoError('That photo is too big (over 25 MB).');
      try {
        return await sharp(Buffer.from(await upload.arrayBuffer()))
          .rotate()
          .flatten({ background: '#ffffff' })
          .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
      } catch {
        throw new PhotoError('That file isn’t a picture I can read. Try a JPEG, PNG or WebP.');
      }
    }),
  );
}

/** Save prepared photos for one chat. Returns their ids, in order. */
export function savePhotos(userId: string, chat: string, photos: Buffer[]): string[] {
  const insert = db.prepare('INSERT INTO ChatImage (id, user_id, chat, createdAt) VALUES (?, ?, ?, ?)');
  return photos.map((photo) => {
    const id = crypto.randomUUID();
    fs.writeFileSync(fileFor(id), photo);
    try {
      insert.run(id, userId, chat, new Date().toISOString());
    } catch (err) {
      // Don't leave a file behind with no record of it.
      fs.rmSync(fileFor(id), { force: true });
      throw err;
    }
    return id;
  });
}

/** The JPEG file for one photo, only if it belongs to this profile. */
export function readPhoto(userId: string, id: string): Buffer | null {
  if (!UUID.test(id)) return null;
  const row = db.prepare('SELECT user_id FROM ChatImage WHERE id = ?').get(id) as { user_id: string } | undefined;
  if (!row || row.user_id !== userId) return null;
  return fs.existsSync(fileFor(id)) ? fs.readFileSync(fileFor(id)) : null;
}

/** Remove every photo in a chat (when the chat is deleted or cleared). */
export function deletePhotos(chat: string): void {
  const rows = db.prepare('SELECT id FROM ChatImage WHERE chat = ?').all(chat) as { id: string }[];
  for (const { id } of rows) fs.rmSync(fileFor(id), { force: true });
  db.prepare('DELETE FROM ChatImage WHERE chat = ?').run(chat);
}

/** A message's `images` column (JSON text, or empty) as a list of photo ids. */
export function photoIds(column: string | null | undefined): string[] {
  if (!column) return [];
  try {
    const ids: unknown = JSON.parse(column);
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && UUID.test(id)) : [];
  } catch {
    return [];
  }
}

/**
 * Turn chat messages into what Ollama reads. A message's photo ids become the pictures themselves
 * (Ollama takes them as base64 text in `images`), but only when the model can see, and only for
 * the newest few photos in the chat: each one takes context room, so older ones drop out of view.
 * Where a photo isn't shown, a short note takes its place so the model knows one was there.
 */
export function withPhotos<T extends { content: string; images?: string[] }>(messages: T[], canSee: boolean): T[] {
  let shown = 0;
  const out: T[] = [];
  // Newest first, so the newest photos are the ones kept in view.
  for (let i = messages.length - 1; i >= 0; i--) {
    const { images: ids = [], ...rest } = messages[i];
    const message = rest as T;
    if (ids.length > 0) {
      const pictures: string[] = [];
      if (canSee && shown + ids.length <= MAX_PHOTOS) {
        for (const id of ids) {
          if (UUID.test(id) && fs.existsSync(fileFor(id))) pictures.push(fs.readFileSync(fileFor(id)).toString('base64'));
        }
      }
      if (pictures.length > 0) {
        shown += pictures.length;
        message.images = pictures;
      } else {
        const what = ids.length === 1 ? 'A photo was' : `${ids.length} photos were`;
        const why = canSee ? 'It is no longer in view.' : 'You can’t see photos.';
        message.content = `${message.content}\n\n[${what} attached here. ${why}]`.trim();
      }
    }
    out.unshift(message);
  }
  return out;
}
