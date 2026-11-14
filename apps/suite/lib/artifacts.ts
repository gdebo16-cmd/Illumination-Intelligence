// lib/artifacts.ts — the Markdown documents Lumen and Umbra write, kept in one place.
//
// An artifact is saved whenever:
//   - a reply holds a <document title="…"> block (Lumen chats, Flicker chats, team chats, task reports), or
//   - a Flicker writes a .md file in a Refract workspace.
// Writing a document again with the same title, in the same chat, updates it instead of adding a copy.
// Artifacts belong to the profile: clearing or deleting a chat keeps them. Delete one from its list.

import 'server-only';
import crypto from 'node:crypto';
import db from '@/lib/db';
import { findDocuments, type ArtifactFormat } from '@/lib/document-blocks';

export type { ArtifactFormat };

export type ArtifactApp = 'lumen' | 'umbra';
export type ArtifactKind = 'document' | 'file';
type ArtifactSourceKind = 'chat' | 'bot' | 'team';

export interface ArtifactSource {
  userId: string;
  app: ArtifactApp;
  sourceKind: ArtifactSourceKind;
  sourceId: string;
  /** Shown in the list: the chat's title, or the Flicker's or team's name. */
  sourceName: string;
}

/** One artifact in a list (no content, to keep the list small). */
export interface ArtifactSummary {
  id: string;
  app: ArtifactApp;
  kind: ArtifactKind;
  /** markdown (a document), html (a web page), svg (an image) or code. */
  format: ArtifactFormat;
  /** For code: its language, e.g. "python". Empty otherwise. */
  language: string;
  sourceKind: ArtifactSourceKind;
  sourceId: string;
  sourceName: string;
  title: string;
  size: number;
  createdAt: string;
  updatedAt: string;
}

export interface Artifact extends ArtifactSummary {
  content: string;
}

interface Row {
  id: string;
  app: ArtifactApp;
  kind: ArtifactKind;
  format: ArtifactFormat;
  language: string;
  source_kind: ArtifactSourceKind;
  source_id: string;
  source_name: string;
  title: string;
  size: number;
  content?: string;
  createdAt: string;
  updatedAt: string;
}

const MAX_TITLE = 200;
// About 500 KB of text: far more than any reply, but stops a runaway file filling the database.
const MAX_CONTENT = 500_000;

const toSummary = (r: Row): ArtifactSummary => ({
  id: r.id,
  app: r.app,
  kind: r.kind,
  format: r.format,
  language: r.language,
  sourceKind: r.source_kind,
  sourceId: r.source_id,
  sourceName: r.source_name,
  title: r.title,
  size: r.size,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** Save (or update) one artifact. Returns its id. */
export interface ArtifactType {
  format: ArtifactFormat;
  language?: string;
}

export function saveArtifact(
  source: ArtifactSource,
  kind: ArtifactKind,
  title: string,
  content: string,
  type: ArtifactType = { format: 'markdown' },
  at = new Date().toISOString(),
): string {
  const name = title.trim().slice(0, MAX_TITLE) || 'Untitled';
  const text = content.slice(0, MAX_CONTENT);
  const existing = db
    .prepare('SELECT id FROM Artifact WHERE user_id = ? AND app = ? AND source_kind = ? AND source_id = ? AND kind = ? AND title = ?')
    .get(source.userId, source.app, source.sourceKind, source.sourceId, kind, name) as { id: string } | undefined;
  if (existing) {
    db.prepare('UPDATE Artifact SET content = ?, source_name = ?, format = ?, language = ?, updatedAt = ? WHERE id = ?').run(
      text, source.sourceName, type.format, type.language ?? '', at, existing.id,
    );
    return existing.id;
  }
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO Artifact (id, user_id, app, kind, format, language, source_kind, source_id, source_name, title, content, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, source.userId, source.app, kind, type.format, type.language ?? '', source.sourceKind, source.sourceId, source.sourceName,
    name, text, at, at,
  );
  return id;
}

/**
 * Save every <document> block in a reply. Never throws: a reply must still be saved and shown
 * even if keeping its documents fails.
 */
export function saveDocumentArtifacts(source: ArtifactSource, reply: string, at?: string): number {
  try {
    const docs = findDocuments(reply);
    for (const doc of docs) saveArtifact(source, 'document', doc.title, doc.content, { format: doc.format, language: doc.language }, at);
    return docs.length;
  } catch (err) {
    console.error('Saving artifacts failed:', err);
    return 0;
  }
}

/** The profile's artifacts in one app, newest first. Optionally only one chat's, Flicker's or team's. */
export function listArtifacts(userId: string, app: ArtifactApp, sourceId?: string): ArtifactSummary[] {
  backfillOnce();
  const rows = (
    sourceId
      ? db
          .prepare(
            `SELECT id, app, kind, format, language, source_kind, source_id, source_name, title, length(content) AS size, createdAt, updatedAt
             FROM Artifact WHERE user_id = ? AND app = ? AND source_id = ? ORDER BY updatedAt DESC`,
          )
          .all(userId, app, sourceId)
      : db
          .prepare(
            `SELECT id, app, kind, format, language, source_kind, source_id, source_name, title, length(content) AS size, createdAt, updatedAt
             FROM Artifact WHERE user_id = ? AND app = ? ORDER BY updatedAt DESC`,
          )
          .all(userId, app)
  ) as Row[];
  return rows.map(toSummary);
}

export function getArtifact(userId: string, id: string): Artifact | null {
  const row = db
    .prepare(
      `SELECT id, app, kind, format, language, source_kind, source_id, source_name, title, length(content) AS size, content, createdAt, updatedAt
       FROM Artifact WHERE id = ? AND user_id = ?`,
    )
    .get(id, userId) as Row | undefined;
  return row ? { ...toSummary(row), content: row.content ?? '' } : null;
}

export function deleteArtifact(userId: string, id: string): boolean {
  return db.prepare('DELETE FROM Artifact WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

/** A chat, Flicker or team was renamed: keep the name shown next to its artifacts current. */
export function renameArtifactSource(userId: string, sourceId: string, sourceName: string): void {
  db.prepare('UPDATE Artifact SET source_name = ? WHERE user_id = ? AND source_id = ?').run(sourceName, userId, sourceId);
}

// ------------------------------------------------------------------ backfill
// Replies written before artifacts existed (or before ```markdown documents counted) are collected
// the first time artifacts are listed: Lumen chats, Flicker chats and team chats. Oldest first, so
// a revised document ends up with its last version. Saving is an upsert, so running it again is safe.
const BACKFILL_KEY = 'backfill-v2';
let backfilled = false;
function backfillOnce(): void {
  if (backfilled) return;
  backfilled = true;
  try {
    const done = db.prepare('INSERT OR IGNORE INTO ArtifactMeta (key) VALUES (?)').run(BACKFILL_KEY);
    // Another copy of the app (production and dev may both run) already did it.
    if (done.changes === 0) return;
    const like = "(m.content LIKE '%<document%' OR m.content LIKE '%<artifact%' OR m.content LIKE '%```%' OR m.content LIKE '%~~~%')";
    const lumen = db
      .prepare(
        `SELECT m.content, m.createdAt, c.id AS sourceId, c.title AS name, c.user_id AS userId
         FROM Message m JOIN Conversation c ON c.id = m.conversationId
         WHERE m.role = 'assistant' AND c.user_id IS NOT NULL AND ${like}
         ORDER BY m.createdAt ASC, m.rowid ASC`,
      )
      .all() as BackfillRow[];
    const bots = db
      .prepare(
        `SELECT m.content, m.createdAt, b.id AS sourceId, b.name, b.user_id AS userId
         FROM UmbraMessage m JOIN UmbraBot b ON b.id = m.bot_id
         WHERE m.role = 'assistant' AND ${like}
         ORDER BY m.createdAt ASC, m.rowid ASC`,
      )
      .all() as BackfillRow[];
    const teams = db
      .prepare(
        `SELECT m.content, m.createdAt, t.id AS sourceId, t.name, t.user_id AS userId
         FROM UmbraTeamMessage m JOIN UmbraTeam t ON t.id = m.team_id
         WHERE m.role = 'assistant' AND ${like}
         ORDER BY m.createdAt ASC, m.rowid ASC`,
      )
      .all() as BackfillRow[];
    const collect = (rows: BackfillRow[], app: ArtifactApp, sourceKind: ArtifactSourceKind) => {
      for (const r of rows) {
        saveDocumentArtifacts({ userId: r.userId, app, sourceKind, sourceId: r.sourceId, sourceName: r.name }, r.content, r.createdAt);
      }
    };
    collect(lumen, 'lumen', 'chat');
    collect(bots, 'umbra', 'bot');
    collect(teams, 'umbra', 'team');
  } catch (err) {
    console.error('Collecting older documents failed:', err);
  }
}

interface BackfillRow {
  content: string;
  createdAt: string;
  sourceId: string;
  name: string;
  userId: string;
}
