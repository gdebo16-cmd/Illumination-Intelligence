// GET    /api/umbra/bots/<id> — one bot
// PUT    /api/umbra/bots/<id> — edit it: { name, flame, personality, purpose, model }
// DELETE /api/umbra/bots/<id> — delete it and its chat

import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user';
import { deleteBot, getBot, updateBot, validateBot } from '@/lib/umbra/bots';

type Params = { params: Promise<{ id: string }> };
const noProfile = () => NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });
const notFound = () => NextResponse.json({ error: 'Bot not found.' }, { status: 404 });

export async function GET(_req: Request, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  const bot = getBot(userId, (await params).id);
  return bot ? NextResponse.json(bot) : notFound();
}

export async function PUT(req: Request, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  const checked = validateBot(await req.json().catch(() => ({})));
  if ('error' in checked) return NextResponse.json(checked, { status: 400 });
  const bot = updateBot(userId, (await params).id, checked.bot);
  return bot ? NextResponse.json(bot) : notFound();
}

export async function DELETE(_req: Request, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  return deleteBot(userId, (await params).id) ? NextResponse.json({ deleted: true }) : notFound();
}
