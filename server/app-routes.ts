import type { Hono } from "hono";
import { AppError } from "./errors.ts";
import type { AppDeps } from "./http.ts";
import { APP_VERSION } from "./version.ts";

// The app itself: its version, backup and restore (F-1304), and a restart when the desktop launcher
// runs the server (it starts it again when it exits with RESTART_CODE).

export const RESTART_CODE = 75;

export function registerAppRoutes(app: Hono, { backup, restart, updates }: AppDeps) {
  const view = () => ({ version: APP_VERSION, canRestart: !!restart, restore: backup.pending(), update: updates?.status() ?? null });
  app.get("/app", (c) => c.json(view()));
  app.post("/app/restart", (c) => {
    if (!restart) throw new AppError(409, "no_restart", "Close Distil and open it again.");
    setTimeout(restart, 200);
    return c.json({ ok: true });
  });

  // Installing runs in the background; the page follows it through GET /app.
  app.post("/app/update/check", async (c) => {
    if (!updates) throw new AppError(409, "no_updates", "Updates come with the installed app.");
    await updates.check();
    return c.json(view());
  });
  app.post("/app/update/install", (c) => {
    if (!updates) throw new AppError(409, "no_updates", "Updates come with the installed app.");
    if (updates.status().state !== "available") throw new AppError(409, "no_update", "There's no update to install.");
    void updates.install();
    return c.json(view());
  });

  app.get("/backup", (c) => {
    const it = backup.exportZip();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await it.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      },
      async cancel() { await it.return(undefined); },
    });
    c.header("content-type", "application/zip");
    c.header("content-disposition", `attachment; filename="distil-backup-${new Date().toISOString().slice(0, 10)}.zip"`);
    return c.body(stream);
  });
  app.post("/backup/restore", async (c) => {
    if (!c.req.raw.body) throw new AppError(400, "no_file", "Choose a backup file.");
    await backup.stage(c.req.raw.body);
    return c.json(view());
  });
  app.delete("/backup/restore", (c) => {
    backup.cancel();
    return c.json(view());
  });
}
