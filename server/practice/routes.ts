import type { Hono } from "hono";
import { z } from "zod";
import { type AppDeps, body } from "../http.ts";
import { AnswerBody, NewPaper } from "./engine.ts";

// Practice and exam API (Phase 6). A paper lives on its chat; writing and exam marking run as jobs.

const Elapsed = z.number().min(0).max(24 * 60 * 60 * 1000);

export function registerPracticeRoutes(app: Hono, { practice }: AppDeps) {
  app.get("/folders/:id/papers", (c) => c.json(practice.list(c.req.param("id"))));
  app.post("/folders/:id/papers", async (c) => c.json(practice.create(c.req.param("id"), await body(c, NewPaper)), 201));

  app.get("/chats/:id/paper", (c) => c.json(practice.view(c.req.param("id"))));
  app.post("/chats/:id/paper/start", async (c) => {
    await body(c, z.object({}));
    return c.json(practice.start(c.req.param("id")));
  });
  app.put("/chats/:id/paper/progress", async (c) => {
    const b = await body(c, z.object({ questionId: z.string().min(1).optional(), answer: AnswerBody.optional(), timeMs: Elapsed.optional(), elapsedMs: Elapsed }));
    return c.json(practice.save(c.req.param("id"), b));
  });
  app.post("/chats/:id/paper/questions/:qid/answer", async (c) => {
    const { answer, timeMs } = await body(c, z.object({ answer: AnswerBody, timeMs: Elapsed.default(0) }));
    return c.json(await practice.answer(c.req.param("id"), c.req.param("qid"), answer, timeMs, c.req.raw.signal));
  });
  app.post("/chats/:id/paper/questions/:qid/hint", async (c) => {
    await body(c, z.object({}));
    return c.json(practice.hint(c.req.param("id"), c.req.param("qid")));
  });
  app.post("/chats/:id/paper/questions/:qid/reveal", async (c) => {
    await body(c, z.object({}));
    return c.json(practice.reveal(c.req.param("id"), c.req.param("qid")));
  });
  app.post("/chats/:id/paper/submit", async (c) => {
    const { elapsedMs } = await body(c, z.object({ elapsedMs: Elapsed.default(0) }));
    return c.json(await practice.submit(c.req.param("id"), elapsedMs, c.req.raw.signal));
  });
  app.post("/chats/:id/paper/retry", async (c) => {
    await body(c, z.object({}));
    return c.json(practice.retry(c.req.param("id")));
  });
}
