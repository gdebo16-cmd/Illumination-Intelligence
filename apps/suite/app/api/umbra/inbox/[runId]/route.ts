// PATCH  /api/umbra/inbox/<runId> — mark read or unread: { read: boolean }
// DELETE /api/umbra/inbox/<runId> — delete the report

import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user';
import { deleteRun, markRunRead } from '@/lib/umbra/tasks';

type Params = { params: Promise<{ runId: string }> };
const noProfile = () => NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });
const notFound = () => NextResponse.json({ error: 'Report not found.' }, { status: 404 });

export async function PATCH(req: Request, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  const body = (await req.json().catch(() => ({}))) as { read?: unknown };
  const ok = markRunRead(userId, (await params).runId, body.read !== false);
  return ok ? NextResponse.json({ ok: true }) : notFound();
}

export async function DELETE(_req: Request, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  return deleteRun(userId, (await params).runId) ? NextResponse.json({ deleted: true }) : notFound();
}
