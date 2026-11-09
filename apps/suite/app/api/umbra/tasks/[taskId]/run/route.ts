// POST /api/umbra/tasks/<taskId>/run — "Run now". Answers straight away; the bot works in the
// background and its report appears in the inbox when it's done.

import { after, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user';
import { getTask, runTaskNow } from '@/lib/umbra/tasks';

export async function POST(_req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });
  const task = getTask(userId, (await params).taskId);
  if (!task) return NextResponse.json({ error: 'Task not found.' }, { status: 404 });

  // after(): keep working once the answer has been sent.
  after(() => runTaskNow(userId, task).catch((err) => console.error('Umbra run-now failed:', err)));
  return NextResponse.json({ started: true }, { status: 202 });
}
