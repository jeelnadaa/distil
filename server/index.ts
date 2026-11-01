// Production entry: serves the built UI and the API on localhost only. Run `npm run build` first.
// The desktop launcher (desktop/launcher.mjs) runs this with DISTIL_SUPERVISED set, so a restart is an
// exit it starts the server again after, and with DISTIL_INSTALL_DIR, which turns on auto-update.
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { RESTART_CODE } from "./app-routes.ts";
import { createServer } from "./main.ts";
import { createUpdates } from "./updates.ts";

const port = Number(process.env.PORT ?? 4321);
// serveStatic wants a path relative to the working directory.
const root = relative(process.cwd(), fileURLToPath(new URL("../dist", import.meta.url))) || ".";
if (!existsSync(join(root, "index.html"))) {
  console.error("No built UI in ./dist. Run `npm run build` first, or `npm run dev` while developing.");
  process.exit(1);
}

const installDir = process.env.DISTIL_INSTALL_DIR;
const feedFile = installDir && join(installDir, "update-feed.txt");
const updates = installDir
  ? createUpdates({ installDir, feedUrl: feedFile && existsSync(feedFile) ? readFileSync(feedFile, "utf8").trim() || null : null })
  : undefined;
const restart = process.env.DISTIL_SUPERVISED ? () => process.exit(RESTART_CODE) : undefined;

const { app: api } = createServer({ port, restart, updates });
const app = new Hono()
  .route("/", api)
  .use("*", serveStatic({ root }))
  .get("*", serveStatic({ root, path: "index.html" }));

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  console.log(`Distil is running at http://localhost:${port}`);
  updates?.schedule();
});
