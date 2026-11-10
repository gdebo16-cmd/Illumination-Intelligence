// GET    /api/umbra/bots/<id>/messages — the bot's chat history, oldest first
// DELETE /api/umbra/bots/<id>/messages — clear the chat (the bot itself stays)

import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user';
import { clearMessages, getBot, listMessages } from '@/lib/umbra/bots';

type Params = { params: Promise<{ id: string }> };

async function ownedBot(params: Params['params']) {
  const userId = await getCurrentUserId();
  if (!userId) return { error: NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 }) };
  const bot = getBot(userId, (await params).id);
  if (!bot) return { error: NextResponse.json({ error: 'Flicker not found.' }, { status: 404 }) };
  return { bot };
}

export async function GET(_req: Request, { params }: Params) {
  const found = await ownedBot(params);
  return 'error' in found ? found.error : NextResponse.json(listMessages(found.bot.id));
}

export async function DELETE(_req: Request, { params }: Params) {
  const found = await ownedBot(params);
  if ('error' in found) return found.error;
  clearMessages(found.bot.id);
  return NextResponse.json({ cleared: true });
}
