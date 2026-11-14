import { NextResponse } from 'next/server';
import crypto from 'crypto';
import db from '@/lib/db';
import { extractMemories, extractModelFor } from '@/lib/memory';
import { chatContext, fitHistory, historyBudget, lumenChat, maintainChat, recall } from '@/lib/chat-memory';
import { getCurrentUserId, noProfile } from '@/lib/user';
import { gpuQueue, OLLAMA_KEEP_ALIVE, OLLAMA_CHAT_NUM_CTX } from '@/lib/queue';
import { BASE_SYSTEM_PROMPT, DOCUMENT_SYSTEM_PROMPT } from '@/lib/prompts';
import { canSeeImages } from '@/config/models';
import { saveDocumentArtifacts } from '@/lib/artifacts';
import { mayHoldDocument } from '@/lib/document-blocks';
import {
  chatKey, PhotoError, PHOTO_CONTEXT_CHARS, preparePhotos, savePhotos, uploadedPhotos, withPhotos,
} from '@/lib/chat-images';

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen3-coder:30b';

export async function POST(req: Request) {
  try {
    // 1. Identify the active user
    const userId = await getCurrentUserId();
    if (!userId) return noProfile();

    // 2. Read the incoming request: JSON, or a form when photos are attached
    let fields: { conversationId?: unknown; prompt?: unknown; model?: unknown };
    let uploads: File[] = [];
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await req.formData();
      fields = { conversationId: form.get('conversationId'), prompt: form.get('prompt'), model: form.get('model') };
      uploads = uploadedPhotos(form);
    } else {
      fields = await req.json();
    }
    const prompt = typeof fields.prompt === 'string' ? fields.prompt : '';
    // A photo can be sent on its own; otherwise there has to be something written.
    if (!prompt.trim() && uploads.length === 0) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const chatModel: string = (typeof fields.model === 'string' && fields.model) || DEFAULT_MODEL;
    const canSee = canSeeImages(chatModel);
    // The photo button is hidden for models that can't see, so this is only a safety net.
    if (uploads.length > 0 && !canSee) {
      return NextResponse.json({ error: 'This model can’t see photos. Pick one that can.' }, { status: 400 });
    }
    let photos: Buffer[];
    try {
      photos = await preparePhotos(uploads);
    } catch (photoError) {
      if (photoError instanceof PhotoError) return NextResponse.json({ error: photoError.message }, { status: 400 });
      throw photoError;
    }

    let activeConversationId = typeof fields.conversationId === 'string' ? fields.conversationId : '';
    const now = new Date().toISOString();

    // 3. Create or validate the conversation
    if (!activeConversationId) {
      activeConversationId = crypto.randomUUID();
      const title = !prompt.trim() ? 'Photo' : prompt.length > 30 ? prompt.substring(0, 30) + '...' : prompt;

      db.prepare(
        `INSERT INTO Conversation (id, title, user_id, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`,
      ).run(activeConversationId, title, userId, now, now);
    } else {
      const conversation = db
        .prepare(`SELECT user_id FROM Conversation WHERE id = ?`)
        .get(activeConversationId) as { user_id: string } | undefined;

      if (!conversation) {
        return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
      }
      if (conversation.user_id !== userId) {
        return NextResponse.json({ error: 'You do not have access to this conversation.' }, { status: 403 });
      }

      db.prepare(`UPDATE Conversation SET updatedAt = ? WHERE id = ?`).run(now, activeConversationId);
    }

    // 4. Load what the model will read of this chat (before saving the new message): the summary
    //    of its older part, and the messages since. See lib/chat-memory.ts.
    const chat = lumenChat(userId, activeConversationId);
    const { summary, history } = chatContext(chat);

    // 5. Save the new user message, and its photos
    const images = savePhotos(userId, chatKey.lumen(activeConversationId), photos);
    const insertMsg = db.prepare(
      `INSERT INTO Message (id, conversationId, role, content, createdAt, images) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insertMsg.run(crypto.randomUUID(), activeConversationId, 'user', prompt, now, images.length ? JSON.stringify(images) : null);

    // 6. Keep the newest messages that fit in the window, word for word.
    // Models don't know today's date on their own, and remembered things come with dates.
    const today = `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`;
    const basePrompt = [BASE_SYSTEM_PROMPT, today, DOCUMENT_SYSTEM_PROMPT].join('\n\n');
    const budget = historyBudget(OLLAMA_CHAT_NUM_CTX, basePrompt.length);
    const recent = fitHistory(history, Math.max(2000, budget - prompt.length - images.length * PHOTO_CONTEXT_CHARS));

    // 7. Add what it remembers: the summary, past exchanges that match, and facts about the profile.
    //    (A memory failure never breaks the chat itself: recall() just returns less.)
    const remembered = await recall(chat, { summary, recent, message: prompt, facts: true });
    const systemPrompt = [basePrompt, remembered].filter(Boolean).join('\n\n');

    // withPhotos swaps photo ids for the pictures themselves, when this model can see them.
    const messages = [
      { role: 'system', content: systemPrompt },
      ...withPhotos(
        [...recent.map((m) => ({ role: m.role, content: m.content, images: m.images })), { role: 'user', content: prompt, images }],
        canSee,
      ),
    ];

    // 8. Send to Ollama through the queue (live chat has priority over background jobs)
    //    The queue unloads any other model first and retries once if Ollama crashes.
    const ollamaData = await gpuQueue.add(
      async () => {
        const res = await fetch(`${OLLAMA_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: chatModel,
            messages,
            stream: false,
            options: { num_ctx: OLLAMA_CHAT_NUM_CTX },
            keep_alive: OLLAMA_KEEP_ALIVE, // stay loaded a while for the next message (lib/queue.ts)
          }),
        });
        if (!res.ok) {
          // Ollama puts the real reason in the body; keep it for the server log.
          const detail = (await res.text().catch(() => '')).slice(0, 300);
          throw new Error(`Ollama error: ${res.status} ${res.statusText}${detail ? ` - ${detail}` : ''}`);
        }
        return (await res.json()) as { message?: { content?: string } };
      },
      'high',
      'ollama',
      { userId, model: chatModel },
    );

    const reply = ollamaData.message?.content || 'No response generated.';

    // 9. Save the assistant response
    const repliedAt = new Date().toISOString();
    insertMsg.run(crypto.randomUUID(), activeConversationId, 'assistant', reply, repliedAt, null);

    // 9b. Keep any document in the reply in Lumen's artifacts (the sidebar's Artifacts list).
    let artifacts = 0;
    if (mayHoldDocument(reply)) {
      const chat = db.prepare('SELECT title FROM Conversation WHERE id = ?').get(activeConversationId) as { title: string } | undefined;
      artifacts = saveDocumentArtifacts(
        { userId, app: 'lumen', sourceKind: 'chat', sourceId: activeConversationId, sourceName: chat?.title ?? 'Chat' },
        reply,
        repliedAt,
      );
    }

    // 10. Extract new memories in the background: do not await, so the reply returns immediately.
    //     It uses the model that just answered (already on the card), with the same context size.
    const memoryModel = extractModelFor(chatModel);
    gpuQueue
      .add(() => extractMemories(db, userId, activeConversationId, memoryModel, OLLAMA_CHAT_NUM_CTX), 'low', 'ollama', {
        userId,
        model: memoryModel,
      })
      .catch((memoryError) => console.error('Memory extraction error:', memoryError));
    // 10b. Also in the background: save this exchange for recall, and fold old messages into the
    //      chat's summary once it has grown.
    maintainChat(chat, chatModel, OLLAMA_CHAT_NUM_CTX, budget);

    // 11. Return the response to the frontend
    return NextResponse.json({ conversationId: activeConversationId, reply, images, artifacts });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('API Chat Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
