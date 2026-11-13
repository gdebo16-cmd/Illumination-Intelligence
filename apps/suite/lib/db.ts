// @ts-expect-error - node:sqlite types
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { RETIRED_BOT_MODELS } from '@/config/umbra';

const DATA_DIR = path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'dev.db'));
// `next build` loads this file in several worker processes at once, and each one sets up the tables
// below. Wait for another process to finish its change instead of failing with "database is locked".
db.exec('PRAGMA busy_timeout = 10000');

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
  if (columns.some((c) => c.name === column)) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (err) {
    // Another process (see busy_timeout above) added it between our check and our change: fine.
    if (!/duplicate column name/i.test((err as Error).message)) throw err;
  }
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

// Prism image editing: was the picture made from words ('create') or by editing one ('edit'),
// and which Prism picture it was edited from (empty for an uploaded picture).
addColumn('PrismImage', 'mode', "TEXT NOT NULL DEFAULT 'create'");
addColumn('PrismImage', 'source_id', 'TEXT');
// Prism model switcher: which model painted the picture (an id from config/prism-models.ts).
// Every picture from before the switcher was made with FLUX.2 Klein.
addColumn('PrismImage', 'model', "TEXT NOT NULL DEFAULT 'flux2-klein'");
// What the model's prompt expander turned the prompt into (empty when it wasn't used).
addColumn('PrismImage', 'expanded_prompt', 'TEXT');
addColumn('UmbraRun', 'team_id', 'TEXT');

// Flickers set to a model that has left the list move to the one that replaced it.
for (const [retired, replacement] of Object.entries(RETIRED_BOT_MODELS)) {
  db.prepare('UPDATE UmbraBot SET model = ? WHERE model = ?').run(replacement, retired);
}

// Code helper: the one project folder a bot may look at, and whether it may change files without asking.
addColumn('UmbraBot', 'code_folder', "TEXT NOT NULL DEFAULT ''");
addColumn('UmbraBot', 'code_auto', 'INTEGER NOT NULL DEFAULT 0');
// "Think before answering": the bot reasons step by step first, and the chat shows its thinking.
addColumn('UmbraBot', 'think', 'INTEGER NOT NULL DEFAULT 0');
// Changes the Code helper suggested, waiting for (or after) your OK. lib/umbra/code.ts
db.exec(`
  CREATE TABLE IF NOT EXISTS UmbraCodeEdit (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    root TEXT NOT NULL,
    path TEXT NOT NULL,
    find_text TEXT NOT NULL,
    replace_text TEXT NOT NULL,
    diff TEXT NOT NULL,
    status TEXT NOT NULL,
    note TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Prism videos: one row per video made from a picture. The files are data/prism/videos/<id>.mp4
// and <id>.png (the starting picture, shown before the video plays).
// status: 'working' while it's being made, then 'done' or 'failed' (with the reason in error).
// seconds is how long the GPU took, which is what the length picker's time estimates average.
db.exec(`
  CREATE TABLE IF NOT EXISTS PrismVideo (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    image_id TEXT,
    prompt TEXT NOT NULL,
    length TEXT NOT NULL,
    frames INTEGER NOT NULL,
    seed INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'working',
    error TEXT,
    seconds REAL,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_prism_video_user ON PrismVideo (user_id, createdAt);
`);

// Photos attached to chat messages (Lumen and Umbra). The files are data/chat-images/<id>.jpg.
// `chat` says which chat a photo belongs to ("lumen:<conversation id>" or "umbra:<bot id>"), so
// its files can be removed when that chat is deleted. lib/chat-images.ts
db.exec(`
  CREATE TABLE IF NOT EXISTS ChatImage (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    chat TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_image_chat ON ChatImage (chat);
`);
// The photos sent with a message: a JSON list of ChatImage ids (empty for most messages).
addColumn('Message', 'images', 'TEXT');
addColumn('UmbraMessage', 'images', 'TEXT');

// Astra: the fonts each profile makes. `glyphs` will hold the drawn letters as JSON
// (empty for now; the drawing pad fills it in later).
db.exec(`
  CREATE TABLE IF NOT EXISTS AstraFont (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    glyphs TEXT NOT NULL DEFAULT '{}',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_astra_font_user ON AstraFont (user_id, updatedAt);
`);
// How thick a font's pen strokes are (config/astra.ts DEFAULT_PEN_WIDTH for fonts made before this).
addColumn('AstraFont', 'pen_width', 'INTEGER NOT NULL DEFAULT 60');

// Artifacts: the Markdown documents Lumen and Umbra write (a <document> block in a reply, or a
// .md file a Flicker writes in Refract). One row per document; writing it again with the same
// title, in the same chat, updates it. See lib/artifacts.ts.
db.exec(`
  CREATE TABLE IF NOT EXISTS Artifact (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    app TEXT NOT NULL,               -- lumen | umbra
    kind TEXT NOT NULL,              -- document (a <document> block) | file (a .md file in Refract)
    source_kind TEXT NOT NULL,       -- chat (Lumen) | bot | team (Umbra)
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_artifact_key ON Artifact (user_id, app, source_kind, source_id, kind, title);
  CREATE INDEX IF NOT EXISTS idx_artifact_user ON Artifact (user_id, app, updatedAt);
`);

export default db;