// POST /api/prism/videos/<id>/smooth — "Smooth" a finished video: make a copy with an
// in-between frame after every frame (RIFE, lib/prism/smooth.ts). Answers straight away with
// the new video, status 'working'; check GET /api/prism/videos until it says 'done'.

import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user';
import { startSmooth } from '@/lib/prism/videos';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });
  const { id } = await params;
  const result = startSmooth(userId, id);
  if (result === 'missing') return NextResponse.json({ error: 'Video not found.' }, { status: 404 });
  if (result === 'not-done') return NextResponse.json({ error: 'Wait for the video to finish first.' }, { status: 409 });
  if (result === 'smoothed') return NextResponse.json({ error: 'This video is already smooth.' }, { status: 409 });
  return NextResponse.json(result, { status: 202 });
}
