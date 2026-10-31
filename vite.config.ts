import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { getRequestListener } from "@hono/node-server";
import { fileURLToPath } from "node:url";

// One process in development: Vite serves the UI and mounts the API at /api.
export default defineConfig({
  root: "web",
  publicDir: fileURLToPath(new URL("design/assets", import.meta.url)),
  plugins: [
    svelte(),
    {
      name: "distil-api",
      async configureServer(server) {
        const { createServer } = await import("./server/main.ts");
        const { app } = createServer({ port: server.config.server.port ?? 5173 });
        const listener = getRequestListener(app.fetch);
        server.middlewares.use((req, res, next) => (req.url?.startsWith("/api/") ? listener(req, res) : next()));
      },
    },
  ],
  server: { port: 5173, strictPort: true, host: "127.0.0.1" },
  // Served from the local machine, so one bundle (KaTeX and highlight.js included) is fine.
  build: { outDir: "../dist", emptyOutDir: true, chunkSizeWarningLimit: 1000 },
});
