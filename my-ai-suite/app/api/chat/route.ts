import { NextResponse } from 'next/server';
import db from '@/lib/db';
import crypto from 'crypto';

export async function POST(req: Request) {
  try {
    const { conversationId, prompt, model } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    let activeConversationId = conversationId;
    const now = new Date().toISOString();

    // 1. Handle Conversation creation/lookup
    if (!activeConversationId) {
      activeConversationId = crypto.randomUUID();
      const title = prompt.length > 30 ? prompt.substring(0, 30) + '...' : prompt;
      
      const insertConv = db.prepare(
        'INSERT INTO Conversation (id, title, createdAt, updatedAt) VALUES (?, ?, ?, ?)'
      );
      insertConv.run(activeConversationId, title, now, now);
    } else {
      // Update conversation timestamp
      const updateConv = db.prepare('UPDATE Conversation SET updatedAt = ? WHERE id = ?');
      updateConv.run(now, activeConversationId);
    }

    // 2. Save user message
    const userMsgId = crypto.randomUUID();
    const insertMsg = db.prepare(
      'INSERT INTO Message (id, conversationId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)'
    );
    insertMsg.run(userMsgId, activeConversationId, 'user', prompt, now);

    // 3. Call local Ollama instance
    const ollamaRes = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || 'qwen3-coder:30b',
        prompt: prompt,
        stream: false,
      }),
    });

    if (!ollamaRes.ok) {
      throw new Error(`Ollama error: ${ollamaRes.statusText}`);
    }

    const ollamaData = await ollamaRes.json();
    const reply = ollamaData.response || 'No response generated.';

    // 4. Save assistant reply
    const assistantMsgId = crypto.randomUUID();
    const replyTime = new Date().toISOString();
    insertMsg.run(assistantMsgId, activeConversationId, 'assistant', reply, replyTime);

    return NextResponse.json({
      conversationId: activeConversationId,
      reply,
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('API Chat Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}