import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openDb } from "./db.ts";
import { createFonts } from "./fonts.ts";
import { createJobs } from "./jobs.ts";
import { createApp } from "./http.ts";
import { createLibrary } from "./library.ts";
import { registerIngest } from "./materials/ingest.ts";
import { createMaterials } from "./materials/store.ts";
import { createMessages } from "./messages.ts";
import { createProviders } from "./providers/service.ts";
import { createSecrets } from "./secrets.ts";
import { createSettings } from "./settings.ts";
import { createUsage } from "./usage.ts";

export const defaultDataDir = () => process.env.DISTIL_DATA_DIR ?? join(homedir(), "Distil");

// Wires the stores to the HTTP app. Shared by the production server and the Vite dev server.
export function createServer({ port, dataDir = defaultDataDir() }: { port: number; dataDir?: string }) {
  mkdirSync(dataDir, { recursive: true });
  const db = openDb(join(dataDir, "distil.db"));
  const settings = createSettings(db);
  const messages = createMessages(db);
  messages.recoverInterrupted();
  const log = (msg: string) => console.error(`[distil] ${msg}`);
  const materials = createMaterials(db, join(dataDir, "materials"));
  const jobs = createJobs(db, { log });
  registerIngest(jobs, materials);
  const deps = {
    dataDir,
    allowedHosts: [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`],
    library: createLibrary(db),
    messages,
    settings,
    usage: createUsage(db),
    fonts: createFonts(join(dataDir, "fonts")),
    materials,
    jobs,
    providers: createProviders(settings, createSecrets(join(dataDir, "secrets.json"))),
    log,
  };
  return { app: createApp(deps), db, jobs };
}
