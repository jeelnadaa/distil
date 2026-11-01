import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { applyPendingRestore, createBackup } from "../server/backup.ts";
import { openDb } from "../server/db.ts";
import { createLibrary } from "../server/library.ts";
import { createMaterials } from "../server/materials/store.ts";
import { createUpdates, newer } from "../server/updates.ts";
import { APP_VERSION } from "../server/version.ts";

const temp = (name: string) => mkdtempSync(join(tmpdir(), `distil-${name}-`));
const streamOf = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>]).stream();
const collect = async (it: AsyncIterable<Uint8Array>) => {
  const parts: Uint8Array[] = [];
  for await (const p of it) parts.push(p);
  return new Uint8Array(Buffer.concat(parts));
};
const log = () => {};

function dataDir(folderName: string) {
  const dir = temp("data");
  const db = openDb(join(dir, "distil.db"));
  const folder = createLibrary(db).createFolder(folderName, null);
  const material = createMaterials(db, join(dir, "materials")).add(folder.id, "notes.md", new TextEncoder().encode("# Bayes\n".repeat(5000)));
  writeFileSync(join(dir, "secrets.json"), "{}");
  return { dir, db, folder, material };
}

describe("backup and restore", () => {
  it("round-trips the database and materials, leaves keys out, and keeps the replaced data", async () => {
    const a = dataDir("Statistics");
    const zip = await collect(createBackup({ db: a.db, dataDir: a.dir }).exportZip());
    expect(existsSync(join(a.dir, "materials"))).toBe(true);

    const b = dataDir("Something else");
    const backup = createBackup({ db: b.db, dataDir: b.dir });
    const manifest = await backup.stage(streamOf(zip));
    expect(manifest).toMatchObject({ app: "distil", version: APP_VERSION, folders: 1, materials: 1 });
    expect(backup.pending()?.folders).toBe(1);
    expect(existsSync(join(b.dir, "restore", "secrets.json"))).toBe(false);
    b.db.close();

    expect(applyPendingRestore(b.dir, log)).toBe(true);
    const db = openDb(join(b.dir, "distil.db"));
    expect(db.prepare("SELECT name FROM folders").all()).toEqual([{ name: "Statistics" }]);
    expect(readFileSync(join(b.dir, "materials", a.material.id, "original"), "utf8")).toContain("# Bayes");
    expect(existsSync(join(b.dir, "before-restore", "distil.db"))).toBe(true);
    expect(existsSync(join(b.dir, "secrets.json"))).toBe(true);
    expect(existsSync(join(b.dir, "restore"))).toBe(false);
    expect(applyPendingRestore(b.dir, log)).toBe(false);
  });

  it("refuses zips that aren't backups, without touching the data", async () => {
    const a = dataDir("Statistics");
    const backup = createBackup({ db: a.db, dataDir: a.dir });
    const evil = zipSync({ "manifest.json": new TextEncoder().encode('{"app":"distil"}'), "../escape.txt": new Uint8Array(1) });
    await expect(backup.stage(streamOf(evil))).rejects.toThrow(/isn't a Distil backup/);
    await expect(backup.stage(streamOf(zipSync({ "notes.txt": new Uint8Array(1) })))).rejects.toThrow(/isn't a Distil backup/);
    const future = zipSync({ "manifest.json": new TextEncoder().encode(JSON.stringify({ app: "distil", version: "9.0.0", schema: 999 })), "distil.db": new Uint8Array(0) });
    await expect(backup.stage(streamOf(future))).rejects.toThrow(/newer Distil/);
    expect(backup.pending()).toBeNull();
    expect(existsSync(join(a.dir, "escape.txt"))).toBe(false);
  });
});

describe("updates", () => {
  const next = "99.0.0";
  const appZip = zipSync({ "package.json": new TextEncoder().encode(JSON.stringify({ name: "distil", version: next })), "server/index.ts": new TextEncoder().encode("// new") });
  const sha = createHash("sha256").update(appZip).digest("hex");
  const fakeFetch = (feed: object) => (async (url: string | URL) => String(url).endsWith(".json")
    ? new Response(JSON.stringify(feed))
    : new Response(appZip, { headers: { "content-length": String(appZip.length) } })) as typeof fetch;

  it("compares versions", () => {
    expect(newer("0.10.0", "0.9.9")).toBe(true);
    expect(newer("0.1.0", "0.1.0")).toBe(false);
    expect(newer("1.0.0", "1.0.1")).toBe(false);
  });

  it("finds a newer version, checks its checksum and stages it for the launcher", async () => {
    const installDir = temp("install");
    const updates = createUpdates({ installDir, feedUrl: "https://example.org/distil/feed.json", fetch: fakeFetch({ version: next, url: `app-${next}.zip`, sha256: sha, notes: "Faster." }) });
    expect((await updates.check()).state).toBe("available");
    expect(updates.status().latest).toEqual({ version: next, notes: "Faster." });
    expect((await updates.install()).state).toBe("ready");
    expect(readFileSync(join(installDir, "next.txt"), "utf8")).toBe(`app-${next}`);
    expect(readFileSync(join(installDir, `app-${next}`, "server", "index.ts"), "utf8")).toBe("// new");
    expect(existsSync(join(installDir, "updates", `app-${next}.zip`))).toBe(false);
  });

  it("refuses a download that doesn't match, an HTTP feed, and an update that needs a newer runtime", async () => {
    const installDir = temp("install");
    const bad = createUpdates({ installDir, feedUrl: "https://example.org/feed.json", fetch: fakeFetch({ version: next, url: "app.zip", sha256: "0".repeat(64) }) });
    await bad.check();
    const after = await bad.install();
    expect(after).toMatchObject({ state: "error" });
    expect(after.error).toMatch(/checksum/);
    expect(existsSync(join(installDir, `app-${next}`))).toBe(false);
    expect(existsSync(join(installDir, "next.txt"))).toBe(false);

    const http = createUpdates({ installDir, feedUrl: "http://example.org/feed.json", fetch: fakeFetch({}) });
    expect((await http.check()).error).toMatch(/HTTPS/);
    const old = createUpdates({ installDir, feedUrl: "https://example.org/feed.json", runtime: "24.0.0", fetch: fakeFetch({ version: next, url: "a.zip", sha256: sha, minRuntime: "26.0.0" }) });
    expect((await old.check()).error).toMatch(/new installer/);
  });
});
