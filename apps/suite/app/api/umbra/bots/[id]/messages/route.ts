// GET    /api/umbra/bots/<id>/messages — the bot's chat history, oldest first
// DELETE /api/umbra/bots/<id>/messages — clear the chat (the bot itself stays)

import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user';
import { clearMessages, getBot, listMessages } from '@/lib/umbra/bots';
import { workHeaders } from '@/lib/umbra/busy';
import { activeRun } from '@/lib/umbra/runs';

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
  if ('error' in found) return found.error;
  const headers = workHeaders(`bot:${found.bot.id}`);
  // A background run (lib/umbra/runs.ts) also counts, e.g. a job another Flicker handed this one.
  if (activeRun(found.bot.id)) headers['X-Umbra-Busy'] = '1';
  return NextResponse.json(listMessages(found.bot.id), { headers });
}

export async function DELETE(_req: Request, { params }: Params) {
  const found = await ownedBot(params);
  if ('error' in found) return found.error;
  if (activeRun(found.bot.id)) {
    return NextResponse.json({ error: `${found.bot.name} is still working. Clear the chat after it finishes.` }, { status: 409 });
  }
  clearMessages(found.bot.id);
  return NextResponse.json({ cleared: true });
}
