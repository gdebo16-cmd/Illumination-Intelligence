// PATCH  /api/memory/facts/<id> — change a fact's wording or kind: { fact, category }
// DELETE /api/memory/facts/<id> — forget it (a shared fact is forgotten by Lumen and every Flicker)

import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUserId, noProfile } from '@/lib/user';
import { editMemory, FACT_MAX_CHARS, forgetMemory, isCategory } from '@/lib/memory';

type Params = { params: Promise<{ id: string }> };

const idOf = async (params: Params['params']) => {
  const id = Number((await params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const notFound = () => NextResponse.json({ error: 'That memory is gone.' }, { status: 404 });

export async function PATCH(req: Request, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  const id = await idOf(params);
  if (!id) return notFound();
  const body = (await req.json().catch(() => ({}))) as { fact?: unknown; category?: unknown };
  const fact = typeof body.fact === 'string' ? body.fact.trim() : '';
  if (fact.length < 3) return NextResponse.json({ error: 'Write the thing to remember first.' }, { status: 400 });
  if (fact.length > FACT_MAX_CHARS) return NextResponse.json({ error: `Keep it under ${FACT_MAX_CHARS} characters.` }, { status: 400 });
  const category = isCategory(body.category) ? body.category : 'other';
  return editMemory(db, userId, id, { fact, category }) ? NextResponse.json({ ok: true }) : notFound();
}

export async function DELETE(_req: Request, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  const id = await idOf(params);
  if (!id) return notFound();
  return forgetMemory(db, userId, id, null) ? NextResponse.json({ ok: true }) : notFound();
}
