// lib/prism/imageJobs.ts — making Prism pictures (new ones, edits and upscales) in the background.
//
// A picture used to be made while the page waited on the same request. On an iPhone, leaving
// the Home Screen app pauses the page and cuts that request off, so the page said the picture
// failed even though it was still being made. Now pictures work like videos (lib/prism/videos.ts):
//   1. startImageJob() writes a row with status 'working' and answers right away;
//   2. the GPU queue makes the picture in the background, saves it like before (saveImage),
//      and marks the row 'done' with the new picture's id (or 'failed' with a reason);
//   3. the page checks GET /api/prism/jobs every couple of seconds, and again whenever you come
//      back to the app, until it's done.
// The job doesn't depend on the page at all, so closing or minimizing it changes nothing.

import 'server-only';
import crypto from 'node:crypto';
import db from '@/lib/db';
import { gpuQueue, type GpuNeeds, type GpuWorker } from '@/lib/queue';
import { ranOutOfMemory } from './comfy';

// One row per picture being made. Finished pictures still go in PrismImage, as always; this table
// only remembers how each job went, and which picture it made.
//
// The table is set up the first time it's needed, not when this file loads: `next build` loads
// every route in many workers at once to look at it, and they all writing to the database at the
// same moment locked it and broke the build.
//
// The GPU queue forgets everything when the server restarts, so a job still 'working' from
// before a restart will never finish. That first use also says so. (globalThis, because Next can
// load this file more than once; this must run only once per server, or it would cut off a job
// that's really still running.)
const g = globalThis as unknown as { prismImageJobsReady?: boolean };
function ready(): void {
  if (g.prismImageJobsReady) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS PrismImageJob (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'create',
      prompt TEXT NOT NULL,
      model TEXT NOT NULL,
      source_id TEXT,
      status TEXT NOT NULL DEFAULT 'working',
      error TEXT,
      image_id TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_prism_image_job_user ON PrismImageJob (user_id, createdAt);
  `);
  db.prepare(
    `UPDATE PrismImageJob SET status = 'failed', error = 'This picture was interrupted when the server restarted. Please try again.'
     WHERE status = 'working'`,
  ).run();
  g.prismImageJobsReady = true;
}

// Just in case: a picture still 'working' after this long is given up on. (It can wait in line
// behind videos, which take several minutes each, so this is generous.)
const GIVE_UP_MINUTES = 60;

// Finished and failed jobs are only kept around long enough for the page to notice them.
const KEEP_FINISHED_MINUTES = 60;

export interface PrismImageJob {
  id: string;
  mode: 'create' | 'edit' | 'upscale';
  prompt: string;
  model: string;
  /** The Prism picture it starts from (edits and upscales of your own pictures). */
  sourceId: string | null;
  status: 'working' | 'done' | 'failed';
  error: string | null;
  /** Once it's done: the new picture's id in GET /api/prism/images. */
  imageId: string | null;
  createdAt: string;
  /** Seconds since it started, by the server's clock (so a phone's clock can't throw the timer off). */
  age: number;
}

type Row = Omit<PrismImageJob, 'age'>;
const withAge = (row: Row): PrismImageJob => ({
  ...row,
  age: Math.max(0, (Date.now() - Date.parse(row.createdAt)) / 1000),
});

const COLUMNS = `id, mode, prompt, model, source_id AS sourceId, status, error, image_id AS imageId, createdAt`;

/** The plain-English reason a picture didn't work. */
export function friendlyImageError(err: unknown, modelName?: string): string {
  const message = (err as Error)?.message ?? 'Unknown error';
  // fetch fails with "fetch failed" when nothing is listening at ComfyUI's address.
  // ComfyUI says "value_not_in_list" when a recipe names a model file it doesn't have.
  if (/fetch failed|ECONNREFUSED/i.test(message)) return 'ComfyUI isn’t running. Start it with run_nvidia_gpu.bat and try again.';
  if (/value_not_in_list/.test(message)) {
    return `${modelName ?? 'That model'} isn’t downloaded into ComfyUI yet. Pick another model, or add its files first.`;
  }
  // still failing after generateImage's own second try
  if (ranOutOfMemory(err)) return 'The computer ran out of memory for this picture. Close a few programs and try again.';
  return message || 'Something went wrong.';
}

/** What a job needs to know to make and save its picture. */
export interface ImageJobOptions<T extends { machine: string }> {
  mode: 'create' | 'edit' | 'upscale';
  /** Shown while it's being made (an upscale passes the original's prompt). */
  prompt: string;
  model: string;
  /** The model's name, for error messages. */
  modelName?: string;
  sourceId: string | null;
  /** For the GPU queue: which machine can do it. */
  needs: GpuNeeds;
  /** Makes the picture on the machine the queue picked. */
  run: (worker: GpuWorker) => Promise<T>;
  /** Saves the finished picture (usually with saveImage) and returns its id. */
  save: (result: T) => Promise<string> | string;
  /** For the server log, e.g. "Prism generate error". */
  label: string;
}

/**
 * Order a picture. Returns straight away with status 'working'; the picture is made and saved
 * in the background, whether or not the page is still there to hear about it.
 */
export function startImageJob<T extends { machine: string }>(userId: string, options: ImageJobOptions<T>): PrismImageJob {
  ready();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO PrismImageJob (id, user_id, mode, prompt, model, source_id, status, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, 'working', ?)`,
  ).run(id, userId, options.mode, options.prompt, options.model, options.sourceId, createdAt);

  // Not awaited on purpose: this keeps going after the page gets its answer.
  void gpuQueue
    .add(options.run, 'high', 'comfy', { userId, needs: options.needs })
    .then(async (result) => {
      const imageId = await options.save(result);
      db.prepare(`UPDATE PrismImageJob SET status = 'done', image_id = ? WHERE id = ?`).run(imageId, id);
      console.log(`Prism: ${options.mode} picture ${imageId} saved (made on ${result.machine}).`);
    })
    .catch((err: unknown) => {
      console.error(`${options.label}:`, err);
      db.prepare(`UPDATE PrismImageJob SET status = 'failed', error = ? WHERE id = ?`).run(
        friendlyImageError(err, options.modelName),
        id,
      );
    });

  return withAge({
    id, mode: options.mode, prompt: options.prompt, model: options.model, sourceId: options.sourceId,
    status: 'working', error: null, imageId: null, createdAt,
  });
}

/** A profile's pictures still being made, plus the ones that finished or failed lately, newest first. */
export function listImageJobs(userId: string): PrismImageJob[] {
  ready();
  const giveUp = new Date(Date.now() - GIVE_UP_MINUTES * 60_000).toISOString();
  db.prepare(
    `UPDATE PrismImageJob SET status = 'failed', error = 'This picture took too long and was given up on. Please try again.'
     WHERE user_id = ? AND status = 'working' AND createdAt < ?`,
  ).run(userId, giveUp);

  const recent = new Date(Date.now() - KEEP_FINISHED_MINUTES * 60_000).toISOString();
  const rows = db
    .prepare(
      `SELECT ${COLUMNS} FROM PrismImageJob
       WHERE user_id = ? AND (status = 'working' OR createdAt >= ?)
       ORDER BY createdAt DESC LIMIT 20`,
    )
    .all(userId, recent) as Row[];
  return rows.map(withAge);
}
