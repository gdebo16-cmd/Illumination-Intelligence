import { NextResponse } from 'next/server';
import crypto from 'crypto';
import db from '@/lib/db';
import { buildMemoryBlock, extractMemories } from '@/lib/memory';
import { getCurrentUserId } from '@/lib/user';
import { gpuQueue } from '@/lib/queue';
import { BASE_SYSTEM_PROMPT, DOCUMENT_SYSTEM_PROMPT } from '@/lib/prompts';

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';

export async function POST(req: Request) {
  try {
    // 1. Identify the active user
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Please select a user profile first.' }, { status: 401 });
    }

    // 2. Read the incoming request
    const { conversationId, prompt, model } = await req.json();
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    let activeConversationId: string = conversationId;
    const now = new Date().toISOString();

    // 3. Create or validate the conversation
    if (!activeConversationId) {
      activeConversationId = crypto.randomUUID();
      const title = prompt.length > 30 ? prompt.substring(0, 30) + '...' : prompt;

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

    // 4. Load previous messages (before saving the new one)
    const history = db
      .prepare(
        `SELECT role, content FROM Message WHERE conversationId = ? ORDER BY createdAt ASC, rowid ASC`,
      )
      .all(activeConversationId) as { role: string; content: string }[];

    // 5. Save the new user message
    const insertMsg = db.prepare(
      `INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)`,
    );
    insertMsg.run(crypto.randomUUID(), activeConversationId, 'user', prompt, now);

    // 6. Retrieve relevant long-term memories (async: must be awaited).
    //    A memory failure must never break the chat itself.
    let memoryBlock = '';
    try {
      memoryBlock = await buildMemoryBlock(db, userId, prompt);
    } catch (memoryError) {
      console.error('Memory retrieval error:', memoryError);
    }

    // 7. Build the messages for Ollama's chat endpoint
    const systemPrompt = [BASE_SYSTEM_PROMPT, DOCUMENT_SYSTEM_PROMPT, memoryBlock]
      .filter(Boolean)
      .join('\n\n');

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      { role: 'user', content: prompt },
    ];

    // 8. Send to Ollama through the queue (live chat has priority over background jobs)
    const ollamaData = await gpuQueue.add(async () => {
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model || 'qwen3-coder:30b',
          messages,
          stream: false,
        }),
      });
      if (!res.ok) {
        throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as { message?: { content?: string } };
    }, 'high');

    const reply = ollamaData.message?.content || 'No response generated.';

    // 9. Save the assistant response
    insertMsg.run(
      crypto.randomUUID(),
      activeConversationId,
      'assistant',
      reply,
      new Date().toISOString(),
    );

    // 10. Extract new memories in the background: do not await, so the reply returns immediately
    gpuQueue
      .add(() => extractMemories(db, userId, activeConversationId), 'low')
      .catch((memoryError) => console.error('Memory extraction error:', memoryError));

    // 11. Return the response to the frontend
    return NextResponse.json({ conversationId: activeConversationId, reply });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('API Chat Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
