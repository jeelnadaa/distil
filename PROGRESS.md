# PROGRESS

Living status log. Update in the same commit as every change.

## Current phase

**Phase 1 — Foundation** complete (2026-10-31). Phase 2 — Materials & Coverage Ledger is next.

## Next up

1. Phase 2 (`plan.md` §15): material upload and parsing, the Coverage Ledger, and the workspace view.
2. Owner smoke test with a real key (Settings › Providers); only a local fake endpoint has been used so far.

## Phase checklist

- [x] Phase 0a — Study the LearnHarness reference and draft `plan.md`
- [x] Phase 0b — Owner approves `plan.md`
- [x] Phase 0c — `DESIGN.md` written and approved
- [x] Phase 0d — Logo chosen: Condense
- [x] Phase 0e — Landing page and app mock-ups built and approved
- [x] Phase 1 — Foundation
- [ ] Phase 2 — Materials & Coverage Ledger
- [ ] Phase 3 — Study Plan
- [ ] Phase 4 — Teach
- [ ] Phase 5 — Interactives
- [ ] Phase 6 — Practice & Exams
- [ ] Phase 7 — Retention
- [ ] Phase 8 — Providers+ & usage dashboard
- [ ] Phase 9 — Ship

## Log

### 2026-10-31
- Studied https://github.com/amosblomqvist/learnharness (README, vision, teaching theory, build plan, architecture: practice, subscriptions, compaction/accounting).
- Owner Q&A recorded in `plan.md` §2: local-first open source; exhaustive coverage ledger; interactivity dial; Google login opt-in with warning; all four modes; optional deadline mode; knowledge graph + flashcards/SRS + mastery + streaks; all input types; folders as subject workspaces, 5 levels; caps warn then hard-stop; ideas only from LearnHarness (own code).
- Created `plan.md`, `AGENTS.md`, `CLAUDE.md`, `PROGRESS.md`, `README.md`; initialised git.

- Product named **Distil** (owner decision); `plan.md` §2 and §18 updated, README retitled.
- Drafted `DESIGN.md`: Satoshi + Instrument Serif + JetBrains Mono, warm paper/ink palette with one copper accent (all text pairs AA, measured), spring and duration motion tokens, signature moments, UX flows F1–F9, key screens S1–S9.

- Built clickable mock-ups in `design/` (static HTML/CSS/ES modules, no deps): landing page with interactive hero and scroll-driven sections; app screens Teach, Today, Workspace/Ledger, Plan, Exam, Review, Usage, Settings; modal gallery (onboarding, palette, brief questions, recap, Fully distilled, cap, Google warning, deletes). Light/dark, reduced motion, mobile checked.
- Satoshi licence forbids repo distribution: font files gitignored, fetched by `design/scripts/fetch-fonts.sh`.
- Mock-ups approved in principle; copper liked. Added four alternative palettes (Verdigris, Oxblood, Cobalt, Citron), AA-checked, with a comparison page and a live switcher on every mock-up.
- Palettes decided: all five ship, Copper default, picked in Settings › Appearance (mock-up updated; review switcher removed).
- Logo: three directions (Condense, Drop-d, Converge) with colour, app-icon, mono and animated SVGs, a review page, and an in-app preview switch. Recommended Drop-d.
- Owner approved the design. Decisions: Condense logo (alternatives removed), dark theme on first run, Ask mode gets the lighter conversational treatment (owner left it to design). Phase 0 complete.

### 2026-10-31 · Phase 1
- Stack chosen (see `AGENTS.md` §4): Node 24 + TypeScript without a build step, Hono, `node:sqlite`, Zod, Svelte 5 + Vite, Vitest.
- Server foundation: SQLite schema with migrations; library with the 5-level depth rule enforced on create and move (F-001, F-004); messages with crash recovery (F-1306); settings with model slots (F-401) and caps; keys in a user-only `secrets.json`, masked in every response (F-1206); streaming adapters for OpenAI-compatible, Anthropic and Gemini with real usage (F-1201, F-1202, F-1101); chat turns with cap pre-check, abort and estimated usage when a provider reports none (F-1104, F-1105, F-407); auto-naming on the cheap slot that never overrides a manual title (F-005). API refuses foreign hosts, cross-origin calls and non-JSON writes. 34 tests.
- Web app (`web/`): sidebar library tree (create, rename, move by menu or drag, delete with counts, nesting to 5 levels), Ask chat with streaming, stop, retry, inline rename, per-chat model picker, chat token meter with context fill, cap warning banner and cap-reached dialog; home onboarding to a free Google AI Studio key; Settings for providers (test-and-save keys, custom OpenAI-compatible endpoints), model slots, token caps (global and per provider, "200k" style input), theme, palette, motion and data folder. Markdown with KaTeX maths (`$…$`, `\(…\)`, `$$…$$`, `\[…\]`, prices left alone) and highlighted code; raw HTML never rendered.
- Verified in the browser against a local fake OpenAI-compatible server: folder → chat → streamed reply with maths, table and code; auto-named; usage recorded and shown; stop keeps the partial reply; a 1k daily cap blocks the next send. Checked at 1440 px, 1024 px and phone width. 38 tests.

### 2026-10-31 · Owner decisions and text font
- Generated visuals must use Distil's design language: specified as plan.md §7.5 (compact widget grammars with semantic styling only, data-only graph and plan map, restricted SVG with a sanitiser, a Distil kit plus design lint for mini-apps; F-751…F-760) and DESIGN.md §8.1 (renderer rules). Lands in Phases 3, 5 and 7.
- Owner answers recorded in plan.md §2: MIT licence (LICENSE added), mastery shown as level + percent and configurable (F-914), gamification off by default (F-934), sibling chats share a compact ledger/graph digest with an "Independent" switch (F-925), practice grading counts the first attempt then allows hinted retries while exams stay one attempt (F-804), suggested model per role (F-1210).
- Text font setting (F-1309, DESIGN.md §3): Satoshi, Anthropic Sans (used only if installed; never bundled) or Custom (installed family name, or an uploaded .woff2/.woff/.ttf/.otf kept in the data folder and checked by file signature, 8 MB max). It swaps `--font-text` everywhere; display and mono stay. Verified in the browser with an installed font and an uploaded one.
- Fixed: delete calls resolved to `undefined`, which `attempt()` read as failure, so removing a key or font skipped its follow-up. Deep links into Settings now jump to the section instead of starting a smooth scroll. 44 tests.

## Open questions

See `plan.md` §18.

## Known issues

- Custom installed fonts are found by family name. Chromium (the desktop build) sees user-installed fonts; Safari only exposes system fonts.
- Only tested against a local fake model; a real-provider smoke test is still owed (needs the owner's key).
- The web bundle is one 614 kB chunk (KaTeX and highlight.js). Fine when served locally; split it if load time ever matters.

- Caps are in tokens only. Cost caps need per-model prices; planned with the usage dashboard (Phase 8).
- A cap is checked before each request, so one reply already in flight can finish past 100 %.
- Keys are in a user-only file, not yet the OS credential store; the desktop build (Phase 9) moves them.
- `npm audit`: two low-severity advisories in a build-time dependency of the Svelte Vite plugin (deepmerge); nothing ships to users.
