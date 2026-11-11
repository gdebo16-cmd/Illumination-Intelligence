// POST /api/umbra/teams/<id>/chat — give the team a message: { message: string }
//
// Streams one JSON object per line, like a bot chat:
//   { "type": "sent",  "message": … }   your message, saved
//   { "type": "step",  "step": … }      the leader (or a teammate under it) did something (may repeat)
//   { "type": "reply", "message": … }   the leader's final answer, saved, with every step
//   { "type": "error", "error": "…" }

import { NextResponse } from 'next/server';
import { endWork, startWork, workFailed } from '@/lib/umbra/busy';
import { USERS } from '@/lib/user';
import { addTeamMessage, listTeamMessages, runTeam } from '@/lib/umbra/teams';
import { ownedTeam } from '../../owned';

const MAX_MESSAGE = 4000;
// How many earlier messages the leader "remembers" in each reply.
const HISTORY = 30;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const found = await ownedTeam(params);
  if ('error' in found) return found.error;
  const { userId, team } = found;

  const body = (await req.json().catch(() => ({}))) as { message?: unknown };
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return NextResponse.json({ error: 'Type a message first.' }, { status: 400 });
  if (message.length > MAX_MESSAGE) {
    return NextResponse.json({ error: `Keep messages under ${MAX_MESSAGE} characters.` }, { status: 400 });
  }

  const history = listTeamMessages(team.id, HISTORY).map((m) => ({ role: m.role, content: m.content }));
  const sent = addTeamMessage(team.id, 'user', message);

  const encoder = new TextEncoder();
  // If you leave the app, the phone drops this stream. The reply keeps going and is saved anyway;
  // the chat page picks it up when you come back.
  const workKey = `team:${team.id}`;
  let gone = false;
  startWork(workKey);
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => {
        if ((event as { type?: string }).type === 'error') workFailed(workKey, (event as { error: string }).error);
        if (gone) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          gone = true;
        }
      };
      send({ type: 'sent', message: sent });
      try {
        const result = await runTeam({
          userId,
          userName: USERS[userId],
          team,
          history,
          message,
          onStep: (step) => send({ type: 'step', step }),
        });
        send({ type: 'reply', message: addTeamMessage(team.id, 'assistant', result.reply, result.steps) });
      } catch (err) {
        console.error('Umbra team chat error:', err);
        const text = (err as Error).message ?? '';
        send({
          type: 'error',
          error: /fetch failed|ECONNREFUSED/i.test(text)
            ? 'Ollama isn’t running, so the team can’t think right now.'
            : /not found/i.test(text)
              ? 'One of the team’s models isn’t installed. Check each Flicker’s settings.'
              : text || 'Something went wrong.',
        });
      } finally {
        endWork(workKey);
        if (!gone) {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      }
    },
    cancel() {
      gone = true;
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' },
  });
}
