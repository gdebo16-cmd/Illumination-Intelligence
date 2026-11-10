// lib/prism/comfy.ts — Prism's connection to ComfyUI.
//
// This does exactly what clicking "Run" on the ComfyUI page does, in three steps
// (plus a step 0 when editing a picture: UPLOAD it to ComfyUI first):
//   1. ORDER:    send the workflow (with our prompt and seed filled in) → get a ticket number back
//   2. WAIT:     keep asking "is ticket X ready?" until ComfyUI says yes (or reports an error)
//   3. PICK UP:  download the finished picture
//
// ComfyUI must be running (run_nvidia_gpu.bat). There can be more than one: every machine in
// config/gpu-workers.ts runs its own copy. So each step below takes `url`, the address of the
// ComfyUI the GPU queue picked for this job (lib/queue.ts and lib/gpu/router.ts decide).
// The finished picture always comes back over the network (step 3), so it doesn't matter
// which machine painted it: it's saved on this one, the same as always.

import fs from 'node:fs';
import path from 'node:path';
import { applyStyle } from '../../config/prism-styles.ts';
import { PRISM_MODELS, findPrismModel, type PrismModelId } from '../../config/prism-models.ts';
import { GPU_WORKERS, LOCAL_WORKER, type GpuWorker } from '../../config/gpu-workers.ts';
import { LOADERS, checkWorkers } from '../gpu/health.ts';
import type { GpuNeeds } from '../gpu/router.ts';

// Which numbered box in a recipe holds each setting we change. Every recipe uses the same
// number for the same job, so this one list works for all the models.
// (Open klein-workflow.json to see them: "4" is the prompt box, "7" the seed, and so on.)
const BOX = {
  prompt: '4', // CLIPTextEncode: what you want in the picture
  negative: '5', // CLIPTextEncode: what you don't want (no effect with the distilled models)
  canvas: '6', // EmptyFlux2LatentImage: the blank canvas size
  seed: '7', // the random starting point: RandomNoise (FLUX.2) or KSampler (FLUX.3)
  schedule: '9', // Flux2Scheduler (FLUX.2 only): steps, and the size again
  save: '13', // SaveImage: where ComfyUI saves the result
  picture: '14', // LoadImage (edit recipes only): the picture to edit
  // FLUX.3 only: the prompt expander (boxes 20–25 in its recipes)
  typed: '21', // PrimitiveStringMultiline: your prompt, as you typed it
  expander: '24', // ComfySwitchNode: the expander's on/off switch
  told: '25', // PreviewAny: the prompt the painter ends up with (expanded or not)
};

// What Prism needs to know about one model's recipes.
interface ModelRecipes {
  /** The recipe for making a picture from words. */
  create: string;
  /** The recipe for editing a picture (the create recipe plus boxes that load and attach yours). */
  edit: string;
  /** Where your prompt goes: the box, and the setting's name inside it. */
  prompt: [box: string, setting: string];
  /** What the seed is called inside box 7. */
  seedSetting: string;
  /** Which boxes need the width and height when making a picture from words. */
  sizeBoxes: string[];
  /** True when the recipes have prompt-expander boxes (BOX.expander and BOX.told). */
  expander: boolean;
}

// The recipe files, two for each model in config/prism-models.ts.
// To add a model: add it to config/prism-models.ts, put its two recipes in lib/prism, and add
// an entry here.
const RECIPES: Record<PrismModelId, ModelRecipes> = {
  'flux2-klein': {
    create: 'klein-workflow.json',
    edit: 'klein-edit-workflow.json',
    prompt: [BOX.prompt, 'text'],
    seedSetting: 'noise_seed',
    sizeBoxes: [BOX.canvas, BOX.schedule],
    expander: false,
  },
  // From ComfyUI's own "FLUX.3 Klein (distilled)" templates: 16 steps, CFG 1, euler / simple.
  // FLUX.3 was trained on long, detailed descriptions, so its recipes first hand your prompt to
  // a "prompt expander" (a second language model) that writes one; box 24 switches that off.
  'flux3-klein': {
    create: 'flux3-klein-workflow.json',
    edit: 'flux3-klein-edit-workflow.json',
    prompt: [BOX.typed, 'value'],
    seedSetting: 'seed',
    sizeBoxes: [BOX.canvas],
    expander: true,
  },
};

const readRecipe = (file: string) =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), 'lib', 'prism', file), 'utf8')) as Workflow;

export interface ImageRequest {
  prompt: string;
  /** Which model paints it: an id from config/prism-models.ts. Leave it out for the default. */
  model?: string;
  /** An art style id from config/prism-styles.ts, e.g. 'watercolor'. Leave it out for none. */
  style?: string;
  /**
   * Let the model's prompt expander rewrite your prompt into a long, detailed one first.
   * Only FLUX.3 has one. Leave it out for on; pass false to send your prompt exactly as typed.
   */
  expand?: boolean;
  /** Same seed + same prompt = same picture. Leave it out for a random one. */
  seed?: number;
  width?: number;
  height?: number;
  /**
   * Edit this picture instead of starting from scratch. The prompt is then an instruction
   * ("make it nighttime"). Prepare it with prepareSource() in lib/prism/source.ts first;
   * the result has the same size as the picture.
   */
  source?: { png: Buffer; width: number; height: number };
}

export interface ImageResult {
  /** The PNG file itself. */
  image: Buffer;
  /** The seed that was used, so the same picture can be made again. */
  seed: number;
  width: number;
  height: number;
  /** How long ComfyUI took, in seconds. */
  seconds: number;
  /** The model that painted it (an id from config/prism-models.ts). */
  model: PrismModelId;
  /** What the prompt expander turned your prompt into. null when it wasn't used. */
  expandedPrompt: string | null;
  /** The machine that painted it, e.g. "Alienware". */
  machine: string;
}

// Shape of one box in the recipe file.
export type Workflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

// The model needs sizes in steps of 16 pixels, between 256 and 2048.
const fitSize = (n: number) => Math.min(2048, Math.max(256, Math.round(n / 16) * 16));

/**
 * Load the chosen model's recipe and write our prompt, seed and size into the right boxes.
 * `uploadedName` is the picture's name in ComfyUI (from upload()), when editing.
 */
export function buildWorkflow(
  request: ImageRequest,
  uploadedName?: string,
): { workflow: Workflow; seed: number; width: number; height: number; model: PrismModelId; expanding: boolean } {
  const model = findPrismModel(request.model).id;
  const recipe = RECIPES[model];
  const editing = Boolean(request.source && uploadedName);
  const workflow = readRecipe(editing ? recipe.edit : recipe.create);
  const seed = request.seed ?? Math.floor(Math.random() * 2 ** 32);
  const [promptBox, promptSetting] = recipe.prompt;
  workflow[promptBox].inputs[promptSetting] = applyStyle(request.prompt, request.style);
  workflow[BOX.seed].inputs[recipe.seedSetting] = seed;
  // The prompt expander is on unless you ask for your prompt exactly as typed.
  const expanding = recipe.expander && request.expand !== false;
  if (recipe.expander) workflow[BOX.expander].inputs.switch = expanding;

  if (editing) {
    // The edit recipe measures the picture itself, so the size boxes are already wired up.
    workflow[BOX.picture].inputs.image = uploadedName;
    workflow[BOX.save].inputs.filename_prefix = 'Prism/prism-edit';
    return { workflow, seed, width: request.source!.width, height: request.source!.height, model, expanding };
  }

  const width = fitSize(request.width ?? 1024);
  const height = fitSize(request.height ?? 1024);
  workflow[BOX.negative].inputs.text = '';
  // The size goes in the blank canvas box (and, for FLUX.2, the step schedule box too).
  for (const box of recipe.sizeBoxes) {
    workflow[box].inputs.width = width;
    workflow[box].inputs.height = height;
  }
  workflow[BOX.save].inputs.filename_prefix = 'Prism/prism';

  return { workflow, seed, width, height, model, expanding };
}

/** Every model file a recipe loads, read from its Load boxes (LOADERS is in lib/gpu/health.ts). */
export function modelFiles(workflow: Workflow): string[] {
  return Object.values(workflow)
    .filter((box) => LOADERS[box.class_type])
    .map((box) => String(box.inputs[LOADERS[box.class_type]]));
}

/**
 * What a picture job needs from a machine, for the GPU queue's router: the model's files and
 * about how much graphics memory it takes (vramGB in config/prism-models.ts).
 */
export function imageNeeds(request: ImageRequest): GpuNeeds {
  const model = findPrismModel(request.model);
  const recipe = RECIPES[model.id];
  return {
    label: `${model.name} ${request.source ? 'edit' : 'picture'}`,
    vramGB: model.vramGB,
    files: modelFiles(readRecipe(request.source ? recipe.edit : recipe.create)),
  };
}

export interface ModelStatus {
  id: PrismModelId;
  name: string;
  note: string;
  /** True when the model has a prompt expander (see config/prism-models.ts). */
  expands: boolean;
  /** True when at least one machine's ComfyUI has every file the model's recipes ask for. */
  ready: boolean;
  /** The files that still need downloading (onto the machine that's closest to having them all). */
  missing: string[];
  /** The machines that can paint with it right now, e.g. ["Raider", "Alienware"]. */
  machines: string[];
}

/**
 * Every model in config/prism-models.ts, and whether any machine's ComfyUI has its files yet.
 * The file names are read out of the recipes themselves, so there's no second list to keep up
 * to date. Throws when ComfyUI isn't running anywhere.
 */
export async function listModels(): Promise<ModelStatus[]> {
  const online = (await checkWorkers(GPU_WORKERS)).filter((s) => s.online);
  if (!online.length) throw new Error('ComfyUI isn’t running on any machine.');

  return PRISM_MODELS.map((model) => {
    const recipe = RECIPES[model.id];
    const files = [...new Set([...modelFiles(readRecipe(recipe.create)), ...modelFiles(readRecipe(recipe.edit))])];
    // What each machine is missing. The model is ready on the machines missing nothing.
    const missingOn = online.map((s) => ({ name: s.worker.name, missing: files.filter((f) => !s.files.has(f)) }));
    const machines = missingOn.filter((m) => m.missing.length === 0).map((m) => m.name);
    const closest = [...missingOn].sort((a, b) => a.missing.length - b.missing.length)[0];
    return { ...model, ready: machines.length > 0, missing: machines.length ? [] : closest.missing, machines };
  });
}

/**
 * Step 0, UPLOAD (editing only): put the picture in ComfyUI's input folder, like the
 * "choose file to upload" button on a Load Image box. Returns the name to put in the recipe.
 */
export async function upload(url: string, png: Buffer): Promise<string> {
  const form = new FormData();
  const name = `edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  form.append('image', new Blob([new Uint8Array(png)], { type: 'image/png' }), name);
  form.append('subfolder', 'prism');
  form.append('type', 'input');
  const res = await fetch(`${url}/upload/image`, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`ComfyUI wouldn't take the picture (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { name: string; subfolder?: string };
  return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
}

/**
 * Ask ComfyUI something that's safe to ask twice, and `read` the answer, with a time limit for
 * both. Tries up to 3 times if the network hiccups (the Alienware is on Wi-Fi). Only used for
 * questions and downloads, never for ORDER, which would paint the picture twice.
 */
async function askSafely<T>(address: string, timeoutMs: number, step: string, read: (res: Response) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await read(await fetch(address, { signal: AbortSignal.timeout(timeoutMs) }));
    } catch (err) {
      if (attempt >= 3) throw new Error(`ComfyUI didn't answer (${step}): ${(err as Error).message}`);
      console.warn(`ComfyUI didn't answer (${step}, try ${attempt} of 3); asking again.`);
    }
  }
}

/** Step 1, ORDER: hand the recipe to ComfyUI. Returns the ticket number. */
export async function order(url: string, workflow: Workflow): Promise<string> {
  const res = await fetch(`${url}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    // ComfyUI explains what's wrong with the recipe (e.g. a missing model file).
    throw new Error(`ComfyUI rejected the job (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { prompt_id: string };
  return data.prompt_id;
}

// What ComfyUI says about a finished picture: its file name and folder.
export interface ImageInfo {
  filename: string;
  subfolder: string;
  type: string;
}

// ComfyUI's notes on a ticket: how it went, and what each box that shows something produced
// (a Save box lists pictures, a "Preview as Text" box lists text).
type History = Record<string, {
  status?: { status_str?: string; messages?: [string, { exception_message?: string; node_type?: string }][] };
  outputs?: Record<string, { images?: ImageInfo[]; text?: string[] }>;
}>;

/**
 * Step 2, WAIT: ask about the ticket every half second until it's done.
 * `saveBox` is the box whose result we want (videos come out of a different box than pictures).
 */
export async function waitFor(url: string, ticket: string, saveBox = BOX.save, timeoutSeconds = 300): Promise<ImageInfo> {
  const giveUpAt = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < giveUpAt) {
    // Each question gets 10 seconds (3 tries); no answer means the machine has dropped off the network.
    const history = await askSafely(`${url}/history/${ticket}`, 10_000, 'is the job done?', async (res) => {
      if (!res.ok) throw new Error(`it answered ${res.status}`);
      return (await res.json()) as History;
    });
    const job = history[ticket];

    // An empty answer means "not ready yet".
    if (job) {
      if (job.status?.status_str === 'error') {
        const problem = job.status.messages?.find(([kind]) => kind === 'execution_error')?.[1];
        throw new Error(`ComfyUI failed in ${problem?.node_type ?? 'a step'}: ${problem?.exception_message ?? 'unknown error'}`);
      }
      const picture = job.outputs?.[saveBox]?.images?.[0];
      if (picture) return picture;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`ComfyUI didn't finish within ${timeoutSeconds} seconds.`);
}

/** Step 3, PICK UP: download the finished picture (over the network, from whichever machine made it). */
export async function pickUp(url: string, info: ImageInfo): Promise<Buffer> {
  const query = new URLSearchParams({ filename: info.filename, subfolder: info.subfolder, type: info.type });
  // The picture is already made, so a slow download is simply asked for again.
  return askSafely(`${url}/view?${query}`, 15_000, 'downloading the result', async (res) => {
    if (!res.ok) throw new Error(`it answered ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  });
}

/**
 * Ask ComfyUI to unload its models and give the memory back. The video model is big (10 GB)
 * and didn't fit next to the picture models, so videos clear the way first and tidy up after.
 */
export async function freeMemory(url: string): Promise<void> {
  await fetch(`${url}/free`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
    signal: AbortSignal.timeout(10_000),
  });
}

/**
 * True when ComfyUI failed because Windows had no memory left to load the model. It shows up
 * as "HostBuffer.read_file_slice failed" (Windows error 1450), and happens when a lot of other
 * programs are open or ComfyUI is still holding models from earlier.
 */
export const ranOutOfMemory = (err: unknown) => /read_file_slice|error=1450/i.test((err as Error)?.message ?? '');

/**
 * All the steps together: describe (or hand over) a picture, get the PNG back.
 * `worker` is the machine to paint on; the GPU queue passes the one it picked. Leave it out
 * (as scripts/try-prism.mjs does) to use this machine.
 */
export async function generateImage(request: ImageRequest, worker: GpuWorker = LOCAL_WORKER): Promise<ImageResult> {
  const { url } = worker;
  const started = Date.now();
  const uploadedName = request.source ? await upload(url, request.source.png) : undefined;
  const { workflow, seed, width, height, model, expanding } = buildWorkflow(request, uploadedName);
  const paint = async () => {
    const ticket = await order(url, workflow);
    const image = await pickUp(url, await waitFor(url, ticket));
    // With the expander on, also fetch what it wrote, to show under the picture.
    const expandedPrompt = expanding ? await textFrom(url, ticket, BOX.told) : null;
    return { image, expandedPrompt };
  };

  let painted: Awaited<ReturnType<typeof paint>>;
  try {
    painted = await paint();
  } catch (err) {
    if (!ranOutOfMemory(err)) throw err;
    // Have ComfyUI let go of the models it's holding, give Windows a moment, and try once more.
    console.warn('ComfyUI ran out of memory loading the model; freeing its memory and trying once more.');
    await freeMemory(url);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    painted = await paint();
  }
  return { ...painted, seed, width, height, seconds: (Date.now() - started) / 1000, model, machine: worker.name };
}

/** The text a "Preview as Text" box showed for a finished ticket (null if it showed none). */
async function textFrom(url: string, ticket: string, box: string): Promise<string | null> {
  const history = await askSafely(`${url}/history/${ticket}`, 10_000, 'reading the expanded prompt', async (res) => (await res.json()) as History);
  return history[ticket]?.outputs?.[box]?.text?.[0]?.trim() || null;
}
