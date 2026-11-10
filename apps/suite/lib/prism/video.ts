// lib/prism/video.ts — turning a picture into a short video with ComfyUI (the Wan 2.2 5B model).
//
// Same three steps as pictures in comfy.ts (upload, order, wait, pick up), with a different
// recipe: wan-video-workflow.json, exported from the "Wan 2.2 5B" template you ran by hand.
// Two differences from pictures:
//   - the video model is big (10 GB), so ComfyUI unloads everything before and after a video;
//   - it's slow (minutes, not seconds), so the page doesn't wait on it: see lib/prism/videos.ts.

import fs from 'node:fs';
import path from 'node:path';
import { freeMemory, modelFiles, order, pickUp, upload, waitFor, type Workflow } from './comfy.ts';
import { LOCAL_WORKER, type GpuWorker } from '../../config/gpu-workers.ts';
import type { GpuNeeds } from '../gpu/router.ts';

const RECIPE = path.join(process.cwd(), 'lib', 'prism', 'wan-video-workflow.json');
const readRecipe = () => JSON.parse(fs.readFileSync(RECIPE, 'utf8')) as Workflow;

/**
 * What a video job needs from a machine, for the GPU queue's router. The Wan model and its text
 * encoder together want about 14 GB, so videos prefer the Raider's 16 GB card. They can only go
 * to the Alienware once its ComfyUI has the Wan files too.
 */
export const videoNeeds = (): GpuNeeds => ({ label: 'Wan 2.2 video', vramGB: 14, files: modelFiles(readRecipe()) });

// Which numbered box in the recipe holds each setting we change.
const BOX = {
  prompt: '6', // CLIPTextEncode: the motion you want
  picture: '56', // LoadImage: the starting picture
  video: '55', // Wan22ImageToVideoLatent: size and length
  sampler: '3', // KSampler: the seed
  save: '58', // SaveVideo
};

/** The model makes 24 frames a second, and the number of frames must be 4n + 1. */
export const FPS = 24;

/**
 * The lengths you can pick. `estimate` is a first guess at how long it takes on this laptop,
 * in seconds; once a length has been made a few times, the real average replaces it.
 * (2 seconds took 146 s in the first test. Longer clips cost more than their length suggests,
 * because every frame is compared with every other frame.)
 */
export const VIDEO_LENGTHS = [
  { id: 'short', name: 'Short', seconds: 2, frames: 49, estimate: 150 },
  { id: 'medium', name: 'Medium', seconds: 3, frames: 73, estimate: 240 },
  { id: 'long', name: 'Long', seconds: 5, frames: 121, estimate: 450 },
] as const;

export type VideoLengthId = (typeof VIDEO_LENGTHS)[number]['id'];
export const findLength = (id: unknown) => VIDEO_LENGTHS.find((l) => l.id === id);

/** The size the model was trained on is 1280×704 (720p); other shapes keep about that many pixels. */
export const VIDEO_PIXELS = 1280 * 704;
/** Video sides must be multiples of 32. */
export const VIDEO_STEP = 32;

export interface VideoRequest {
  /** What should move, e.g. "the waves roll in and the beam sweeps across the sea". */
  prompt: string;
  /** The starting picture, already prepared at the video size (prepareSource with VIDEO_PIXELS). */
  picture: { png: Buffer; width: number; height: number };
  frames: number;
  seed?: number;
}

export interface VideoResult {
  /** The MP4 file itself. */
  video: Buffer;
  seed: number;
  /** How long it took, in seconds (including loading the model). */
  seconds: number;
  /** The machine that made it, e.g. "Raider". */
  machine: string;
}

export function buildVideoWorkflow(request: VideoRequest, uploadedName: string): { workflow: Workflow; seed: number } {
  const workflow = readRecipe();
  const seed = request.seed ?? Math.floor(Math.random() * 2 ** 32);
  workflow[BOX.prompt].inputs.text = request.prompt;
  workflow[BOX.picture].inputs.image = uploadedName;
  workflow[BOX.video].inputs.width = request.picture.width;
  workflow[BOX.video].inputs.height = request.picture.height;
  workflow[BOX.video].inputs.length = request.frames;
  workflow[BOX.sampler].inputs.seed = seed;
  return { workflow, seed };
}

/**
 * Make the video: clear ComfyUI's memory, run the recipe, download the MP4, clear up again.
 * `worker` is the machine the GPU queue picked (this one when left out).
 */
export async function generateVideo(request: VideoRequest, worker: GpuWorker = LOCAL_WORKER): Promise<VideoResult> {
  const { url } = worker;
  const started = Date.now();
  await freeMemory(url);
  try {
    const uploadedName = await upload(url, request.picture.png);
    const { workflow, seed } = buildVideoWorkflow(request, uploadedName);
    const ticket = await order(url, workflow);
    // A long clip can take several minutes; allow up to 20.
    const info = await waitFor(url, ticket, BOX.save, 20 * 60);
    const video = await pickUp(url, info);
    return { video, seed, seconds: (Date.now() - started) / 1000, machine: worker.name };
  } finally {
    // Give the memory back for pictures and chat, even if something went wrong.
    await freeMemory(url).catch(() => undefined);
  }
}
