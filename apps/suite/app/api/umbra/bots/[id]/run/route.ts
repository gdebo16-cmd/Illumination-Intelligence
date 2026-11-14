// GET /api/umbra/bots/<id>/run — what the Flicker is working on right now (or just finished):
// { run: { id, status: 'working' | 'done' | 'failed', steps, source, request, error, startedAt, finishedAt } | null }
// The chat page checks this while a reply is being made in the background (you left the app, or
// another Flicker handed this one a job), so it can show the steps so far. lib/umbra/runs.ts

import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user';
import { getBot } from '@/lib/umbra/bots';
import { latestRun } from '@/lib/umbra/runs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });
  const bot = getBot(userId, (await params).id);
  if (!bot) return NextResponse.json({ error: 'Flicker not found.' }, { status: 404 });
  const run = latestRun(bot.id);
  return NextResponse.json(
    {
      run: run && {
        id: run.id,
        status: run.status,
        steps: run.steps,
        source: run.source,
        request: run.request,
        error: run.error,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
