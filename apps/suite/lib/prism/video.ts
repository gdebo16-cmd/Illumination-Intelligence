// lib/prism/video.ts — making a short video with ComfyUI, from a picture or from words only.
//
// Two models (config/prism-video-models.ts), each with one recipe file:
//   - "Fast", Wan 2.2 TI2V 5B: wan-video-workflow.json, exported from the "Wan 2.2 5B" template.
//     The same files make videos from words: the recipe just leaves out the starting picture.
//   - "Better", Wan 2.2 14B with the Lightning 4-step add-ons: wan14b-video-workflow.json.
//     It comes in two halves (high noise for the first 2 steps, low noise for the last 2), loaded
//     from slimmed-down GGUF copies. Videos from words need the T2V files instead of the I2V
//     ones (TEXT_FILES below). Where to get them: docs/prism-video.md.
//
// Same three steps as pictures in comfy.ts (upload, order, wait, pick up). Two differences:
//   - the video models are big, so ComfyUI unloads everything before and after a video;
//   - it's slow (minutes, not seconds), so the page doesn't wait on it: see lib/prism/videos.ts.

import fs from 'node:fs';
import path from 'node:path';
import { freeMemory, modelFiles, order, pickUp, upload, waitFor, type Workflow } from './comfy.ts';
import { LOCAL_WORKER, type GpuWorker } from '../../config/gpu-workers.ts';
import { findVideoModel, type VideoModelId } from '../../config/prism-video-models.ts';
import type { GpuNeeds } from '../gpu/router.ts';

/** A video made from a picture, or from words only. */
export type VideoMode = 'image' | 'text';

// Which numbered box in each recipe holds each setting we change. Both recipes use the same
// numbers for the same jobs.
const BOX = {
  prompt: '6', // CLIPTextEncode: the motion you want
  picture: '56', // LoadImage: the starting picture (removed for a video from words)
  video: '55', // Wan22ImageToVideoLatent (5B) or WanImageToVideo (14B): size and length
  sampler: '3', // KSampler (5B) or the first KSamplerAdvanced (14B): the seed
  decode: '8', // VAEDecode: the finished frames
  save: '58', // SaveVideo
  // Added for a video from words, which has no starting picture: its first frame, saved as a
  // picture so the gallery has something to show.
  firstFrame: '90', // ImageFromBatch
  poster: '91', // SaveImage
};

const RECIPES: Record<VideoModelId, { file: string; seedSetting: string; textFiles: Record<string, string> }> = {
  'wan-5b': { file: 'wan-video-workflow.json', seedSetting: 'seed', textFiles: {} },
  'wan-14b': {
    file: 'wan14b-video-workflow.json',
    seedSetting: 'noise_seed',
    // A video from words uses the text → video halves and their Lightning add-ons.
    textFiles: {
      '37': 'Wan2.2-T2V-A14B-HighNoise-Q4_K_M.gguf',
      '47': 'Wan2.2-T2V-A14B-LowNoise-Q4_K_M.gguf',
      '60': 'wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors',
      '61': 'wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors',
    },
  },
};

const readRecipe = (model: VideoModelId) =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), 'lib', 'prism', RECIPES[model].file), 'utf8')) as Workflow;

// The setting that names the file, in each kind of Load box the recipes use.
const FILE_SETTING: Record<string, string> = { UnetLoaderGGUF: 'unet_name', LoraLoaderModelOnly: 'lora_name' };

/** The recipe for this model and mode, before the prompt, size and seed are filled in. */
export function videoRecipe(model: VideoModelId, mode: VideoMode): Workflow {
  const workflow = readRecipe(model);
  if (mode === 'text') {
    // No starting picture: drop its box and the wire from it.
    delete workflow[BOX.picture];
    delete workflow[BOX.video].inputs.start_image;
    for (const [box, file] of Object.entries(RECIPES[model].textFiles)) {
      workflow[box].inputs[FILE_SETTING[workflow[box].class_type]] = file;
    }
    // Keep the first frame as the video's picture.
    workflow[BOX.firstFrame] = { class_type: 'ImageFromBatch', inputs: { image: [BOX.decode, 0], batch_index: 0, length: 1 } };
    workflow[BOX.poster] = { class_type: 'SaveImage', inputs: { images: [BOX.firstFrame, 0], filename_prefix: 'Prism/prism-video-poster' } };
  }
  return workflow;
}

/** Every model file this model needs for this mode. */
export const videoFiles = (model: VideoModelId, mode: VideoMode) => modelFiles(videoRecipe(model, mode));

/**
 * What a video job needs from a machine, for the GPU queue's router. Both models want about
 * 14 GB, so videos prefer the Raider's 16 GB card. They can only go to the Alienware once its
 * ComfyUI has the files too.
 */
export function videoNeeds(model: VideoModelId, mode: VideoMode): GpuNeeds {
  const found = findVideoModel(model);
  return { label: `${found.name} video`, vramGB: found.vramGB, files: videoFiles(model, mode) };
}

export interface VideoRequest {
  model: VideoModelId;
  /** What should move, e.g. "the waves roll in and the beam sweeps across the sea". */
  prompt: string;
  /** The starting picture, already prepared at the model's video size. Left out for a video from words. */
  picture?: { png: Buffer; width: number; height: number };
  /** The frame size, for a video from words (a picture brings its own). */
  size?: { width: number; height: number };
  frames: number;
  seed?: number;
}

export interface VideoResult {
  /** The MP4 file itself. */
  video: Buffer;
  /** For a video from words: its first frame, as a PNG. */
  poster: Buffer | null;
  seed: number;
  /** How long it took, in seconds (including loading the model). */
  seconds: number;
  /** The machine that made it, e.g. "Raider". */
  machine: string;
}

export function buildVideoWorkflow(request: VideoRequest, uploadedName?: string): { workflow: Workflow; seed: number } {
  const mode: VideoMode = request.picture ? 'image' : 'text';
  const workflow = videoRecipe(request.model, mode);
  const seed = request.seed ?? Math.floor(Math.random() * 2 ** 32);
  const size = request.picture ?? request.size;
  if (!size) throw new Error('A video from words needs a size.');
  workflow[BOX.prompt].inputs.text = request.prompt;
  if (uploadedName) workflow[BOX.picture].inputs.image = uploadedName;
  workflow[BOX.video].inputs.width = size.width;
  workflow[BOX.video].inputs.height = size.height;
  workflow[BOX.video].inputs.length = request.frames;
  workflow[BOX.sampler].inputs[RECIPES[request.model].seedSetting] = seed;
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
    const uploadedName = request.picture ? await upload(url, request.picture.png) : undefined;
    const { workflow, seed } = buildVideoWorkflow(request, uploadedName);
    const ticket = await order(url, workflow);
    // A long clip can take a while, more so with the 14B model; allow up to 30 minutes.
    const info = await waitFor(url, ticket, BOX.save, 30 * 60);
    const video = await pickUp(url, info);
    // The job is finished, so its first frame is already saved (for a video from words).
    const poster = request.picture ? null : await pickUp(url, await waitFor(url, ticket, BOX.poster, 30));
    return { video, poster, seed, seconds: (Date.now() - started) / 1000, machine: worker.name };
  } finally {
    // Give the memory back for pictures and chat, even if something went wrong.
    await freeMemory(url).catch(() => undefined);
  }
}
