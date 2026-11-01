import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { type AppDeps, body } from "../http.ts";
import { ACTIONS, type ActionKind, Answer, type TeachEvent } from "./engine.ts";

// Teach API (Phase 4): the lesson session's state, and each move in it streamed as server-sent events.
// Closing the connection aborts the teacher's reply (F-407).

const stream = (c: Context, events: AsyncGenerator<TeachEvent>) => streamSSE(c, async (out) => {
  for await (const event of events) {
    if (!out.aborted) await out.writeSSE({ data: JSON.stringify(event) });
  }
});

export function registerTeachRoutes(app: Hono, { teacher }: AppDeps) {
  app.get("/chats/:id/teach", (c) => c.json(teacher.view(c.req.param("id"))));
  app.post("/chats/:id/teach/start", async (c) => {
    await body(c, z.object({}));
    return stream(c, await teacher.start(c.req.param("id"), c.req.raw.signal));
  });
  app.post("/chats/:id/teach/answer", async (c) => {
    const answer = await body(c, Answer);
    return stream(c, await teacher.answer(c.req.param("id"), answer, c.req.raw.signal));
  });
  app.post("/chats/:id/teach/action", async (c) => {
    const { kind } = await body(c, z.object({ kind: z.enum(Object.keys(ACTIONS) as [ActionKind, ...ActionKind[]]) }));
    return stream(c, await teacher.action(c.req.param("id"), kind, c.req.raw.signal));
  });
  app.post("/chats/:id/teach/ask", async (c) => {
    const { text } = await body(c, z.object({ text: z.string().max(4000) }));
    return stream(c, await teacher.ask(c.req.param("id"), text, c.req.raw.signal));
  });
}
