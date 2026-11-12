// GET /api/prism/images/<id> — the picture file itself, only for the profile that made it.

import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user';
import { deleteImage, readImageFile } from '@/lib/prism/images';

// DELETE /api/prism/images/<id> — delete that picture for good (the ✕ on its thumbnail).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });
  }
  const { id } = await params;
  if (!deleteImage(userId, id)) return NextResponse.json({ error: 'Picture not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });
  }

  const { id } = await params;
  const file = readImageFile(userId, id);
  if (!file) return NextResponse.json({ error: 'Picture not found.' }, { status: 404 });

  return new NextResponse(new Uint8Array(file), {
    headers: {
      'Content-Type': 'image/png',
      // A picture never changes once made, so the browser can keep it.
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
