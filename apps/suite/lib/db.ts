// @ts-expect-error - node:sqlite types
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'dev.db'));

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

// Prism: one row per picture. The picture itself is saved as data/prism/images/<id>.png.
// The prompt, style, seed and size are kept so a picture can be made again exactly.
db.exec(`
  CREATE TABLE IF NOT EXISTS PrismImage (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    style TEXT NOT NULL DEFAULT 'none',
    seed INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    seconds REAL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_prism_user ON PrismImage (user_id, createdAt);
`);

// Umbra: the bots each profile creates, and one ongoing chat per bot.
db.exec(`
  CREATE TABLE IF NOT EXISTS UmbraBot (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    flame TEXT NOT NULL,
    personality TEXT NOT NULL DEFAULT '',
    purpose TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_umbra_bot_user ON UmbraBot (user_id, updatedAt);

  CREATE TABLE IF NOT EXISTS UmbraMessage (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bot_id) REFERENCES UmbraBot(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_umbra_message_bot ON UmbraMessage (bot_id, createdAt);

  -- Stage 2: things a bot chose to remember with its "save note" tool.
  CREATE TABLE IF NOT EXISTS UmbraNote (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL,
    content TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bot_id) REFERENCES UmbraBot(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_umbra_note_bot ON UmbraNote (bot_id, createdAt);
`);

// Umbra stage 3: tasks a bot runs on its own, and the reports they leave in the inbox.
db.exec(`
  CREATE TABLE IF NOT EXISTS UmbraTask (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    instructions TEXT NOT NULL,
    schedule TEXT NOT NULL,          -- JSON, see config/umbra-schedule.ts
    enabled INTEGER NOT NULL DEFAULT 1,
    nextRunAt TEXT,                  -- ISO time; NULL = not scheduled
    lastRunAt TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bot_id) REFERENCES UmbraBot(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_umbra_task_due ON UmbraTask (enabled, nextRunAt);
  CREATE INDEX IF NOT EXISTS idx_umbra_task_bot ON UmbraTask (bot_id);

  CREATE TABLE IF NOT EXISTS UmbraRun (
    id TEXT PRIMARY KEY,
    task_id TEXT,
    bot_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,            -- running | done | error
    report TEXT,
    steps TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    startedAt TEXT NOT NULL,
    finishedAt TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_umbra_run_user ON UmbraRun (user_id, startedAt);
`);

// Stage 2 columns, added to databases made before tools existed:
//   UmbraBot.tools      which tools the bot may use (a JSON list of tool ids)
//   UmbraMessage.steps  the tool steps behind a reply (JSON), shown in the chat
const addColumn = (table: string, column: string, definition: string) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
};
addColumn('UmbraBot', 'tools', "TEXT NOT NULL DEFAULT '[]'");
addColumn('UmbraMessage', 'steps', 'TEXT');

// Umbra stage 4: teams. A leader bot plus teammates (each with a role), and one team chat.
db.exec(`
  CREATE TABLE IF NOT EXISTS UmbraTeam (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT '',
    leader_id TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY (leader_id) REFERENCES UmbraBot(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_umbra_team_user ON UmbraTeam (user_id, updatedAt);

  CREATE TABLE IF NOT EXISTS UmbraTeamMember (
    team_id TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (team_id, bot_id),
    FOREIGN KEY (team_id) REFERENCES UmbraTeam(id) ON DELETE CASCADE,
    FOREIGN KEY (bot_id) REFERENCES UmbraBot(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS UmbraTeamMessage (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    steps TEXT,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (team_id) REFERENCES UmbraTeam(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_umbra_team_message ON UmbraTeamMessage (team_id, createdAt);
`);
// A task or report that belongs to a team (its bot_id is the team's leader).
addColumn('UmbraTask', 'team_id', 'TEXT');
addColumn('UmbraRun', 'team_id', 'TEXT');

export default db;