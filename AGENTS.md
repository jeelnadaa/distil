# AGENTS.md — directions for coding agents

Read this file fully before doing anything in this repo.

## 1. Start of every session

1. Read `PROGRESS.md` — it says which phase we are in, what is done, and what is next.
2. Read `plan.md` — the approved scope. Feature IDs (`F-xxx`) are the shared vocabulary.
3. Read `DESIGN.md` once it exists — UX and visual rules. Do not invent UI that contradicts it.
4. Continue from the "Next up" item in `PROGRESS.md`. Do not start a later phase early.

## 2. Workflow rules

- **Work in phases** as defined in `plan.md` §15. One phase at a time, on `main` (owner, 2026-11-01).
- **Ask, don't assume.** If a product decision is not covered by `plan.md` / `DESIGN.md`, ask the owner. Record the answer in `plan.md` §2 (Decisions) before acting on it.
- **Commit, never push.** Commit each finished feature or coherent step locally with a clear message referencing feature IDs (e.g. `feat(ledger): recall audit loop (F-302)`). Never `git push`.
- **Docs move with code.** In the same commit as the feature, update:
  - `PROGRESS.md` — tick the feature, update "Next up", note decisions and known issues.
  - `README.md` — when user-visible behaviour, setup, or features change.
  - `AGENTS.md` — when a convention or workflow rule changes.
  - `plan.md` — only when the owner changes scope.
- **Never copy code from LearnHarness.** Ideas only (owner decision). Credit lives in `README.md`.

## 3. Code standards

- Minimal, clean, production-level. No dead code, no speculative abstractions, no commented-out blocks.
- Small modules with one responsibility. Match the surrounding code's naming and comment density.
- **LLMs judge, code enforces.** Any guarantee (coverage, caps, schema) is checked by deterministic code, never trusted to a model.
- All LLM structured outputs are schema-validated; on failure, retry with the validation error.
- Secrets (API keys, OAuth tokens) never appear in logs, URLs, test fixtures, or committed files.
- Every feature ships with tests for its deterministic logic. Tests must not call real LLMs or the network.
- Keep the app runnable after every commit.

## 4. Stack and commands

- **Node ≥ 24**, TypeScript run natively (type stripping): only erasable syntax, no enums or parameter properties, import with `.ts` extensions.
- **Server:** Hono on `@hono/node-server`, SQLite via built-in `node:sqlite`, Zod for every request body and stored setting.
- **UI:** Svelte 5 + Vite (`web/`). In dev the API is mounted inside Vite, so `npm run dev` is the only process.
- `npm run dev` · `npm test` · `npm run check` (tsc + svelte-check) · `npm run build` then `npm start` (serves `dist/` and the API on `127.0.0.1:4321`).
- Data lives in `DISTIL_DATA_DIR` (default `~/Distil`): `distil.db` and `secrets.json`. Point it at a scratch folder when testing by hand.
- Svelte 5 gotcha: `$state(new Set())` is not reactive; use `SvelteSet`/`SvelteMap` from `svelte/reactivity`.
- Generated visuals never carry styling: models emit grammars or data, and renderers apply tokens (plan.md §7.5, DESIGN.md §8.1). Don't add a prompt or renderer that accepts colours, fonts or CSS from a model.
- To test chat without a real key, run `node scripts/fake-llm.mjs` and add `http://127.0.0.1:11999/v1` as a custom endpoint in Settings › Providers.

## 5. Repository map

| Path | Purpose |
|---|---|
| `plan.md` | Product scope, decisions, phases, feature IDs |
| `DESIGN.md` | UX flows, screens, visual system, motion tokens (approved) |
| `PROGRESS.md` | Living status log — the hand-off between sessions |
| `README.md` | User-facing overview, setup, credits |
| `AGENTS.md` | This file |
| `CLAUDE.md` | Pointer to this file |
| `design/` | Clickable design mock-ups (landing, app screens, dialogs) on the real tokens; open `design/index.html` |
| `design/assets/logo/` | Approved logo SVGs: colour, `-icon` (favicon/app tile), `-mono`, `-animated` (geometry mirrors `design/js/brand.js`) |
| `design/scripts/fetch-fonts.sh` | Downloads Satoshi (licence forbids committing it) |
| `server/` | Local API (Node 24 runs the TypeScript directly): SQLite store, library, chat turns, providers, usage and caps |
| `server/providers/` | Streaming adapters (OpenAI-compatible, Anthropic, Gemini), catalog and key-checked service |
| `server/fonts.ts` | Saved text fonts (F-1309) in `<data>/fonts/`: installed families by name and uploaded files (validated by signature), each under a name |
| `server/secrets.ts` | API keys in `<data>/secrets.json`: several labelled keys per provider, first is the default |
| `server/materials/` | Phase 2 ingest: `store` (copies in `<data>/materials/`, re-import keeps unchanged chunks), `parse` (PDF, DOCX, PPTX, Markdown, text, images; flags visual pages), `chunk`, `ingest` (parse job), `render` (PDF pages to JPEG for vision), `web` (links → article Markdown or file), `youtube` (transcripts: Gemini or pasted), `search` (FTS5 keyword index, anchored hits) |
| `server/ledger/` | Coverage Ledger: `store` (items, sources, merge candidates) and `extract` (extract → audit → merge job, estimate) |
| `server/retrieval/` | Phase 4 retrieval (F-1004, F-1005): `local` (local embedding models: size check, download after consent, graphics card through DirectML on Windows with the processor as fallback), `vectors` (chunk vectors per model, cosine), `retrieve` (keyword + meaning merged by reciprocal rank fusion, passages for lesson items, indexing job with quota backoff), `routes` |
| `server/plan/` | Phase 3 Study Plan: `brief` (Brief Compiler, nearest brief, F-105 text), `planner` (part-by-part plan job, code-enforced coverage via `coverage`), `dag`, `sections`, `schedule` (deadline days, drift, re-balance), `store`, `view`, `today`, `export` (Markdown, iCalendar), `context` (the brief each Q&A turn knows), `routes` |
| `server/teach/` | Phase 4 Teach: `engine` (lesson sessions: step planning, probe, streamed teaching with `<check>` extraction, grading, repairs, recap), `checks` (check types, shuffles, grading), `prompts` (teacher and step planner), `store` (sessions and checks), `routes` (SSE endpoints) |
| `server/visuals/` | Phase 5 visuals (plan.md §7.5): `grammar/` (widget grammars and parsers), `lint`, `sanitize` (SVG), `reference` (prompt text per dial), `blocks` (fenced blocks), `repair` (one cheap fix per broken block), `kit` (sandbox document, Distil kit), `builder` (mini-apps and figures, versions, fixes), `routes` |
| `server/learning/` | Shared by every learning mode: `types.ts` (Study Brief schema, item statuses, evidence kinds, chat modes) and `learner.ts` (evidence per item; statuses only move forward) |
| `scripts/fake-llm.mjs` | Fake OpenAI-compatible model for checking screens by hand without a real key |
| `server/jobs.ts` | Background job runner backed by SQLite (resumes after restart) |
| `server/llm.ts` | One-shot model calls for agents: walks the slot's fallback list (rate limit, outage, quota, cap → next entry; waits only when all are busy), usage by role, images and videos, validated JSON with one retry |
| `server/constants.ts` | Limits shared with the browser (no Node imports) |
| `web/src/components/` | Svelte screens and parts: `App`, `Sidebar`/`Tree`, `ChatView`, `SettingsView`, `Home` (the one new-chat screen), `ActivityDock`, `PlanTab`/`PlanMap`/`BriefForm` (Study Plan), `TodayView`, `LessonProgress` (lesson chat ring button and dialog), `LessonView`/`CheckCard` (the lesson screen), `EmbeddingsSetting` (search by meaning in Settings › Models), `CoverageBars`, `DialSelect` (interactivity dial), `visuals/` (one component per widget, `Widget` frame, `Built` + `Sandbox` for mini-apps and figures, `Code` runner), `Select` (themed dropdown; use it, never `<select>`), `Tooltip` (reads `data-tip`), `SoundButton` (study sounds), dialogs |
| `web/src/lib/` | `api.ts` (typed client, SSE), `state.svelte.ts` (app state, routes `#/new/:folderId`, `#/chat/:id`, `#/folder/:id/:tab` (materials, ledger, plan), `#/today`, `#/material/:id/:loc/:item`, `#/settings/:section`), `markdown.ts`, `prefs.ts`, `icons.ts`, `viewer.ts` (sections, quote ranges, location labels), `activity.svelte.ts` (jobs for the activity panel), `sound.svelte.ts` (generated study sounds, Web Audio), `wheel.ts` (wheel scrolls horizontal strips), `visuals.ts` (reply segments, theme CSS for sandboxes) |
| `web/src/styles/` | Design tokens, palettes, base and shell CSS ported from `design/` |
| `test/` | Vitest suites; fake fetch and scripted models, never real LLMs or the network |
| `.claude/launch.json` | Preview servers: `app` (Vite dev, 5173) and `design` (mock-ups, 4173) |

Extend this table as code directories are created.
