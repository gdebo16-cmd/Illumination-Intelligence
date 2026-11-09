// GET  /api/umbra/bots — your bots, most recently used first
// POST /api/umbra/bots — create a bot: { name, flame, personality, purpose, model }

import { connection, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user';
import { createBot, listBots, validateBot } from '@/lib/umbra/bots';

const noProfile = () => NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });

export async function GET() {
  await connection();
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  return NextResponse.json(listBots(userId));
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  const checked = validateBot(await req.json().catch(() => ({})));
  if ('error' in checked) return NextResponse.json(checked, { status: 400 });
  return NextResponse.json(createBot(userId, checked.bot), { status: 201 });
}
