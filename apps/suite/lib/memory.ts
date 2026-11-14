// lib/memory.ts - extraction, storage, retrieval for per-user memory (the facts Lumen keeps).
// Written for node:sqlite (DatabaseSync). Server-side only.
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
  /** When it was saved or last changed (SQLite's "YYYY-MM-DD HH:MM:SS", UTC). */
  updated_at: string;
}
type Op =
  | { action: 'add'; fact: string; category: Category }
  | { action: 'update'; id: number; fact: string; category: Category }
  | { action: 'delete'; id: number };

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
/**
 * `model` is the one to ask (see extractModelFor). `numCtx` is the context window to ask for:
 * pass the same size the chat uses, because Ollama loads a model again when the size changes.
 */
export async function extractMemories(
  db: Db,
  userId: string,
  conversationId: string,
  model: string,
  numCtx: number,
): Promise<void> {
  const state = db
    .prepare('SELECT last_row_id FROM memory_extractions WHERE conversation_id = ?')
    .get(conversationId) as { last_row_id: number } | undefined;
  const since = state?.last_row_id ?? 0;

  // Message ids are UUIDs, so order by SQLite's built-in rowid instead.
  const msgs = db
    .prepare(
      'SELECT rowid AS rid, role, content FROM Message WHERE conversationId = ? AND rowid > ? ORDER BY rowid',
    )
    .all(conversationId, since) as { rid: number; role: string; content: string }[];
  if (msgs.length === 0) return;

  const transcript = msgs.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

  // Show the model only memories related to this chat, so it can update instead of duplicate.
  const related = hasMemories(db, userId)
    ? await retrieve(db, userId, (await embed([transcript.slice(0, 2000)], 'query'))[0], 15, 0.3)
    : [];
  const existing = related.map((m) => `[${m.id}] (${m.category}) ${m.fact}`).join('\n') || '(none)';

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
        { role: 'system', content: EXTRACTION_SYSTEM },
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

  await applyOps(db, userId, conversationId, ops, new Set(related.map((m) => m.id)));

  db.prepare(
    `INSERT INTO memory_extractions (conversation_id, last_row_id) VALUES (?, ?)
     ON CONFLICT(conversation_id) DO UPDATE SET last_row_id = excluded.last_row_id, processed_at = datetime('now')`,
  ).run(conversationId, msgs[msgs.length - 1].rid);
}

async function applyOps(
  db: Db,
  userId: string,
  conversationId: string,
  ops: Op[],
  allowedIds: Set<number>,
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
    `INSERT INTO memories (user_id, fact, category, source_conversation_id, embedding, embedding_model)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
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
        add.run(userId, o.fact, o.category ?? 'other', conversationId, toBlob(vectors[vi++]), EMBED_TAG);
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

// ---------------------------------------------------------------- retrieval
/** Does this profile have anything saved? (Saves embedding a question when there's nothing to find.) */
export function hasMemories(db: Db, userId: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM memories WHERE user_id = ? AND deleted_at IS NULL LIMIT 1').get(userId));
}

/** Embed again any memory whose embedding was made another way (see EMBED_TAG). A one-time catch-up. */
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

/** The saved facts closest in meaning to `query` (an embedding made with embed(…, 'query')). */
async function retrieve(
  db: Db,
  userId: string,
  query: Float32Array,
  k = 8,
  minScore = 0.35,
): Promise<Memory[]> {
  await refreshEmbeddings(db, userId);
  const rows = db
    .prepare(
      `SELECT id, fact, category, updated_at, embedding FROM memories
       WHERE user_id = ? AND deleted_at IS NULL AND embedding_model = ?`,
    )
    .all(userId, EMBED_TAG) as (Memory & { embedding: Uint8Array })[];

  return rows
    .map((r) => ({ r, score: cosine(query, fromBlob(r.embedding)) }))
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ r }) => ({ id: r.id, fact: r.fact, category: r.category, updated_at: r.updated_at }));
}

// ---------------------------------------------------------------- injection
// How many "who they are / how they like answers" facts are always included, whatever was asked.
const ALWAYS_INCLUDED = 6;

/** "2026-03-14 09:12:00" -> "Mar 2026", so the model can tell an old fact from a fresh one. */
function monthOf(sqliteTime: string): string {
  const date = new Date(`${sqliteTime.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The facts to show the model this turn, as text for the system prompt ('' when there are none).
 * `query` is the embedding of what's being talked about (lib/chat-memory.ts builds it from the
 * last few messages, so "what about the other one?" still finds the right facts).
 *
 * Two kinds go in: the profile's core facts and answer preferences (always, so the assistant never
 * forgets who it is talking to), then whatever matches this turn.
 */
export async function buildMemoryBlock(
  db: Db,
  userId: string,
  query: Float32Array,
  maxChars = 2000, // roughly 500 tokens
): Promise<string> {
  const core = db
    .prepare(
      `SELECT id, fact, category, updated_at FROM memories
       WHERE user_id = ? AND deleted_at IS NULL AND category IN ('profile', 'preference')
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(userId, ALWAYS_INCLUDED) as unknown as Memory[];
  const coreIds = new Set(core.map((m) => m.id));
  const hits = (await retrieve(db, userId, query)).filter((m) => !coreIds.has(m.id));

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

  return `Things you know about the user (use only when relevant; don't mention that you have notes):\n${lines.join('\n')}`;
}
