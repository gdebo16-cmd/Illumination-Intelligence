// lib/umbra/remember.ts — after a Flicker or a team replies, pick up facts from the chat in the
// background (lib/memory.ts), the way Lumen does. Only for a Flicker with Memory turned on.

import 'server-only';
import db from '@/lib/db';
import { extractMemories, extractModelFor, type ExtractSource } from '@/lib/memory';
import { gpuQueue } from '@/lib/queue';
import { numCtxFor } from './agent';
import type { Bot } from './bots';

/**
 * `bot` is the Flicker that answered (a team's leader), and keeps any notes of its own; `chat` says
 * where the messages are. `model` and `toolIds` are what the reply ran with, so the model is
 * already on the card and is asked for the same context size.
 */
export function rememberFromChat(
  userId: string,
  bot: Bot,
  chat: Omit<ExtractSource, 'bot'>,
  model: string = bot.model,
  toolIds: Bot['tools'] = bot.tools,
): void {
  if (!toolIds.includes('notes')) return;
  const memoryModel = extractModelFor(model);
  gpuQueue
    .add(
      () => extractMemories(db, userId, { ...chat, bot: { id: bot.id, name: bot.name } }, memoryModel, numCtxFor(toolIds)),
      'low', 'ollama', { userId, model: memoryModel },
    )
    .catch((err) => console.error('Flicker memory extraction error:', (err as Error)?.message ?? err));
}
