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
  `
  -- Phase 2: the Coverage Ledger. Items belong to the folder of the material they came from.
  ALTER TABLE chunks ADD COLUMN marks TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE chunks ADD COLUMN extracted_at INTEGER;
  ALTER TABLE chunks ADD COLUMN audit_rounds INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE chunks ADD COLUMN audit_done INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE jobs ADD COLUMN params TEXT NOT NULL DEFAULT '{}';
  CREATE TABLE items (
    id            TEXT PRIMARY KEY,
    folder_id     TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    type          TEXT NOT NULL,
    title         TEXT NOT NULL,
    statement     TEXT NOT NULL,
    origin        TEXT NOT NULL CHECK (origin IN ('extracted', 'audit', 'manual')),
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'planned', 'taught', 'checked', 'mastered')),
    mark          TEXT CHECK (mark IN ('skip', 'known', 'out_of_scope')),
    merge_checked INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );
  CREATE INDEX items_folder ON items(folder_id, created_at);
  -- Where an item appears. Deleting a material removes its anchors; items left with none are removed in code.
  CREATE TABLE item_sources (
    item_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    chunk_id    TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    material_id TEXT NOT NULL,
    loc         INTEGER NOT NULL,
    quote       TEXT NOT NULL,
    PRIMARY KEY (item_id, chunk_id)
  );
  CREATE INDEX item_sources_material ON item_sources(material_id);
  `,
  `
  -- Phase 2: pages whose content is partly drawn (formulas, figures, scans), sent to the model as images.
  ALTER TABLE materials ADD COLUMN visual TEXT NOT NULL DEFAULT '[]';
  `,
  `
  -- Phase 2: where a material was fetched from (a web page or video), so it can be fetched again.
  ALTER TABLE materials ADD COLUMN source TEXT;
  `,
  `
  -- Phase 2: what the last re-import of a material changed (F-212), as JSON.
  ALTER TABLE materials ADD COLUMN reimport TEXT;
  `,
  `
  -- A line about how a running job is going, such as which fallback model is answering.
  ALTER TABLE jobs ADD COLUMN note TEXT;
  `,
  `
  -- Local keyword index over every chunk (BM25, stemmed), kept in step with chunks by triggers, so
  -- importing, re-importing and deleting a material update it with no model involved.
  CREATE VIRTUAL TABLE chunks_fts USING fts5(headings, text, content='chunks', content_rowid='rowid', tokenize='porter unicode61 remove_diacritics 2');
  CREATE TRIGGER chunks_fts_insert AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts(rowid, headings, text) VALUES (new.rowid, new.headings, new.text);
  END;
  CREATE TRIGGER chunks_fts_delete AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, headings, text) VALUES ('delete', old.rowid, old.headings, old.text);
  END;
  CREATE TRIGGER chunks_fts_update AFTER UPDATE OF headings, text ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, headings, text) VALUES ('delete', old.rowid, old.headings, old.text);
    INSERT INTO chunks_fts(rowid, headings, text) VALUES (new.rowid, new.headings, new.text);
  END;
  INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild');
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
