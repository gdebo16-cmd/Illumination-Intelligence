// PUT    /api/umbra/tasks/<taskId> — edit: { title, instructions, schedule }
// PATCH  /api/umbra/tasks/<taskId> — pause or resume: { enabled: boolean }
// DELETE /api/umbra/tasks/<taskId> — delete (its past reports stay in the inbox)

import { NextResponse } from 'next/server';
import { getCurrentUserId, noProfile } from '@/lib/user';
import { deleteTask, setTaskEnabled, updateTask, validateTask } from '@/lib/umbra/tasks';

type Params = { params: Promise<{ taskId: string }> };
const notFound = () => NextResponse.json({ error: 'Task not found.' }, { status: 404 });

export async function PUT(req: Request, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  const checked = validateTask(await req.json().catch(() => ({})));
  if ('error' in checked) return NextResponse.json(checked, { status: 400 });
  const task = updateTask(userId, (await params).taskId, checked.task);
  return task ? NextResponse.json(task) : notFound();
}

export async function PATCH(req: Request, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'Send { enabled: true | false }.' }, { status: 400 });
  const task = setTaskEnabled(userId, (await params).taskId, body.enabled);
  return task ? NextResponse.json(task) : notFound();
}

export async function DELETE(_req: Request, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  return deleteTask(userId, (await params).taskId) ? NextResponse.json({ deleted: true }) : notFound();
}
