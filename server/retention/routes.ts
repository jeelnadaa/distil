import type { Hono } from "hono";
import { z } from "zod";
import { type AppDeps, body } from "../http.ts";
import { CARD_KINDS } from "./cards.ts";
import { preview } from "./fsrs.ts";

// Retention API (Phase 7): cards and reviews, a folder's progress and knowledge graph, streak and XP.

const Text = (max: number) => z.string().trim().min(1).max(max);

export function registerRetentionRoutes(app: Hono, { retention, cards, settings }: AppDeps) {
  app.get("/folders/:id/cards", (c) => c.json(cards.list(c.req.param("id"))));
  app.post("/folders/:id/cards", async (c) => {
    const b = await body(c, z.object({ kind: z.enum(CARD_KINDS).default("basic"), front: Text(2000), back: Text(4000), itemId: z.string().min(1).nullable().default(null) }));
    return c.json(cards.create({ folderId: c.req.param("id"), ...b, origin: "manual" }), 201);
  });
  app.post("/folders/:id/cards/generate", async (c) => {
    const { items } = await body(c, z.object({ items: z.array(z.string().min(1)).max(2000).optional() }));
    return c.json({ job: retention.generate(c.req.param("id"), items) });
  });
  app.get("/folders/:id/cards.tsv", (c) => {
    c.header("content-type", "text/tab-separated-values; charset=utf-8");
    c.header("content-disposition", `attachment; filename="distil-cards.txt"`);
    return c.body(cards.exportTsv(c.req.param("id")));
  });
  app.post("/folders/:id/cards/import", async (c) => {
    const { text } = await body(c, z.object({ text: z.string().min(1).max(5_000_000) }));
    return c.json({ imported: cards.importTsv(c.req.param("id"), text) });
  });
  app.patch("/cards/:id", async (c) => c.json(cards.update(c.req.param("id"), await body(c, z.object({ front: Text(2000).optional(), back: Text(4000).optional(), kind: z.enum(CARD_KINDS).optional() })))));
  app.delete("/cards/:id", (c) => { cards.remove(c.req.param("id")); return c.body(null, 204); });

  app.get("/review", (c) => c.json(cards.queue(c.req.query("folder") || null)));
  app.post("/cards/:id/review", async (c) => {
    const { grade } = await body(c, z.object({ grade: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) }));
    // With fresh interval hints, for a card that comes round again in the same session.
    const card = retention.review(c.req.param("id"), grade);
    return c.json({ ...card, preview: preview(card.state, Date.now()) });
  });
  app.post("/cards/:id/explain", async (c) => {
    await body(c, z.object({}));
    return c.json({ text: await retention.explain(c.req.param("id"), c.req.raw.signal) });
  });

  app.get("/folders/:id/progress", (c) => c.json(retention.progress(c.req.param("id"))));
  app.get("/folders/:id/graph", (c) => c.json(retention.graph(c.req.param("id"), c.req.query("unit") || null)));
  app.post("/folders/:id/graph", async (c) => {
    const { unit } = await body(c, z.object({ unit: z.string().min(1).nullable().default(null) }));
    return c.json(retention.buildGraph(c.req.param("id"), unit));
  });
  // Streak and XP exist only when the learner switched them on (F-934).
  app.get("/stats", (c) => c.json(settings.get().gamification ? retention.stats() : null));
}
