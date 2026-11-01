import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { type ChatDeps, meterFor, prepareTurn, streamTurn } from "./chat.ts";
import { AppError, notFound } from "./errors.ts";
import type { Fonts } from "./fonts.ts";
import type { Jobs } from "./jobs.ts";
import { estimateExtraction, type ExtractParams, extractLabel, inRange, visualPages } from "./ledger/extract.ts";
import type { Ledger } from "./ledger/store.ts";
import type { Search } from "./materials/search.ts";
import { MAX_MATERIAL_BYTES, type Material, type Materials, type StoredChunk } from "./materials/store.ts";
import { parseLabel, reimportLabel } from "./materials/ingest.ts";
import { type FetchFn, fetchUrl, parseUrl } from "./materials/web.ts";
import { MAX_PASTED_CHARS, pastedTranscript, transcribeVideo, videoTitle, watchUrl, youtubeId } from "./materials/youtube.ts";
import { ProviderError } from "./providers/types.ts";
import { ITEM_TYPES } from "./prompts.ts";
import { SettingsPatch } from "./settings.ts";
import { DIALS } from "./visuals/reference.ts";
import type { Db } from "./db.ts";
import type { Learner } from "./learning/learner.ts";
import type { Briefs } from "./plan/brief.ts";
import { registerPlanRoutes } from "./plan/routes.ts";
import type { LocalModels } from "./retrieval/local.ts";
import { queueIndexing, type Retrieval } from "./retrieval/retrieve.ts";
import { registerRetrievalRoutes } from "./retrieval/routes.ts";
import type { Vectors } from "./retrieval/vectors.ts";
import type { Plans } from "./plan/store.ts";
import type { Teacher } from "./teach/engine.ts";
import { registerTeachRoutes } from "./teach/routes.ts";
import type { Visuals } from "./visuals/builder.ts";
import { registerVisualRoutes } from "./visuals/routes.ts";

export type AppDeps = ChatDeps & { dataDir: string; allowedHosts: string[]; fonts: Fonts; materials: Materials; search: Search; ledger: Ledger; jobs: Jobs; fetch?: FetchFn }
  & { db: Db; learner: Learner; plans: Plans; briefs: Briefs; local: LocalModels; vectors: Vectors; retrieval: Retrieval; teacher: Teacher; visuals: Visuals };

const NullableId = z.string().min(1).nullable();
const ModelRefBody = z.object({ provider: z.string().min(1), id: z.string().min(1), key: z.string().min(1).optional() });
const StrategyBody = z.object({ strategy: z.enum(["balanced", "thorough", "economy"]).default("balanced") });
const Location = z.coerce.number().int().positive().optional();
const Scope = StrategyBody.extend({ materialId: z.string().min(1).optional(), from: Location, to: Location });
const ItemType = z.enum(ITEM_TYPES);
const ItemPatch = z.object({
  title: z.string().min(1).max(200).optional(), statement: z.string().max(2000).optional(), type: ItemType.optional(),
  mark: z.enum(["skip", "known", "out_of_scope"]).nullable().optional(),
});

export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const json = await c.req.json().catch(() => {
    throw new AppError(400, "invalid_json", "The request body isn't valid JSON.");
  });
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new AppError(400, "invalid_request", z.prettifyError(parsed.error));
  return parsed.data;
}

export function createApp(deps: AppDeps) {
  const { library, messages, providers, settings, usage, materials, ledger, jobs } = deps;
  const app = new Hono().basePath("/api");

  // The API holds keys and spends tokens, so only this app may call it: the Host header must be ours
  // (stops DNS rebinding), a cross-origin Origin is refused, and writes must be JSON (no form posts).
  app.use(async (c, next) => {
    const host = c.req.header("host") ?? "";
    if (!deps.allowedHosts.includes(host)) throw new AppError(403, "forbidden_host", "Unknown host.");
    const origin = c.req.header("origin");
    if (origin && new URL(origin).host !== host) throw new AppError(403, "forbidden_origin", "Cross-origin requests are not allowed.");
    // File uploads are raw bytes; that content type can't be sent cross-site without a CORS preflight, which we never grant.
    const type = c.req.header("content-type") ?? "";
    const upload = c.req.method === "POST" && /^\/api\/(folders\/[^/]+\/materials|materials\/[^/]+\/replace)$/.test(c.req.path) && type === "application/octet-stream";
    if (c.req.method !== "GET" && c.req.method !== "DELETE" && !upload && !type.startsWith("application/json")) {
      throw new AppError(415, "json_only", "Send JSON.");
    }
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ code: err.code, message: err.message, details: err.details }, err.status as 400);
    if (err instanceof ProviderError) return c.json({ code: "provider_error", message: err.message }, 502);
    deps.log?.(`Unhandled error: ${err.stack ?? err.message}`);
    return c.json({ code: "internal", message: "Something went wrong on our side." }, 500);
  });

  /* ---------- Library (F-001, F-004) ---------- */
  app.get("/library", (c) => c.json(library.list()));

  app.post("/folders", async (c) => {
    const { name, parentId } = await body(c, z.object({ name: z.string(), parentId: NullableId }));
    return c.json(library.createFolder(name, parentId), 201);
  });
  app.patch("/folders/:id", async (c) => {
    const patch = await body(c, z.object({ name: z.string().optional(), parentId: NullableId.optional(), dial: z.enum(DIALS).nullable().optional() }));
    return c.json(library.updateFolder(c.req.param("id"), patch));
  });
  app.get("/folders/:id/contents", (c) => c.json(library.folderContents(c.req.param("id"))));
  app.delete("/folders/:id", (c) => {
    const ids = materials.idsUnder(c.req.param("id"));
    ids.forEach((id) => jobs.abortFor(id));
    library.deleteFolder(c.req.param("id"));
    materials.removeFiles(ids);
    return c.body(null, 204);
  });

  app.post("/chats", async (c) => {
    const { folderId } = await body(c, z.object({ folderId: NullableId }));
    return c.json(library.createChat(folderId), 201);
  });
  app.get("/chats/:id", (c) => {
    const chat = library.getChat(c.req.param("id"));
    return c.json({ chat, messages: messages.list(chat.id), meter: meterFor(deps, chat) });
  });
  app.patch("/chats/:id", async (c) => {
    const patch = await body(c, z.object({ title: z.string().optional(), folderId: NullableId.optional(), model: ModelRefBody.nullable().optional(), dial: z.enum(DIALS).nullable().optional() }));
    return c.json(library.updateChat(c.req.param("id"), patch));
  });
  app.delete("/chats/:id", (c) => {
    library.deleteChat(c.req.param("id"));
    return c.body(null, 204);
  });

  // Streams one turn as server-sent events. Closing the connection aborts the provider request (F-407).
  app.post("/chats/:id/messages", async (c) => {
    const { text, model } = await body(c, z.object({ text: z.string(), model: ModelRefBody.optional() }));
    const turn = prepareTurn(deps, c.req.param("id"), text, model);
    const signal = c.req.raw.signal;
    return streamSSE(c, async (stream) => {
      for await (const event of streamTurn(deps, turn, signal)) {
        if (!stream.aborted) await stream.writeSSE({ data: JSON.stringify(event) });
      }
    });
  });

  /* ---------- Providers & models (F-1201, F-1202, F-1205) ---------- */
  app.get("/providers", (c) => c.json(providers.list()));
  app.get("/providers/:id/models", async (c) => c.json(await providers.models(c.req.param("id"), c.req.query("refresh") === "1")));
  app.post("/providers/:id/keys", async (c) => {
    const { key, label } = await body(c, z.object({ key: z.string(), label: z.string().max(40).optional() }));
    return c.json(await providers.addKey(c.req.param("id"), key, label), 201);
  });
  app.delete("/providers/:id/keys", (c) => {
    providers.removeKey(c.req.param("id"));
    return c.body(null, 204);
  });
  app.delete("/providers/:id/keys/:key", (c) => {
    providers.removeKey(c.req.param("id"), c.req.param("key"));
    return c.body(null, 204);
  });

  /* ---------- Settings & usage (F-1104, F-1302) ---------- */
  app.get("/settings", (c) => c.json({ ...settings.get(), dataDir: deps.dataDir }));
  app.patch("/settings", async (c) => {
    const before = JSON.stringify(settings.get().embeddings);
    const next = settings.update(await body(c, SettingsPatch));
    // A new embedding model indexes the materials for it.
    if (JSON.stringify(next.embeddings) !== before) queueIndexing(deps.jobs, deps.retrieval);
    return c.json({ ...next, dataDir: deps.dataDir });
  });
  app.get("/usage", (c) => {
    const s = settings.get();
    const provider = c.req.query("provider") ?? s.models.strong?.provider ?? "";
    return c.json({ ...usage.totals(), cap: usage.capStatus(s.caps, provider) });
  });

  /* ---------- Materials (F-201…F-210) ---------- */
  app.get("/folders/:id/materials", (c) => c.json(materials.list(c.req.param("id"))));
  // Keyword search over the folder's materials, each hit anchored to its page, slide or line.
  app.get("/folders/:id/search", (c) => {
    library.requireFolder(c.req.param("id"));
    const q = (c.req.query("q") ?? "").slice(0, 500);
    return c.json(deps.search.search(c.req.param("id"), q, Math.min(Number(c.req.query("limit")) || 20, 50)));
  });
  app.post("/folders/:id/materials", async (c) => {
    if (Number(c.req.header("content-length") ?? 0) > MAX_MATERIAL_BYTES) throw new AppError(413, "file_too_large", "Files can be up to 200 MB.");
    const name = decodeURIComponent(c.req.header("x-file-name") ?? "");
    const material = materials.add(c.req.param("id"), name, new Uint8Array(await c.req.arrayBuffer()));
    jobs.enqueue("parse", parseLabel(material.name), { folderId: material.folderId, materialId: material.id });
    return c.json(material, 201);
  });
  // A link: the page (or the file it points to) is fetched now and kept as a copy (F-203). A YouTube
  // link becomes a transcript: the one pasted with it, or else one a Gemini model writes (F-204).
  app.post("/folders/:id/materials/url", async (c) => {
    const { url, transcript } = await body(c, z.object({ url: z.string().min(1).max(2000), transcript: z.string().max(MAX_PASTED_CHARS).optional() }));
    const folderId = c.req.param("id");
    const target = parseUrl(url);
    library.requireFolder(folderId);
    const video = youtubeId(target);
    let fetched;
    if (video) {
      const title = await videoTitle(video, deps.fetch);
      fetched = transcript?.trim() ? pastedTranscript(title, video, transcript) : await transcribeVideo(deps, video, title, folderId);
    } else {
      fetched = await fetchUrl(target, deps.fetch);
    }
    const material = materials.add(folderId, fetched.name, fetched.bytes, video ? watchUrl(video) : target.href);
    jobs.enqueue("parse", parseLabel(material.name), { folderId: material.folderId, materialId: material.id });
    return c.json(material, 201);
  });
  // A new version of a material (F-212): a replacement file, or its link fetched again. Unchanged
  // sections keep their items; the rest is read again and waits to be distilled.
  const reimport = (id: string, fetched: { name: string; bytes: Uint8Array }) => {
    jobs.abortFor(id);
    const material = materials.replace(id, fetched.name, fetched.bytes);
    jobs.enqueue("parse", reimportLabel(material.name), { folderId: material.folderId, materialId: id, params: { reimport: true } });
    return material;
  };
  app.post("/materials/:id/replace", async (c) => {
    if (Number(c.req.header("content-length") ?? 0) > MAX_MATERIAL_BYTES) throw new AppError(413, "file_too_large", "Files can be up to 200 MB.");
    const name = decodeURIComponent(c.req.header("x-file-name") ?? "");
    return c.json(reimport(c.req.param("id"), { name, bytes: new Uint8Array(await c.req.arrayBuffer()) }));
  });
  app.post("/materials/:id/refetch", async (c) => {
    const material = materials.get(c.req.param("id"));
    if (!material.source) throw new AppError(400, "no_source", "This material was added as a file. Replace the file instead.");
    const target = parseUrl(material.source);
    if (youtubeId(target)) throw new AppError(400, "video_refetch", "A video doesn't change once published, so there is nothing to fetch again.");
    return c.json(reimport(material.id, await fetchUrl(target, deps.fetch)));
  });
  app.delete("/materials/:id/reimport", (c) => {
    materials.get(c.req.param("id"));
    materials.setReimport(c.req.param("id"), null);
    return c.body(null, 204);
  });
  app.get("/materials/:id", (c) => c.json({ material: materials.get(c.req.param("id")), chunks: materials.chunks(c.req.param("id")) }));
  app.get("/materials/:id/file", (c) => {
    const { bytes, type } = materials.read(c.req.param("id"));
    return c.body(new Uint8Array(bytes), 200, { "content-type": type, "content-disposition": "inline", "x-content-type-options": "nosniff" });
  });
  app.delete("/materials/:id", (c) => {
    jobs.abortFor(c.req.param("id"));
    materials.remove(c.req.param("id"));
    ledger.removeOrphans();
    return c.body(null, 204);
  });

  /* ---------- Coverage Ledger (F-207, F-208, F-301…F-310) ---------- */
  // What to distil: every read material in a folder's subtree, or one material, optionally only a
  // location range of it ("pages 17–176"). Only chunks with extraction or audit work left count.
  const pending = (folderId: string, scope: z.infer<typeof Scope>) => materials.idsUnder(folderId)
    .filter((id) => !scope.materialId || id === scope.materialId)
    .map((id) => ({ material: materials.get(id), chunks: materials.chunks(id).filter((ch) => (!ch.extracted || !ch.audited) && inRange(ch, scope)) }))
    .filter(({ material, chunks }) => material.status === "ready" && chunks.length > 0);
  const priced = (material: Material, chunks: StoredChunk[]) =>
    chunks.map((ch) => ({ tokens: ch.tokens, images: material.kind === "image" ? 1 : visualPages(material, ch).length }));
  const extract = (material: Material, params: ExtractParams) =>
    jobs.active("extract", material.id)
    ?? jobs.enqueue("extract", extractLabel(material.name, material.unit, params), { folderId: material.folderId, materialId: material.id, params });

  app.get("/folders/:id/estimate", (c) => {
    const parsed = Scope.safeParse(c.req.query());
    if (!parsed.success) throw new AppError(400, "invalid_request", z.prettifyError(parsed.error));
    const { strategy } = parsed.data;
    if (c.req.query("reaudit")) {
      const ready = materials.idsUnder(c.req.param("id")).map((id) => materials.get(id)).filter((m) => m.status === "ready");
      return c.json({ materials: ready.length, ...estimateExtraction(ready.flatMap((m) => priced(m, materials.chunks(m.id))), strategy, true) });
    }
    const work = pending(c.req.param("id"), parsed.data);
    return c.json({ materials: work.length, ...estimateExtraction(work.flatMap((w) => priced(w.material, w.chunks)), strategy) });
  });
  app.post("/folders/:id/extract", async (c) => {
    const scope = await body(c, Scope);
    const { materialId: _, ...params } = scope;
    return c.json(pending(c.req.param("id"), scope).map(({ material }) => extract(material, params)), 202);
  });
  // "What did we miss?" (F-309): audit every chunk in the folder again, then merge.
  app.post("/folders/:id/reaudit", async (c) => {
    const { strategy } = await body(c, StrategyBody);
    const ids = materials.idsUnder(c.req.param("id")).filter((id) => materials.get(id).status === "ready");
    ids.forEach((id) => materials.resetAudit(id));
    return c.json(ids.map((id) => extract(materials.get(id), { strategy })), 202);
  });
  app.get("/folders/:id/items", (c) => c.json(ledger.list(c.req.param("id"))));
  app.post("/folders/:id/items", async (c) => {
    const draft = await body(c, z.object({ type: ItemType, title: z.string().max(200), statement: z.string().max(2000).default("") }));
    library.requireFolder(c.req.param("id"));
    return c.json(ledger.addManual(c.req.param("id"), draft), 201);
  });
  app.patch("/items/:id", async (c) => c.json(ledger.update(c.req.param("id"), await body(c, ItemPatch))));
  app.delete("/items/:id", (c) => {
    ledger.remove(c.req.param("id"));
    return c.body(null, 204);
  });

  /* ---------- Background jobs (F-209, F-402) ---------- */
  app.get("/jobs", (c) => c.json(jobs.list()));
  app.post("/jobs/:id/abort", (c) => {
    jobs.abort(c.req.param("id"));
    return c.json(jobs.get(c.req.param("id")));
  });

  /* ---------- Saved text fonts (F-1309) ---------- */
  app.get("/fonts", (c) => c.json(deps.fonts.list()));
  app.post("/fonts", async (c) => {
    const input = await body(c, z.union([
      z.object({ family: z.string().min(1).max(200), name: z.string().max(200).optional() }),
      z.object({ fileName: z.string().max(200), data: z.base64(), name: z.string().max(200).optional() }),
    ]));
    return c.json("family" in input ? deps.fonts.addInstalled(input.family, input.name) : deps.fonts.addFile(input.fileName, input.data, input.name), 201);
  });
  app.patch("/fonts/:id", async (c) => {
    const { name } = await body(c, z.object({ name: z.string().max(200) }));
    return c.json(deps.fonts.rename(c.req.param("id"), name));
  });
  app.get("/fonts/:id/file", (c) => {
    const font = deps.fonts.read(c.req.param("id"));
    return c.body(new Uint8Array(font.bytes), 200, { "content-type": font.type, "cache-control": "private, max-age=31536000, immutable" });
  });
  app.delete("/fonts/:id", (c) => {
    deps.fonts.remove(c.req.param("id"));
    return c.body(null, 204);
  });

  registerPlanRoutes(app, deps);
  registerRetrievalRoutes(app, deps);
  registerTeachRoutes(app, deps);
  registerVisualRoutes(app, deps);
  return app;
}
