import type { Db } from "../db.ts";
import { AppError } from "../errors.ts";
import { MAX_WAIT_MS, retryDelay, sleep } from "../llm.ts";
import { ProviderError } from "../providers/types.ts";
import type { Jobs } from "../jobs.ts";
import type { Item } from "../ledger/store.ts";
import type { Search } from "../materials/search.ts";
import type { Providers } from "../providers/service.ts";
import type { SettingsStore } from "../settings.ts";
import { estimateTokens, type UsageStore } from "../usage.ts";
import type { LocalModels } from "./local.ts";
import type { Vectors } from "./vectors.ts";

// Retrieval (F-1004): the keyword index and, when on, embeddings each rank the folder's chunks; reciprocal
// rank fusion merges them, and each passage keeps its anchor so answers and lessons can cite it.

export type Passage = {
  chunkId: string; materialId: string; materialName: string; loc: number; locTo: number;
  headings: string[]; text: string; via: ("keyword" | "meaning" | "source")[];
};

const RRF_K = 60;
const CANDIDATES = 20;
const BATCH = 32;
// What a chunk is embedded as: its headings, then its text, cut to stay inside every model's input limit.
const EMBED_CHARS = 2000;
export const embedText = (headings: string[], text: string) => [...headings, text].join("\n").slice(0, EMBED_CHARS);

// wait is injectable so tests don't sleep.
export type RetrievalDeps = {
  db: Db; search: Search; vectors: Vectors; local: LocalModels; providers: Providers; settings: SettingsStore; usage: UsageStore;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
};
const ATTEMPTS = 8;
const BACKOFF_CAP_MS = 60_000;

export function createRetrieval(deps: RetrievalDeps) {
  const { db, search, vectors } = deps;

  // The embedding model in use, as stored with the vectors, or null when meaning-based search is off.
  const model = (): string | null => {
    const e = deps.settings.get().embeddings;
    return e.mode === "provider" ? `${e.provider}:${e.id}` : e.mode === "local" ? `local:${e.size}` : null;
  };

  async function embed(texts: string[], task: "document" | "query", folderId: string | null, signal?: AbortSignal): Promise<number[][]> {
    const e = deps.settings.get().embeddings;
    if (e.mode === "local") return deps.local.embed(e.size, texts);
    if (e.mode !== "provider") return [];
    const ref = { provider: e.provider, id: e.id, key: e.key };
    const { vectors: out, tokens } = await deps.providers.embed(ref, { texts, task, signal });
    deps.usage.record({
      provider: e.provider, model: e.id, role: "embed", chatId: null, folderId, estimated: tokens === null,
      usage: { input: tokens ?? estimateTokens(texts.join("")), output: 0, cached: 0, reasoning: 0 },
    });
    return out;
  }

  const chunks = (ids: string[]) => {
    if (!ids.length) return new Map<string, Omit<Passage, "via">>();
    const rows = db.prepare(`SELECT c.id, c.material_id, m.name, c.loc_from, c.loc_to, c.headings, c.text FROM chunks c
      JOIN materials m ON m.id = c.material_id WHERE c.id IN (${ids.map(() => "?").join(",")})`).all(...ids) as {
        id: string; material_id: string; name: string; loc_from: number; loc_to: number; headings: string; text: string;
      }[];
    return new Map(rows.map((r) => [r.id, {
      chunkId: r.id, materialId: r.material_id, materialName: r.name, loc: r.loc_from, locTo: r.loc_to, headings: JSON.parse(r.headings) as string[], text: r.text,
    }]));
  };

  // Free tiers limit embedding tokens per minute: indexing waits as asked and carries on, and stops
  // only when the quota is gone for longer than a short wait.
  async function patiently<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await run();
      } catch (err) {
        if (!(err instanceof ProviderError) || (err.status !== 429 && err.status < 500) || attempt >= ATTEMPTS) throw err;
        const asked = retryDelay(err.message);
        if (asked !== null && asked > MAX_WAIT_MS) throw new AppError(429, "quota_exhausted", "The embedding model is out of quota for now. Indexing keeps what it has; run it again once the quota resets.");
        // A per-minute limit often says "retry in 0.3 s" while the minute isn't over, so waits also grow.
        await (deps.wait ?? sleep)(Math.max(asked ?? 0, Math.min(BACKOFF_CAP_MS, 2000 * 2 ** (attempt - 1))), signal);
      }
    }
  }

  const retrieval = {
    model,

    // The folder's best passages for a query. Meaning-based search is skipped (keyword only) when it is
    // off, its model is missing, or the provider fails, so a lesson never stops on it.
    async retrieve(folderId: string, query: string, limit = 6, signal?: AbortSignal): Promise<Passage[]> {
      const ranks = new Map<string, { score: number; via: Set<Passage["via"][number]> }>();
      const add = (ids: string[], via: Passage["via"][number]) => ids.forEach((id, i) => {
        const r = ranks.get(id) ?? { score: 0, via: new Set() };
        r.score += 1 / (RRF_K + i + 1);
        r.via.add(via);
        ranks.set(id, r);
      });
      add(search.search(folderId, query, CANDIDATES).map((h) => h.chunkId), "keyword");
      const m = model();
      if (m && (vectors.counts(m, folderId).done ?? 0) > 0) {
        const vector = await embed([query], "query", folderId, signal).then((v) => v[0]).catch(() => undefined);
        if (vector) add(vectors.nearest(m, folderId, vector, CANDIDATES).map((n) => n.chunkId), "meaning");
      }
      const top = [...ranks.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, limit);
      const found = chunks(top.map(([id]) => id));
      return top.flatMap(([id, r]) => (found.has(id) ? [{ ...found.get(id)!, via: [...r.via] }] : []));
    },

    // Everything the folder's materials say about these items (F-617): the chunks each item was found in,
    // then what search finds for it across every file, without repeats.
    async forItems(folderId: string, items: Item[], perItem = 3, signal?: AbortSignal): Promise<Passage[]> {
      const out = new Map<string, Passage>();
      const where = db.prepare("SELECT id FROM chunks WHERE material_id = ? AND loc_from <= ? AND loc_to >= ? ORDER BY ord LIMIT 1");
      for (const item of items) {
        const own = item.sources.flatMap((s) => (where.get(s.materialId, s.loc, s.loc) as { id: string } | undefined)?.id ?? []);
        for (const [id, p] of chunks(own)) if (!out.has(id)) out.set(id, { ...p, via: ["source"] });
        for (const p of await retrieval.retrieve(folderId, `${item.title}. ${item.statement}`, perItem, signal)) {
          const seen = out.get(p.chunkId);
          if (seen) seen.via = [...new Set([...seen.via, ...p.via])];
          else out.set(p.chunkId, p);
        }
      }
      return [...out.values()];
    },

    // Embeds chunks that have no vector for the current model; the indexing job's work.
    async index(folderId: string | null, progress: (done: number, total: number) => void, signal?: AbortSignal) {
      const m = model();
      if (!m) return;
      for (;;) {
        const { total, done } = vectors.counts(m, folderId);
        progress(done ?? 0, total);
        const batch = vectors.missing(m, folderId, BATCH);
        if (!batch.length || signal?.aborted) return;
        const texts = batch.map((c) => embedText(JSON.parse(c.headings) as string[], c.text));
        const out = await patiently(() => embed(texts, "document", folderId, signal), signal);
        vectors.put(m, batch.map((c, i) => ({ chunkId: c.id, vector: out[i]! })));
      }
    },
  };
  return retrieval;
}

export type Retrieval = ReturnType<typeof createRetrieval>;

export const INDEX_LABEL = "Indexing for search by meaning";

// One indexing job at a time covers every folder; it's queued when the embedding model changes and after a file is read.
export function registerIndexing(jobs: Jobs, retrieval: Retrieval) {
  jobs.register("embed", async (_job, { signal, progress }) => retrieval.index(null, progress, signal));
}

// Returns whether indexing is now queued or running.
export function queueIndexing(jobs: Jobs, retrieval: Retrieval): boolean {
  if (!retrieval.model()) return false;
  if (jobs.list().some((j) => j.kind === "embed" && (j.status === "queued" || j.status === "running"))) return true;
  jobs.enqueue("embed", INDEX_LABEL, {});
  return true;
}
