// GET /api/umbra/inbox — your task reports, newest first, with the number still unread.
//   ?count=1  just the unread count (cheap; used for the badge)

import { connection, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user';
import { listBots } from '@/lib/umbra/bots';
import { listRuns, unreadCount } from '@/lib/umbra/tasks';

export async function GET(req: Request) {
  await connection();
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });

  const unread = unreadCount(userId);
  if (new URL(req.url).searchParams.get('count')) return NextResponse.json({ unread });

  // Add each report's bot name and flame, so the inbox can show who wrote it.
  const bots = new Map(listBots(userId).map((b) => [b.id, b]));
  const runs = listRuns(userId).map((run) => ({
    ...run,
    botName: bots.get(run.botId)?.name ?? 'A deleted bot',
    botFlame: bots.get(run.botId)?.flame ?? 'pearl',
  }));
  return NextResponse.json({ unread, runs });
}
