// lib/prism/cloud.ts — "Cloud Painting" and "Cloud Movies": pictures and videos made online by
// much bigger models than this computer can run.
//
// They still go through ComfyUI, the same three steps as lib/prism/comfy.ts (order, wait, pick
// up). The difference is the recipe: its main box is one of ComfyUI's "Partner Nodes", which
// sends the job to the model maker's servers and waits for the result. So:
//   - it costs money: prepaid Comfy credits, taken from the account the key below belongs to;
//   - your prompt (and starting picture) leave the house;
//   - it needs no graphics memory, so these jobs skip the GPU queue (lib/queue.ts).
// Because of the first two, nothing here ever runs unless someone picks a Cloud model by hand in
// Prism's dropdowns. Flickers, Astra and every default keep using the local models.
//
// Setup: make an API key in your Comfy account (platform.comfy.org) and put it in
// apps/suite/.env as
//   COMFY_ORG_API_KEY=...
// then restart the app. The models and what they cost are in config/prism-models.ts and
// config/prism-video-models.ts.

import 'server-only';
import { applyStyle } from '../../config/prism-styles.ts';
import { CLOUD_PAINTING } from '../../config/prism-models.ts';
import type { CloudVideoModelId } from '../../config/prism-video-models.ts';
import { GPU_WORKERS, LOCAL_WORKER, type GpuWorker } from '../../config/gpu-workers.ts';
import { order, pickUp, upload, waitFor, type ImageRequest, type ImageResult, type Workflow } from './comfy.ts';
import type { VideoResult } from './video-workflow.ts';

const KEY_NAME = 'COMFY_ORG_API_KEY';
const cloudKey = () => process.env[KEY_NAME]?.trim() || null;

/** Shown in the dropdowns (as what's "missing") and when someone tries Cloud without a key. */
export const CLOUD_SETUP = `a Comfy API key (${KEY_NAME} in apps/suite/.env)`;
/** Why Cloud can't be used right now, or null when it can. Checked before a job is started. */
export const cloudProblem = () =>
  cloudKey() ? null : `Cloud isn’t set up yet. Add ${KEY_NAME} to apps/suite/.env and restart, or pick a local model.`;

// The Partner Node each cloud model uses (class names as ComfyUI 0.44 lists them).
const NODE = { painting: 'Flux3ImageNode', 'cloud-kling': 'KlingVideoNode', 'cloud-veo': 'Veo3VideoGenerationNode' } as const;

// Box numbers, kept the same as the local recipes where they mean the same thing.
const BOX = { model: '1', save: '13', picture: '14', saveVideo: '58', frames: '90', firstFrame: '91', poster: '92' };

/**
 * The ComfyUI that will pass the job along. A cloud job keeps that ComfyUI's line busy while it
 * waits (minutes, for a movie) without using its graphics card, so another machine is preferred
 * over this one, whose line the local pictures and videos mostly use.
 */
async function cloudWorker(nodeClass: string): Promise<GpuWorker> {
  const others = GPU_WORKERS.filter((w) => w.id !== LOCAL_WORKER.id);
  for (const worker of [...others, LOCAL_WORKER]) {
    try {
      const res = await fetch(`${worker.url}/object_info/${nodeClass}`, { signal: AbortSignal.timeout(4000) });
      if (res.ok && nodeClass in ((await res.json()) as object)) return worker;
    } catch {
      // off, or not on this network: try the next machine
    }
  }
  throw new Error('No running ComfyUI has the cloud models’ boxes. Start ComfyUI (run_nvidia_gpu.bat), and update it if it’s an old one.');
}

/** ORDER, with the account key attached (ComfyUI hands it to the Partner Node). */
function orderCloud(url: string, workflow: Workflow): Promise<string> {
  const key = cloudKey();
  if (!key) throw new Error(cloudProblem()!);
  return order(url, workflow, { api_key_comfy_org: key });
}

/**
 * The plain-English reason a cloud job failed, when it's one of the usual ones (the wording of
 * these comes from Comfy's servers, so it's matched loosely). null for anything else.
 */
export function friendlyCloudError(err: unknown): string | null {
  const message = (err as Error)?.message ?? '';
  if (/unauthori[sz]ed|\b401\b|please log ?in|invalid api key/i.test(message)) {
    return `Comfy turned the key down. Check ${KEY_NAME} in apps/suite/.env.`;
  }
  if (/\b402\b|insufficient|not enough credits?|payment required/i.test(message)) {
    return 'Your Comfy account is out of credits. Add some at comfy.org, then try again.';
  }
  if (/moderat|safety|content policy|blocked/i.test(message)) return 'The cloud model turned this one down (its content rules). Try describing it differently.';
  return null;
}

// FLUX 3 takes a shape as a ratio, not a size.
const RATIOS = ['21:9', '2:1', '16:9', '3:2', '7:5', '4:3', '5:4', '1:1', '4:5', '3:4', '5:7', '2:3', '9:16', '1:2', '9:21'];
function nearestRatio(width: number, height: number): string {
  const wanted = Math.log(width / height);
  const distance = (ratio: string) => {
    const [w, h] = ratio.split(':').map(Number);
    return Math.abs(Math.log(w / h) - wanted);
  };
  return [...RATIOS].sort((a, b) => distance(a) - distance(b))[0];
}

// A PNG says its width and height near the start of the file.
function pngSize(png: Buffer, fallback: { width: number; height: number }): { width: number; height: number } {
  const isPng = png.length > 24 && png.readUInt32BE(0) === 0x89504e47;
  return isPng ? { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } : fallback;
}

/**
 * Cloud Painting: FLUX 3 Image at 2K. With `request.source` it edits that picture instead (the
 * prompt is then the change to make) and keeps its shape.
 */
export async function generateCloudImage(request: ImageRequest): Promise<ImageResult> {
  const started = Date.now();
  const worker = await cloudWorker(NODE.painting);
  const { url } = worker;
  const uploadedName = request.source ? await upload(url, request.source.png) : undefined;
  const seed = request.seed ?? Math.floor(Math.random() * 2 ** 32);
  const asked = { width: request.source?.width ?? request.width ?? 1024, height: request.source?.height ?? request.height ?? 1024 };

  const workflow: Workflow = {
    [BOX.model]: {
      class_type: NODE.painting,
      inputs: {
        prompt: applyStyle(request.prompt, request.style),
        // 'auto' follows the picture being edited.
        aspect_ratio: uploadedName ? 'auto' : nearestRatio(asked.width, asked.height),
        resolution: '2K', // about 4 megapixels; the price goes with this (config/prism-models.ts)
        grounding: false, // no web research first: quicker, and the prompt is used as written
        safety_tolerance: 4, // the box's own default
        seed, // FLUX 3 picks its own; this only tells ComfyUI it's a new job
        ...(uploadedName ? { 'images.image_1': [BOX.picture, 0] } : {}),
      },
    },
    [BOX.save]: { class_type: 'SaveImage', inputs: { images: [BOX.model, 0], filename_prefix: uploadedName ? 'Prism/prism-cloud-edit' : 'Prism/prism-cloud' } },
    ...(uploadedName ? { [BOX.picture]: { class_type: 'LoadImage', inputs: { image: uploadedName } } } : {}),
  };

  const ticket = await orderCloud(url, workflow);
  // A 2K picture is a big file, and may come back over Wi-Fi.
  const image = await pickUp(url, await waitFor(url, ticket, BOX.save, 10 * 60), 60_000);
  return {
    image,
    seed,
    ...pngSize(image, asked),
    seconds: (Date.now() - started) / 1000,
    model: CLOUD_PAINTING,
    expandedPrompt: null,
    machine: `the cloud, through ${worker.name}`,
  };
}

export interface CloudVideoRequest {
  model: CloudVideoModelId;
  prompt: string;
  /** Clip length. Each model takes its own (config/prism-video-models.ts, `seconds`). */
  seconds: number;
  /** The starting picture. Left out for a video from words. */
  picture?: { png: Buffer; width: number; height: number };
  /** The frame size, for a video from words: only its shape is used. */
  size?: { width: number; height: number };
}

/** Cloud Movies: Kling 3 (no sound) or Veo 3.1 (with sound), both at 1080p. */
export async function generateCloudVideo(request: CloudVideoRequest): Promise<VideoResult> {
  const started = Date.now();
  const worker = await cloudWorker(NODE[request.model]);
  const { url } = worker;
  const uploadedName = request.picture ? await upload(url, request.picture.png) : undefined;
  const seed = Math.floor(Math.random() * 2 ** 31);
  const shape = request.picture ?? request.size;
  if (!shape) throw new Error('A video from words needs a shape.');
  const ratio = shape.width / shape.height;
  const wide = ratio >= 1 ? '16:9' : '9:16';

  const model: Workflow[string] =
    request.model === 'cloud-kling'
      ? {
          class_type: NODE['cloud-kling'],
          inputs: {
            // One shot, not a storyboard. Settings that belong to a choice are written "choice.setting".
            multi_shot: 'disabled',
            'multi_shot.prompt': request.prompt,
            'multi_shot.negative_prompt': '',
            'multi_shot.duration': request.seconds,
            generate_audio: false, // sound costs half as much again
            model: 'kling-v3',
            'model.resolution': '1080p',
            'model.aspect_ratio': Math.abs(Math.log(ratio)) < 0.1 ? '1:1' : wide, // ignored when there's a picture
            seed,
            ...(uploadedName ? { start_frame: [BOX.picture, 0] } : {}),
          },
        }
      : {
          class_type: NODE['cloud-veo'],
          inputs: {
            prompt: request.prompt,
            aspect_ratio: wide, // Veo makes landscape or portrait only
            resolution: '1080p',
            negative_prompt: '',
            duration_seconds: request.seconds,
            seed,
            model: 'veo-3.1-generate',
            generate_audio: true,
            ...(uploadedName ? { image: [BOX.picture, 0] } : {}),
          },
        };

  const workflow: Workflow = {
    [BOX.model]: model,
    [BOX.saveVideo]: {
      class_type: 'SaveVideo',
      inputs: { video: [BOX.model, 0], filename_prefix: 'Prism/prism-cloud-video', format: 'mp4', 'format.codec': 'h264' },
    },
    ...(uploadedName
      ? { [BOX.picture]: { class_type: 'LoadImage', inputs: { image: uploadedName } } }
      : {
          // A video from words has no starting picture: keep its first frame for the gallery.
          [BOX.frames]: { class_type: 'GetVideoComponents', inputs: { video: [BOX.model, 0] } },
          [BOX.firstFrame]: { class_type: 'ImageFromBatch', inputs: { image: [BOX.frames, 0], batch_index: 0, length: 1 } },
          [BOX.poster]: { class_type: 'SaveImage', inputs: { images: [BOX.firstFrame, 0], filename_prefix: 'Prism/prism-video-poster' } },
        }),
  };

  const ticket = await orderCloud(url, workflow);
  const video = await pickUp(url, await waitFor(url, ticket, BOX.saveVideo, 30 * 60), 120_000);
  const poster = uploadedName ? null : await pickUp(url, await waitFor(url, ticket, BOX.poster, 60), 60_000).catch(() => null);
  return { video, poster, seed, seconds: (Date.now() - started) / 1000, machine: `the cloud, through ${worker.name}` };
}
