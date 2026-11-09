// GET /api/prism/images — the signed-in profile's pictures, newest first.

import { connection, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user';
import { listImages } from '@/lib/prism/images';

export async function GET() {
  // Run on every request, never a saved copy from build time.
  await connection();
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });
  }
  return NextResponse.json(listImages(userId));
}
