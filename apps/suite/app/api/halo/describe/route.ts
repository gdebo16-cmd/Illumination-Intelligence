// POST /api/halo/describe — { description } → the shape, moves and settings a local model picked
// for it (lib/halo/describe.ts). The Halo page puts them into its controls; nothing is saved here.

import { NextResponse } from 'next/server';
import { getCurrentUserId, noProfile } from '@/lib/user';
import { describeAnimation, MAX_DESCRIPTION } from '@/lib/halo/describe';

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  const body = await req.json().catch(() => ({}));
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, MAX_DESCRIPTION) : '';
  if (!description) {
    return NextResponse.json({ error: 'Describe the animation you want, like “a flame that flickers”.' }, { status: 400 });
  }
  try {
    return NextResponse.json(await describeAnimation(description, userId));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
