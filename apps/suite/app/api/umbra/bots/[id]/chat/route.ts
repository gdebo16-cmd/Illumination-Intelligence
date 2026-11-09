// POST /api/umbra/bots/<id>/chat — send the bot a message: { message: string }
// Returns the bot's reply (and saves both to its chat).

import { NextResponse } from 'next/server';
import { getCurrentUserId, USERS } from '@/lib/user';
import { gpuQueue } from '@/lib/queue';
import { addMessage, getBot, listMessages, systemPrompt } from '@/lib/umbra/bots';

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const MAX_MESSAGE = 4000;
// How many earlier messages the bot "remembers" in each reply.
const HISTORY = 40;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // 1. Who is asking, and is it their bot?
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });
  const bot = getBot(userId, (await params).id);
  if (!bot) return NextResponse.json({ error: 'Bot not found.' }, { status: 404 });

  // 2. What did they say?
  const body = (await req.json().catch(() => ({}))) as { message?: unknown };
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return NextResponse.json({ error: 'Type a message first.' }, { status: 400 });
  if (message.length > MAX_MESSAGE) {
    return NextResponse.json({ error: `Keep messages under ${MAX_MESSAGE} characters.` }, { status: 400 });
  }

  // 3. Build what the model reads: the bot's character sheet, recent chat, then the new message.
  const history = listMessages(bot.id, HISTORY);
  const saved = addMessage(bot.id, 'user', message);
  const messages = [
    { role: 'system', content: systemPrompt(bot, USERS[userId]) },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  // 4. Ask the bot's model, through the GPU queue (which clears Prism's model off the card first).
  try {
    const data = await gpuQueue.add(async () => {
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: bot.model, messages, stream: false }),
      });
      if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
      return (await res.json()) as { message?: { content?: string } };
    }, 'high', 'ollama');

    const reply = data.message?.content?.trim() || '…';
    return NextResponse.json({ sent: saved, reply: addMessage(bot.id, 'assistant', reply) });
  } catch (err) {
    console.error('Umbra chat error:', err);
    const text = (err as Error).message ?? '';
    const friendly = /fetch failed|ECONNREFUSED/i.test(text)
      ? 'Ollama isn’t running, so the bot can’t think right now.'
      : /not found/i.test(text)
        ? `The model ${bot.model} isn’t installed. Pick another in the bot’s settings.`
        : text || 'Something went wrong.';
    return NextResponse.json({ error: friendly, sent: saved }, { status: 502 });
  }
}
