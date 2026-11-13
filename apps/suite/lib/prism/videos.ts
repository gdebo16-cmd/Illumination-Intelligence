// lib/prism/videos.ts — making, saving and finding Prism's videos.
//
// A video takes minutes, longer than a phone will happily keep a page request open. So making
// one works like a takeaway order instead of waiting at the counter:
//   1. startVideo() writes a row with status 'working' and answers right away;
//   2. the GPU queue makes the video in the background and marks the row 'done' (or 'failed');
//   3. the page checks the list every few seconds until it's done.
// Each video is two files in data/prism/videos/: <id>.mp4, and <id>.png (its starting picture,
// or for a video made from words, its first frame once it's done).

import 'server-only';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import db from '@/lib/db';
import { gpuQueue } from '@/lib/queue';
import { checkWorkers } from '../gpu/health.ts';
import { GPU_WORKERS } from '../../config/gpu-workers.ts';
import {
  PRISM_VIDEO_MODELS, VIDEO_LENGTHS, findVideoModel, framesFor,
  type VideoLengthId, type VideoModelId,
} from '../../config/prism-video-models.ts';
import { generateVideo, videoFiles, videoNeeds, type VideoMode } from './video';
import { SMOOTH_FILE, smoothNeeds, smoothVideo } from './smooth';
import type { PreparedSource } from './source';

const VIDEO_DIR = path.join(process.cwd(), 'data', 'prism', 'videos');
fs.mkdirSync(VIDEO_DIR, { recursive: true });

// A video still 'working' after this long was cut off (say, the server restarted mid-way).
// (Up to 30 minutes on the GPU, plus time waiting in the queue.)
const GIVE_UP_MINUTES = 60;

export interface PrismVideo {
  id: string;
  /** The Prism picture it started from (empty for an uploaded picture). */
  imageId: string | null;
  prompt: string;
  /** The video model that made it (config/prism-video-models.ts). */
  model: VideoModelId;
  /** Made from a picture ('image') or from words only ('text'). */
  mode: VideoMode;
  length: VideoLengthId;
  /** How long the clip is, in seconds. */
  clipSeconds: number;
  /** For a smoothed copy ("Smooth"): the video it was made from. Null for every other video. */
  smoothOf: string | null;
  /** Frames per second: the model's, or twice that for a smoothed copy. */
  fps: number;
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
  /**
   * The starting picture, shown before the video plays and while it's being made. A video from
   * words has none until it's done (then it's the first frame); null until then.
   */
  poster: string | null;
}

type Row = Omit<PrismVideo, 'url' | 'poster' | 'clipSeconds' | 'model' | 'fps'> & { model: string | null };
const withUrls = (row: Row): PrismVideo => {
  const model = findVideoModel(row.model).id;
  const hasPoster = row.mode === 'image' || fs.existsSync(path.join(VIDEO_DIR, `${row.id}.png`));
  return {
    ...row,
    model,
    fps: findVideoModel(model).fps * (row.smoothOf ? 2 : 1),
    clipSeconds: VIDEO_LENGTHS.find((l) => l.id === row.length)?.seconds ?? Math.round(row.frames / findVideoModel(model).fps),
    url: `/api/prism/videos/${row.id}`,
    poster: hasPoster ? `/api/prism/videos/${row.id}?poster=1` : null,
  };
};

const COLUMNS = `id, image_id AS imageId, prompt, model, mode, smooth_of AS smoothOf, length, frames, seed, width, height, status, error, seconds, createdAt`;

/**
 * Order a video. Returns straight away with status 'working'; the video is made in the
 * background. From a picture: `picture` must already be prepared at the model's video size.
 * From words only: leave `picture` out and give the frame `size` instead.
 */
export function startVideo(
  userId: string,
  options: {
    prompt: string;
    model: VideoModelId;
    length: VideoLengthId;
    picture?: PreparedSource;
    size?: { width: number; height: number };
    imageId: string | null;
  },
): PrismVideo {
  const length = VIDEO_LENGTHS.find((l) => l.id === options.length)!;
  const model = findVideoModel(options.model);
  const frames = framesFor(model, length.seconds);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const { picture } = options;
  const mode: VideoMode = picture ? 'image' : 'text';
  const size = picture ?? options.size;
  if (!size) throw new Error('A video from words needs a size.');

  if (picture) fs.writeFileSync(path.join(VIDEO_DIR, `${id}.png`), picture.png);
  db.prepare(
    `INSERT INTO PrismVideo (id, user_id, image_id, prompt, model, mode, length, frames, seed, width, height, status, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'working', ?)`,
  ).run(id, userId, options.imageId, options.prompt, model.id, mode, length.id, frames, size.width, size.height, createdAt);

  // Not awaited on purpose: this keeps going after the page gets its answer.
  // The GPU queue picks a machine that has the video model's files (see lib/gpu/router.ts).
  const request = {
    model: model.id,
    prompt: options.prompt,
    frames,
    ...(picture ? { picture } : { size: { width: size.width, height: size.height } }),
  };
  void gpuQueue
    .add((worker) => generateVideo(request, worker), 'high', 'comfy', {
      userId,
      needs: videoNeeds(model.id, mode),
    })
    .then((result) => {
      fs.writeFileSync(path.join(VIDEO_DIR, `${id}.mp4`), result.video);
      if (result.poster) fs.writeFileSync(path.join(VIDEO_DIR, `${id}.png`), result.poster);
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
    id, imageId: options.imageId, prompt: options.prompt, model: model.id, mode, smoothOf: null, length: length.id, frames, seed: 0,
    width: size.width, height: size.height, status: 'working', error: null, seconds: null, createdAt,
  });
}

/**
 * "Smooth" a finished video: a new video, made in the background, with an in-between frame
 * after every frame (lib/prism/smooth.ts). The original is kept. Returns 'missing' when the
 * video isn't this profile's, 'not-done' when it isn't finished, 'smoothed' when it's already
 * a smoothed copy.
 */
export function startSmooth(userId: string, sourceId: string): PrismVideo | 'missing' | 'not-done' | 'smoothed' {
  const source = db.prepare(`SELECT ${COLUMNS} FROM PrismVideo WHERE id = ? AND user_id = ?`).get(sourceId, userId) as Row | undefined;
  if (!source) return 'missing';
  if (source.status !== 'done') return 'not-done';
  if (source.smoothOf) return 'smoothed';
  const mp4 = path.join(VIDEO_DIR, `${source.id}.mp4`);
  if (!fs.existsSync(mp4)) return 'missing';

  // Read it now, so deleting the original while this waits in line doesn't matter.
  const original = fs.readFileSync(mp4);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const frames = source.frames * 2 - 1; // an in-between frame in every gap
  const fps = findVideoModel(source.model).fps;
  const poster = path.join(VIDEO_DIR, `${source.id}.png`);
  if (fs.existsSync(poster)) fs.copyFileSync(poster, path.join(VIDEO_DIR, `${id}.png`));
  db.prepare(
    `INSERT INTO PrismVideo (id, user_id, image_id, prompt, model, mode, smooth_of, length, frames, seed, width, height, status, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'working', ?)`,
  ).run(
    id, userId, source.imageId, source.prompt, findVideoModel(source.model).id, source.mode, source.id, source.length, frames,
    source.seed, source.width, source.height, createdAt,
  );

  void gpuQueue
    .add((worker) => smoothVideo(original, fps, worker), 'high', 'comfy', { userId, needs: smoothNeeds() })
    .then((result) => {
      fs.writeFileSync(path.join(VIDEO_DIR, `${id}.mp4`), result.video);
      db.prepare(`UPDATE PrismVideo SET status = 'done', seconds = ? WHERE id = ?`).run(result.seconds, id);
    })
    .catch((err: Error) => {
      console.error('Prism smooth error:', err);
      const friendly = /fetch failed|ECONNREFUSED/i.test(err.message ?? '')
        ? 'ComfyUI isn’t running. Start it with run_nvidia_gpu.bat and try again.'
        : err.message || 'Something went wrong.';
      db.prepare(`UPDATE PrismVideo SET status = 'failed', error = ? WHERE id = ?`).run(friendly, id);
    });

  return withUrls({
    id, imageId: source.imageId, prompt: source.prompt, model: source.model, mode: source.mode, smoothOf: source.id,
    length: source.length, frames, seed: source.seed, width: source.width, height: source.height,
    status: 'working', error: null, seconds: null, createdAt,
  });
}

/** How long smoothing usually takes, in seconds: the average so far, or a first guess. */
export function smoothWait(): number {
  const row = db.prepare(`SELECT AVG(seconds) AS average FROM PrismVideo WHERE status = 'done' AND smooth_of IS NOT NULL`).get() as
    | { average: number | null }
    | undefined;
  return row?.average ?? 60;
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
 * The length choices for each video model, each with how long it usually takes: the average of
 * the videos that model has made so far at that length (everyone's, since it's the same
 * graphics card), or the first guess from config/prism-video-models.ts.
 */
export function lengthChoices(): Record<VideoModelId, LengthChoice[]> {
  const rows = db
    .prepare(
      `SELECT COALESCE(model, '${PRISM_VIDEO_MODELS[0].id}') AS model, length, AVG(seconds) AS average, COUNT(*) AS runs
       FROM PrismVideo WHERE status = 'done' AND smooth_of IS NULL GROUP BY 1, length`,
    )
    .all() as { model: string; length: string; average: number; runs: number }[];
  const choices = {} as Record<VideoModelId, LengthChoice[]>;
  for (const model of PRISM_VIDEO_MODELS) {
    choices[model.id] = VIDEO_LENGTHS.map((l) => {
      const made = rows.find((r) => r.model === model.id && r.length === l.id);
      return { id: l.id, name: l.name, seconds: l.seconds, wait: made ? made.average : model.estimates[l.id], runs: made?.runs ?? 0 };
    });
  }
  return choices;
}

export interface VideoModelStatus {
  id: VideoModelId;
  /** Whether some machine's ComfyUI has every file for a video from a picture, and from words. */
  ready: Record<VideoMode, boolean>;
  /** The files still missing for each (on the machine closest to having them all). */
  missing: Record<VideoMode, string[]>;
}

/**
 * Whether each video model is downloaded yet, for each mode, and whether some machine can
 * Smooth (has the RIFE add-on). Null when ComfyUI isn't running anywhere, so there's no way to
 * tell (the page then lets you pick anything).
 */
export async function videoModelStatus(): Promise<{ models: VideoModelStatus[]; smooth: boolean } | null> {
  const online = (await checkWorkers(GPU_WORKERS)).filter((s) => s.online);
  if (!online.length) return null;
  const smooth = online.some((s) => s.files.has(SMOOTH_FILE));
  const models = PRISM_VIDEO_MODELS.map((model) => {
    const status: VideoModelStatus = { id: model.id, ready: { image: false, text: false }, missing: { image: [], text: [] } };
    for (const mode of ['image', 'text'] as const) {
      const files = videoFiles(model.id, mode);
      const missingOn = online.map((s) => files.filter((f) => !s.files.has(f))).sort((a, b) => a.length - b.length);
      status.ready[mode] = missingOn[0].length === 0;
      status.missing[mode] = missingOn[0];
    }
    return status;
  });
  return { models, smooth };
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

