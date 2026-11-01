import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DatabaseSync } from "node:sqlite";
import { Zip, ZipDeflate } from "fflate";
import { type Db, SCHEMA_VERSION } from "./db.ts";
import { AppError } from "./errors.ts";
import { APP_VERSION } from "./version.ts";
import { safePath, unzipTo } from "./zip.ts";

// Backup and restore (F-1304). A backup is a zip of a consistent copy of the database, the materials
// and the added fonts. Keys (secrets.json) and downloaded models stay out: keys don't belong in a file
// that gets copied around, and models download again. A restore is unpacked and checked into
// restore/, then swapped in at the next start, before the database opens; the data it replaces is
// kept in before-restore/ until the next restore.

const FOLDERS = ["materials", "fonts"] as const;
const ZIP_LIMIT = 4 * 1024 ** 3 - 64 * 1024 ** 2; // plain zip (no ZIP64), with room for the database
export type BackupManifest = { app: "distil"; version: string; schema: number; createdAt: number; folders: number; materials: number };

const filesIn = (root: string, prefix: string): { path: string; name: string; size: number }[] => {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((e) => {
    const path = join(root, e.name);
    if (e.isDirectory()) return filesIn(path, `${prefix}${e.name}/`);
    return e.isFile() ? [{ path, name: `${prefix}${e.name}`, size: statSync(path).size }] : [];
  });
};

// Only names a backup can hold: the database, the manifest and files under the two folders.
const allowed = (name: string) => {
  if (name === "distil.db" || name === "manifest.json") return true;
  const parts = name.split("/");
  return (FOLDERS as readonly string[]).includes(parts[0]!) && parts.length >= 2 && safePath(name);
};

const counts = (db: DatabaseSync | Db) => ({
  folders: (db.prepare("SELECT count(*) AS n FROM folders").get() as { n: number }).n,
  materials: (db.prepare("SELECT count(*) AS n FROM materials").get() as { n: number }).n,
});

export function createBackup({ db, dataDir, now = () => Date.now() }: { db: Db; dataDir: string; now?: () => number }) {
  const staging = join(dataDir, "restore-staging");
  const pendingDir = join(dataDir, "restore");

  // The zip, produced as it's read: each file is added only when the previous one has been sent.
  async function* exportZip(): AsyncGenerator<Uint8Array> {
    const files = FOLDERS.flatMap((f) => filesIn(join(dataDir, f), `${f}/`));
    if (files.reduce((s, f) => s + f.size, 0) > ZIP_LIMIT) throw new AppError(413, "backup_too_large", "The materials are over 4 GB, more than a backup can hold. Copy the data folder while Distil is closed instead.");
    const snapshot = join(dataDir, `backup-${now()}.db`);
    db.prepare("VACUUM INTO ?").run(snapshot);
    try {
      const out: Uint8Array[] = [];
      const zip = new Zip((err, chunk) => { if (err) throw err; out.push(chunk); });
      const drain = function* () { yield* out.splice(0); };
      const manifest: BackupManifest = { app: "distil", version: APP_VERSION, schema: SCHEMA_VERSION, createdAt: now(), ...counts(db) };
      const head = new ZipDeflate("manifest.json", { level: 6 });
      zip.add(head);
      head.push(new TextEncoder().encode(JSON.stringify(manifest, null, 2)), true);
      for (const f of [{ path: snapshot, name: "distil.db" }, ...files]) {
        // The database compresses well; materials are mostly compressed already, so they're stored in
        // level-0 deflate blocks, which (unlike plain stored entries) a streaming unzip can find the end of.
        const entry = new ZipDeflate(f.name, { level: f.name === "distil.db" ? 6 : 0 });
        zip.add(entry);
        for await (const chunk of createReadStream(f.path)) {
          entry.push(chunk as Uint8Array);
          yield* drain();
        }
        entry.push(new Uint8Array(0), true);
        yield* drain();
      }
      zip.end();
      yield* drain();
    } finally {
      rmSync(snapshot, { force: true });
    }
  }

  // Unpacks an uploaded backup into restore/ after checking it. Nothing in use is touched here.
  async function stage(body: ReadableStream<Uint8Array>): Promise<BackupManifest> {
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    const upload = join(staging, "upload.zip");
    try {
      await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream), createWriteStream(upload));
      const files = join(staging, "files");
      await unzipTo(upload, files, allowed, "a Distil backup");
      rmSync(upload);
      const manifest = check(files);
      rmSync(pendingDir, { recursive: true, force: true });
      renameSync(files, pendingDir);
      return manifest;
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  const pending = (): BackupManifest | null => {
    try {
      return JSON.parse(readFileSync(join(pendingDir, "manifest.json"), "utf8")) as BackupManifest;
    } catch {
      return null;
    }
  };

  return { exportZip, stage, pending, cancel: () => rmSync(pendingDir, { recursive: true, force: true }) };
}

export type Backup = ReturnType<typeof createBackup>;

function check(dir: string): BackupManifest {
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as BackupManifest;
  } catch {
    throw new AppError(400, "not_a_backup", "This isn't a Distil backup: it has no manifest.");
  }
  if (manifest.app !== "distil" || !existsSync(join(dir, "distil.db"))) throw new AppError(400, "not_a_backup", "This isn't a Distil backup.");
  if (manifest.schema > SCHEMA_VERSION) throw new AppError(400, "backup_too_new", `This backup is from a newer Distil (${manifest.version}). Update Distil, then restore it.`);
  const db = new DatabaseSync(join(dir, "distil.db"), { readOnly: true });
  try {
    const ok = (db.prepare("PRAGMA quick_check").get() as { quick_check: string }).quick_check;
    if (ok !== "ok") throw new AppError(400, "backup_damaged", "The database in this backup is damaged.");
    return { ...manifest, ...counts(db) };
  } finally {
    db.close();
  }
}

// Called at start-up, before the database opens: swaps a checked restore into place. The data it
// replaces moves to before-restore/, replacing the copy an earlier restore left there.
export function applyPendingRestore(dataDir: string, log: (msg: string) => void): boolean {
  const pendingDir = join(dataDir, "restore");
  if (!existsSync(join(pendingDir, "manifest.json")) || !existsSync(join(pendingDir, "distil.db"))) return false;
  const before = join(dataDir, "before-restore");
  rmSync(before, { recursive: true, force: true });
  mkdirSync(before);
  for (const name of ["distil.db", "distil.db-wal", "distil.db-shm", ...FOLDERS]) {
    if (existsSync(join(dataDir, name))) renameSync(join(dataDir, name), join(before, name));
  }
  for (const name of ["distil.db", ...FOLDERS]) {
    if (existsSync(join(pendingDir, name))) renameSync(join(pendingDir, name), join(dataDir, name));
  }
  writeFileSync(join(before, "restored-at.txt"), new Date().toISOString());
  rmSync(pendingDir, { recursive: true, force: true });
  log("restored a backup; the previous data is in before-restore/");
  return true;
}
