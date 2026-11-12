// POST /api/astra/ai-character — have Prism's painter draw ONE character in a style: { char, style, seed? }
// Gives back the picture (PNG). The page traces it into the font (trace.ts), just like an upload,
// so the picture itself isn't kept anywhere.
//
// One character per picture, because AI painters are good at drawing a single big letter but often
// misspell a whole alphabet. It goes through the same GPU queue as Prism (lib/queue.ts), so it waits
// its turn and Lumen's chat model is moved out of the way first.

import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user';
import { generateImage, imageNeeds, type ImageRequest } from '@/lib/prism/comfy';
import { friendlyImageError } from '@/lib/prism/imageJobs';
import { gpuQueue } from '@/lib/queue';
import { characterName, isCharacter } from '@/config/astra';
import { DEFAULT_PRISM_MODEL, findPrismModel } from '@/config/prism-models';

const MAX_STYLE = 300;
const SIZE = 768; // big enough to trace cleanly, small enough to be quick

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** What the painter is told. The style is yours; the rest keeps the picture easy to trace. */
function characterPrompt(char: string, style: string): string {
  return (
    `${characterName(char)} ("${char}"), alone in the centre of a plain pure white background. ` +
    `The character is solid black, designed in this style: ${style}. ` +
    'A single character as a typography specimen: large, crisp clean edges, high contrast, flat 2D. ' +
    'No other letters or words, no shadow, no border, no frame, no background pattern.'
  );
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return bad('Please select a user profile first.', 401);
  const body = await req.json().catch(() => ({}));
  const char = typeof body.char === 'string' ? body.char : '';
  if (!isCharacter(char)) return bad('That character isn’t in the font.');
  const style = typeof body.style === 'string' ? body.style.trim().slice(0, MAX_STYLE) : '';
  if (!style) return bad('Describe the style you want, like “chunky bubble letters”.');
  const seed = typeof body.seed === 'number' && Number.isFinite(body.seed) ? Math.floor(Math.abs(body.seed)) % 2 ** 32 : undefined;

  const model = findPrismModel(DEFAULT_PRISM_MODEL);
  const request: ImageRequest = {
    prompt: characterPrompt(char, style),
    model: model.id,
    expand: false,
    style: 'none',
    width: SIZE,
    height: SIZE,
    seed,
  };
  try {
    const result = await gpuQueue.add((worker) => generateImage(request, worker), 'high', 'comfy', {
      userId,
      needs: imageNeeds(request),
    });
    return new NextResponse(new Uint8Array(result.image), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Seed': String(result.seed) },
    });
  } catch (err) {
    console.error('Astra AI character error:', err);
    return bad(friendlyImageError(err, model.name), 502);
  }
}
