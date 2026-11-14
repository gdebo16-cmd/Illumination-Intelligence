// lib/prism/upscale.ts — making a picture bigger with ComfyUI.
//
// Two recipes, both run like any other Prism picture (upload, fill in the recipe, order, wait):
//   upscale-workflow.json          Fast 4× / Photo 4×. A small model enlarges and stops there.
//   enhance-upscale-workflow.json  SeedVR2 to about 4K. 8K then adds a faithful 2× (Real-ESRGAN).
//
// Which pixels that means is decided in upscale-plan.ts. Model weights stay in ComfyUI's folders;
// see docs/prism-upscale.md. A missing file or a ComfyUI without SeedVR2 fails straight away.

import fs from 'node:fs';
import path from 'node:path';
import sharp, { type Metadata } from 'sharp';
import { LOCAL_WORKER, type GpuWorker } from '../../config/gpu-workers.ts';
import type { GpuNeeds } from '../gpu/router.ts';
import { filesOffered } from '../gpu/health.ts';
import { freeMemory, modelFiles, order, pickUp, ranOutOfMemory, upload, waitFor, type Workflow } from './comfy.ts';
import {
  FAST_MAX_LONG_EDGE,
  FAST_MODELS,
  SECOND_PASS_FILES,
  SEEDVR_INPUT_MEGAPIXELS,
  SEEDVR_UNET,
  SEEDVR_VAE,
  type FastModelId,
  type UpscalePlan,
} from './upscale-plan.ts';

const FAST_RECIPE = 'upscale-workflow.json';
const ENHANCE_RECIPE = 'enhance-upscale-workflow.json';

const readRecipe = (file: string) =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), 'lib', 'prism', file), 'utf8')) as Workflow;

// Boxes we fill in. The numbers match the recipe files.
const FAST = { loader: '1', upscale: '2', scale: '3', save: '13', picture: '14' };
const ENHANCE = {
  picture: '14',
  shrink: '20',
  grow: '21',
  vae: '51',
  unet: '52',
  sample: '54',
  post: '59',
  loader: '1',
  upscale: '2',
  scale: '3',
  save: '13',
};

/** Nodes an Enhance job needs. Older ComfyUI builds don't have them; Fast 4× doesn't use them. */
const SEEDVR_NODES = ['SeedVR2Preprocess', 'SeedVR2Conditioning', 'SeedVR2PostProcessing'] as const;

const sameShape = (aw: number, ah: number, bw: number, bh: number) =>
  Math.abs(aw / ah - bw / bh) / (aw / ah) < 0.01;

/** What the GPU queue should require before it picks a machine. */
export function needsForPlan(plan: UpscalePlan): GpuNeeds {
  if (plan.path === 'fast') {
    const model = FAST_MODELS[plan.fastModel ?? 'realesrgan'];
    return { label: plan.label, vramGB: plan.vramGB, files: [], oneOf: [...model.files] };
  }
  return {
    label: plan.label,
    vramGB: plan.vramGB,
    files: [SEEDVR_UNET, SEEDVR_VAE],
    // 4K doesn't load the 2× model. 8K does, under whichever file name is installed.
    oneOf: plan.thenFast2x ? [...SECOND_PASS_FILES] : undefined,
  };
}

/**
 * Fill in a recipe. `modelFile` is the fast model, or the 2× model on an 8K enhance
 * (null for 4K, which doesn't load one).
 */
export function buildUpscaleWorkflow(options: {
  uploadedName: string;
  sourceWidth: number;
  sourceHeight: number;
  plan: UpscalePlan;
  modelFile: string | null;
  seed?: number;
}): Workflow {
  const { plan } = options;
  if (plan.path === 'fast') {
    const workflow = readRecipe(FAST_RECIPE);
    workflow[FAST.picture].inputs.image = options.uploadedName;
    workflow[FAST.loader].inputs.model_name = options.modelFile;
    const exact4x = plan.width === options.sourceWidth * 4 && plan.height === options.sourceHeight * 4;
    if (exact4x) {
      // The model is already 4×. A second resize would only resample it.
      delete workflow[FAST.scale];
      workflow[FAST.save].inputs.images = [FAST.upscale, 0];
    } else {
      workflow[FAST.scale].inputs.width = plan.width;
      workflow[FAST.scale].inputs.height = plan.height;
      workflow[FAST.scale].inputs.crop = 'disabled';
      workflow[FAST.save].inputs.images = [FAST.scale, 0];
    }
    return workflow;
  }

  const workflow = readRecipe(ENHANCE_RECIPE);
  const seed = options.seed ?? Math.floor(Math.random() * 2 ** 32);
  workflow[ENHANCE.picture].inputs.image = options.uploadedName;
  workflow[ENHANCE.shrink].inputs.megapixels = SEEDVR_INPUT_MEGAPIXELS;
  workflow[ENHANCE.grow].inputs.width = plan.seedvrWidth;
  workflow[ENHANCE.grow].inputs.height = plan.seedvrHeight;
  workflow[ENHANCE.unet].inputs.unet_name = SEEDVR_UNET;
  workflow[ENHANCE.unet].inputs.weight_dtype = 'default';
  workflow[ENHANCE.vae].inputs.vae_name = SEEDVR_VAE;
  workflow[ENHANCE.sample].inputs.seed = seed;
  workflow[ENHANCE.scale].inputs.width = plan.width;
  workflow[ENHANCE.scale].inputs.height = plan.height;
  workflow[ENHANCE.scale].inputs.crop = sameShape(options.sourceWidth, options.sourceHeight, plan.width, plan.height)
    ? 'disabled'
    : 'center';

  if (plan.thenFast2x) {
    workflow[ENHANCE.loader].inputs.model_name = options.modelFile;
    workflow[ENHANCE.scale].inputs.image = [ENHANCE.upscale, 0];
  } else {
    // Leave the 2× model out entirely, so a 4K job doesn't ask for it or wait on it.
    delete workflow[ENHANCE.loader];
    delete workflow[ENHANCE.upscale];
    workflow[ENHANCE.scale].inputs.image = [ENHANCE.post, 0];
  }
  return workflow;
}

/** The first of `names` that this ComfyUI lists, or null. */
async function firstInstalled(url: string, loader: string, names: readonly string[]): Promise<string | null> {
  const offered = new Set(await filesOffered(url, loader));
  return names.find((name) => offered.has(name)) ?? null;
}

/**
 * SeedVR2's three nodes, missing ones listed. An empty list means this ComfyUI can Enhance.
 * Throws when ComfyUI doesn't answer (the queue can try another machine).
 */
async function missingSeedVR2Nodes(url: string): Promise<string[]> {
  const missing: string[] = [];
  await Promise.all(SEEDVR_NODES.map(async (name) => {
    const res = await fetch(`${url}/object_info/${name}`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) {
      missing.push(name);
      return;
    }
    const data = (await res.json()) as Record<string, unknown>;
    if (!data[name]) missing.push(name);
  }));
  return missing;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface UpscaleRequest {
  png: Buffer;
  width: number;
  height: number;
  plan: UpscalePlan;
}

/**
 * Enlarge one picture on the machine the queue picked.
 * Enhance clears the graphics card first (SeedVR2 int8 is most of 16 GB) and again after.
 */
export async function upscaleImage(
  request: UpscaleRequest,
  worker: GpuWorker = LOCAL_WORKER,
): Promise<{ image: Buffer; seconds: number; machine: string }> {
  const { url } = worker;
  const { plan } = request;
  const started = Date.now();
  const enhance = plan.path === 'enhance';

  if (enhance) {
    const missing = await missingSeedVR2Nodes(url);
    if (missing.length) {
      throw new Error(
        `This ComfyUI doesn’t have SeedVR2 (${missing.join(', ')}). Update ComfyUI, or use Fast 4× or Photo 4×.`,
      );
    }
  }

  const modelFile = enhance
    ? plan.thenFast2x
      ? await firstInstalled(url, 'UpscaleModelLoader', SECOND_PASS_FILES)
      : null
    : await firstInstalled(url, 'UpscaleModelLoader', FAST_MODELS[(plan.fastModel ?? 'realesrgan') as FastModelId].files);

  if (!enhance && !modelFile) {
    const names = FAST_MODELS[(plan.fastModel ?? 'realesrgan') as FastModelId].files.join(' or ');
    throw new Error(`${plan.label}: ComfyUI doesn’t have ${names} in models/upscale_models yet.`);
  }
  if (enhance && plan.thenFast2x && !modelFile) {
    throw new Error(`Enhance to 8K also needs ${SECOND_PASS_FILES.join(' or ')} in models/upscale_models.`);
  }

  const paint = async () => {
    const uploadedName = await upload(url, request.png);
    const workflow = buildUpscaleWorkflow({
      uploadedName,
      sourceWidth: request.width,
      sourceHeight: request.height,
      plan,
      modelFile,
    });
    // A recipe that names a file ComfyUI can't load fails here, before any waiting.
    const ticket = await order(url, workflow);
    const info = await waitFor(url, ticket, '13', enhance ? 10 * 60 : 5 * 60);
    return pickUp(url, info, 120_000);
  };

  if (enhance) await freeMemory(url);
  try {
    let image: Buffer;
    try {
      image = await paint();
    } catch (err) {
      if (!ranOutOfMemory(err)) throw err;
      console.warn(`ComfyUI ran out of memory on ${plan.label}; freeing its memory and trying once more.`);
      await freeMemory(url);
      await sleep(3000);
      image = await paint();
    }
    return { image, seconds: (Date.now() - started) / 1000, machine: worker.name };
  } finally {
    if (enhance) await freeMemory(url).catch(() => undefined);
  }
}

/**
 * A picture someone loaded from their device, ready to enlarge: upright, no see-through parts,
 * and not shrunk. (prepareSource() in source.ts shrinks edits to about 1 megapixel; that would
 * throw away the detail an upscale is meant to keep.)
 */
export async function pictureForUpscale(input: Buffer): Promise<{ png: Buffer; width: number; height: number }> {
  let meta: Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw new Error('That file isn’t a picture Prism can read. Try a PNG, JPEG or WebP.');
  }
  if (!meta.width || !meta.height) throw new Error('That picture has no size.');
  const sideways = (meta.orientation ?? 1) >= 5;
  const width = sideways ? meta.height : meta.width;
  const height = sideways ? meta.width : meta.height;
  if (Math.max(width, height) > FAST_MAX_LONG_EDGE) throw new Error('That picture is already over 8K on the long edge.');
  const png = await sharp(input).rotate().flatten({ background: '#000000' }).png().toBuffer();
  return { png, width, height };
}

/** Every model file a built recipe loads. Used by the check script. */
export const filesIn = modelFiles;
