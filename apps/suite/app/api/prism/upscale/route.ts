// POST /api/prism/upscale — "make this picture bigger".
//
// Send (JSON):  { imageId: "<one of your Prism pictures>", factor?: 2 | 4 }
// Get back:     a NEW saved picture, `factor` times bigger (2 if left out), with the same prompt
//               and settings as the original. The original is kept.
//
// The work is done by a small upscale model in ComfyUI (see upscaleImage in lib/prism/comfy.ts).
// It enlarges and sharpens the picture as it is; it doesn't repaint it.

import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { getCurrentUserId } from '@/lib/user';
import { gpuQueue } from '@/lib/queue';
import { UPSCALE_FACTORS, UPSCALE_MAX_SIDE, ranOutOfMemory, upscaleImage, upscaleNeeds } from '@/lib/prism/comfy';
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

  try {
    const result = await gpuQueue.add((worker) => upscaleImage(file, factor, worker), 'high', 'comfy', {
      userId,
      needs: upscaleNeeds(),
    });

    // Measure the result rather than assume it, then save it as a new picture that remembers
    // which one it came from. It keeps the original's prompt, style, seed and model.
    const { width = original.width * factor, height = original.height * factor } = await sharp(result.image).metadata();
    const saved = saveImage(
      userId,
      original.prompt,
      original.style,
      {
        image: result.image,
        seed: original.seed,
        width,
        height,
        seconds: result.seconds,
        model: findPrismModel(original.model).id,
        expandedPrompt: original.expandedPrompt,
      },
      { sourceId: original.id, mode: 'upscale' },
    );
    return NextResponse.json({ ...saved, machine: result.machine });
  } catch (err) {
    const message = (err as Error).message ?? 'Unknown error';
    console.error('Prism upscale error:', err);
    const friendly = /fetch failed|ECONNREFUSED/i.test(message)
      ? 'ComfyUI isn’t running. Start it with run_nvidia_gpu.bat and try again.'
      : ranOutOfMemory(err)
        ? 'The computer ran out of memory for this picture. Close a few programs and try again.'
        : message;
    return bad(friendly, 502);
  }
}
