// GET /api/umbra/looks/<id> — a Flicker look made in Halo (the Lottie .json), for the avatar to play.

import { readLook } from '@/lib/umbra/looks';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const text = readLook((await params).id);
  if (!text) return Response.json({ error: 'Look not found.' }, { status: 404 });
  // A saved look never changes, so the browser can keep it for good.
  return new Response(text, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=31536000, immutable' } });
}
