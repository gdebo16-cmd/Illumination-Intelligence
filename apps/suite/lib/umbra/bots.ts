// lib/umbra/bots.ts — Umbra's bots, their chats, and their notes.
//
// A bot is a flame avatar + a name + a personality + a purpose + a model + the tools it may use.
// Each bot has one ongoing chat with the profile that made it, and notes it chose to remember.

import 'server-only';
import crypto from 'node:crypto';
import db from '@/lib/db';
import { BOT_LIMITS, BOT_MODELS, BOT_TOOLS, DEFAULT_TOOL_IDS, flameWords, isBotModel, isFlame, isToolId, type ToolId } from '@/config/umbra';
import { checkCodeFolder, editStatuses } from './code';
import { approvalStatuses } from './prod-control';
import { chatKey, deletePhotos, photoIds } from '@/lib/chat-images';
import { canThink } from '@/config/models';
import type { AgentStep } from './types';
import { renameArtifactSource, saveDocumentArtifacts } from '@/lib/artifacts';
import { DOCUMENT_SYSTEM_PROMPT } from '@/lib/prompts';
import { mayHoldDocument } from '@/lib/document-blocks';

export interface Bot {
  id: string;
  name: string;
  flame: string;
  personality: string;
  purpose: string;
  model: string;
  tools: ToolId[];
  /** Code helper: the one project folder it may look at ('' when not set)… */
  codeFolder: string;
  /** …and whether it may change files there without asking first. */
  codeAutoWrite: boolean;
  /** Think before answering: reason step by step first, and show the thinking in the chat. */
  think: boolean;
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
  /** For your messages: ids of the photos sent with it (lib/chat-images.ts). */
  images?: string[];
}

export interface BotNote {
  id: string;
  content: string;
  createdAt: string;
}

export type BotInput = Pick<Bot, 'name' | 'flame' | 'personality' | 'purpose' | 'model' | 'tools' | 'codeFolder' | 'codeAutoWrite' | 'think'>;

const BOT_COLUMNS =
  'id, name, flame, personality, purpose, model, tools, code_folder AS codeFolder, code_auto AS codeAutoWrite, think, createdAt, updatedAt';

// The database keeps the tool list as JSON text; turn it back into a list (dropping unknown ids).
type BotRow = Omit<Bot, 'tools' | 'codeAutoWrite' | 'think'> & { tools: string; codeAutoWrite: number; think: number };
const fromRow = (row: BotRow): Bot => {
  let tools: unknown = [];
  try {
    tools = JSON.parse(row.tools);
  } catch {}
  return {
    ...row,
    tools: Array.isArray(tools) ? tools.filter(isToolId) : [],
    codeAutoWrite: row.codeAutoWrite === 1,
    think: row.think === 1,
  };
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
    // Leaving tools out (older forms) gives the bot the usual tools.
    tools: Array.isArray(input.tools) ? [...new Set(input.tools.filter(isToolId))] : [...DEFAULT_TOOL_IDS],
    codeFolder: text(input.codeFolder),
    codeAutoWrite: input.codeAutoWrite === true,
    think: input.think === true,
  };
  // Only some models can think; for the others the switch stays off.
  if (!canThink(bot.model)) bot.think = false;
  if (!bot.name) return { error: 'Give your Flicker a name.' };
  if (bot.name.length > BOT_LIMITS.name) return { error: `Keep the name under ${BOT_LIMITS.name} characters.` };
  if (!isFlame(bot.flame)) return { error: 'Pick a flame for your Flicker.' };
  if (bot.personality.length > BOT_LIMITS.personality) return { error: 'The personality is too long.' };
  if (bot.purpose.length > BOT_LIMITS.purpose) return { error: 'The purpose is too long.' };
  if (!isBotModel(bot.model)) return { error: 'Pick one of the listed models.' };
  if (bot.tools.includes('code')) {
    const problem = checkCodeFolder(bot.codeFolder);
    if (problem) return { error: problem };
  }
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
    `INSERT INTO UmbraBot (id, user_id, name, flame, personality, purpose, model, tools, code_folder, code_auto, think, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, userId, input.name, input.flame, input.personality, input.purpose, input.model, JSON.stringify(input.tools),
    input.codeFolder, input.codeAutoWrite ? 1 : 0, input.think ? 1 : 0, now, now,
  );
  return { id, ...input, createdAt: now, updatedAt: now };
}

export function updateBot(userId: string, id: string, input: BotInput): Bot | null {
  if (!getBot(userId, id)) return null;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE UmbraBot SET name = ?, flame = ?, personality = ?, purpose = ?, model = ?, tools = ?, code_folder = ?, code_auto = ?,
     think = ?, updatedAt = ? WHERE id = ?`,
  ).run(
    input.name, input.flame, input.personality, input.purpose, input.model, JSON.stringify(input.tools),
    input.codeFolder, input.codeAutoWrite ? 1 : 0, input.think ? 1 : 0, now, id,
  );
  renameArtifactSource(userId, id, input.name);
  return getBot(userId, id);
}

export function deleteBot(userId: string, id: string): boolean {
  if (!getBot(userId, id)) return false;
  db.prepare('DELETE FROM UmbraMessage WHERE bot_id = ?').run(id);
  deletePhotos(chatKey.umbra(id));
  db.prepare('DELETE FROM UmbraNote WHERE bot_id = ?').run(id);
  db.prepare('DELETE FROM UmbraTask WHERE bot_id = ?').run(id);
  db.prepare('DELETE FROM UmbraRun WHERE bot_id = ?').run(id);
  db.prepare('DELETE FROM UmbraCodeEdit WHERE bot_id = ?').run(id);
  // Background chat runs (lib/umbra/runs.ts); the table only exists once a run has happened.
  try {
    db.prepare('DELETE FROM UmbraChatRun WHERE bot_id = ?').run(id);
  } catch {}
  // Prod control requests (lib/umbra/prod-control.ts); that table also only exists once used.
  try {
    db.prepare('DELETE FROM UmbraApproval WHERE bot_id = ?').run(id);
  } catch {}
  // Teams: drop it from teams it's on; teams it leads go too (a team can't work without its leader).
  db.prepare('DELETE FROM UmbraTeamMember WHERE bot_id = ?').run(id);
  for (const { id: teamId } of db.prepare('SELECT id FROM UmbraTeam WHERE leader_id = ?').all(id) as { id: string }[]) {
    db.prepare('DELETE FROM UmbraTeamMessage WHERE team_id = ?').run(teamId);
    db.prepare('DELETE FROM UmbraTeamMember WHERE team_id = ?').run(teamId);
    db.prepare('DELETE FROM UmbraTask WHERE team_id = ?').run(teamId);
    db.prepare('DELETE FROM UmbraTeam WHERE id = ?').run(teamId);
  }
  db.prepare('DELETE FROM UmbraBot WHERE id = ?').run(id);
  return true;
}

// ------------------------------------------------------------------ chat

type MessageRow = Omit<BotMessage, 'steps' | 'images'> & { steps: string | null; images: string | null };

export function listMessages(botId: string, limit = 200): BotMessage[] {
  // Newest `limit` messages, returned oldest-first for display.
  const rows = db
    .prepare(
      `SELECT id, role, content, createdAt, steps, images FROM UmbraMessage
       WHERE bot_id = ? ORDER BY createdAt DESC, rowid DESC LIMIT ?`,
    )
    .all(botId, limit) as unknown as MessageRow[];
  const messages = rows.reverse().map(({ steps, images, ...m }): BotMessage => {
    let parsed: AgentStep[] | undefined;
    try {
      parsed = steps ? JSON.parse(steps) : undefined;
    } catch {}
    const message: BotMessage = parsed?.length ? { ...m, steps: parsed } : m;
    const photos = photoIds(images);
    if (photos.length) message.images = photos;
    return message;
  });
  // Code helper: show whether each suggested change was applied since (the saved steps say "pending").
  const editSteps = messages.flatMap((m) => m.steps ?? []).filter((s) => s.edit);
  const current = editStatuses(editSteps.map((s) => s.edit!.id));
  for (const step of editSteps) Object.assign(step.edit!, current.get(step.edit!.id));
  // Prod control: show what happened to each restart request (approved, denied, how it went).
  const approvalSteps = messages.flatMap((m) => m.steps ?? []).filter((s) => s.approval);
  const approvals = approvalStatuses(approvalSteps.map((s) => s.approval!.id));
  for (const step of approvalSteps) {
    const now = approvals.get(step.approval!.id);
    if (now) step.approval = now;
  }
  return messages;
}

export function addMessage(
  botId: string,
  role: BotMessage['role'],
  content: string,
  steps?: AgentStep[],
  /** Ids of photos sent with the message, already saved with savePhotos(). */
  images?: string[],
): BotMessage {
  const message: BotMessage = { id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString() };
  if (steps?.length) message.steps = steps;
  if (images?.length) message.images = images;
  db.prepare('INSERT INTO UmbraMessage (id, bot_id, role, content, createdAt, steps, images) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    message.id, botId, role, content, message.createdAt, steps?.length ? JSON.stringify(steps) : null,
    images?.length ? JSON.stringify(images) : null,
  );
  db.prepare('UPDATE UmbraBot SET updatedAt = ? WHERE id = ?').run(message.createdAt, botId);
  // A document the Flicker wrote goes to Umbra's artifacts too.
  if (role === 'assistant' && mayHoldDocument(content)) {
    const owner = db.prepare('SELECT user_id, name FROM UmbraBot WHERE id = ?').get(botId) as { user_id: string; name: string } | undefined;
    if (owner) {
      saveDocumentArtifacts(
        { userId: owner.user_id, app: 'umbra', sourceKind: 'bot', sourceId: botId, sourceName: owner.name },
        content,
        message.createdAt,
      );
    }
  }
  return message;
}

export function clearMessages(botId: string): void {
  db.prepare('DELETE FROM UmbraMessage WHERE bot_id = ?').run(botId);
  deletePhotos(chatKey.umbra(botId));
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
    `You are ${bot.name}, a Flicker (an AI helper) created by ${userName} in Umbra, part of the Illumination Intelligence suite.`,
    // e.g. "violet flame spirit" or "water droplet spirit" (a picked color is named by its look, not its code).
    `You appear as a small ${flameWords(bot.flame)}.`,
    bot.purpose && `What you're for: ${bot.purpose}`,
    bot.personality && `Your personality and how you talk: ${bot.personality}`,
    'Stay in character. Keep replies conversational and only as long as they need to be.',
    // Models don't know today's date on their own; without this they guess (often years off).
    `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`,
    toolNames.length
      ? `You have tools: ${toolNames.join(', ')}. Use them whenever they would make your answer more accurate or useful, ` +
        'instead of guessing. You can use several tools in a row before answering. ' +
        'Never invent tool results; if a tool fails, tell the user plainly.'
      : 'You have no tools: you cannot browse the web, read files, or take actions. If asked, say so honestly instead of pretending. (You can still write documents and .md files with a document block, as described below.)',
    toolNames.length > 0 &&
      `You keep working even if ${userName} leaves the chat or closes the app: your tools keep running on the server and your reply is saved here for when they come back. ` +
        'So carry a job through to the end instead of stopping to check in, unless you truly need their decision.',
    bot.tools.includes('calculator') &&
      'Never do arithmetic in your head: use the calculate tool for any math, and days_until for counting days.',
    usesWeb && 'When your answer uses information from the web, mention where it came from, with links.',
    bot.tools.includes('code') &&
      `You can work with the code in ${userName}'s project folder (${bot.codeFolder}). Look around with list_folder, ` +
        'search_code and read_file before answering questions about it; never guess what a file says. ' +
        'To change a file, call propose_edit with text copied exactly from read_file. ' +
        (bot.codeAutoWrite
          ? 'Your changes are written straight away, so be careful and make one small change at a time.'
          : `${userName} sees each change and applies it with a button, so tell them what each change does and why.`),
    bot.tools.includes('refract') &&
      `You can work in Refract, a virtual machine isolated from ${userName}'s PC. ` +
        'Projects live in workspaces you copy in with refract_clone (an https git link; private GitHub repos work too). ' +
        'To get the latest from GitHub use refract_pull, not git pull or git fetch in refract_run (those can\'t log in to private repos). ' +
        'Look around with refract_workspaces, refract_list, refract_search and refract_read; never guess what a file says. ' +
        'Edit with refract_write (changes are written in the virtual machine straight away). ' +
        'Run builds, tests and other commands with refract_run, always inside a workspace. ' +
        'Before a risky change, take a workspace snapshot with refract_snapshot so you can restore it if something goes wrong. ' +
        'When the work is ready, commit it with refract_commit (a clear message; files that may hold secrets are left out automatically), ' +
        'then open a pull request with refract_pull_request, which pushes to a feature branch and returns the PR link to share. ' +
        'refract_push pushes without a PR. Never push straight onto main or master unless they clearly ask; nothing is ever force-pushed. ' +
        `Merge a pull request with refract_merge_pr only when ${userName} asked you to merge it or approved merging. ` +
        'It squash-merges Flicker (flicker/) pull requests into the default branch, and refuses when there are conflicts or checks failed or are still running; then say why, and wait or fix it. ' +
        'Pushing and pull requests need a GitHub token on the server; if a tool says it is missing, pass that on plainly. ' +
        'All of this work stays in the virtual machine until you push it. ' +
        'These tools cannot touch the host PC. ' +
        'If the virtual machine is off, the refract_ tools start it themselves and wait until it is ready (this can take a minute or two), ' +
        'and refract_start turns it on on its own. So never ask the user to start Refract: just carry on with the work. ' +
        'Only if starting it fails, pass on the reason plainly.',
    bot.tools.includes('host_ops') &&
      `You have Prod control: restart_prod asks ${userName} to approve pulling main, building, and restarting the live app on their PC, and prod_status checks on it. ` +
        `Only request a restart after ${userName} asked for one, and tell them it needs their approval: they tap Approve on the card in this chat, and nothing runs until they do. ` +
        'The restart briefly stops the server you run on. Your work is picked back up afterwards, so then check the result with prod_status and report it plainly. ' +
        'Merging pull requests is separate (refract_merge_pr).',
    bot.tools.includes('notes') &&
      `When ${userName} tells you something worth remembering long-term (preferences, facts about them, plans), save it with save_note. Notes are for short facts only: when asked to save or export a write-up as a file, use a document block instead.`,
    DOCUMENT_SYSTEM_PROMPT,
    notes.length > 0 &&
      `Things you've saved about ${userName} (your notes):\n${notes.map((n) => `- ${n.content}`).join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
