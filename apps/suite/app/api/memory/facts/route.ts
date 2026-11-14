// POST /api/memory/facts — add a fact by hand: { fact, category, botId? }
// Without botId it is shared (Lumen and every Flicker with Memory on); with one, that Flicker's own note.

import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUserId, noProfile } from '@/lib/user';
import { addMemory, FACT_MAX_CHARS, isCategory } from '@/lib/memory';
import { getBot } from '@/lib/umbra/bots';

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  const body = (await req.json().catch(() => ({}))) as { fact?: unknown; category?: unknown; botId?: unknown };
  const fact = typeof body.fact === 'string' ? body.fact.trim() : '';
  if (fact.length < 3) return NextResponse.json({ error: 'Write the thing to remember first.' }, { status: 400 });
  if (fact.length > FACT_MAX_CHARS) return NextResponse.json({ error: `Keep it under ${FACT_MAX_CHARS} characters.` }, { status: 400 });
  const category = isCategory(body.category) ? body.category : 'other';
  const botId = typeof body.botId === 'string' && body.botId ? body.botId : null;
  if (botId && !getBot(userId, botId)) return NextResponse.json({ error: 'Flicker not found.' }, { status: 404 });
  const id = addMemory(db, userId, { fact, category, botId });
  return NextResponse.json({ id }, { status: 201 });
}
