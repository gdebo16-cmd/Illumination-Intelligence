// POST /api/umbra/bots/<id>/chat — send the bot a message: { message: string }
//
// The answer arrives as a stream, one JSON object per line, as things happen:
//   { "type": "sent",  "message": … }   your message, saved
//   { "type": "step",  "step": … }      a tool started or finished (may repeat)
//   { "type": "reply", "message": … }   the bot's answer, saved, with its steps
//   { "type": "error", "error": "…" }   something went wrong

import { NextResponse } from 'next/server';
import { getCurrentUserId, USERS } from '@/lib/user';
import { addMessage, getBot, listMessages, listNotes, systemPrompt } from '@/lib/umbra/bots';
import { runAgent, type ChatMessage } from '@/lib/umbra/agent';

const MAX_MESSAGE = 4000;
// How many earlier messages the bot "remembers" in each reply.
const HISTORY = 40;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // 1. Who is asking, and is it their bot?
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });
  const bot = getBot(userId, (await params).id);
  if (!bot) return NextResponse.json({ error: 'Flicker not found.' }, { status: 404 });

  // 2. What did they say?
  const body = (await req.json().catch(() => ({}))) as { message?: unknown };
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return NextResponse.json({ error: 'Type a message first.' }, { status: 400 });
  if (message.length > MAX_MESSAGE) {
    return NextResponse.json({ error: `Keep messages under ${MAX_MESSAGE} characters.` }, { status: 400 });
  }

  // 3. What the model reads: the bot's character sheet (with its notes), recent chat, the new message.
  const history = listMessages(bot.id, HISTORY);
  const sent = addMessage(bot.id, 'user', message);
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(bot, USERS[userId], listNotes(bot.id)) },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  // 4. Run the agent loop, streaming each event to the page as it happens.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      send({ type: 'sent', message: sent });
      try {
        const result = await runAgent({
          model: bot.model,
          toolIds: bot.tools,
          messages,
          context: { userId, botId: bot.id },
          onStep: (step) => send({ type: 'step', step }),
        });
        send({ type: 'reply', message: addMessage(bot.id, 'assistant', result.reply, result.steps) });
      } catch (err) {
        console.error('Umbra chat error:', err);
        const text = (err as Error).message ?? '';
        send({
          type: 'error',
          error: /fetch failed|ECONNREFUSED/i.test(text)
            ? 'Ollama isn’t running, so the bot can’t think right now.'
            : /not found/i.test(text)
              ? `The model ${bot.model} isn’t installed. Pick another in the bot’s settings.`
              : text || 'Something went wrong.',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' },
  });
}
