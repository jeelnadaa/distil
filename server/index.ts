// Production entry: serves the built UI and the API on localhost only. Run `npm run build` first.
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { Hono } from "hono";
import { createServer } from "./main.ts";

const port = Number(process.env.PORT ?? 4321);
const root = "./dist";
if (!existsSync(`${root}/index.html`)) {
  console.error("No built UI in ./dist. Run `npm run build` first, or `npm run dev` while developing.");
  process.exit(1);
}

const { app: api } = createServer({ port });
const app = new Hono()
  .route("/", api)
  .use("*", serveStatic({ root }))
  .get("*", serveStatic({ root, path: "index.html" }));

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  console.log(`Distil is running at http://localhost:${port}`);
});
