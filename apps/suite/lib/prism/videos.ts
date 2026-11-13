// lib/prism/videos.ts — making, saving and finding Prism's videos.
//
// A video takes minutes, longer than a phone will happily keep a page request open. So making
// one works like a takeaway order instead of waiting at the counter:
//   1. startVideo() writes a row with status 'working' and answers right away;
//   2. the GPU queue makes the video in the background and marks the row 'done' (or 'failed');
//   3. the page checks the list every few seconds until it's done.
// Each video is two files in data/prism/videos/: <id>.mp4, and <id>.png (its starting picture).

import 'server-only';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import db from '@/lib/db';
import { gpuQueue } from '@/lib/queue';
import { VIDEO_LENGTHS, generateVideo, videoNeeds, type VideoLengthId } from './video-workflow';
import type { PreparedSource } from './source';

const VIDEO_DIR = path.join(process.cwd(), 'data', 'prism', 'videos');
fs.mkdirSync(VIDEO_DIR, { recursive: true });

// A video still 'working' after this long was cut off (say, the server restarted mid-way).
const GIVE_UP_MINUTES = 45;

export interface PrismVideo {
  id: string;
  /** The Prism picture it started from (empty for an uploaded picture). */
  imageId: string | null;
  prompt: string;
  length: VideoLengthId;
  frames: number;
  seed: number;
  width: number;
  height: number;
  status: 'working' | 'done' | 'failed';
  error: string | null;
  seconds: number | null;
  createdAt: string;
  /** Where the browser loads the video from (once it's done). */
  url: string;
  /** The starting picture, shown before the video plays and while it's being made. */
  poster: string;
}

type Row = Omit<PrismVideo, 'url' | 'poster'>;
const withUrls = (row: Row): PrismVideo => ({
  ...row,
  url: `/api/prism/videos/${row.id}`,
  poster: `/api/prism/videos/${row.id}?poster=1`,
});

const COLUMNS = `id, image_id AS imageId, prompt, length, frames, seed, width, height, status, error, seconds, createdAt`;

/**
 * Order a video. Returns straight away with status 'working'; the video is made in the
 * background. `picture` must already be prepared at the video size.
 */
export function startVideo(
  userId: string,
  options: { prompt: string; length: VideoLengthId; picture: PreparedSource; imageId: string | null },
): PrismVideo {
  const length = VIDEO_LENGTHS.find((l) => l.id === options.length)!;
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const { picture } = options;

  fs.writeFileSync(path.join(VIDEO_DIR, `${id}.png`), picture.png);
  db.prepare(
    `INSERT INTO PrismVideo (id, user_id, image_id, prompt, length, frames, seed, width, height, status, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'working', ?)`,
  ).run(id, userId, options.imageId, options.prompt, length.id, length.frames, picture.width, picture.height, createdAt);

  // Not awaited on purpose: this keeps going after the page gets its answer.
  // The GPU queue picks a machine that has the video model (see lib/gpu/router.ts).
  void gpuQueue
    .add((worker) => generateVideo({ prompt: options.prompt, picture, frames: length.frames }, worker), 'high', 'comfy', {
      userId,
      needs: videoNeeds(),
    })
    .then((result) => {
      fs.writeFileSync(path.join(VIDEO_DIR, `${id}.mp4`), result.video);
      db.prepare(`UPDATE PrismVideo SET status = 'done', seed = ?, seconds = ? WHERE id = ?`).run(result.seed, result.seconds, id);
    })
    .catch((err: Error) => {
      console.error('Prism video error:', err);
      const friendly = /fetch failed|ECONNREFUSED/i.test(err.message ?? '')
        ? 'ComfyUI isn’t running. Start it with run_nvidia_gpu.bat and try again.'
        : err.message || 'Something went wrong.';
      db.prepare(`UPDATE PrismVideo SET status = 'failed', error = ? WHERE id = ?`).run(friendly, id);
    });

  return withUrls({
    id, imageId: options.imageId, prompt: options.prompt, length: length.id, frames: length.frames, seed: 0,
    width: picture.width, height: picture.height, status: 'working', error: null, seconds: null, createdAt,
  });
}

/** A profile's videos, newest first. */
export function listVideos(userId: string, limit = 40): PrismVideo[] {
  // Anything stuck 'working' for too long was interrupted; say so instead of spinning forever.
  const cutoff = new Date(Date.now() - GIVE_UP_MINUTES * 60_000).toISOString();
  db.prepare(
    `UPDATE PrismVideo SET status = 'failed', error = 'This video was interrupted. Please try again.'
     WHERE user_id = ? AND status = 'working' AND createdAt < ?`,
  ).run(userId, cutoff);

  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM PrismVideo WHERE user_id = ? ORDER BY createdAt DESC LIMIT ?`)
    .all(userId, limit) as Row[];
  return rows.map(withUrls);
}

export interface LengthChoice {
  id: VideoLengthId;
  name: string;
  /** Length of the clip, in seconds. */
  seconds: number;
  /** How long making it usually takes, in seconds. */
  wait: number;
  /** How many finished videos that average comes from (0 = still the first guess). */
  runs: number;
}

/**
 * The length choices, each with how long it usually takes: the average of the videos made
 * so far at that length (everyone's, since it's the same graphics card), or the first guess.
 */
export function lengthChoices(): LengthChoice[] {
  const rows = db
    .prepare(`SELECT length, AVG(seconds) AS average, COUNT(*) AS runs FROM PrismVideo WHERE status = 'done' GROUP BY length`)
    .all() as { length: string; average: number; runs: number }[];
  return VIDEO_LENGTHS.map((l) => {
    const made = rows.find((r) => r.length === l.id);
    return { id: l.id, name: l.name, seconds: l.seconds, wait: made ? made.average : l.estimate, runs: made?.runs ?? 0 };
  });
}

/**
 * Delete one video for good: its row, the MP4 and its starting picture. Only if it belongs to
 * this profile. A video that's still being made can't be deleted (the job would finish and
 * leave a file behind with no record of it); that gives 'working'.
 */
export function deleteVideo(userId: string, id: string): 'deleted' | 'working' | 'missing' {
  const row = db.prepare('SELECT status FROM PrismVideo WHERE id = ? AND user_id = ?').get(id, userId) as
    | { status: PrismVideo['status'] }
    | undefined;
  if (!row) return 'missing';
  if (row.status === 'working') return 'working';
  db.prepare('DELETE FROM PrismVideo WHERE id = ? AND user_id = ?').run(id, userId);
  fs.rmSync(path.join(VIDEO_DIR, `${id}.mp4`), { force: true });
  fs.rmSync(path.join(VIDEO_DIR, `${id}.png`), { force: true });
  return 'deleted';
}

/** One video's file (the MP4, or its starting picture), only if it belongs to this profile. */
export function videoFilePath(userId: string, id: string, kind: 'video' | 'poster'): string | null {
  const row = db.prepare('SELECT user_id FROM PrismVideo WHERE id = ?').get(id) as { user_id: string } | undefined;
  if (!row || row.user_id !== userId) return null;
  const file = path.join(VIDEO_DIR, `${id}.${kind === 'video' ? 'mp4' : 'png'}`);
  return fs.existsSync(file) ? file : null;
}

