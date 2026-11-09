// lib/umbra/bots.ts — Umbra's bots, their chats, and their notes.
//
// A bot is a flame avatar + a name + a personality + a purpose + a model + the tools it may use.
// Each bot has one ongoing chat with the profile that made it, and notes it chose to remember.

import 'server-only';
import crypto from 'node:crypto';
import db from '@/lib/db';
import { ALL_TOOL_IDS, BOT_LIMITS, BOT_MODELS, BOT_TOOLS, isBotModel, isFlame, isToolId, type ToolId } from '@/config/umbra';
import type { AgentStep } from './agent';

export interface Bot {
  id: string;
  name: string;
  flame: string;
  personality: string;
  purpose: string;
  model: string;
  tools: ToolId[];
  createdAt: string;
  updatedAt: string;
}

export interface BotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  /** For bot replies: the tools it used along the way. */
  steps?: AgentStep[];
}

export interface BotNote {
  id: string;
  content: string;
  createdAt: string;
}

export type BotInput = Pick<Bot, 'name' | 'flame' | 'personality' | 'purpose' | 'model' | 'tools'>;

const BOT_COLUMNS = 'id, name, flame, personality, purpose, model, tools, createdAt, updatedAt';

// The database keeps the tool list as JSON text; turn it back into a list (dropping unknown ids).
type BotRow = Omit<Bot, 'tools'> & { tools: string };
const fromRow = (row: BotRow): Bot => {
  let tools: unknown = [];
  try {
    tools = JSON.parse(row.tools);
  } catch {}
  return { ...row, tools: Array.isArray(tools) ? tools.filter(isToolId) : [] };
};

/** Check and tidy what the form sent. Returns an error message, or the cleaned-up bot. */
export function validateBot(input: Record<string, unknown>): { error: string } | { bot: BotInput } {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const bot: BotInput = {
    name: text(input.name),
    flame: text(input.flame),
    personality: text(input.personality),
    purpose: text(input.purpose),
    model: text(input.model) || BOT_MODELS[0].id,
    // Leaving tools out (older forms) gives the bot every tool.
    tools: Array.isArray(input.tools) ? [...new Set(input.tools.filter(isToolId))] : [...ALL_TOOL_IDS],
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
  const rows = db
    .prepare(`SELECT ${BOT_COLUMNS} FROM UmbraBot WHERE user_id = ? ORDER BY updatedAt DESC`)
    .all(userId) as unknown as BotRow[];
  return rows.map(fromRow);
}

/** One bot, only if it belongs to this profile. */
export function getBot(userId: string, id: string): Bot | null {
  const row = db
    .prepare(`SELECT ${BOT_COLUMNS} FROM UmbraBot WHERE id = ? AND user_id = ?`)
    .get(id, userId) as BotRow | undefined;
  return row ? fromRow(row) : null;
}

export function createBot(userId: string, input: BotInput): Bot {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO UmbraBot (id, user_id, name, flame, personality, purpose, model, tools, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, input.name, input.flame, input.personality, input.purpose, input.model, JSON.stringify(input.tools), now, now);
  return { id, ...input, createdAt: now, updatedAt: now };
}

export function updateBot(userId: string, id: string, input: BotInput): Bot | null {
  if (!getBot(userId, id)) return null;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE UmbraBot SET name = ?, flame = ?, personality = ?, purpose = ?, model = ?, tools = ?, updatedAt = ? WHERE id = ?`,
  ).run(input.name, input.flame, input.personality, input.purpose, input.model, JSON.stringify(input.tools), now, id);
  return getBot(userId, id);
}

export function deleteBot(userId: string, id: string): boolean {
  if (!getBot(userId, id)) return false;
  db.prepare('DELETE FROM UmbraMessage WHERE bot_id = ?').run(id);
  db.prepare('DELETE FROM UmbraNote WHERE bot_id = ?').run(id);
  db.prepare('DELETE FROM UmbraBot WHERE id = ?').run(id);
  return true;
}

// ------------------------------------------------------------------ chat

type MessageRow = Omit<BotMessage, 'steps'> & { steps: string | null };

export function listMessages(botId: string, limit = 200): BotMessage[] {
  // Newest `limit` messages, returned oldest-first for display.
  const rows = db
    .prepare(
      `SELECT id, role, content, createdAt, steps FROM UmbraMessage
       WHERE bot_id = ? ORDER BY createdAt DESC, rowid DESC LIMIT ?`,
    )
    .all(botId, limit) as unknown as MessageRow[];
  return rows.reverse().map(({ steps, ...m }) => {
    let parsed: AgentStep[] | undefined;
    try {
      parsed = steps ? JSON.parse(steps) : undefined;
    } catch {}
    return parsed?.length ? { ...m, steps: parsed } : m;
  });
}

export function addMessage(botId: string, role: BotMessage['role'], content: string, steps?: AgentStep[]): BotMessage {
  const message: BotMessage = { id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString() };
  if (steps?.length) message.steps = steps;
  db.prepare('INSERT INTO UmbraMessage (id, bot_id, role, content, createdAt, steps) VALUES (?, ?, ?, ?, ?, ?)').run(
    message.id, botId, role, content, message.createdAt, steps?.length ? JSON.stringify(steps) : null,
  );
  db.prepare('UPDATE UmbraBot SET updatedAt = ? WHERE id = ?').run(message.createdAt, botId);
  return message;
}

export function clearMessages(botId: string): void {
  db.prepare('DELETE FROM UmbraMessage WHERE bot_id = ?').run(botId);
}

// ------------------------------------------------------------------ notes

export function listNotes(botId: string): BotNote[] {
  return db
    .prepare('SELECT id, content, createdAt FROM UmbraNote WHERE bot_id = ? ORDER BY createdAt ASC')
    .all(botId) as unknown as BotNote[];
}

export function deleteNote(botId: string, noteId: string): boolean {
  return db.prepare('DELETE FROM UmbraNote WHERE id = ? AND bot_id = ?').run(noteId, botId).changes > 0;
}

// ------------------------------------------------------------------ instructions

/** The bot's "character sheet": instructions the model reads before every reply. */
export function systemPrompt(bot: Bot, userName: string, notes: BotNote[]): string {
  const toolNames = BOT_TOOLS.filter((t) => bot.tools.includes(t.id)).map((t) => t.name.toLowerCase());
  const usesWeb = bot.tools.includes('web_search') || bot.tools.includes('read_webpage');

  return [
    `You are ${bot.name}, a bot created by ${userName} in Umbra, part of the Illumination Intelligence suite.`,
    `You appear as a small ${bot.flame} flame spirit.`,
    bot.purpose && `What you're for: ${bot.purpose}`,
    bot.personality && `Your personality and how you talk: ${bot.personality}`,
    'Stay in character. Keep replies conversational and only as long as they need to be.',
    // Models don't know today's date on their own; without this they guess (often years off).
    `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`,
    toolNames.length
      ? `You have tools: ${toolNames.join(', ')}. Use them whenever they would make your answer more accurate or useful, ` +
        'instead of guessing. You can use several tools in a row before answering. ' +
        'Never invent tool results; if a tool fails, tell the user plainly.'
      : 'You have no tools: you cannot browse the web, see files, or take actions. If asked, say so honestly instead of pretending.',
    bot.tools.includes('calculator') &&
      'Never do arithmetic in your head: use the calculate tool for any math, and days_until for counting days.',
    usesWeb && 'When your answer uses information from the web, mention where it came from, with links.',
    bot.tools.includes('notes') &&
      `When ${userName} tells you something worth remembering long-term (preferences, facts about them, plans), save it with save_note.`,
    notes.length > 0 &&
      `Things you've saved about ${userName} (your notes):\n${notes.map((n) => `- ${n.content}`).join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
