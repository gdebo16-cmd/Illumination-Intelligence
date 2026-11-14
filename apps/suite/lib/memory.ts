// lib/memory.ts - extraction, storage, retrieval for long-term memory: short facts about a profile.
// Written for node:sqlite (DatabaseSync). Server-side only.
//
// Two kinds of fact live in the `memories` table:
//   - shared (bot_id NULL): about the person (who they are, their setup, people, projects, how they
//     like answers). Lumen and every Flicker with Memory turned on read and add to these.
//   - a Flicker's own notes (bot_id set): only about that Flicker's work with them ("call me
//     captain", "we're halfway through the Spanish course"). Only that Flicker reads them.
// Facts are found again by meaning (embeddings), with the core ones always included.
// What a chat itself remembers (its running summary, and recall of past exchanges) is in
// lib/chat-memory.ts, which uses the embedding helpers here.
import 'server-only';
import { thinkSetting } from '@/config/models';
import { OLLAMA_KEEP_ALIVE } from '@/lib/queue';

const OLLAMA = process.env.OLLAMA_URL ?? 'http://localhost:11434';
// The model that reads a chat for things worth remembering. Normally it's the model the chat just
// used: that one is already on the graphics card, so nothing has to be unloaded and loaded again
// around every message. Set MEMORY_EXTRACT_MODEL in .env to always use one particular model.
const FIXED_EXTRACT_MODEL = process.env.MEMORY_EXTRACT_MODEL?.trim() || null;
export const extractModelFor = (chatModel: string) => FIXED_EXTRACT_MODEL ?? chatModel;
const EMBED_MODEL = process.env.MEMORY_EMBED_MODEL ?? 'nomic-embed-text';
// The embedding model is tiny, so it runs on the processor and leaves the graphics card to the
// chat model. Set MEMORY_EMBED_GPU=1 in .env to put it on the card instead.
const EMBED_ON_GPU = process.env.MEMORY_EMBED_GPU === '1';
// Nomic's models expect to be told whether a text is something stored or a question about it;
// without that, matches are noticeably worse.
const USES_TASK_PREFIX = /nomic/i.test(EMBED_MODEL);
/**
 * Saved next to each embedding: the model, and how the text was prepared. Embeddings made another
 * way can't be compared with new ones, so memories are embedded again when this changes.
 */
export const EMBED_TAG = USES_TASK_PREFIX ? `${EMBED_MODEL}+task-prefix` : EMBED_MODEL;

// Minimal shape of node:sqlite's DatabaseSync, so this file needs no extra types.
interface Statement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
}
export interface Db {
  prepare(sql: string): Statement;
  exec(sql: string): void;
}

type Category = 'profile' | 'preference' | 'project' | 'people' | 'other';
export interface Memory {
  id: number;
  fact: string;
  category: Category;
  /** Set for a Flicker's own note; null for a shared fact. */
  bot_id: string | null;
  /** When it was saved or last changed (SQLite's "YYYY-MM-DD HH:MM:SS", UTC). */
  updated_at: string;
}
type Scope = 'user' | 'flicker';
type Op =
  | { action: 'add'; fact: string; category: Category; scope?: Scope }
  | { action: 'update'; id: number; fact: string; category: Category }
  | { action: 'delete'; id: number };

/** Which facts a lookup can see: shared ones, plus (with `botId`) that Flicker's own notes. */
const scopeSql = (botId: string | undefined) => (botId ? '(bot_id IS NULL OR bot_id = ?)' : 'bot_id IS NULL');
const scopeArgs = (botId: string | undefined) => (botId ? [botId] : []);

// ---------------------------------------------------------------- extraction prompt
const EXTRACTION_SYSTEM = `You maintain a long-term memory about one user, kept as short facts.
You will be given EXISTING MEMORIES (with ids) and a NEW CONVERSATION excerpt.
Return the changes to make, as JSON.

Save a fact only if ALL of these hold:
- The user stated it directly. Never infer, guess, or diagnose.
- It will probably still be true and useful in a month (identity, role, setup, projects, lasting preferences, people in their life).
- It is not a one-off task, a passing mood, or something only true for this chat.

Rules:
- One fact per entry, written as a short self-contained sentence about the user ("Uses an RTX 5080 with 16GB VRAM").
- If a new statement changes or contradicts an existing memory, use "update" with that id. Do not add a duplicate.
- If the user asks you to forget something, use "delete" with that id.
- Never save passwords, API keys, ID or card numbers.
- Preferences about how the assistant should respond use category "preference".
- If nothing qualifies, return {"operations": []}. Returning nothing is normal and often correct.

Categories: profile, preference, project, people, other.`;

/** Added when the chat is with a Flicker: each new fact is either shared or that Flicker's own. */
const flickerScopeRule = (name: string) => `

This conversation is with ${name}, one of several assistants the user has. Give every "add" a "scope":
- "user": a fact about the user that any assistant should know (who they are, their setup, people, projects, how they like answers in general).
- "flicker": only about the user's work with ${name} (how they want ${name} to act, a plan or routine they keep with ${name}).
Existing memories marked "(${name} only)" are ${name}'s own.`;

const OPS_SCHEMA = {
  type: 'object',
  properties: {
    operations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'update', 'delete'] },
          id: { type: 'integer' },
          fact: { type: 'string' },
          category: { type: 'string', enum: ['profile', 'preference', 'project', 'people', 'other'] },
          scope: { type: 'string', enum: ['user', 'flicker'] },
        },
        required: ['action'],
      },
    },
  },
  required: ['operations'],
};

// ---------------------------------------------------------------- ollama + vector helpers
/** `kind`: 'document' for text being stored, 'query' for text used to search what's stored. */
export async function embed(texts: string[], kind: 'query' | 'document'): Promise<Float32Array[]> {
  const prefix = USES_TASK_PREFIX ? (kind === 'query' ? 'search_query: ' : 'search_document: ') : '';
  const res = await fetch(`${OLLAMA}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: texts.map((t) => prefix + t),
      ...(EMBED_ON_GPU ? {} : { options: { num_gpu: 0 } }),
    }),
  });
  if (!res.ok) throw new Error(`embed failed: ${res.status}`);
  const data = (await res.json()) as { embeddings: number[][] };
  return data.embeddings.map((e) => Float32Array.from(e));
}

// node:sqlite takes Uint8Array for BLOBs and returns Uint8Array.
export const toBlob = (v: Float32Array) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
// slice() copies into a fresh buffer, which avoids Float32Array alignment errors.
export const fromBlob = (b: Uint8Array) => new Float32Array(b.slice().buffer);

/** The best match between one stored embedding and any of the searches. */
export const bestScore = (queries: Float32Array[], v: Float32Array) => Math.max(...queries.map((q) => cosine(q, v)));

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ---------------------------------------------------------------- extraction
/** The chat to read for facts. */
export interface ExtractSource {
  /** Where extraction keeps how far it has read: a Lumen conversation id, or "umbra:<bot id>". */
  cursorKey: string;
  table: 'Message' | 'UmbraMessage';
  column: 'conversationId' | 'bot_id';
  id: string;
  /** For a Flicker's chat: which Flicker, so it can keep notes of its own. */
  bot?: { id: string; name: string };
}

// Very short messages ("ok", "thanks!") never hold a fact worth a turn on the graphics card.
const MIN_NEW_USER_CHARS = 12;
// A long reply (a whole document, say) is shortened before it is read.
const EXTRACT_MESSAGE_CHARS = 1500;
const shorten = (text: string) =>
  text.length > EXTRACT_MESSAGE_CHARS ? `${text.slice(0, EXTRACT_MESSAGE_CHARS - 300)}\n…\n${text.slice(-300)}` : text;

/**
 * Read the chat's new messages for facts worth keeping, and save them.
 * `model` is the one to ask (see extractModelFor). `numCtx` is the context window to ask for:
 * pass the same size the chat uses, because Ollama loads a model again when the size changes.
 */
export async function extractMemories(
  db: Db,
  userId: string,
  source: ExtractSource,
  model: string,
  numCtx: number,
): Promise<void> {
  const state = db
    .prepare('SELECT last_row_id FROM memory_extractions WHERE conversation_id = ?')
    .get(source.cursorKey) as { last_row_id: number } | undefined;
  const since = state?.last_row_id ?? 0;

  // Message ids are UUIDs, so order by SQLite's built-in rowid instead. (Table and column come
  // from the callers' fixed values, never from a request.)
  const msgs = db
    .prepare(
      `SELECT rowid AS rid, role, content FROM ${source.table} WHERE ${source.column} = ? AND rowid > ? ORDER BY rowid`,
    )
    .all(source.id, since) as { rid: number; role: string; content: string }[];
  if (msgs.length === 0) return;
  const saveCursor = () =>
    db.prepare(
      `INSERT INTO memory_extractions (conversation_id, last_row_id) VALUES (?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET last_row_id = excluded.last_row_id, processed_at = datetime('now')`,
    ).run(source.cursorKey, msgs[msgs.length - 1].rid);

  const said = msgs.filter((m) => m.role === 'user').reduce((n, m) => n + m.content.trim().length, 0);
  if (said < MIN_NEW_USER_CHARS) {
    saveCursor();
    return;
  }

  const botName = source.bot?.name;
  const transcript = msgs
    .map((m) => `${m.role === 'user' ? 'USER' : (botName ?? 'ASSISTANT').toUpperCase()}: ${shorten(m.content)}`)
    .join('\n\n');

  // Show the model only memories related to this chat, so it can update instead of duplicate.
  const botId = source.bot?.id;
  const related = hasMemories(db, userId, botId)
    ? await retrieve(db, userId, await embed([transcript.slice(0, 2000)], 'query'), { k: 15, minScore: 0.3, botId })
    : [];
  const existing =
    related
      .map((m) => `[${m.id}] (${m.bot_id ? `${botName} only, ` : ''}${m.category}) ${m.fact}`)
      .join('\n') || '(none)';

  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: OPS_SCHEMA, // structured output keeps the JSON valid
      options: { temperature: 0, num_ctx: numCtx },
      keep_alive: OLLAMA_KEEP_ALIVE, // the same as the chat's, so this doesn't shorten it
      ...thinkSetting(model, false), // sorting facts needs no long reasoning
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM + (botName ? flickerScopeRule(botName) : '') },
        { role: 'user', content: `EXISTING MEMORIES:\n${existing}\n\nNEW CONVERSATION:\n${transcript}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`extract failed: ${res.status}`);
  const body = (await res.json()) as { message: { content: string } };

  let ops: Op[] = [];
  try {
    ops = JSON.parse(body.message.content).operations ?? [];
  } catch {
    return; // bad JSON: leave the cursor where it is and retry next time
  }

  await applyOps(db, userId, source.cursorKey, ops, new Set(related.map((m) => m.id)), botId);
  saveCursor();
}

async function applyOps(
  db: Db,
  userId: string,
  sourceKey: string,
  ops: Op[],
  allowedIds: Set<number>,
  botId: string | undefined,
) {
  // Only trust update/delete for ids the model was actually shown, and keep facts sane.
  const valid = ops.filter((o) => {
    if (o.action === 'add') return o.fact?.trim().length > 3 && o.fact.length < 300;
    if (o.action === 'update') return allowedIds.has(o.id) && o.fact?.trim().length > 3 && o.fact.length < 300;
    return allowedIds.has(o.id);
  });
  if (valid.length === 0) return;

  const texts = valid.filter((o): o is Extract<Op, { fact: string }> => 'fact' in o).map((o) => o.fact);
  const vectors = texts.length ? await embed(texts, 'document') : [];
  let vi = 0;

  const add = db.prepare(
    `INSERT INTO memories (user_id, bot_id, fact, category, source_conversation_id, embedding, embedding_model)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  // An update keeps the fact where it was (shared, or that Flicker's own).
  const update = db.prepare(
    `UPDATE memories SET fact = ?, category = ?, embedding = ?, embedding_model = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
  );
  const del = db.prepare("UPDATE memories SET deleted_at = datetime('now') WHERE id = ? AND user_id = ?");

  // node:sqlite has no transaction() helper, so do it by hand.
  db.exec('BEGIN');
  try {
    for (const o of valid) {
      if (o.action === 'add') {
        // In a Flicker's chat, a fact only about that Flicker stays with it; the rest is shared.
        const owner = botId && o.scope === 'flicker' ? botId : null;
        add.run(userId, owner, o.fact, o.category ?? 'other', sourceKey, toBlob(vectors[vi++]), EMBED_TAG);
      } else if (o.action === 'update') {
        update.run(o.fact, o.category ?? 'other', toBlob(vectors[vi++]), EMBED_TAG, o.id, userId);
      } else {
        del.run(o.id, userId);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ---------------------------------------------------------------- a Flicker's notes
/** A Flicker's own notes (its save_note tool, and what it picked up itself), oldest first. */
export function listBotNotes(db: Db, botId: string): Memory[] {
  return db
    .prepare(
      `SELECT id, fact, category, bot_id, updated_at FROM memories
       WHERE bot_id = ? AND deleted_at IS NULL ORDER BY created_at ASC, id ASC`,
    )
    .all(botId) as unknown as Memory[];
}

/** The shared facts about a profile, newest first. */
export function listSharedFacts(db: Db, userId: string): Memory[] {
  return db
    .prepare(
      `SELECT id, fact, category, bot_id, updated_at FROM memories
       WHERE user_id = ? AND bot_id IS NULL AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC`,
    )
    .all(userId) as unknown as Memory[];
}

/** Save a note for one Flicker (its save_note tool). It is embedded the next time memory is searched. */
export function addBotNote(db: Db, userId: string, botId: string, fact: string): void {
  db.prepare(`INSERT INTO memories (user_id, bot_id, fact, category, source_conversation_id) VALUES (?, ?, ?, 'other', ?)`).run(
    userId, botId, fact, `umbra:${botId}`,
  );
}

/**
 * Forget one fact. From a Flicker's page (`botId`) that can be one of its own notes or a shared
 * fact; never another Flicker's note. Soft delete, so it could be brought back by hand.
 */
export function forgetMemory(db: Db, userId: string, id: number, botId?: string): boolean {
  const result = db
    .prepare(
      `UPDATE memories SET deleted_at = datetime('now')
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND ${scopeSql(botId)}`,
    )
    .run(id, userId, ...scopeArgs(botId)) as { changes: number | bigint };
  return Number(result.changes) > 0;
}

/** Remove everything a Flicker kept for itself (when the Flicker is deleted). Shared facts stay. */
export function deleteBotNotes(db: Db, botId: string): void {
  db.prepare('DELETE FROM memories WHERE bot_id = ?').run(botId);
}

// ---------------------------------------------------------------- retrieval
/** Is there anything this lookup could find? (Saves embedding a question when there's nothing.) */
export function hasMemories(db: Db, userId: string, botId?: string): boolean {
  return Boolean(
    db
      .prepare(`SELECT 1 FROM memories WHERE user_id = ? AND deleted_at IS NULL AND ${scopeSql(botId)} LIMIT 1`)
      .get(userId, ...scopeArgs(botId)),
  );
}

/** Embed any fact that has no embedding yet, or one made another way (see EMBED_TAG). */
async function refreshEmbeddings(db: Db, userId: string): Promise<void> {
  const stale = db
    .prepare(
      `SELECT id, fact FROM memories
       WHERE user_id = ? AND deleted_at IS NULL AND (embedding IS NULL OR embedding_model IS NOT ?) LIMIT 64`,
    )
    .all(userId, EMBED_TAG) as { id: number; fact: string }[];
  if (stale.length === 0) return;
  const vectors = await embed(stale.map((m) => m.fact), 'document');
  const save = db.prepare('UPDATE memories SET embedding = ?, embedding_model = ? WHERE id = ?');
  stale.forEach((m, i) => save.run(toBlob(vectors[i]), EMBED_TAG, m.id));
}

/** The facts closest in meaning to any of `queries` (embeddings made with embed(…, 'query')). */
async function retrieve(
  db: Db,
  userId: string,
  queries: Float32Array[],
  options: { k?: number; minScore?: number; botId?: string } = {},
): Promise<Memory[]> {
  const { k = 8, minScore = 0.35, botId } = options;
  await refreshEmbeddings(db, userId);
  const rows = db
    .prepare(
      `SELECT id, fact, category, bot_id, updated_at, embedding FROM memories
       WHERE user_id = ? AND deleted_at IS NULL AND embedding_model = ? AND ${scopeSql(botId)}`,
    )
    .all(userId, EMBED_TAG, ...scopeArgs(botId)) as (Memory & { embedding: Uint8Array })[];

  return rows
    .map((r) => ({ r, score: bestScore(queries, fromBlob(r.embedding)) }))
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ r }) => ({ id: r.id, fact: r.fact, category: r.category, bot_id: r.bot_id, updated_at: r.updated_at }));
}

// ---------------------------------------------------------------- injection
// How many facts are always included, whatever was asked: the core shared ones ("who they are,
// how they like answers"), and a Flicker's newest notes of its own.
const ALWAYS_SHARED = 6;
const ALWAYS_BOT_NOTES = 6;

/** "2026-03-14 09:12:00" -> "Mar 2026", so the model can tell an old fact from a fresh one. */
function monthOf(sqliteTime: string): string {
  const date = new Date(`${sqliteTime.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The facts to show the model this turn, as text for the system prompt ('' when there are none).
 * `queries` are embeddings of what's being talked about (lib/chat-memory.ts makes one of the new
 * message and one with the last few messages, so "what about the other one?" still finds the
 * right facts), or null when there is nothing to search with or the embedding model can't be
 * reached: then only the facts that are always included go in.
 *
 * Always included: the profile's core facts and answer preferences, and (with `botId`) that
 * Flicker's newest notes, so it never forgets who it is talking to. Then whatever matches.
 */
export async function buildMemoryBlock(
  db: Db,
  userId: string,
  queries: Float32Array[] | null,
  options: { botId?: string; userName?: string; maxChars?: number } = {},
): Promise<string> {
  const { botId, maxChars = 2000 } = options; // 2000 characters: roughly 500 tokens
  const core = db
    .prepare(
      `SELECT id, fact, category, bot_id, updated_at FROM memories
       WHERE user_id = ? AND deleted_at IS NULL AND bot_id IS NULL AND category IN ('profile', 'preference')
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(userId, ALWAYS_SHARED) as unknown as Memory[];
  if (botId) {
    core.push(
      ...(db
        .prepare(
          `SELECT id, fact, category, bot_id, updated_at FROM memories
           WHERE bot_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?`,
        )
        .all(botId, ALWAYS_BOT_NOTES) as unknown as Memory[]),
    );
  }
  const coreIds = new Set(core.map((m) => m.id));

  let hits: Memory[] = [];
  if (queries?.length) {
    try {
      hits = (await retrieve(db, userId, queries, { botId })).filter((m) => !coreIds.has(m.id));
    } catch (err) {
      // The embedding model is missing or busy: carry on with the facts that are always included.
      console.error('Memory search error:', (err as Error)?.message ?? err);
    }
  }

  const lines: string[] = [];
  const usedIds: number[] = [];
  let used = 0;
  // Matches first when room is short: they are what this message is about.
  for (const m of [...hits, ...core]) {
    const when = monthOf(m.updated_at);
    const line = `- ${m.fact}${when ? ` (noted ${when})` : ''}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length;
    if (!coreIds.has(m.id)) usedIds.push(m.id);
  }
  if (lines.length === 0) return '';

  if (usedIds.length) {
    db.prepare(
      `UPDATE memories SET use_count = use_count + 1, last_used_at = datetime('now')
       WHERE id IN (${usedIds.map(() => '?').join(',')})`,
    ).run(...usedIds);
  }

  const who = options.userName ?? 'the user';
  return `Things you know about ${who} (use only when relevant; don't mention that you have notes):\n${lines.join('\n')}`;
}

/** buildMemoryBlock for a piece of text (a task, a job, a request), embedding it first. */
export async function memoryFor(
  db: Db,
  userId: string,
  about: string,
  options: { botId?: string; userName?: string } = {},
): Promise<string> {
  let queries: Float32Array[] | null = null;
  if (about.trim() && hasMemories(db, userId, options.botId)) {
    try {
      queries = await embed([about.slice(0, 2000)], 'query');
    } catch (err) {
      console.error('Memory search error:', (err as Error)?.message ?? err);
    }
  }
  return buildMemoryBlock(db, userId, queries, options);
}
