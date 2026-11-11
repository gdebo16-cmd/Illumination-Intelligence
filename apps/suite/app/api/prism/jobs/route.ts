// GET /api/prism/jobs — the signed-in profile's pictures still being made, and the ones that
// finished or failed in the last hour, newest first. The Prism page checks this every couple of
// seconds while a picture is being made, and whenever you come back to the app.
// (POST /api/prism/generate and /api/prism/upscale start the jobs; see lib/prism/imageJobs.ts.)

import { connection, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user';
import { listImageJobs } from '@/lib/prism/imageJobs';

export async function GET() {
  // Run on every request, never a saved copy from build time.
  await connection();
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });
  }
  return NextResponse.json(listImageJobs(userId), { headers: { 'Cache-Control': 'no-store' } });
}
