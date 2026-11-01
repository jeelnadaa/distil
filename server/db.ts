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
  `
  -- Phases 3–8 shared contract (built in parallel; see progress/README.md). Phases append their own
  -- migrations after this one and never edit it.
  -- The Study Brief per folder (F-101…F-104), as validated JSON (server/learning/types.ts).
  CREATE TABLE briefs (
    folder_id  TEXT PRIMARY KEY REFERENCES folders(id) ON DELETE CASCADE,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  -- Study plan (F-501): one active plan per folder, units of ordered lessons, each teaching ordered items.
  CREATE TABLE plans (
    id         TEXT PRIMARY KEY,
    folder_id  TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    status     TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
    schedule   TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX plans_folder ON plans(folder_id, status);
  CREATE TABLE plan_units (
    id      TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    ord     INTEGER NOT NULL,
    title   TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE lessons (
    id            TEXT PRIMARY KEY,
    plan_id       TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    unit_id       TEXT NOT NULL REFERENCES plan_units(id) ON DELETE CASCADE,
    ord           INTEGER NOT NULL,
    title         TEXT NOT NULL,
    summary       TEXT NOT NULL DEFAULT '',
    minutes       INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
    scheduled_for TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );
  CREATE INDEX lessons_plan ON lessons(plan_id, ord);
  CREATE TABLE lesson_items (
    lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    item_id   TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    ord       INTEGER NOT NULL,
    PRIMARY KEY (lesson_id, item_id)
  );
  CREATE INDEX lesson_items_item ON lesson_items(item_id);
  CREATE TABLE lesson_prereqs (
    lesson_id   TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    requires_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    PRIMARY KEY (lesson_id, requires_id)
  );
  -- Where an item's content comes from: the folder's material, an extra topic added from a labelled
  -- answer (F-314, Phase 4), or a researcher's syllabus built from the model (F-205, Phase 8).
  ALTER TABLE items ADD COLUMN provenance TEXT NOT NULL DEFAULT 'material' CHECK (provenance IN ('material', 'extra', 'generated'));
  -- A Teach chat belongs to its lesson. chats.mode is one of ask, teach, practice, exam.
  ALTER TABLE chats ADD COLUMN lesson_id TEXT REFERENCES lessons(id) ON DELETE SET NULL;
  -- Learner evidence per item (F-610, F-807, F-911): every probe, check, practice or exam answer and
  -- card review. Mastery and statuses are derived from it in code (server/learning/learner.ts).
  CREATE TABLE item_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    folder_id  TEXT NOT NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('taught', 'probe', 'check', 'practice', 'exam', 'review')),
    score      REAL CHECK (score BETWEEN 0 AND 1),
    confidence TEXT CHECK (confidence IN ('guess', 'unsure', 'sure')),
    with_help  INTEGER NOT NULL DEFAULT 0,
    chat_id    TEXT,
    message_id TEXT,
    ref        TEXT,
    at         INTEGER NOT NULL
  );
  CREATE INDEX item_events_item ON item_events(item_id, at);
  CREATE INDEX item_events_folder ON item_events(folder_id, at);
  -- Flashcards (F-901…F-903); state is the scheduler's JSON (FSRS-class, Phase 7).
  CREATE TABLE cards (
    id         TEXT PRIMARY KEY,
    folder_id  TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    item_id    TEXT REFERENCES items(id) ON DELETE SET NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('basic', 'reverse', 'cloze', 'formula')),
    front      TEXT NOT NULL,
    back       TEXT NOT NULL,
    origin     TEXT NOT NULL CHECK (origin IN ('taught', 'missed', 'manual', 'import')),
    state      TEXT NOT NULL DEFAULT '{}',
    due_at     INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX cards_due ON cards(folder_id, due_at);
  `,
  `
  -- Phase 3: a plan is a course (from a ledger) or a skill plan with milestones and projects (F-510);
  -- lessons carry their kind, exam weight 1–3 (F-508), suggested aids as JSON (F-502) and when they were
  -- finished (the schedule's record of past days). The brief remembers which kind of plan it asks for.
  ALTER TABLE plans ADD COLUMN kind TEXT NOT NULL DEFAULT 'course' CHECK (kind IN ('course', 'skill'));
  ALTER TABLE lessons ADD COLUMN kind TEXT NOT NULL DEFAULT 'lesson' CHECK (kind IN ('lesson', 'project'));
  ALTER TABLE lessons ADD COLUMN weight INTEGER NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 3);
  ALTER TABLE lessons ADD COLUMN aids TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE lessons ADD COLUMN done_at INTEGER;
  ALTER TABLE briefs ADD COLUMN kind TEXT NOT NULL DEFAULT 'course' CHECK (kind IN ('course', 'skill'));
  `,
  `
  -- Each plan keeps the brief it was built from ({brief, kind} as JSON), so switching to a saved plan brings
  -- its goal, exam date and hours back, and a re-plan can reuse it.
  ALTER TABLE plans ADD COLUMN brief TEXT;
  `,
  `
  -- Embeddings for meaning-based search (F-1005): one vector per chunk and embedding model ("google:…",
  -- "local:small"), as little-endian float32. Changing the model leaves the old vectors unused until removed.
  CREATE TABLE chunk_vectors (
    chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    model    TEXT NOT NULL,
    vec      BLOB NOT NULL,
    PRIMARY KEY (chunk_id, model)
  );
  CREATE INDEX chunk_vectors_model ON chunk_vectors(model);
  `,
  `
  -- Teach (Phase 4): one session per lesson chat. steps is JSON: [{title, kind, items, status}] where kind is
  -- orientation or teach and status upcoming, current, done or shaky. repairs counts re-explanations of the
  -- current step; probe holds the probe's questions and verdicts.
  CREATE TABLE teach_sessions (
    chat_id    TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
    lesson_id  TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    phase      TEXT NOT NULL CHECK (phase IN ('probe', 'teach', 'recap', 'done')),
    steps      TEXT NOT NULL,
    step       INTEGER NOT NULL DEFAULT 0,
    repairs    INTEGER NOT NULL DEFAULT 0,
    probe      TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  -- A check question in a lesson (F-604): the spec with its answer (never sent before answering), the step
  -- it checks (-1 in the probe), its items, and the learner's result once answered.
  CREATE TABLE checks (
    id         TEXT PRIMARY KEY,
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    step       INTEGER NOT NULL,
    items      TEXT NOT NULL,
    spec       TEXT NOT NULL,
    result     TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX checks_chat ON checks(chat_id, created_at);
  `,
  `
  -- The passages a reply was grounded in, numbered as it cites them ([1], [2]).
  ALTER TABLE messages ADD COLUMN sources TEXT;
  `,
  `
  -- Interactivity dial (F-741): text, balanced or visual; NULL follows the parent folder, then Settings.
  ALTER TABLE folders ADD COLUMN dial TEXT;
  ALTER TABLE chats ADD COLUMN dial TEXT;
  -- Built visuals (F-721, F-725): the mini-app or figure for one app or figure block of a reply,
  -- by its position in the reply; rebuilding adds a version (F-723).
  CREATE TABLE visuals (
    id         TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    block      INTEGER NOT NULL,
    version    INTEGER NOT NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('app', 'figure')),
    content    TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (message_id, block, version)
  );
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
