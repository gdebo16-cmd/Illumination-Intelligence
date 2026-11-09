-- Per-user memory store for the node:sqlite database (dev.db).
-- Conversation ids are TEXT (UUIDs) to match the Conversation table.

CREATE TABLE IF NOT EXISTS memories (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                TEXT    NOT NULL,                 -- separates you and your wife
  fact                   TEXT    NOT NULL,                 -- one short, self-contained statement
  category               TEXT    NOT NULL DEFAULT 'other', -- profile | preference | project | people | other
  source_conversation_id TEXT,                             -- which chat it came from
  embedding              BLOB,                             -- Float32 bytes; NULL until embedded
  embedding_model        TEXT,                             -- re-embed everything if this changes
  use_count              INTEGER NOT NULL DEFAULT 0,
  last_used_at           TEXT,
  created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at             TEXT                              -- soft delete so "forget" is reversible
);

CREATE INDEX IF NOT EXISTS idx_memories_user
  ON memories (user_id, deleted_at);

-- How far extraction has read in each conversation (by Message rowid, since ids are UUIDs).
CREATE TABLE IF NOT EXISTS memory_extractions (
  conversation_id TEXT    PRIMARY KEY,
  last_row_id     INTEGER NOT NULL,
  processed_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);