// GET /api/chat-images/<id> — a photo that was attached to a chat message, only for the profile that sent it.

import { NextResponse } from 'next/server';
import { getCurrentUserId, noProfile } from '@/lib/user';
import { readPhoto } from '@/lib/chat-images';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();

  const file = readPhoto(userId, (await params).id);
  if (!file) return NextResponse.json({ error: 'Photo not found.' }, { status: 404 });

  return new NextResponse(new Uint8Array(file), {
    headers: {
      'Content-Type': 'image/jpeg',
      // A photo never changes once sent, so the browser can keep it.
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
