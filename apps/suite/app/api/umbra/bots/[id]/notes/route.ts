// GET    /api/umbra/bots/<id>/notes            — what the bot has saved about you
// DELETE /api/umbra/bots/<id>/notes?note=<id>  — make it forget one note

import { NextResponse } from 'next/server';
import { getCurrentUserId, noProfile } from '@/lib/user';
import { deleteNote, getBot, listNotes } from '@/lib/umbra/bots';

type Params = { params: Promise<{ id: string }> };

async function ownedBot(params: Params['params']) {
  const userId = await getCurrentUserId();
  if (!userId) return { error: noProfile() };
  const bot = getBot(userId, (await params).id);
  if (!bot) return { error: NextResponse.json({ error: 'Flicker not found.' }, { status: 404 }) };
  return { bot };
}

export async function GET(_req: Request, { params }: Params) {
  const found = await ownedBot(params);
  return 'error' in found ? found.error : NextResponse.json(listNotes(found.bot.id));
}

export async function DELETE(req: Request, { params }: Params) {
  const found = await ownedBot(params);
  if ('error' in found) return found.error;
  const noteId = new URL(req.url).searchParams.get('note') ?? '';
  return deleteNote(found.bot.id, noteId)
    ? NextResponse.json({ deleted: true })
    : NextResponse.json({ error: 'Note not found.' }, { status: 404 });
}
