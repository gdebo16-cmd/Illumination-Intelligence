// @ts-expect-error - node:sqlite types
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('dev.db');

// Initialize tables if they don't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS Conversation (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
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

export default db;