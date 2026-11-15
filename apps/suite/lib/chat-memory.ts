// lib/chat-memory.ts — how a chat keeps its thread without holding every message on the graphics card.
//
// The model only ever reads a small window (lib/queue.ts OLLAMA_CHAT_NUM_CTX). Three things fill it:
//
//   1. The newest messages, word for word (chatContext + fitHistory).
//   2. A running summary of everything older in this chat. After a reply, when the newest messages
//      nearly fill their share of the window, the oldest of them are folded into the summary
//      (foldSummary). It folds a batch at a time, not one message per turn, so most turns need no
//      extra model call.
//   3. Recall: past exchanges that match what's being talked about now (recall). Every exchange is
//      saved with an embedding (embedNewEpisodes), so "what did we decide about the garden?" finds
//      the answer even if it was said months ago, or in another Lumen chat.
//
// It also adds what's known about the person (lib/memory.ts): Lumen the shared facts, a Flicker
// with Memory on the shared facts and its own notes.
//
// Summaries and embeddings live in SQLite and cost no graphics memory. Embedding runs on the
// processor; the summary is written by the chat's own model, which is already loaded.
//
// Used by Lumen's chats, each Flicker's own chat, and team chats. The Memory page
// (/umbra/memory) shows each chat's summary and what was last recalled, from here.

import 'server-only';
import db from '@/lib/db';
import { localOnly, thinkSetting } from '@/config/models';
import { chatKey, PHOTO_CONTEXT_CHARS, photoIds } from '@/lib/chat-images';
import { buildMemoryBlock, embed, EMBED_TAG, fromBlob, hasMemories, keyTerms, matchScore, toBlob } from '@/lib/memory';
import { gpuQueue, OLLAMA_KEEP_ALIVE, OLLAMA_URL } from '@/lib/queue';

/** Which chat, and where its messages are kept. */
export interface ChatRef {
  /** "lumen:<conversation id>", "umbra:<bot id>" or "umbra-team:<team id>". */
  key: string;
  userId: string;
  table: 'Message' | 'UmbraMessage' | 'UmbraTeamMessage';
  column: 'conversationId' | 'bot_id' | 'team_id';
  id: string;
  /** Where recall looks: every Lumen chat of this profile, or only this chat (a Flicker's or a team's). */
  recallScope: 'all-lumen' | 'this-chat';
}

export const lumenChat = (userId: string, conversationId: string): ChatRef => ({
  key: chatKey.lumen(conversationId), userId, table: 'Message', column: 'conversationId', id: conversationId, recallScope: 'all-lumen',
});
export const umbraChat = (userId: string, botId: string): ChatRef => ({
  key: chatKey.umbra(botId), userId, table: 'UmbraMessage', column: 'bot_id', id: botId, recallScope: 'this-chat',
});
export const teamChatKey = (teamId: string) => `umbra-team:${teamId}`;
export const teamChat = (userId: string, teamId: string): ChatRef => ({
  key: teamChatKey(teamId), userId, table: 'UmbraTeamMessage', column: 'team_id', id: teamId, recallScope: 'this-chat',
});

export interface HistoryMessage {
  /** The message's rowid: its place in the chat. */
  rid: number;
  role: 'user' | 'assistant';
  content: string;
  /** Ids of photos sent with it (lib/chat-images.ts). */
  images: string[];
}

// ------------------------------------------------------------------ sizes

/** Room kept in the window for the summary, recalled exchanges and facts added to the system prompt. */
export const RECALL_RESERVE_CHARS = 5000;
const SUMMARY_MAX_CHARS = 1800;
const EPISODES_MAX_CHARS = 1500;

/**
 * How many characters of past messages fit in a window of `numCtx` tokens, next to instructions
 * `promptChars` long and what recall adds. (About 3 characters per token, keeping a quarter of the
 * window free for the answer.) `share` below 1 leaves room for tool results.
 */
export function historyBudget(numCtx: number, promptChars: number, share = 1): number {
  return Math.max(2000, Math.floor((numCtx * 3 * 0.75 - promptChars - RECALL_RESERVE_CHARS) * share));
}

const sizeOf = (m: { content: string; images: string[] }) => m.content.length + m.images.length * PHOTO_CONTEXT_CHARS;

/** Calculate the total character count of a message history. */
export function calculateUsedHistory<T extends { content: string; images: string[] }>(history: T[]): number {
  return history.reduce((acc, m) => acc + sizeOf(m), 0);
}

/** Returns the percentage of the history budget currently occupied (0-100). */
export function getGasGauge<T extends { content: string; images: string[] }>(history: T[], budget: number): number {
  const used = calculateUsedHistory(history);
  return Math.min(100, Math.round((used / budget) * 100));
}

/** Keep the newest messages that fit in the budget, so Ollama never has to cut off the start. */
export function fitHistory<T extends { content: string; images: string[] }>(history: T[], budget: number): T[] {
  let start = history.length;
  while (start > 0 && calculateUsedHistory(history.slice(0, start)) <= budget) {
    start--;
  }
  return history.slice(start);
}

// ------------------------------------------------------------------ reading a chat

interface State {
  summary: string;
  summaryUpto: number;
  episodesUpto: number;
}

function stateOf(key: string): State {
  const row = db
    .prepare('SELECT summary, summary_upto AS summaryUpto, episodes_upto AS episodesUpto FROM ChatMemory WHERE chat = ?')
    .get(key) as State | undefined;
  return row ?? { summary: '', summaryUpto: 0, episodesUpto: 0 };
}

function saveState(key: string, change: Partial<State>): void {
  const next = { ...stateOf(key), ...change };
  db.prepare(
    `INSERT INTO ChatMemory (chat, summary, summary_upto, episodes_upto, updatedAt) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(chat) DO UPDATE SET summary = excluded.summary, summary_upto = excluded.summary_upto,
       episodes_upto = excluded.episodes_upto, updatedAt = excluded.updatedAt`,
  ).run(key, next.summary, next.summaryUpto, next.episodesUpto, new Date().toISOString());
}

type Row = { rid: number; role: string; content: string; images: string | null; createdAt: string };

function messagesAfter(chat: ChatRef, rowid: number, limit = -1): (HistoryMessage & { createdAt: string })[] {
  // Table and column come from the fixed ChatRef makers above, never from a request.
  // Team chats have no photos.
  const images = chat.table === 'UmbraTeamMessage' ? 'NULL AS images' : 'images';
  const rows = db
    .prepare(
      `SELECT rowid AS rid, role, content, ${images}, createdAt FROM ${chat.table}
       WHERE ${chat.column} = ? AND rowid > ? ORDER BY rowid LIMIT ?`,
    )
    .all(chat.id, rowid, limit) as Row[];
  return rows.map((m) => ({
    rid: m.rid,
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
    images: photoIds(m.images),
    createdAt: m.createdAt,
  }));
}

/**
 * What the model should read of this chat: the summary of its older part ('' for a short chat),
 * and every message since, oldest first. Call it before saving the new message, then trim the
 * messages with fitHistory.
 */
export function chatContext(chat: ChatRef): { summary: string; history: HistoryMessage[] } {
  const state = stateOf(chat.key);
  return { summary: state.summary, history: messagesAfter(chat, state.summaryUpto) };
}

export function getGasGauge(history: HistoryMessage[], budget: number): number {
  return (calculateUsedHistory(history) / budget) * 100;
}

export function calculateUsedHistory(history: HistoryMessage[]): number {
  return history.reduce((acc, m) => acc + sizeOf(m), 0);
}

export function foldSummary(chat: ChatRef, history: HistoryMessage[]): void {
  const state = stateOf(chat.key);
  const { summary, summaryUpto } = state;
  
  // Take the first 5 messages that haven't been summarized yet
  const toFold = history.slice(0, 5);
  const contentToFold = toFold.map(m => m.content).join('\n');
  
  // In a real scenario, we'd call the LLM here to create a new summary
  // For now, we'll just append the content to the existing summary
  const newSummary = summary + '\n' + contentToFold;
  
  saveState(chat.key, {
    summary: newSummary,
    summaryUpto: summaryUpto + toFold.length
  });
}

/** Forget a chat's summary and saved exchanges (when the chat is deleted or cleared). */
export function forgetChat(key: string): void {
  db.prepare('DELETE FROM ChatMemory WHERE chat = ?').run(key);
  db.prepare('DELETE FROM ChatEpisode WHERE chat = ?').run(key);
}

// ------------------------------------------------------------------ recall (before a reply)

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

/** How close an old exchange has to be to what's being said now to be worth showing. */
const EPISODE_MIN_SCORE = 0.5;
const EPISODE_COUNT = 3;

function hasEpisodes(chat: ChatRef): boolean {
  const found =
    chat.recallScope === 'all-lumen'
      ? db.prepare("SELECT 1 FROM ChatEpisode WHERE user_id = ? AND chat LIKE 'lumen:%' LIMIT 1").get(chat.userId)
      : db.prepare('SELECT 1 FROM ChatEpisode WHERE user_id = ? AND chat = ? LIMIT 1').get(chat.userId, chat.key);
  return Boolean(found);
}

function episodeBlock(chat: ChatRef, queries: Float32Array[], terms: string[], visibleFrom: number): string {
  type Episode = { chat: string; lastRowId: number; text: string; embedding: Uint8Array; createdAt: string };
  const columns = 'chat, last_row_id AS lastRowId, text, embedding, createdAt';
  const rows = (
    chat.recallScope === 'all-lumen'
      ? db
          .prepare(`SELECT ${columns} FROM ChatEpisode WHERE user_id = ? AND embedding_model = ? AND chat LIKE 'lumen:%'`)
          .all(chat.userId, EMBED_TAG)
      : db
          .prepare(`SELECT ${columns} FROM ChatEpisode WHERE user_id = ? AND embedding_model = ? AND chat = ?`)
          .all(chat.userId, EMBED_TAG, chat.key)
  ) as Episode[];

  const best = rows
    // Leave out what the model is about to read anyway (the newest messages of this chat).
    .filter((e) => !(e.chat === chat.key && e.lastRowId >= visibleFrom))
    .map((e) => ({ e, score: matchScore(queries, fromBlob(e.embedding), e.text, terms, EPISODE_MIN_SCORE) }))
    .filter((x) => x.score >= EPISODE_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, EPISODE_COUNT);

  const parts: string[] = [];
  let used = 0;
  for (const { e } of best) {
    const day = new Date(e.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const part = `[${day}]\n${e.text}`;
    if (used + part.length > EPISODES_MAX_CHARS) break;
    parts.push(part);
    used += part.length;
  }
  if (parts.length === 0) return '';
  return (
    'Earlier exchanges between you and the user that may matter now (from before the messages below; ' +
    `use them only when relevant, as things you remember):\n${parts.join('\n\n')}`
  );
}

/**
 * What to add to the system prompt for this turn: the chat's summary, past exchanges that match,
 * and (with `facts`) what's known about the person: shared facts, plus a Flicker's own notes when
 * `facts.botId` is given. '' when there is nothing.
 *
 * `recent` is the trimmed history the model will read and `message` the new message. It searches
 * twice in one go: with the new message alone (a clear question isn't drowned out by the last
 * reply), and with the last couple of messages too (so a short follow-up like "and the other
 * one?" still works). Each memory counts by its better match.
 * A failure here never breaks the chat: it just remembers less this turn.
 */
export async function recall(
  chat: ChatRef,
  options: {
    summary: string;
    recent: HistoryMessage[];
    message: string;
    facts: false | { botId?: string; userName?: string };
    /** Keep this as the chat's latest recall for the Memory page (default true). */
    log?: boolean;
  },
): Promise<string> {
  const blocks: string[] = [];
  if (options.summary) {
    blocks.push(
      `Summary of this conversation so far (older messages you can no longer see):\n${clip(options.summary, SUMMARY_MAX_CHARS)}`,
    );
  }

  const said = clip(options.message, 1000);
  const withContext = [...options.recent.slice(-2).map((m) => clip(m.content, 300)), said]
    .filter((t) => t.trim())
    .join('\n');
  const searches = [...new Set([said, withContext].filter((t) => t.trim()))];
  // Names, numbers and codes in the new message are also looked for word for word (lib/memory.ts).
  const terms = keyTerms(options.message);
  const facts = options.facts;
  const searchFacts = Boolean(facts) && hasMemories(db, chat.userId, facts ? facts.botId : undefined);
  const wantEpisodes = hasEpisodes(chat);
  let queries: Float32Array[] | null = null;
  if (searches.length && (searchFacts || wantEpisodes)) {
    try {
      queries = await embed(searches, 'query');
    } catch (err) {
      console.error('Memory recall error:', (err as Error)?.message ?? err);
    }
  }
  if ((queries || terms.length) && wantEpisodes) {
    blocks.push(episodeBlock(chat, queries ?? [], terms, options.recent[0]?.rid ?? Number.MAX_SAFE_INTEGER));
  }
  // Even without a search, the facts that are always included still go in.
  if (searchFacts && facts) {
    try {
      blocks.push(await buildMemoryBlock(db, chat.userId, queries, { ...facts, terms }));
    } catch (err) {
      console.error('Memory recall error:', (err as Error)?.message ?? err);
    }
  }
  const remembered = blocks.filter(Boolean).join('\n\n');
  if (options.log !== false) noteRecall(chat.key, remembered);
  return remembered;
}

/** Keep what was recalled for the latest message, for the Memory page (helps when tuning). */
function noteRecall(key: string, text: string): void {
  const now = new Date().toISOString();
  try {
    db.prepare(
      `INSERT INTO ChatMemory (chat, updatedAt, last_recall, last_recall_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(chat) DO UPDATE SET last_recall = excluded.last_recall, last_recall_at = excluded.last_recall_at`,
    ).run(key, now, text, now);
  } catch (err) {
    console.error('Could not keep the recall for the Memory page:', (err as Error)?.message ?? err);
  }
}

// ------------------------------------------------------------------ upkeep (after a reply)

const EPISODES_PER_RUN = 48;
const embedding = new Set<string>(); // chats being embedded right now, so two replies don't save one exchange twice

/** Save each finished exchange (the user's message and the reply) with an embedding. */
async function embedNewEpisodes(chat: ChatRef): Promise<void> {
  if (embedding.has(chat.key)) return;
  embedding.add(chat.key);
  try {
    const messages = messagesAfter(chat, stateOf(chat.key).episodesUpto, 400);

    // An exchange: one or more user messages, then the replies up to the next user message.
    const exchanges: { text: string; lastRid: number; createdAt: string }[] = [];
    let asked: string[] = [];
    let answered: string[] = [];
    let last = messages[0];
    const close = () => {
      const text = `User: ${clip(asked.join('\n'), 500)}\nYou: ${clip(answered.join('\n'), 700)}`;
      exchanges.push({ text, lastRid: last.rid, createdAt: last.createdAt });
      asked = [];
      answered = [];
    };
    for (const m of messages) {
      if (m.role === 'user' && answered.length) close();
      (m.role === 'user' ? asked : answered).push(m.content.trim() || (m.images.length ? '(a photo)' : ''));
      last = m;
      if (exchanges.length === EPISODES_PER_RUN) break;
    }
    // The newest exchange counts once it has its reply, which is when this runs.
    if (exchanges.length < EPISODES_PER_RUN && asked.length && answered.length) close();
    if (exchanges.length === 0) return;

    const vectors = await embed(exchanges.map((e) => e.text), 'document');
    const add = db.prepare(
      'INSERT INTO ChatEpisode (user_id, chat, last_row_id, text, embedding, embedding_model, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    db.exec('BEGIN');
    try {
      exchanges.forEach((e, i) => add.run(chat.userId, chat.key, e.lastRid, e.text, toBlob(vectors[i]), EMBED_TAG, e.createdAt));
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    saveState(chat.key, { episodesUpto: exchanges[exchanges.length - 1].lastRid });
  } finally {
    embedding.delete(chat.key);
  }
}

/** Calculate the total "weight" of a message history. */
export function calculateUsedHistory(history: HistoryMessage[]): number {
  return history.reduce((sum, m) => sum + m.content.length + (m.images.length * 100), 0);
}

/** Returns a 0-100% gauge of the current history relative to the budget. */
export function getGasGauge(history: HistoryMessage[], budget: number): number {
  const used = calculateUsedHistory(history);
  return Math.min(100, Math.round((used / budget) * 100));
}

// Fold when the messages since the summary pass this share of their budget, down to this share.
const FOLD_ABOVE = 0.9;
const FOLD_DOWN_TO = 0.5;
// A long reply (a whole document, say) is shortened before it is summarized.
const FOLD_MESSAGE_CHARS = 1500;

const SUMMARY_SYSTEM = `You keep the running summary of a conversation between a user and an assistant. The assistant will read it in place of the old messages, so it has to hold everything needed to carry on naturally.

You get the SUMMARY SO FAR and the NEXT MESSAGES. Write the new summary, covering both.

Keep: what the user wants and why, decisions made, facts, names, numbers, dates, things the user said about themselves, anything promised or left open, and where things stand now.
Drop: greetings, filler, and anything that was later corrected or replaced (keep only the final version).

Write in plain sentences or short bullets, third person ("The user…", "The assistant…"). At most 250 words. Output only the summary.`;

function pendingFold(chat: ChatRef, budget: number): { state: State; fold: HistoryMessage[] } | null {
  const state = stateOf(chat.key);
  const messages = messagesAfter(chat, state.summaryUpto);
  let left = messages.reduce((sum, m) => sum + sizeOf(m), 0);
  if (left <= budget * FOLD_ABOVE) return null;

  // Take the oldest messages until what's left fits comfortably, a batch the model can read in one go.
  let cut = 0;
  let batch = 0;
  while (cut < messages.length - 2 && left > budget * FOLD_DOWN_TO && batch < budget) {
    left -= sizeOf(messages[cut]);
    batch += Math.min(messages[cut].content.length, FOLD_MESSAGE_CHARS);
    cut++;
  }
  // What stays should start with something the user said.
  while (cut < messages.length - 2 && messages[cut].role !== 'user') cut++;
  return cut > 0 ? { state, fold: messages.slice(0, cut) } : null;
}

/** Fold the oldest messages into the chat's summary, if the chat has grown enough to need it. */
async function foldSummary(chat: ChatRef, model: string, numCtx: number, budget: number): Promise<void> {
  // More than one batch only when catching up on a chat that was already long.
  for (let pass = 0; pass < 3; pass++) {
    const pending = pendingFold(chat, budget);
    if (!pending) return;
    const { state, fold } = pending;

    const transcript = fold
      .map((m) => {
        const text = m.content.length > FOLD_MESSAGE_CHARS
          ? `${m.content.slice(0, FOLD_MESSAGE_CHARS - 400)}\n…\n${m.content.slice(-400)}`
          : m.content;
        return `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${text}${m.images.length ? ' (sent with a photo)' : ''}`;
      })
      .join('\n\n');

    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        // The same window the chat uses: Ollama loads a model again when the size changes.
        options: { temperature: 0.2, num_ctx: numCtx, num_predict: 600 },
        keep_alive: OLLAMA_KEEP_ALIVE,
        ...thinkSetting(model, false),
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM },
          { role: 'user', content: `SUMMARY SO FAR:\n${state.summary || '(none yet)'}\n\nNEXT MESSAGES:\n${transcript}` },
        ],
      }),
    });
    if (!res.ok) throw new Error(`summary failed: ${res.status}`);
    const body = (await res.json()) as { message?: { content?: string } };
    const summary = (body.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (!summary) return; // nothing usable: leave the messages where they are and try again next time

    saveState(chat.key, { summary: clip(summary, SUMMARY_MAX_CHARS), summaryUpto: fold[fold.length - 1].rid });
  }
}

/**
 * Call after a reply is saved. It returns straight away and does the upkeep in the background:
 * saves the new exchange for recall, and folds old messages into the summary when the chat has
 * grown. `model` and `numCtx` are the ones the chat just used (already on the card); `budget` is
 * the history budget the chat was given (historyBudget).
 */
export function maintainChat(chat: ChatRef, chatModel: string, numCtx: number, budget: number): void {
  const model = localOnly(chatModel); // after a cloud reply, a local model writes the summary
  embedNewEpisodes(chat).catch((err) => console.error('Chat recall upkeep error:', (err as Error)?.message ?? err));
  // Only take a turn on the graphics card when there's something to summarize.
  if (!pendingFold(chat, budget)) return;
  gpuQueue
    .add(() => foldSummary(chat, model, numCtx, budget), 'low', 'ollama', { userId: chat.userId, model })
    .catch((err) => console.error('Chat summary error:', (err as Error)?.message ?? err));
}

// ------------------------------------------------------------------ the Memory page

export interface ChatMemoryView {
  key: string;
  kind: 'lumen' | 'flicker' | 'team';
  /** The chat's title, or the Flicker's or team's name. */
  title: string;
  /** Where to open the chat. */
  href: string;
  summary: string;
  /** How many exchanges are saved for recall. */
  saved: number;
  /** What was recalled for its latest message ('' for nothing), and when. */
  lastRecall: string;
  lastRecallAt: string | null;
}

/** The chats this profile owns: key → title and link. Only these can be shown or reset. */
function ownedChats(userId: string): Map<string, { kind: ChatMemoryView['kind']; title: string; href: string }> {
  const owned = new Map<string, { kind: ChatMemoryView['kind']; title: string; href: string }>();
  for (const c of db.prepare('SELECT id, title FROM Conversation WHERE user_id = ?').all(userId) as { id: string; title: string }[]) {
    owned.set(chatKey.lumen(c.id), { kind: 'lumen', title: c.title, href: '/lumen' });
  }
  for (const b of db.prepare('SELECT id, name FROM UmbraBot WHERE user_id = ?').all(userId) as { id: string; name: string }[]) {
    owned.set(chatKey.umbra(b.id), { kind: 'flicker', title: b.name, href: `/umbra/${b.id}` });
  }
  for (const t of db.prepare('SELECT id, name FROM UmbraTeam WHERE user_id = ?').all(userId) as { id: string; name: string }[]) {
    owned.set(teamChatKey(t.id), { kind: 'team', title: t.name, href: `/umbra/teams/${t.id}` });
  }
  return owned;
}

/** What each of this profile's chats remembers of itself, most recently used first. */
export function chatMemoryOverview(userId: string): ChatMemoryView[] {
  const owned = ownedChats(userId);
  const saved = new Map(
    (db.prepare('SELECT chat, COUNT(*) AS n FROM ChatEpisode WHERE user_id = ? GROUP BY chat').all(userId) as { chat: string; n: number }[])
      .map((r) => [r.chat, Number(r.n)]),
  );
  type Row = { chat: string; summary: string; updatedAt: string; lastRecall: string | null; lastRecallAt: string | null };
  const rows = db
    .prepare('SELECT chat, summary, updatedAt, last_recall AS lastRecall, last_recall_at AS lastRecallAt FROM ChatMemory')
    .all() as Row[];
  return rows
    .filter((r) => owned.has(r.chat))
    .map((r) => ({
      key: r.chat,
      ...owned.get(r.chat)!,
      summary: r.summary,
      saved: saved.get(r.chat) ?? 0,
      lastRecall: r.lastRecall ?? '',
      lastRecallAt: r.lastRecallAt,
    }))
    .sort((a, b) => (b.lastRecallAt ?? '').localeCompare(a.lastRecallAt ?? ''));
}

/**
 * From the Memory page: 'summary' starts the chat's summary over (its messages are summarized
 * again as it grows); 'all' also forgets its saved exchanges. Facts about you stay either way.
 */
export function resetChatMemory(userId: string, key: string, what: 'summary' | 'all'): boolean {
  if (!ownedChats(userId).has(key)) return false;
  if (what === 'all') forgetChat(key);
  else saveState(key, { summary: '', summaryUpto: 0 });
  return true;
}
