// GET  /api/umbra/bots/<id>/tasks — this bot's tasks
// POST /api/umbra/bots/<id>/tasks — add one: { title, instructions, schedule }

import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user';
import { getBot } from '@/lib/umbra/bots';
import { createTask, listTasks, validateTask } from '@/lib/umbra/tasks';

type Params = { params: Promise<{ id: string }> };

async function ownedBot(params: Params['params']) {
  const userId = await getCurrentUserId();
  if (!userId) return { error: NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 }) };
  const bot = getBot(userId, (await params).id);
  if (!bot) return { error: NextResponse.json({ error: 'Flicker not found.' }, { status: 404 }) };
  return { userId, bot };
}

export async function GET(_req: Request, { params }: Params) {
  const found = await ownedBot(params);
  return 'error' in found ? found.error : NextResponse.json(listTasks(found.userId, found.bot.id));
}

export async function POST(req: Request, { params }: Params) {
  const found = await ownedBot(params);
  if ('error' in found) return found.error;
  const checked = validateTask(await req.json().catch(() => ({})));
  if ('error' in checked) return NextResponse.json(checked, { status: 400 });
  return NextResponse.json(createTask(found.userId, found.bot.id, checked.task), { status: 201 });
}
