// POST /api/umbra/edits/<id> — apply or turn down a change the Code helper suggested.
// Body: { apply: true } writes the change to the file; { apply: false } leaves the file alone.

import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user';
import { decideEdit } from '@/lib/umbra/code';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { apply?: unknown };
  const edit = decideEdit(userId, (await params).id, body.apply === true);
  if (!edit) return NextResponse.json({ error: 'That suggested change wasn’t found.' }, { status: 404 });
  return NextResponse.json(edit);
}
