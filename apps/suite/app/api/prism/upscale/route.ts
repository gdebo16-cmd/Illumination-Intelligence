// POST /api/prism/upscale — "make this picture bigger".
//
// Send (JSON):  { imageId: "<one of your Prism pictures>", factor?: 2 | 4 }
// Get back:     (status 202, right away) a picture job with status 'working'. In the background it
//               makes a NEW saved picture, `factor` times bigger (2 if left out), with the same
//               prompt and settings as the original. The original is kept. The page checks
//               GET /api/prism/jobs until it's done, like a new picture (lib/prism/imageJobs.ts).
//
// The work is done by a small upscale model in ComfyUI (see upscaleImage in lib/prism/comfy.ts).
// It enlarges and sharpens the picture as it is; it doesn't repaint it.

import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { getCurrentUserId } from '@/lib/user';
import { UPSCALE_FACTORS, UPSCALE_MAX_SIDE, upscaleImage, upscaleNeeds } from '@/lib/prism/comfy';
import { startImageJob } from '@/lib/prism/imageJobs';
import { getImage, readImageFile, saveImage } from '@/lib/prism/images';
import { findPrismModel } from '@/config/prism-models';

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return bad('Please select a user profile first.', 401);

  let body: { imageId?: unknown; factor?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad('Send the request as JSON.');
  }
  const factor = UPSCALE_FACTORS.find((f) => f === Number(body.factor)) ?? 2;

  // The picture to enlarge: it has to be one of this profile's own.
  const original = typeof body.imageId === 'string' ? getImage(userId, body.imageId) : null;
  const file = original && readImageFile(userId, original.id);
  if (!original || !file) return bad('That picture wasn’t found.', 404);
  if (Math.max(original.width, original.height) > UPSCALE_MAX_SIDE) return bad('That picture is already as big as Prism makes them.');

  // Order it; the answer goes back straight away and the work carries on without the page.
  const model = findPrismModel(original.model);
  const job = startImageJob(userId, {
    mode: 'upscale',
    prompt: original.prompt,
    model: model.id,
    modelName: model.name,
    sourceId: original.id,
    needs: upscaleNeeds(),
    run: (worker) => upscaleImage(file, factor, worker),
    // Measure the result rather than assume it, then save it as a new picture that remembers
    // which one it came from. It keeps the original's prompt, style, seed and model.
    save: async (result) => {
      const { width = original.width * factor, height = original.height * factor } = await sharp(result.image).metadata();
      return saveImage(
        userId,
        original.prompt,
        original.style,
        {
          image: result.image,
          seed: original.seed,
          width,
          height,
          seconds: result.seconds,
          model: model.id,
          expandedPrompt: original.expandedPrompt,
        },
        { sourceId: original.id, mode: 'upscale' },
      ).id;
    },
    label: 'Prism upscale error',
  });
  return NextResponse.json(job, { status: 202 });
}
