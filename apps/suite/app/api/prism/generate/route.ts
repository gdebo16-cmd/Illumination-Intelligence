// POST /api/prism/generate — "make me a picture".
//
// Send: { prompt: string, style?: string, width?: number, height?: number, seed?: number }
// Get back: the saved picture's details, including `url` to show it.

import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user';
import { gpuQueue } from '@/lib/queue';
import { generateImage } from '@/lib/prism/comfy';
import { saveImage } from '@/lib/prism/images';
import { PRISM_STYLES } from '@/config/prism-styles';

const MAX_PROMPT = 2000;

export async function POST(req: Request) {
  // 1. Who is asking?
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });
  }

  // 2. Read and check what they asked for.
  let body: { prompt?: unknown; style?: unknown; width?: unknown; height?: unknown; seed?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Send the request as JSON.' }, { status: 400 });
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return NextResponse.json({ error: 'Describe the picture you want.' }, { status: 400 });
  if (prompt.length > MAX_PROMPT) {
    return NextResponse.json({ error: `Keep the description under ${MAX_PROMPT} characters.` }, { status: 400 });
  }

  const style = PRISM_STYLES.some((s) => s.id === body.style) ? (body.style as string) : 'none';
  const number = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const seed = number(body.seed);

  // 3. Make it. The GPU queue unloads Lumen's chat model first if it's on the card.
  try {
    const result = await gpuQueue.add(
      () =>
        generateImage({
          prompt,
          style,
          width: number(body.width),
          height: number(body.height),
          seed: seed === undefined ? undefined : Math.floor(Math.abs(seed)) % 2 ** 32,
        }),
      'high',
      'comfy',
    );

    // 4. Keep it, and tell the page where to find it.
    return NextResponse.json(saveImage(userId, prompt, style, result));
  } catch (err) {
    const message = (err as Error).message ?? 'Unknown error';
    console.error('Prism generate error:', err);
    // fetch fails with "fetch failed" when nothing is listening at ComfyUI's address.
    const friendly = /fetch failed|ECONNREFUSED/i.test(message)
      ? 'ComfyUI isn’t running. Start it with run_nvidia_gpu.bat and try again.'
      : message;
    return NextResponse.json({ error: friendly }, { status: 502 });
  }
}
