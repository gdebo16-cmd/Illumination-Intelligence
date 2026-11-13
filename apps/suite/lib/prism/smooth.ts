// lib/prism/smooth.ts — "Smooth": put an in-between frame after every frame of a finished video.
//
// RIFE (frame interpolation) guesses what happens between two frames. Doubling the frames and
// the frames per second keeps the clip the same length but makes the motion smoother: 24 → 48
// a second for the Fast model, 16 → 32 for the Better one.
//
// The recipe is smooth-workflow.json: load the MP4, split it into frames, RIFE, put it back
// together. RIFE comes from the ComfyUI-Frame-Interpolation add-on (see docs/prism-video.md);
// it downloads its own model file the first time it runs.
//
// RIFE is small (a couple of GB of graphics memory at most), so the GPU queue's router sends
// it to the machine with the SMALLEST card that has the add-on: the Alienware, leaving the
// Raider free for the next video. If only the Raider has it, it runs there.

import fs from 'node:fs';
import path from 'node:path';
import { order, pickUp, waitFor, type Workflow } from './comfy.ts';
import { LOCAL_WORKER, type GpuWorker } from '../../config/gpu-workers.ts';
import type { GpuNeeds } from '../gpu/router.ts';

const RECIPE = path.join(process.cwd(), 'lib', 'prism', 'smooth-workflow.json');
const readRecipe = () => JSON.parse(fs.readFileSync(RECIPE, 'utf8')) as Workflow;

const BOX = { video: '1', rife: '3', create: '4', save: '5' };

/** The RIFE model the recipe asks for. A machine offers it once the add-on is installed. */
export const SMOOTH_FILE = String(readRecipe()[BOX.rife].inputs.ckpt_name);

/** What a Smooth job needs from a machine, for the GPU queue's router. */
export const smoothNeeds = (): GpuNeeds => ({ label: 'Smooth video', vramGB: 2, files: [SMOOTH_FILE] });

/**
 * Put the MP4 in ComfyUI's input folder, like dropping a video onto a Load Video box.
 * (ComfyUI's /upload/image takes any file.) Returns the name to put in the recipe.
 */
async function uploadVideo(url: string, mp4: Buffer): Promise<string> {
  const form = new FormData();
  const name = `prism-smooth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
  form.append('image', new Blob([new Uint8Array(mp4)], { type: 'video/mp4' }), name);
  form.append('type', 'input');
  const res = await fetch(`${url}/upload/image`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`ComfyUI wouldn't take the video (${res.status}): ${await res.text()}`);
  return ((await res.json()) as { name: string }).name;
}

export function buildSmoothWorkflow(uploadedName: string, fps: number): Workflow {
  const workflow = readRecipe();
  workflow[BOX.video].inputs.file = uploadedName;
  workflow[BOX.create].inputs.fps = fps * Number(workflow[BOX.rife].inputs.multiplier);
  return workflow;
}

/**
 * Smooth one video. `fps` is the video's own frames per second (its model's).
 * `worker` is the machine the GPU queue picked (this one when left out).
 */
export async function smoothVideo(
  mp4: Buffer,
  fps: number,
  worker: GpuWorker = LOCAL_WORKER,
): Promise<{ video: Buffer; seconds: number; machine: string }> {
  const started = Date.now();
  const uploadedName = await uploadVideo(worker.url, mp4);
  const ticket = await order(worker.url, buildSmoothWorkflow(uploadedName, fps));
  const video = await pickUp(worker.url, await waitFor(worker.url, ticket, BOX.save, 15 * 60), 60_000);
  return { video, seconds: (Date.now() - started) / 1000, machine: worker.name };
}
