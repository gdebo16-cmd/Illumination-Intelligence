// POST /api/umbra/looks — save a Halo animation as a Flicker look: { animation, color }
// Answers { id, look }: `look` is what to save as the new Flicker's look ("halo:<id>#color").

import { NextResponse } from 'next/server';
import { getCurrentUserId, noProfile } from '@/lib/user';
import { saveLook } from '@/lib/umbra/looks';

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  const body = await req.json().catch(() => ({}));
  const color = typeof body.color === 'string' && /^#[0-9a-f]{6}$/i.test(body.color) ? body.color.toLowerCase() : '#a77bff';
  const saved = saveLook(body.animation);
  if ('error' in saved) return NextResponse.json(saved, { status: 400 });
  return NextResponse.json({ id: saved.id, look: `halo:${saved.id}${color}` });
}
