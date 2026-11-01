import type { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../http.ts";
import type { Jobs } from "../jobs.ts";
import { LOCAL_SIZES, type LocalSize } from "../settings.ts";
import { LOCAL_MODELS, type LocalModels } from "./local.ts";
import { queueIndexing } from "./retrieve.ts";

// Search by meaning (F-1005): local models (size check, download after consent, removal), the provider
// embedding models a key offers, and how far indexing has got.

const Size = z.enum(LOCAL_SIZES);
const size = (raw: string): LocalSize => Size.parse(raw);
export const downloadLabel = (s: LocalSize) => `Downloading the ${LOCAL_MODELS[s].label} search model`;

export function registerModelDownload(jobs: Jobs, local: LocalModels, after: (s: LocalSize) => void) {
  jobs.register("embed-model", async (job, { progress, signal }) => {
    const s = size(String(job.params.size));
    // Shown in megabytes, so the activity panel reads like a download.
    await local.download(s, (done, total) => progress(Math.round(done / 1e6), Math.max(1, Math.round(total / 1e6))), signal);
    after(s);
  });
}

export function registerRetrievalRoutes(app: Hono, deps: AppDeps) {
  const { local, retrieval, vectors, jobs, settings, providers } = deps;

  app.get("/embeddings", (c) => {
    const model = retrieval.model();
    const counts = model ? vectors.counts(model, null) : null;
    return c.json({
      local: LOCAL_SIZES.map((s) => ({ size: s, label: LOCAL_MODELS[s].label, note: LOCAL_MODELS[s].note, installed: local.installed(s) })),
      index: counts && { done: counts.done ?? 0, total: counts.total },
    });
  });
  app.get("/embeddings/local/:size", async (c) => c.json({ bytes: await local.size(size(c.req.param("size"))) }));
  app.post("/embeddings/local/:size/download", (c) => {
    const s = size(c.req.param("size"));
    return c.json(jobs.enqueue("embed-model", downloadLabel(s), { params: { size: s } }), 202);
  });
  app.delete("/embeddings/local/:size", (c) => {
    const s = size(c.req.param("size"));
    local.remove(s);
    vectors.drop(`local:${s}`);
    const e = settings.get().embeddings;
    if (e.mode === "local" && e.size === s) settings.update({ embeddings: { mode: "off" } });
    return c.body(null, 204);
  });
  app.post("/embeddings/index", (c) => c.json({ queued: queueIndexing(jobs, retrieval) }));
  app.get("/providers/:id/embedding-models", async (c) => c.json(await providers.embeddingModels(c.req.param("id"))));
}
