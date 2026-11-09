// lib/prism/comfy.ts — Prism's connection to ComfyUI.
//
// This does exactly what clicking "Run" on the ComfyUI page does, in three steps
// (plus a step 0 when editing a picture: UPLOAD it to ComfyUI first):
//   1. ORDER:    send the workflow (with our prompt and seed filled in) → get a ticket number back
//   2. WAIT:     keep asking "is ticket X ready?" until ComfyUI says yes (or reports an error)
//   3. PICK UP:  download the finished picture
//
// ComfyUI must be running (run_nvidia_gpu.bat). It listens at the address below.

import fs from 'node:fs';
import path from 'node:path';
import { applyStyle } from '../../config/prism-styles.ts';

const COMFY_URL = process.env.COMFY_URL ?? 'http://127.0.0.1:8188';

// The recipe files: one for making a picture from words, one for editing a picture.
// klein-edit-workflow.json is klein-workflow.json plus boxes 14–20 (load, resize, pack and
// attach your picture), so the box numbers below are the same in both.
// (A model switcher later = more entries like these, one recipe per model.)
const RECIPES = {
  create: path.join(process.cwd(), 'lib', 'prism', 'klein-workflow.json'),
  edit: path.join(process.cwd(), 'lib', 'prism', 'klein-edit-workflow.json'),
};

// Which numbered box in the recipe holds each setting we change.
// (Open klein-workflow.json to see them: "4" is the prompt box, "7" the seed, and so on.)
const BOX = {
  prompt: '4', // CLIPTextEncode: what you want in the picture
  negative: '5', // CLIPTextEncode: what you don't want (no effect with the distilled model)
  canvas: '6', // EmptyFlux2LatentImage: the blank canvas size
  seed: '7', // RandomNoise: the random starting point
  schedule: '9', // Flux2Scheduler: steps, and the size again
  save: '13', // SaveImage: where ComfyUI saves the result
  picture: '14', // LoadImage (edit recipe only): the picture to edit
};

export interface ImageRequest {
  prompt: string;
  /** An art style id from config/prism-styles.ts, e.g. 'watercolor'. Leave it out for none. */
  style?: string;
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
}

// Shape of one box in the recipe file.
type Workflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

// The model needs sizes in steps of 16 pixels, between 256 and 2048.
const fitSize = (n: number) => Math.min(2048, Math.max(256, Math.round(n / 16) * 16));

/**
 * Load the recipe and write our prompt, seed and size into the right boxes.
 * `uploadedName` is the picture's name in ComfyUI (from upload()), when editing.
 */
export function buildWorkflow(
  request: ImageRequest,
  uploadedName?: string,
): { workflow: Workflow; seed: number; width: number; height: number } {
  const editing = Boolean(request.source && uploadedName);
  const workflow = JSON.parse(fs.readFileSync(editing ? RECIPES.edit : RECIPES.create, 'utf8')) as Workflow;
  const seed = request.seed ?? Math.floor(Math.random() * 2 ** 32);
  workflow[BOX.prompt].inputs.text = applyStyle(request.prompt, request.style);
  workflow[BOX.seed].inputs.noise_seed = seed;

  if (editing) {
    // The edit recipe measures the picture itself, so the size boxes are already wired up.
    workflow[BOX.picture].inputs.image = uploadedName;
    workflow[BOX.save].inputs.filename_prefix = 'Prism/prism-edit';
    return { workflow, seed, width: request.source!.width, height: request.source!.height };
  }

  const width = fitSize(request.width ?? 1024);
  const height = fitSize(request.height ?? 1024);
  workflow[BOX.negative].inputs.text = '';
  // The size is set in two boxes: the blank canvas, and the step schedule.
  workflow[BOX.canvas].inputs.width = width;
  workflow[BOX.canvas].inputs.height = height;
  workflow[BOX.schedule].inputs.width = width;
  workflow[BOX.schedule].inputs.height = height;
  workflow[BOX.save].inputs.filename_prefix = 'Prism/prism';

  return { workflow, seed, width, height };
}

/**
 * Step 0, UPLOAD (editing only): put the picture in ComfyUI's input folder, like the
 * "choose file to upload" button on a Load Image box. Returns the name to put in the recipe.
 */
async function upload(png: Buffer): Promise<string> {
  const form = new FormData();
  const name = `edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  form.append('image', new Blob([new Uint8Array(png)], { type: 'image/png' }), name);
  form.append('subfolder', 'prism');
  form.append('type', 'input');
  const res = await fetch(`${COMFY_URL}/upload/image`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`ComfyUI wouldn't take the picture (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { name: string; subfolder?: string };
  return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
}

/** Step 1, ORDER: hand the recipe to ComfyUI. Returns the ticket number. */
async function order(workflow: Workflow): Promise<string> {
  const res = await fetch(`${COMFY_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  });
  if (!res.ok) {
    // ComfyUI explains what's wrong with the recipe (e.g. a missing model file).
    throw new Error(`ComfyUI rejected the job (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { prompt_id: string };
  return data.prompt_id;
}

// What ComfyUI says about a finished picture: its file name and folder.
interface ImageInfo {
  filename: string;
  subfolder: string;
  type: string;
}

/** Step 2, WAIT: ask about the ticket every half second until it's done. */
async function waitFor(ticket: string, timeoutSeconds = 300): Promise<ImageInfo> {
  const giveUpAt = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < giveUpAt) {
    const res = await fetch(`${COMFY_URL}/history/${ticket}`);
    const history = (await res.json()) as Record<string, {
      status?: { status_str?: string; messages?: [string, { exception_message?: string; node_type?: string }][] };
      outputs?: Record<string, { images?: ImageInfo[] }>;
    }>;
    const job = history[ticket];

    // An empty answer means "not ready yet".
    if (job) {
      if (job.status?.status_str === 'error') {
        const problem = job.status.messages?.find(([kind]) => kind === 'execution_error')?.[1];
        throw new Error(`ComfyUI failed in ${problem?.node_type ?? 'a step'}: ${problem?.exception_message ?? 'unknown error'}`);
      }
      const picture = job.outputs?.[BOX.save]?.images?.[0];
      if (picture) return picture;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`ComfyUI didn't finish within ${timeoutSeconds} seconds.`);
}

/** Step 3, PICK UP: download the finished picture. */
async function pickUp(info: ImageInfo): Promise<Buffer> {
  const query = new URLSearchParams({ filename: info.filename, subfolder: info.subfolder, type: info.type });
  const res = await fetch(`${COMFY_URL}/view?${query}`);
  if (!res.ok) throw new Error(`Couldn't download the picture from ComfyUI (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

/** All the steps together: describe (or hand over) a picture, get the PNG back. */
export async function generateImage(request: ImageRequest): Promise<ImageResult> {
  const started = Date.now();
  const uploadedName = request.source ? await upload(request.source.png) : undefined;
  const { workflow, seed, width, height } = buildWorkflow(request, uploadedName);
  const ticket = await order(workflow);
  const info = await waitFor(ticket);
  const image = await pickUp(info);
  return { image, seed, width, height, seconds: (Date.now() - started) / 1000 };
}
