import { NextResponse } from 'next/server';
import { gpuQueue } from '@/lib/queue';
import { getCurrentUserId } from '@/lib/user';


/** Where the current user's live request is in the GPU line. Polled by <QueueNotice>. */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ waiting: false, place: 0, ahead: 0 });
  return NextResponse.json(gpuQueue.statusFor(userId));
}
