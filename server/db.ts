import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

// Append-only: each entry upgrades the schema by one version (tracked in PRAGMA user_version).
const MIGRATIONS = [
  `
  CREATE TABLE folders (
    id         TEXT PRIMARY KEY,
    parent_id  TEXT REFERENCES folders(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE chats (
    id             TEXT PRIMARY KEY,
    folder_id      TEXT REFERENCES folders(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    title_source   TEXT NOT NULL CHECK (title_source IN ('default', 'auto', 'manual')),
    mode           TEXT NOT NULL DEFAULT 'ask',
    model_provider TEXT,
    model_id       TEXT,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );
  CREATE TABLE messages (
    id         TEXT PRIMARY KEY,
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content    TEXT NOT NULL,
    status     TEXT NOT NULL CHECK (status IN ('streaming', 'done', 'aborted', 'error')),
    error      TEXT,
    provider   TEXT,
    model      TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX messages_chat ON messages(chat_id, created_at);
  -- No foreign keys: usage history outlives deleted chats and folders.
  CREATE TABLE usage (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    at               INTEGER NOT NULL,
    provider         TEXT NOT NULL,
    model            TEXT NOT NULL,
    role             TEXT NOT NULL,
    chat_id          TEXT,
    folder_id        TEXT,
    input_tokens     INTEGER NOT NULL,
    output_tokens    INTEGER NOT NULL,
    cached_tokens    INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens INTEGER NOT NULL DEFAULT 0,
    estimated        INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX usage_at ON usage(at);
  CREATE INDEX usage_chat ON usage(chat_id);
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  -- Phase 2: materials (a copy of each file lives in <data>/materials/<id>/), their chunks, and background jobs.
  CREATE TABLE materials (
    id         TEXT PRIMARY KEY,
    folder_id  TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    name       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    sha256     TEXT NOT NULL,
    status     TEXT NOT NULL CHECK (status IN ('queued', 'parsing', 'ready', 'error')),
    error      TEXT,
    unit       TEXT,
    length     INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX materials_folder ON materials(folder_id, created_at);
  CREATE TABLE chunks (
    id          TEXT PRIMARY KEY,
    material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    ord         INTEGER NOT NULL,
    loc_from    INTEGER NOT NULL,
    loc_to      INTEGER NOT NULL,
    headings    TEXT NOT NULL,
    text        TEXT NOT NULL,
    tokens      INTEGER NOT NULL
  );
  CREATE INDEX chunks_material ON chunks(material_id, ord);
  -- No foreign keys: a job's record outlives what it worked on.
  CREATE TABLE jobs (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    folder_id   TEXT,
    material_id TEXT,
    label       TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'error', 'aborted')),
    done        INTEGER NOT NULL DEFAULT 0,
    total       INTEGER NOT NULL DEFAULT 0,
    error       TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX jobs_status ON jobs(status, created_at);
  `,
];

export function openDb(file: string): Db {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

function migrate(db: Db) {
  const { user_version: current } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = current; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
