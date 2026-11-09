// POST /api/prism/generate — "make me a picture", or "edit this picture".
//
// Make one from words (JSON):
//   { prompt, style?, width?, height?, seed? }
// Edit one of your Prism pictures (JSON):
//   { prompt: "make it nighttime", sourceId: "<picture id>", style?, seed? }
// Edit a picture from your device (a form upload, multipart/form-data):
//   fields prompt, style?, seed?, and the file in "image"
//
// Get back: the saved picture's details, including `url` to show it.
// An edit keeps the shape of the picture you started from, so width/height are ignored.

import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user';
import { gpuQueue } from '@/lib/queue';
import { generateImage } from '@/lib/prism/comfy';
import { readImageFile, saveImage } from '@/lib/prism/images';
import { MAX_SOURCE_BYTES, prepareSource, type PreparedSource } from '@/lib/prism/source';
import { PRISM_STYLES } from '@/config/prism-styles';

const MAX_PROMPT = 2000;

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  // 1. Who is asking?
  const userId = await getCurrentUserId();
  if (!userId) return bad('Please select a user profile first.', 401);

  // 2. Read what they sent: JSON, or a form with a picture file.
  const fields: Record<string, unknown> = {};
  let upload: File | null = null;
  try {
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await req.formData();
      for (const [key, value] of form.entries()) {
        if (key === 'image' && typeof value !== 'string') upload = value;
        else if (typeof value === 'string') fields[key] = key === 'seed' || key === 'width' || key === 'height' ? Number(value) : value;
      }
    } else {
      Object.assign(fields, await req.json());
    }
  } catch {
    return bad('Send the request as JSON or as a form.');
  }

  const prompt = typeof fields.prompt === 'string' ? fields.prompt.trim() : '';
  if (!prompt) return bad('Describe the picture you want, or what to change.');
  if (prompt.length > MAX_PROMPT) return bad(`Keep the description under ${MAX_PROMPT} characters.`);

  const style = PRISM_STYLES.some((s) => s.id === fields.style) ? (fields.style as string) : 'none';
  const number = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const seed = number(fields.seed);

  // 3. Editing? Get the starting picture ready (upright, no transparency, about 1 megapixel).
  let source: PreparedSource | undefined;
  const sourceId = typeof fields.sourceId === 'string' && fields.sourceId ? fields.sourceId : null;
  try {
    if (upload) {
      if (upload.size > MAX_SOURCE_BYTES) return bad('That picture is too big (over 25 MB).');
      source = await prepareSource(Buffer.from(await upload.arrayBuffer()));
    } else if (sourceId) {
      const file = readImageFile(userId, sourceId);
      if (!file) return bad('That picture wasn’t found.', 404);
      source = await prepareSource(file);
    }
  } catch (err) {
    return bad((err as Error).message || 'Couldn’t read that picture.');
  }

  // 4. Make it. The GPU queue unloads Lumen's chat model first if it's on the card.
  try {
    const result = await gpuQueue.add(
      () =>
        generateImage({
          prompt,
          style,
          width: number(fields.width),
          height: number(fields.height),
          seed: seed === undefined ? undefined : Math.floor(Math.abs(seed)) % 2 ** 32,
          source,
        }),
      'high',
      'comfy',
    );

    // 5. Keep it, and tell the page where to find it.
    return NextResponse.json(saveImage(userId, prompt, style, result, source ? { sourceId: upload ? null : sourceId } : undefined));
  } catch (err) {
    const message = (err as Error).message ?? 'Unknown error';
    console.error('Prism generate error:', err);
    // fetch fails with "fetch failed" when nothing is listening at ComfyUI's address.
    const friendly = /fetch failed|ECONNREFUSED/i.test(message)
      ? 'ComfyUI isn’t running. Start it with run_nvidia_gpu.bat and try again.'
      : message;
    return bad(friendly, 502);
  }
}
