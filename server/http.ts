import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { type ChatDeps, meterFor, prepareTurn, streamTurn } from "./chat.ts";
import { AppError, notFound } from "./errors.ts";
import type { Fonts } from "./fonts.ts";
import type { Jobs } from "./jobs.ts";
import { MAX_MATERIAL_BYTES, type Materials } from "./materials/store.ts";
import { parseLabel } from "./materials/ingest.ts";
import { ProviderError } from "./providers/types.ts";
import { SettingsPatch } from "./settings.ts";

export type AppDeps = ChatDeps & { dataDir: string; allowedHosts: string[]; fonts: Fonts; materials: Materials; jobs: Jobs };

const NullableId = z.string().min(1).nullable();
const ModelRefBody = z.object({ provider: z.string().min(1), id: z.string().min(1) });

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const json = await c.req.json().catch(() => {
    throw new AppError(400, "invalid_json", "The request body isn't valid JSON.");
  });
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new AppError(400, "invalid_request", z.prettifyError(parsed.error));
  return parsed.data;
}

export function createApp(deps: AppDeps) {
  const { library, messages, providers, settings, usage, materials, jobs } = deps;
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
    const upload = c.req.method === "POST" && /^\/api\/folders\/[^/]+\/materials$/.test(c.req.path) && type === "application/octet-stream";
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
    const patch = await body(c, z.object({ name: z.string().optional(), parentId: NullableId.optional() }));
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
    const patch = await body(c, z.object({ title: z.string().optional(), folderId: NullableId.optional(), model: ModelRefBody.nullable().optional() }));
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
  app.put("/providers/:id/key", async (c) => {
    const { key } = await body(c, z.object({ key: z.string() }));
    return c.json(await providers.setKey(c.req.param("id"), key));
  });
  app.delete("/providers/:id/key", (c) => {
    providers.removeKey(c.req.param("id"));
    return c.body(null, 204);
  });

  /* ---------- Settings & usage (F-1104, F-1302) ---------- */
  app.get("/settings", (c) => c.json({ ...settings.get(), dataDir: deps.dataDir }));
  app.patch("/settings", async (c) => c.json({ ...settings.update(await body(c, SettingsPatch)), dataDir: deps.dataDir }));
  app.get("/usage", (c) => {
    const s = settings.get();
    const provider = c.req.query("provider") ?? s.models.strong?.provider ?? "";
    return c.json({ ...usage.totals(), cap: usage.capStatus(s.caps, provider) });
  });

  /* ---------- Materials (F-201…F-210) ---------- */
  app.get("/folders/:id/materials", (c) => c.json(materials.list(c.req.param("id"))));
  app.post("/folders/:id/materials", async (c) => {
    if (Number(c.req.header("content-length") ?? 0) > MAX_MATERIAL_BYTES) throw new AppError(413, "file_too_large", "Files can be up to 200 MB.");
    const name = decodeURIComponent(c.req.header("x-file-name") ?? "");
    const material = materials.add(c.req.param("id"), name, new Uint8Array(await c.req.arrayBuffer()));
    jobs.enqueue("parse", parseLabel(material.name), { folderId: material.folderId, materialId: material.id });
    return c.json(material, 201);
  });
  app.get("/materials/:id", (c) => c.json({ material: materials.get(c.req.param("id")), chunks: materials.chunks(c.req.param("id")) }));
  app.get("/materials/:id/file", (c) => {
    const { bytes, type } = materials.read(c.req.param("id"));
    return c.body(new Uint8Array(bytes), 200, { "content-type": type, "content-disposition": "inline", "x-content-type-options": "nosniff" });
  });
  app.delete("/materials/:id", (c) => {
    jobs.abortFor(c.req.param("id"));
    materials.remove(c.req.param("id"));
    return c.body(null, 204);
  });

  /* ---------- Background jobs (F-209, F-402) ---------- */
  app.get("/jobs", (c) => c.json(jobs.list()));
  app.post("/jobs/:id/abort", (c) => {
    jobs.abort(c.req.param("id"));
    return c.json(jobs.get(c.req.param("id")));
  });

  /* ---------- Text font (F-1309) ---------- */
  app.get("/fonts/text", (c) => {
    const font = deps.fonts.read();
    if (!font) throw notFound("Font");
    return c.body(new Uint8Array(font.bytes), 200, { "content-type": font.type, "cache-control": "no-cache" });
  });
  app.get("/fonts/text/info", (c) => c.json(deps.fonts.info()));
  app.put("/fonts/text", async (c) => {
    const { name, data } = await body(c, z.object({ name: z.string().max(200), data: z.base64() }));
    return c.json(deps.fonts.save(name, data));
  });
  app.delete("/fonts/text", (c) => {
    deps.fonts.remove();
    return c.body(null, 204);
  });

  return app;
}
