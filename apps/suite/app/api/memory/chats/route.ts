// DELETE /api/memory/chats?chat=<key>&what=summary|all
//   summary: start the chat's running summary over
//   all:     also forget its saved exchanges, so nothing from it is recalled
// The chat's messages, and the facts about you, stay either way.

import { NextResponse } from 'next/server';
import { getCurrentUserId, noProfile } from '@/lib/user';
import { resetChatMemory } from '@/lib/chat-memory';

export async function DELETE(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  const url = new URL(req.url);
  const key = url.searchParams.get('chat') ?? '';
  const what = url.searchParams.get('what') === 'all' ? 'all' : 'summary';
  return resetChatMemory(userId, key, what)
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'Chat not found.' }, { status: 404 });
}
