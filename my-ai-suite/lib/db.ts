// @ts-expect-error - node:sqlite types
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const db = new DatabaseSync('dev.db');

// Initialize tables if they don't exist (new databases get user_id from the start)
db.exec(`
  CREATE TABLE IF NOT EXISTS Conversation (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    user_id TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS Message (
    id TEXT PRIMARY KEY,
    conversationId TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversationId) REFERENCES Conversation(id) ON DELETE CASCADE
  );
`);

// Migration: databases created before multi-user support have no user_id column.
const conversationColumns = db
  .prepare('PRAGMA table_info(Conversation)')
  .all() as { name: string }[];

if (!conversationColumns.some((c) => c.name === 'user_id')) {
  db.exec('ALTER TABLE Conversation ADD COLUMN user_id TEXT');
}

// Optional: give old chats (which have no owner yet) to one user.
// Set LEGACY_CHAT_OWNER in .env.local to that user's id, restart once, then remove it.
const legacyOwner = process.env.LEGACY_CHAT_OWNER;
if (legacyOwner) {
  db.prepare('UPDATE Conversation SET user_id = ? WHERE user_id IS NULL').run(legacyOwner);
}

db.exec('CREATE INDEX IF NOT EXISTS idx_conversation_user ON Conversation (user_id, updatedAt)');

// Memory tables (safe to run every start: every statement uses IF NOT EXISTS)
db.exec(
  fs.readFileSync(path.join(process.cwd(), 'lib', 'memory-schema.sql'), 'utf8'),
);

export default db;