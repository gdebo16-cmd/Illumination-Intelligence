// lib/memory.ts - extraction, storage, retrieval for per-user memory.
// Written for node:sqlite (DatabaseSync). Server-side only. Untested: adjust names to your project.
import 'server-only';

const OLLAMA = process.env.OLLAMA_URL ?? 'http://localhost:11434';
export const EXTRACT_MODEL = process.env.MEMORY_EXTRACT_MODEL ?? 'qwen3:8b'; // ideally the model already loaded
const EMBED_MODEL = process.env.MEMORY_EMBED_MODEL ?? 'nomic-embed-text';

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

export type Category = 'profile' | 'preference' | 'project' | 'people' | 'other';
export interface Memory {
  id: number;
  fact: string;
  category: Category;
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
async function embed(texts: string[]): Promise<Float32Array[]> {
  const res = await fetch(`${OLLAMA}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`embed failed: ${res.status}`);
  const data = (await res.json()) as { embeddings: number[][] };
  return data.embeddings.map((e) => Float32Array.from(e));
}

// node:sqlite takes Uint8Array for BLOBs and returns Uint8Array.
const toBlob = (v: Float32Array) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
// slice() copies into a fresh buffer, which avoids Float32Array alignment errors.
const fromBlob = (b: Uint8Array) => new Float32Array(b.slice().buffer);

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ---------------------------------------------------------------- extraction
export async function extractMemories(db: Db, userId: string, conversationId: string): Promise<void> {
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
  const related = await retrieve(db, userId, transcript.slice(0, 2000), 15, 0.3);
  const existing = related.map((m) => `[${m.id}] (${m.category}) ${m.fact}`).join('\n') || '(none)';

  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: EXTRACT_MODEL,
      stream: false,
      format: OPS_SCHEMA, // structured output keeps the JSON valid
      options: { temperature: 0, num_ctx: 8192 },
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
  const vectors = texts.length ? await embed(texts) : [];
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
        add.run(userId, o.fact, o.category ?? 'other', conversationId, toBlob(vectors[vi++]), EMBED_MODEL);
      } else if (o.action === 'update') {
        update.run(o.fact, o.category ?? 'other', toBlob(vectors[vi++]), EMBED_MODEL, o.id, userId);
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
export async function retrieve(
  db: Db,
  userId: string,
  query: string,
  k = 8,
  minScore = 0.35,
): Promise<Memory[]> {
  const rows = db
    .prepare(
      'SELECT id, fact, category, embedding FROM memories WHERE user_id = ? AND deleted_at IS NULL AND embedding IS NOT NULL',
    )
    .all(userId) as (Memory & { embedding: Uint8Array })[];
  if (rows.length === 0) return [];

  const [q] = await embed([query]);
  return rows
    .map((r) => ({ r, score: cosine(q, fromBlob(r.embedding)) }))
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ r }) => ({ id: r.id, fact: r.fact, category: r.category }));
}

// ---------------------------------------------------------------- injection
// Call before each chat turn, then add the result to your system prompt.
export async function buildMemoryBlock(
  db: Db,
  userId: string,
  userMessage: string,
  maxChars = 2500, // roughly 600 tokens
): Promise<string> {
  const hits = await retrieve(db, userId, userMessage);
  const lines: string[] = [];
  let used = 0;
  for (const m of hits) {
    const line = `- ${m.fact}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length;
  }
  if (lines.length === 0) return '';

  const usedIds = hits.slice(0, lines.length).map((m) => m.id);
  db.prepare(
    `UPDATE memories SET use_count = use_count + 1, last_used_at = datetime('now')
     WHERE id IN (${usedIds.map(() => '?').join(',')})`,
  ).run(...usedIds);

  return `Things you know about the user (use only when relevant; don't mention that you have notes):\n${lines.join('\n')}`;
}