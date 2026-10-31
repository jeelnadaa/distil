import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";
import { AppError, notFound } from "./errors.ts";

// Background work (F-209, F-402, F-403, F-1306): jobs are rows, so they survive restarts. A job that
// was running when Distil stopped is queued again on start, and its handler resumes from what it saved.

export type JobStatus = "queued" | "running" | "done" | "error" | "aborted";
export type Job = {
  id: string; kind: string; folderId: string | null; materialId: string | null; label: string;
  status: JobStatus; done: number; total: number; error: string | null; note: string | null; params: Record<string, unknown>;
  createdAt: number; updatedAt: number;
};
export type JobContext = { signal: AbortSignal; progress: (done: number, total: number) => void; note: (text: string | null) => void };
export type JobHandler = (job: Job, ctx: JobContext) => Promise<void>;

type Row = {
  id: string; kind: string; folder_id: string | null; material_id: string | null; label: string;
  status: JobStatus; done: number; total: number; error: string | null; note: string | null; params: string; created_at: number; updated_at: number;
};
const toJob = (r: Row): Job => ({
  id: r.id, kind: r.kind, folderId: r.folder_id, materialId: r.material_id, label: r.label, status: r.status,
  done: r.done, total: r.total, error: r.error, note: r.note, params: JSON.parse(r.params) as Record<string, unknown>, createdAt: r.created_at, updatedAt: r.updated_at,
});

const RECENT_MS = 24 * 60 * 60 * 1000; // the activity dock shows what finished or failed in the last day

export function createJobs(db: Db, opts: { concurrency?: number; now?: () => number; log?: (msg: string) => void } = {}) {
  const now = opts.now ?? (() => Date.now());
  const handlers = new Map<string, JobHandler>();
  const running = new Map<string, AbortController>();
  const waiters: (() => void)[] = [];
  let concurrency = opts.concurrency ?? 2;

  db.prepare("UPDATE jobs SET status = 'queued', updated_at = ? WHERE status = 'running'").run(now());

  const get = (id: string) => {
    const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw notFound("Job");
    return toJob(row);
  };
  const set = (id: string, fields: Partial<Pick<Row, "status" | "done" | "total" | "error" | "note">>) => {
    const keys = Object.keys(fields) as (keyof typeof fields)[];
    db.prepare(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
      .run(...keys.map((k) => fields[k] ?? null), now(), id);
  };

  async function run(job: Job, handler: JobHandler, controller: AbortController) {
    set(job.id, { status: "running", error: null, note: null });
    let note: string | null = null;
    try {
      await handler(job, {
        signal: controller.signal,
        progress: (done, total) => set(job.id, { done, total }),
        note: (text) => { if (text !== note) set(job.id, { note: (note = text) }); },
      });
      set(job.id, { status: controller.signal.aborted ? "aborted" : "done" });
    } catch (err) {
      if (controller.signal.aborted) set(job.id, { status: "aborted" });
      else {
        set(job.id, { status: "error", error: err instanceof Error ? err.message : String(err) });
        if (!(err instanceof AppError)) opts.log?.(`Job ${job.kind} failed: ${err instanceof Error ? err.stack : err}`);
      }
    } finally {
      running.delete(job.id);
      pump();
    }
  }

  // Starts queued jobs, oldest first, up to the concurrency limit.
  function pump() {
    const queued = db.prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at, rowid").all() as Row[];
    for (const row of queued) {
      if (running.size >= concurrency) break;
      const handler = handlers.get(row.kind);
      if (!handler || running.has(row.id)) continue;
      const controller = new AbortController();
      running.set(row.id, controller);
      void run(toJob(row), handler, controller);
    }
    if (running.size === 0) waiters.splice(0).forEach((resolve) => resolve());
  }

  return {
    register(kind: string, handler: JobHandler) {
      handlers.set(kind, handler);
      queueMicrotask(pump);
    },

    enqueue(kind: string, label: string, refs: { folderId?: string | null; materialId?: string | null; params?: Record<string, unknown> } = {}): Job {
      const id = randomUUID();
      const at = now();
      db.prepare("INSERT INTO jobs (id, kind, folder_id, material_id, label, status, params, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)")
        .run(id, kind, refs.folderId ?? null, refs.materialId ?? null, label, JSON.stringify(refs.params ?? {}), at, at);
      queueMicrotask(pump);
      return get(id);
    },

    get,

    // Active jobs plus those that finished in the last day, so the activity dock can show the outcome.
    list(): Job[] {
      return (db.prepare("SELECT * FROM jobs WHERE status IN ('queued', 'running') OR updated_at > ? ORDER BY created_at DESC, rowid DESC LIMIT 50")
        .all(now() - RECENT_MS) as Row[]).map(toJob);
    },

    abort(id: string) {
      const job = get(id);
      if (job.status === "queued") set(id, { status: "aborted" });
      running.get(id)?.abort();
    },

    // The unfinished job of a kind for a material, so the same work is never queued twice.
    active(kind: string, materialId: string): Job | null {
      const row = db.prepare("SELECT * FROM jobs WHERE kind = ? AND material_id = ? AND status IN ('queued', 'running') ORDER BY created_at LIMIT 1")
        .get(kind, materialId) as Row | undefined;
      return row ? toJob(row) : null;
    },

    // Aborts every unfinished job for a material (used before deleting it).
    abortFor(materialId: string) {
      const ids = (db.prepare("SELECT id FROM jobs WHERE material_id = ? AND status IN ('queued', 'running')").all(materialId) as { id: string }[]);
      for (const { id } of ids) this.abort(id);
    },

    setConcurrency(n: number) {
      concurrency = Math.max(1, n);
      pump();
    },

    // Resolves once nothing is running or startable (tests and shutdown).
    async idle() {
      pump();
      while (running.size > 0) await new Promise<void>((resolve) => waiters.push(resolve));
    },
  };
}

export type Jobs = ReturnType<typeof createJobs>;
