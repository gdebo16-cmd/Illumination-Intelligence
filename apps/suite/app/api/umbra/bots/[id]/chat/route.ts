// POST /api/umbra/bots/<id>/chat — send the bot a message: { message: string }
// With photos (only for a bot whose model can see images) it is a form instead: "message", plus
// one "image" file per photo.
//
// The answer arrives as a stream, one JSON object per line, as things happen:
//   { "type": "sent",  "message": … }   your message, saved
//   { "type": "step",  "step": … }      a tool started or finished (may repeat)
//   { "type": "reply", "message": … }   the bot's answer, saved, with its steps
//   { "type": "error", "error": "…" }   something went wrong
//
// The work itself is a background run (lib/umbra/runs.ts): it keeps going and is saved even if the
// page goes away mid-reply. GET /api/umbra/bots/<id>/run shows its steps to a page that comes back.
// While a run is going, another message to the same Flicker gets 409 instead of a second, colliding loop.

import { NextResponse } from 'next/server';
import { getCurrentUserId, USERS } from '@/lib/user';
import { addMessage, getBot, listMessages, listNotes, systemPrompt } from '@/lib/umbra/bots';
import type { ChatMessage } from '@/lib/umbra/agent';
import { activeRun, RunBusyError, startRun, workshopPrompt } from '@/lib/umbra/runs';
import { canSeeImages } from '@/config/models';
import { chatKey, PhotoError, preparePhotos, savePhotos, uploadedPhotos, withPhotos } from '@/lib/chat-images';

const MAX_MESSAGE = 4000;
// How many earlier messages the bot "remembers" in each reply.
const HISTORY = 40;

/** A GitHub repo the user picked in the Flicker chat dropdown. */
function readSelectedRepo(raw: unknown): { name: string; url: string } | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return null;
    if (text.startsWith("{")) {
      try {
        value = JSON.parse(text);
      } catch {
        return null;
      }
    } else {
      value = { url: text };
    }
  }
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const urlRaw = typeof rec.url === "string" ? rec.url.trim() : "";
  let parsed: URL;
  try {
    parsed = new URL(urlRaw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") return null;
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repoName = parts[1].replace(/\.git$/i, "");
  const nameRaw = typeof rec.name === "string" ? rec.name.trim() : "";
  const name = nameRaw || repoName;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(name)) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(owner)) return null;
  return { name, url: `https://github.com/${owner}/${repoName}.git` };
}


export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // 1. Who is asking, and is it their bot?
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });
  const bot = getBot(userId, (await params).id);
  if (!bot) return NextResponse.json({ error: 'Flicker not found.' }, { status: 404 });

  // 2. What did they say? JSON, or a form when photos are attached.
  let body: { message?: unknown; repo?: unknown } = {};
  let uploads: File[] = [];
  try {
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await req.formData();
      body = { message: form.get('message'), repo: form.get('repo') };
      uploads = uploadedPhotos(form);
    } else {
      body = await req.json();
    }
  } catch {}
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  // A photo can be sent on its own; otherwise there has to be something written.
  if (!message && uploads.length === 0) return NextResponse.json({ error: 'Type a message first.' }, { status: 400 });
  if (message.length > MAX_MESSAGE) {
    return NextResponse.json({ error: `Keep messages under ${MAX_MESSAGE} characters.` }, { status: 400 });
  }
  const canSee = canSeeImages(bot.model);
  // The photo button is hidden for bots that can't see, so this is only a safety net.
  if (uploads.length > 0 && !canSee) {
    return NextResponse.json({ error: `${bot.name}’s model can’t see photos. Pick one that can in its settings.` }, { status: 400 });
  }
  let photos: Buffer[];
  try {
    photos = await preparePhotos(uploads);
  } catch (err) {
    if (err instanceof PhotoError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }

  // One reply at a time: if this Flicker is still working (on your last message, or on a job another
  // Flicker handed it), say so instead of starting a second loop in the same chat.
  const busyRun = activeRun(bot.id);
  if (busyRun) {
    return NextResponse.json(
      { error: `${bot.name} is still working on ${busyRun.source === 'delegate' ? 'a job another Flicker handed over' : 'your last message'}. Its reply will show up here when it’s done.` },
      { status: 409 },
    );
  }

  // 3. What the model reads: the bot's character sheet (with its notes), recent chat, the new message.
  const history = listMessages(bot.id, HISTORY);
  const sent = addMessage(bot.id, 'user', message, undefined, savePhotos(userId, chatKey.umbra(bot.id), photos));
  // withPhotos swaps photo ids for the pictures themselves, when this bot's model can see them.
  const repo = bot.tools.includes('refract') ? readSelectedRepo(body.repo) : null;
  const prompt = systemPrompt(bot, USERS[userId], listNotes(bot.id)) + workshopPrompt(repo ?? undefined);
  const messages: ChatMessage[] = [
    { role: 'system', content: prompt },
    ...withPhotos<ChatMessage>(
      [...history.map((m) => ({ role: m.role, content: m.content, images: m.images })), { role: 'user', content: message, images: sent.images }],
      canSee,
    ),
  ];

  // 4. Start the work in the background, then stream each event to the page as it happens.
  // If you leave the app, the phone drops this stream. The run doesn't depend on it: it keeps going
  // and is saved, and the chat page picks it up (with its steps so far) when you come back.
  const encoder = new TextEncoder();
  let gone = false;
  let push: (event: object) => void = () => {};
  let started: ReturnType<typeof startRun>;
  try {
    started = startRun({
      userId,
      bot,
      messages,
      workshop: repo ?? undefined,
      source: 'chat',
      depth: 0,
      request: message,
      onStep: (step) => push({ type: 'step', step }),
    });
  } catch (err) {
    if (err instanceof RunBusyError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }

  const stream = new ReadableStream({
    async start(controller) {
      push = (event: object) => {
        if (gone) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          gone = true;
        }
      };
      push({ type: 'sent', message: sent, runId: started.runId });
      const outcome = await started.done;
      if (outcome.status === 'done') push({ type: 'reply', message: outcome.message });
      else push({ type: 'error', error: outcome.error ?? 'Something went wrong.' });
      if (!gone) {
        try {
          controller.close();
        } catch {
          // already closed
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
