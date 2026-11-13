// POST /api/prism/upscale — make a bigger copy of a picture.
//
// One of your Prism pictures (JSON):
//   { imageId, target?, fastModel?, factor? }
// A picture from your device (multipart/form-data):
//   fields target?, fastModel?, and the file in "image"
//
// `target` is fast-4x, 4k, 4k-uhd, 8k, or 8k-uhd (fast-2x is the old button, still accepted).
// Leave it out and `factor: 4` means Fast 4×; anything else means the old 2× enlarge.
// `fastModel` is realesrgan (Fast 4×) or nomos (Photo 4×). Enhance ignores it.
//
// Get back (status 202, right away): a picture job with status 'working'. The new picture keeps
// the original prompt and settings. The page checks GET /api/prism/jobs until it's done.
//
// Fast 4× and Photo 4× only enlarge. Enhance (4K and 8K) uses SeedVR2, which can invent fine
// detail. Model files and an older ComfyUI are reported as a failed job, not a hang.
// See docs/prism-upscale.md and lib/prism/upscale.ts.

import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { getCurrentUserId } from '@/lib/user';
import { pictureForUpscale, needsForPlan, upscaleImage } from '@/lib/prism/upscale';
import { startImageJob } from '@/lib/prism/imageJobs';
import { getImage, readImageFile, saveImage } from '@/lib/prism/images';
import { MAX_SOURCE_BYTES } from '@/lib/prism/source';
import { findPrismModel, type PrismModelId } from '@/config/prism-models';
import {
  isFastModel,
  isUpscaleTarget,
  planUpscale,
  upscaleBlockReason,
  type FastModelId,
  type UpscaleTargetId,
} from '@/lib/prism/upscale-plan';

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** The old `factor` field, for a request that doesn't send `target`. */
function targetFromFactor(factor: unknown): UpscaleTargetId {
  return Number(factor) === 4 ? 'fast-4x' : 'fast-2x';
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return bad('Please select a user profile first.', 401);

  const fields: Record<string, unknown> = {};
  let upload: File | null = null;
  try {
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await req.formData();
      for (const [key, value] of form.entries()) {
        if (key === 'image' && typeof value !== 'string') upload = value;
        else if (typeof value === 'string') fields[key] = value;
      }
    } else {
      Object.assign(fields, await req.json());
    }
  } catch {
    return bad('Send the request as JSON or as a form.');
  }

  if (fields.target !== undefined && !isUpscaleTarget(fields.target)) {
    return bad('Pick Fast 4×, Photo 4×, Enhance 4K, 4K UHD, Enhance 8K, or 8K UHD.');
  }
  if (fields.fastModel !== undefined && !isFastModel(fields.fastModel)) {
    return bad('The fast upscaler is Real-ESRGAN or Nomos.');
  }
  const target = isUpscaleTarget(fields.target) ? fields.target : targetFromFactor(fields.factor);
  const fastModel: FastModelId = isFastModel(fields.fastModel) ? fields.fastModel : 'realesrgan';
  if (!upload && typeof fields.imageId !== 'string') return bad('Choose a picture to enlarge.');

  // The picture: one you already made, or one you just loaded.
  let png: Buffer;
  let width: number;
  let height: number;
  let prompt: string;
  let style: string;
  let seed: number;
  let modelId: PrismModelId;
  let expandedPrompt: string | null;
  let sourceId: string | null;

  try {
    if (upload) {
      if (upload.size > MAX_SOURCE_BYTES) return bad('That picture is too big (over 25 MB).');
      const prepared = await pictureForUpscale(Buffer.from(await upload.arrayBuffer()));
      png = prepared.png;
      width = prepared.width;
      height = prepared.height;
      const name = upload.name.replace(/\.[^.]+$/, '').trim().slice(0, 200);
      prompt = name || 'Loaded picture';
      style = 'none';
      seed = 0;
      modelId = findPrismModel(undefined).id;
      expandedPrompt = null;
      sourceId = null;
    } else {
      const original = typeof fields.imageId === 'string' ? getImage(userId, fields.imageId) : null;
      const file = original && readImageFile(userId, original.id);
      if (!original || !file) return bad('That picture wasn’t found.', 404);
      png = file;
      width = original.width;
      height = original.height;
      prompt = original.prompt;
      style = original.style;
      seed = original.seed;
      modelId = findPrismModel(original.model).id;
      expandedPrompt = original.expandedPrompt;
      sourceId = original.id;
    }
  } catch (err) {
    return bad((err as Error).message || 'Couldn’t read that picture.');
  }

  const reason = upscaleBlockReason(target, width, height, fastModel);
  if (reason) return bad(reason);
  const plan = planUpscale(target, width, height, fastModel);

  const job = startImageJob(userId, {
    mode: 'upscale',
    prompt,
    model: modelId,
    modelName: plan.label,
    sourceId,
    needs: needsForPlan(plan),
    run: (worker) => upscaleImage({ png, width, height, plan }, worker),
    // Measure the result rather than trust the plan (SeedVR2 pads to even pixels).
    save: async (result) => {
      const { width: outW = plan.width, height: outH = plan.height } = await sharp(result.image).metadata();
      return saveImage(
        userId,
        prompt,
        style,
        {
          image: result.image,
          seed,
          width: outW,
          height: outH,
          seconds: result.seconds,
          model: modelId,
          expandedPrompt,
        },
        { sourceId, mode: 'upscale' },
      ).id;
    },
    label: 'Prism upscale error',
  });
  return NextResponse.json(job, { status: 202 });
}
