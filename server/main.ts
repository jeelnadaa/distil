import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openDb } from "./db.ts";
import { createFonts } from "./fonts.ts";
import { createJobs } from "./jobs.ts";
import { createApp } from "./http.ts";
import { createLibrary } from "./library.ts";
import { registerExtraction } from "./ledger/extract.ts";
import { createLedger } from "./ledger/store.ts";
import { createLearner } from "./learning/learner.ts";
import { registerIngest } from "./materials/ingest.ts";
import { createMaterials } from "./materials/store.ts";
import { createMessages } from "./messages.ts";
import { createBriefs } from "./plan/brief.ts";
import { chatContext } from "./plan/context.ts";
import { registerPlanner } from "./plan/planner.ts";
import { createLocalModels } from "./retrieval/local.ts";
import { createRetrieval, queueIndexing, registerIndexing } from "./retrieval/retrieve.ts";
import { registerModelDownload } from "./retrieval/routes.ts";
import { createVectors } from "./retrieval/vectors.ts";
import { createSearch } from "./materials/search.ts";
import { createPlans } from "./plan/store.ts";
import { createTeacher } from "./teach/engine.ts";
import { createTeachStore } from "./teach/store.ts";
import { createVisuals } from "./visuals/builder.ts";
import { createPractice } from "./practice/engine.ts";
import { createPapers } from "./practice/store.ts";
import { createCards } from "./retention/cards.ts";
import { createRetention } from "./retention/engine.ts";
import { createProviders } from "./providers/service.ts";
import { createSecrets } from "./secrets.ts";
import { createResearcher } from "./research/researcher.ts";
import { createSettings } from "./settings.ts";
import type { FetchFn } from "./materials/web.ts";
import { createUsage } from "./usage.ts";
import { applyPendingRestore, createBackup } from "./backup.ts";
import type { Updates } from "./updates.ts";
import { createTutorial } from "./tutorial/tutorial.ts";

export const defaultDataDir = () => process.env.DISTIL_DATA_DIR ?? join(homedir(), "Distil");

// Wires the stores to the HTTP app. Shared by the production server and the Vite dev server.
// fetch: replaced in tests so links resolve without the network. restart and updates: from the desktop launcher.
export function createServer({ port, dataDir = defaultDataDir(), fetch, restart, updates }: { port: number; dataDir?: string; fetch?: FetchFn; restart?: () => void; updates?: Updates }) {
  mkdirSync(dataDir, { recursive: true });
  const log = (msg: string) => console.error(`[distil] ${msg}`);
  applyPendingRestore(dataDir, log);
  const db = openDb(join(dataDir, "distil.db"));
  const settings = createSettings(db);
  const messages = createMessages(db);
  messages.recoverInterrupted();
  const library = createLibrary(db);
  library.removeEmptyChats();
  const tutorial = createTutorial({ db, library, messages });
  tutorial.addOnce();
  const materials = createMaterials(db, join(dataDir, "materials"));
  const jobs = createJobs(db, { log });
  const ledger = createLedger(db);
  const usage = createUsage(db);
  const secrets = createSecrets(join(dataDir, "secrets.json"));
  const providers = createProviders(settings, secrets);
  const search = createSearch(db);
  const local = createLocalModels(join(dataDir, "models"));
  const vectors = createVectors(db);
  const retrieval = createRetrieval({ db, search, vectors, local, providers, settings, usage, log });
  registerIndexing(jobs, retrieval);
  // A fresh download may be another variant of the model, so its old vectors are dropped and rebuilt.
  registerModelDownload(jobs, local, (size) => {
    vectors.drop(`local:${size}`);
    const e = settings.get().embeddings;
    if (e.mode === "local" && e.size === size) queueIndexing(jobs, retrieval);
  });
  registerIngest(jobs, materials, ledger, () => queueIndexing(jobs, retrieval));
  registerExtraction(jobs, { providers, settings, usage, materials, ledger });
  const learner = createLearner(db);
  const plans = createPlans(db);
  const briefs = createBriefs(db);
  registerPlanner(jobs, { providers, settings, usage, db, plans, briefs, learner });
  const cards = createCards(db);
  const retention = createRetention({ providers, settings, usage, db, jobs, ledger, plans, learner, retrieval, cards });
  const teacher = createTeacher({ providers, settings, usage, db, library, messages, plans, ledger, learner, retrieval, teach: createTeachStore(db), log, onLessonDone: retention.lessonDone });
  const visuals = createVisuals({ providers, settings, usage, db, library, messages, log });
  const practice = createPractice({ providers, settings, usage, db, jobs, library, ledger, plans, learner, retrieval, papers: createPapers(db) });
  const researcher = createResearcher({ providers, settings, usage, jobs, materials, secrets, fetch });
  const deps = {
    dataDir,
    allowedHosts: [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`],
    library,
    messages,
    settings,
    usage,
    fonts: createFonts(join(dataDir, "fonts")),
    materials,
    search,
    local,
    vectors,
    retrieval,
    ledger,
    learner,
    db,
    plans,
    briefs,
    jobs,
    providers,
    teacher,
    visuals,
    practice,
    retention,
    cards,
    researcher,
    secrets,
    backup: createBackup({ db, dataDir }),
    tutorial,
    restart,
    updates,
    context: chatContext(db, retention.digest),
    log,
    fetch,
  };
  return { app: createApp(deps), db, jobs };
}
