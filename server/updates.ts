import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { AppError } from "./errors.ts";
import { APP_VERSION } from "./version.ts";
import { insidePath, unzipTo } from "./zip.ts";

// Auto-update for the installed Windows build (F-1305). The install folder holds one folder per app
// version (app-<version>) and current.txt naming the one to run. An update is a zip of the next app
// folder, listed in a JSON feed with its SHA-256; it's downloaded, checked, unpacked beside the
// current one and named in next.txt, and the launcher switches to it on the next restart. The feed is
// set when a build is packaged (update-feed.txt); with none, updates are off.

const Feed = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  url: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i),
  notes: z.string().max(4000).default(""),
  minRuntime: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
});
type Feed = z.infer<typeof Feed>;
export type UpdateStatus = {
  current: string;
  state: "idle" | "checking" | "available" | "downloading" | "ready" | "error";
  latest: { version: string; notes: string } | null;
  progress: number | null;
  error: string | null;
  checkedAt: number | null;
};

const DAY = 24 * 3_600_000;
const parts = (v: string) => v.split(".").map(Number);
export const newer = (a: string, b: string) => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};
// The feed and the download must be HTTPS; plain HTTP only to this machine, for testing a feed.
const trusted = (url: URL) => url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));

export function createUpdates({ installDir, feedUrl, fetch: get = fetch, now = () => Date.now(), runtime = process.versions.node }: {
  installDir: string; feedUrl: string | null; fetch?: typeof fetch; now?: () => number; runtime?: string;
}) {
  let feed: Feed | null = null;
  const status: UpdateStatus = { current: APP_VERSION, state: "idle", latest: null, progress: null, error: null, checkedAt: null };
  const fail = (message: string) => { Object.assign(status, { state: "error", error: message, progress: null }); };
  const staged = () => existsSync(join(installDir, "next.txt")) ? readFileSync(join(installDir, "next.txt"), "utf8").trim() : null;
  if (staged()) status.state = "ready";

  async function check() {
    if (!feedUrl || status.state === "checking" || status.state === "downloading" || status.state === "ready") return status;
    const url = new URL(feedUrl);
    if (!trusted(url)) { fail("The update feed isn't HTTPS."); return status; }
    Object.assign(status, { state: "checking", error: null });
    try {
      const res = await get(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`the update server answered ${res.status}`);
      const parsed = Feed.safeParse(await res.json());
      if (!parsed.success) throw new Error("the update feed isn't in the expected form");
      feed = parsed.data;
      status.checkedAt = now();
      if (!newer(feed.version, APP_VERSION)) return Object.assign(status, { state: "idle", latest: null });
      if (feed.minRuntime && newer(feed.minRuntime, runtime)) {
        fail(`Distil ${feed.version} needs a new installer; download it from the Distil site.`);
        status.latest = { version: feed.version, notes: feed.notes };
        return status;
      }
      return Object.assign(status, { state: "available", latest: { version: feed.version, notes: feed.notes } });
    } catch (err) {
      fail(`Couldn't check for updates: ${err instanceof Error ? err.message : String(err)}.`);
      return status;
    }
  }

  // Downloads and unpacks the update; it takes over at the next restart.
  async function install() {
    if (status.state !== "available" || !feed) throw new AppError(409, "no_update", "There's no update to install.");
    const target = feed;
    const url = new URL(target.url, feedUrl!);
    if (!trusted(url)) throw new AppError(400, "untrusted_update", "The update isn't served over HTTPS.");
    const dir = join(installDir, "updates");
    const zip = join(dir, `app-${target.version}.zip`);
    const unpacked = join(installDir, `app-${target.version}.partial`);
    Object.assign(status, { state: "downloading", progress: 0, error: null });
    try {
      mkdirSync(dir, { recursive: true });
      const res = await get(url);
      if (!res.ok || !res.body) throw new Error(`the download answered ${res.status}`);
      const total = Number(res.headers.get("content-length") ?? 0);
      const hash = createHash("sha256");
      let got = 0;
      const tap = new Transform({ transform(chunk: Buffer, _enc, done) {
        hash.update(chunk);
        got += chunk.length;
        if (total) status.progress = Math.min(0.99, got / total);
        done(null, chunk);
      } });
      await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), tap, createWriteStream(zip));
      if (hash.digest("hex") !== target.sha256.toLowerCase()) throw new Error("the download doesn't match its checksum");
      rmSync(unpacked, { recursive: true, force: true });
      await unzipTo(zip, unpacked, insidePath, "a Distil update");
      const pkg = JSON.parse(readFileSync(join(unpacked, "package.json"), "utf8")) as { name?: string; version?: string };
      if (pkg.name !== "distil" || pkg.version !== target.version) throw new Error("the download isn't the version the feed lists");
      const final = join(installDir, `app-${target.version}`);
      rmSync(final, { recursive: true, force: true });
      renameSync(unpacked, final);
      writeFileSync(join(installDir, "next.txt"), `app-${target.version}`);
      Object.assign(status, { state: "ready", progress: 1 });
    } catch (err) {
      rmSync(unpacked, { recursive: true, force: true });
      fail(`The update couldn't be installed: ${err instanceof Error ? err.message : String(err)}.`);
    } finally {
      rmSync(zip, { force: true });
    }
    return status;
  }

  // Checks shortly after start and then once a day; installing waits for the learner.
  function schedule() {
    if (!feedUrl) return;
    setTimeout(() => void check(), 10_000).unref();
    setInterval(() => void check(), DAY).unref();
  }

  return { status: () => ({ ...status, enabled: !!feedUrl }), check, install, schedule };
}

export type Updates = ReturnType<typeof createUpdates>;
