// lib/umbra/bots.ts — Umbra's bots and their chats.
//
// A bot is a flame avatar + a name + a personality + a purpose + a model.
// Each bot has one ongoing chat with the profile that made it.

import 'server-only';
import crypto from 'node:crypto';
import db from '@/lib/db';
import { BOT_LIMITS, BOT_MODELS, isBotModel, isFlame } from '@/config/umbra';

export interface Bot {
  id: string;
  name: string;
  flame: string;
  personality: string;
  purpose: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface BotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export type BotInput = Pick<Bot, 'name' | 'flame' | 'personality' | 'purpose' | 'model'>;

const BOT_COLUMNS = 'id, name, flame, personality, purpose, model, createdAt, updatedAt';

/** Check and tidy what the form sent. Returns an error message, or the cleaned-up bot. */
export function validateBot(input: Record<string, unknown>): { error: string } | { bot: BotInput } {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const bot: BotInput = {
    name: text(input.name),
    flame: text(input.flame),
    personality: text(input.personality),
    purpose: text(input.purpose),
    model: text(input.model) || BOT_MODELS[0].id,
  };
  if (!bot.name) return { error: 'Give your bot a name.' };
  if (bot.name.length > BOT_LIMITS.name) return { error: `Keep the name under ${BOT_LIMITS.name} characters.` };
  if (!isFlame(bot.flame)) return { error: 'Pick a flame for your bot.' };
  if (bot.personality.length > BOT_LIMITS.personality) return { error: 'The personality is too long.' };
  if (bot.purpose.length > BOT_LIMITS.purpose) return { error: 'The purpose is too long.' };
  if (!isBotModel(bot.model)) return { error: 'Pick one of the listed models.' };
  return { bot };
}

export function listBots(userId: string): Bot[] {
  return db
    .prepare(`SELECT ${BOT_COLUMNS} FROM UmbraBot WHERE user_id = ? ORDER BY updatedAt DESC`)
    .all(userId) as unknown as Bot[];
}

/** One bot, only if it belongs to this profile. */
export function getBot(userId: string, id: string): Bot | null {
  const bot = db
    .prepare(`SELECT ${BOT_COLUMNS} FROM UmbraBot WHERE id = ? AND user_id = ?`)
    .get(id, userId) as Bot | undefined;
  return bot ?? null;
}

export function createBot(userId: string, input: BotInput): Bot {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO UmbraBot (id, user_id, name, flame, personality, purpose, model, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, input.name, input.flame, input.personality, input.purpose, input.model, now, now);
  return { id, ...input, createdAt: now, updatedAt: now };
}

export function updateBot(userId: string, id: string, input: BotInput): Bot | null {
  if (!getBot(userId, id)) return null;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE UmbraBot SET name = ?, flame = ?, personality = ?, purpose = ?, model = ?, updatedAt = ? WHERE id = ?`,
  ).run(input.name, input.flame, input.personality, input.purpose, input.model, now, id);
  return getBot(userId, id);
}

export function deleteBot(userId: string, id: string): boolean {
  if (!getBot(userId, id)) return false;
  db.prepare('DELETE FROM UmbraMessage WHERE bot_id = ?').run(id);
  db.prepare('DELETE FROM UmbraBot WHERE id = ?').run(id);
  return true;
}

export function listMessages(botId: string, limit = 200): BotMessage[] {
  // Newest `limit` messages, returned oldest-first for display.
  const rows = db
    .prepare(
      `SELECT id, role, content, createdAt FROM UmbraMessage
       WHERE bot_id = ? ORDER BY createdAt DESC, rowid DESC LIMIT ?`,
    )
    .all(botId, limit) as unknown as BotMessage[];
  return rows.reverse();
}

export function addMessage(botId: string, role: BotMessage['role'], content: string): BotMessage {
  const message = { id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString() };
  db.prepare('INSERT INTO UmbraMessage (id, bot_id, role, content, createdAt) VALUES (?, ?, ?, ?, ?)').run(
    message.id, botId, role, content, message.createdAt,
  );
  db.prepare('UPDATE UmbraBot SET updatedAt = ? WHERE id = ?').run(message.createdAt, botId);
  return message;
}

export function clearMessages(botId: string): void {
  db.prepare('DELETE FROM UmbraMessage WHERE bot_id = ?').run(botId);
}

/** The bot's "character sheet": instructions the model reads before every reply. */
export function systemPrompt(bot: Bot, userName: string): string {
  return [
    `You are ${bot.name}, a bot created by ${userName} in Umbra, part of the Illumination Intelligence suite.`,
    `You appear as a small ${bot.flame} flame spirit.`,
    bot.purpose && `What you're for: ${bot.purpose}`,
    bot.personality && `Your personality and how you talk: ${bot.personality}`,
    'Stay in character. Keep replies conversational and only as long as they need to be.',
    'You cannot browse the web, see files, or take actions yet; if asked, say so honestly instead of pretending.',
  ]
    .filter(Boolean)
    .join('\n\n');
}
