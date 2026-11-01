import type { Hono } from "hono";
import { z } from "zod";
import { type AppDeps, body } from "../http.ts";
import { maskKey } from "../secrets.ts";
import { SEARCH_LABEL, SEARCH_PROVIDERS, searchSecret, webSearch } from "./search.ts";

// Web search keys (F-1209) and the topic-only researcher (F-205).

export function registerResearchRoutes(app: Hono, { researcher, secrets, settings, fetch }: AppDeps) {
  // Each provider with its key masked, and which one the researcher uses.
  const view = () => ({
    provider: settings.get().webSearch,
    providers: SEARCH_PROVIDERS.map((id) => {
      const key = secrets.get(searchSecret(id));
      return { id, label: SEARCH_LABEL[id], preview: key ? maskKey(key.key) : null };
    }),
  });
  app.get("/search-providers", (c) => c.json(view()));
  // A key is tried with one search before it's kept, and becomes the one the researcher uses.
  app.post("/search-providers/:id/key", async (c) => {
    const id = z.enum(SEARCH_PROVIDERS).parse(c.req.param("id"));
    const { key } = await body(c, z.object({ key: z.string().trim().min(8).max(400) }));
    await webSearch(id, key, "spaced repetition", { count: 1, fetch, signal: c.req.raw.signal });
    secrets.remove(searchSecret(id));
    secrets.add(searchSecret(id), key);
    settings.update({ webSearch: id });
    return c.json(view());
  });
  app.patch("/search-providers", async (c) => {
    const { provider } = await body(c, z.object({ provider: z.enum(SEARCH_PROVIDERS).nullable() }));
    settings.update({ webSearch: provider && secrets.has(searchSecret(provider)) ? provider : null });
    return c.json(view());
  });
  app.delete("/search-providers/:id/key", (c) => {
    const id = z.enum(SEARCH_PROVIDERS).parse(c.req.param("id"));
    secrets.remove(searchSecret(id));
    if (settings.get().webSearch === id) settings.update({ webSearch: null });
    return c.json(view());
  });

  app.post("/folders/:id/research", async (c) => {
    const { topic } = await body(c, z.object({ topic: z.string().trim().min(3).max(2000) }));
    return c.json(researcher.start(c.req.param("id"), topic), 201);
  });
}
