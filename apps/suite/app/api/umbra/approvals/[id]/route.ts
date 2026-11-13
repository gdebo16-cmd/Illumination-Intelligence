// POST /api/umbra/approvals/<id> - approve or deny something a Flicker asked to do that needs your
// OK first (Prod control's restart_prod, lib/umbra/prod-control.ts).
// Body: { approve: true } starts the fixed pull, build and restart sequence; { approve: false } does nothing.

import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user';
import { decideApproval } from '@/lib/umbra/prod-control';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { approve?: unknown };
  const approval = decideApproval(userId, (await params).id, body.approve === true);
  if (!approval) return NextResponse.json({ error: 'That request wasn’t found.' }, { status: 404 });
  return NextResponse.json(approval);
}
