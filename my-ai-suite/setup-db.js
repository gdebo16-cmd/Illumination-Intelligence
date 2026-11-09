// setup-db.js
const Database = require('better-sqlite3');
const db = new Database('sqlite.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS Conversation (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS Message (
    id TEXT PRIMARY KEY,
    conversationId TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversationId) REFERENCES Conversation(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS Generation (
    id TEXT PRIMARY KEY,
    toolType TEXT NOT NULL,
    prompt TEXT NOT NULL,
    outputUrl TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

console.log("SQLite database initialized successfully with all tables!");