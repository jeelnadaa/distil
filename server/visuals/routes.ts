import type { Hono } from "hono";
import { z } from "zod";
import { AppError, notFound } from "../errors.ts";
import { type AppDeps, body } from "../http.ts";
import { repairVisuals } from "./repair.ts";

// Built visuals (F-721, F-725): every version of a reply's mini-apps and figures, building one on first view.
export function registerVisualRoutes(app: Hono, deps: AppDeps) {
  const { visuals, messages, library } = deps;
  app.get("/messages/:id/visuals", (c) => c.json(visuals.list(c.req.param("id"))));
  app.post("/messages/:id/visuals", async (c) => {
    const { block, rebuild } = await body(c, z.object({ block: z.number().int().min(0).max(50), rebuild: z.boolean().default(false) }));
    return c.json(await visuals.build(c.req.param("id"), block, rebuild, c.req.raw.signal));
  });
  // Retry on a block that couldn't be drawn (F-758): one more repair of the reply's broken blocks.
  app.post("/messages/:id/repair", async (c) => {
    await body(c, z.object({}));
    const message = messages.get(c.req.param("id"));
    if (!message) throw notFound("Message");
    if (message.role !== "assistant" || message.status !== "done") throw new AppError(400, "not_repairable", "Only a finished reply can be redrawn.");
    const content = await repairVisuals(deps, message.content, library.getChat(message.chatId).folderId, c.req.raw.signal);
    if (content !== message.content) messages.finish(message.id, content, "done");
    return c.json({ ...message, content });
  });
  app.post("/visuals/:id/fix", async (c) => {
    const { errors } = await body(c, z.object({ errors: z.array(z.string().max(500)).min(1).max(10) }));
    return c.json(await visuals.fix(c.req.param("id"), errors, c.req.raw.signal));
  });
}
