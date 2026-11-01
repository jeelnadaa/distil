# PROGRESS

Living status log. Update in the same commit as every change.

## Current phase

**Phase 5 — Interactives** is next, on `main`.

## Next up

1. Phase 5 — Interactives: visuals and quiz widgets inside lessons (F-618's second half, F-708).
2. Still open from Phase 4 (should/could): opening recall questions from the previous lesson (F-614), predict-before-reveal prompts (F-608), dictation (F-615). Downloading a local embedding model has only been checked up to the consent dialog; the download itself waits for the owner's go-ahead.

## Phase checklist

- [x] Phase 0a — Study the LearnHarness reference and draft `plan.md`
- [x] Phase 0b — Owner approves `plan.md`
- [x] Phase 0c — `DESIGN.md` written and approved
- [x] Phase 0d — Logo chosen: Condense
- [x] Phase 0e — Landing page and app mock-ups built and approved
- [x] Phase 1 — Foundation
- [x] Phase 2 — Materials & Coverage Ledger
- [x] Phase 3 — Study Plan
- [x] Phase 4 — Teach
- [ ] Phase 5 — Interactives
- [ ] Phase 6 — Practice & Exams
- [ ] Phase 7 — Retention
- [ ] Phase 8 — Providers+ & usage dashboard
- [ ] Phase 9 — Ship
- [ ] Phase 10 — Tune (ledger and answer quality)

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

### 2026-10-31 · Phase 2 server
- Materials (F-201…F-206): uploads are copied into `<data>/materials/<id>/` (owner choice: copy, offer re-import), deduplicated by SHA-256, up to 200 MB. Local parsers for PDF (pdf.js, headings from font size, dehyphenation), DOCX (incl. tables and equations), PPTX (slides and speaker notes), Markdown and text. Structure-aware chunks of about 1200 tokens keep their page/slide range, heading path and per-location marks so a quote maps to its exact page.
- Background jobs (F-209, F-402, F-1306): rows in SQLite with params and progress, a concurrency limit, abort, and resume after restart.
- Extraction (F-207, F-302, F-303, F-405): owner choice "cheap pass + strong audit": the cheap model extracts each chunk, the strong model re-reads it against what was found (up to 2 rounds), then judges duplicate groups that code pre-clusters by title overlap (only unjudged items are sent; short ids keep prompts small). "Thorough" uses the strong model throughout. Replies are validated and retried once with the error. Each chunk's progress is saved, so a stopped or crashed job resumes where it was. Usage is recorded per role (extractor, auditor, merger) and caps are checked before every call.
- Ledger API (F-208, F-301, F-306, F-309): token estimate of the remaining work per strategy, extract-all for a folder subtree, "What did we miss?" re-audit, list (with subfolders), manual add, edit and mark (skip / known / out of scope), delete. Deleting or re-reading a material removes items that only it supported; manual items stay. 71 tests.

### 2026-10-31 · Phase 2 workspace
- Folder workspace (`#/folder/:id/materials|ledger`, opened by clicking a folder in the sidebar): drop zone and file picker, per-file status (reading, ready, distilling %, distilled), remove with confirmation; Distil pre-flight dialog with Balanced/Thorough and a token estimate (F-208); activity panel with the mini still and Stop; coverage panel with "What did we miss?" (audit-only estimate); ledger table grouped by source file with filters, marks (known / skip / out of scope), add and edit, source links to the cited page. Rows become cards on phones.
- Verified in the browser against the local fake model: upload, estimate, distil, live progress, ledger, marking; 1440 px and phone width with no horizontal scroll.
- Fixed: Markdown blocks covered a whole section, so every item cited the section's first line; blocks are now per paragraph. The ledger reloads after a failed action so a stale list catches up. 71 tests.

### 2026-10-31 · Real-provider smoke test (Google AI Studio, owner's key)
- Key saved and checked by the owner in Settings; model list loads.
- Chat on `gemini-3.5-flash`: streams, LaTeX renders, auto-named by `gemini-flash-lite-latest`, real usage recorded. Distil on the sample notes: 5 correctly typed items with correct line anchors, prose maths turned into LaTeX, audit clean in one round.
- Found: on the free tier `gemini-pro-latest` (3.1 Pro) has a quota of 0 (429), and `gemini-flash-latest` returned 503 "high demand"; both errors reached the learner as clear messages. Recorded under F-1210 (suggest Flash/Flash-Lite on the free tier, prefer pinned versions).
- Fixed: the extraction estimate ignored thinking tokens (said ~1.2k, used ~1.6k); it now adds an allowance per call and comes out at ~2.1k, on the high side as intended.

### 2026-10-31 · Material viewer (F-210)
- `#/material/:id/:loc/:item`: every ledger anchor and file name opens it. Text view for every format, one section per page/slide/line, scrolled to the cited location with the quote highlighted (CSS Custom Highlight API, no DOM changes); a rail lists the file's ledger items in reading order. PDFs also have an Original view drawn with pdf.js, loaded only on demand, pages drawn as they scroll into view, opened at the cited page.
- Why pdf.js and not the browser's PDF viewer: the built-in pane (and so potentially the desktop build) has none; it downloaded the file instead.
- Verified in the browser: Markdown and PDF, desktop and phone width. Fixed: the `hide-sm` top-bar rule had never been ported, so long crumbs pushed the title out on phones. 73 tests.

### 2026-10-31 · Phase 2 inputs and textbook test
- Retry with backoff for 429/5xx (honours "retry in Xs"; a wait over 2 minutes stops the job with `quota_exhausted`, resumable).
- Vision extraction (F-202, F-213): PDF pages whose content is drawn (operator list: any picture, or 80+ vector paths) are rendered server-side (pdf.js + @napi-rs/canvas, 1000 px JPEG) and sent with their text, up to 4 per call; photos and scans are image materials read entirely by the model. Gemini, OpenAI and Anthropic encodings tested.
- Distil one material or a page range ("chapters 1–2") from the Materials tab; the estimate counts page images.
- Web pages (F-203): a pasted link is fetched once and kept. HTML becomes Markdown of the main article (Readability + linkedom), with MathML/KaTeX/MathJax kept as LaTeX and citation markers and edit links dropped; links to PDFs, images and text are stored as those files. Verified on Wikipedia "Standard deviation": 53 display formulas render.
- YouTube (F-204): a dialog offers "Transcribe with Gemini" (Google's API takes the YouTube link; low media resolution, measured 96 tokens per second of video; on-screen formulas noted in LaTeX) or "Paste transcript" (YouTube's own transcript, grouped into timed paragraphs). Title from the public oEmbed endpoint. Verified with a real 19 s video.
- Re-import (F-212): "Replace with a new version" for files, "Fetch again" for pages (not videos). Unchanged sections keep their extraction progress and items, anchors move with them; the row shows new/changed sections and lists items removed with the old text.
- Textbook exit test: OpenStax *Introductory Statistics 2e* (CC BY 4.0, 847 pages, 555 chunks, 412 visual pages). Chapter 1 (pages 17–76): all 47 chunks extracted, 489 items (110 definitions, 90 examples, 164 facts, 29 procedures, …), maths in LaTeX where present. Usage so far ~113k cheap + ~55k strong tokens, in line with the 287k estimate. The audit stopped after 17 strong-model calls: `gemini-3.5-flash` free-tier daily quota.
- 91 tests.

### 2026-10-31 · Economy strategy and textbook chapters 1–2
- Owner chose to audit with Flash-Lite while the strong model's free quota is small: new **Economy** strategy (cheap model for extract, audit and merge), offered in the Distil dialog next to Balanced and Thorough.
- Fixed: a chunk whose audit rounds were used up before it was marked done (a run stopped in between) was skipped forever, so its material never reached 100 %.
- Chapters 1–2 (pages 17–176, 98 chunks) fully distilled. Chapter 2: 525 items, 41 formulas. Page 121's standard deviation formulas, absent from the PDF text layer, came out correct from the page images (the sample and population standard deviation formulas, with and without frequencies). Chapter 2 used ~412k Flash-Lite tokens against a 437k estimate.
- Audit strength: Flash-Lite's 160 audit calls wrote ~8k output tokens in total, so it rarely finds misses; the strong model's 17 calls wrote 23k. Economy is a quota workaround, not a substitute; "What did we miss?" on Balanced once quota allows is the stronger check.
- 93 tests.
- Owner decision: exercise sets and worked-example arithmetic stay in the ledger (recorded in `plan.md` §2).
- Owner decision: YouTube transcripts come from Gemini or a paste only; captions are not fetched (`plan.md` §2, F-204).

### 2026-10-31 · Owner feedback batch
- Ledger: a merged item found twice on one page crashed the workspace ("0 files · 0 items"); sources are now de-duplicated. The ledger can be opened while a material is distilling (polling no longer replaces the list when nothing changed) and renders 200 items at a time with "Show more", so 1 000-item ledgers stay fast.
- Activity panel (F-1310): a clock button in every top bar lists running jobs and the last 24 hours, with stop and resume, so closing a dialog no longer loses a job's status.
- Distil progress shows both numbers, labelled: "Distilling pages 17–176 · 98%" for the run, "17% of the file distilled" otherwise.
- Materials table: row actions aligned in fixed slots in the text font; long titles end in an ellipsis.
- Fonts (F-1309): every added font is saved under an optional name as its own pill; Anthropic Sans now matches the installed family names ("Anthropic Sans Text", "Anthropic Sans Display").
- Chats: the logo, "New chat" and "New chat in folder" open one start screen (it names the folder); a chat is created with its first message, and empty chats are removed at startup.
- Themed dropdown in place of the browser's `<select>`, and one app-wide tooltip (`data-tip`, or the label of an icon-only control).
- Fallback lists (F-1211, F-1212): several labelled keys per provider; each slot has an ordered list of (provider, key, model) tried on rate limits, outages, exhausted quota and caps. Chat says which model answered; the activity panel says when a fallback is distilling.
- Local keyword index (F-214): FTS5 over every chunk, kept in step by triggers; `GET /api/folders/:id/search?q=` returns hits anchored to their page. On the textbook a query takes ~10 ms.
- Planned, not built: configurable embeddings and hybrid retrieval for Ask/Teach (F-1004, F-1005, Phase 4); the built-in tutorial chat (F-1312, Phase 9).
- Grounding and memory design recorded (`plan.md` §4.5): ledger for coverage, anchored retrieval for content, grounding labels on every answer (F-1006), layered chat memory with learner state in the database (F-1007). Owner decisions: uncovered questions are answered at once and labelled; out-of-material topics are offered as *extra* ledger items (F-314); topic-only subjects use web search when set up, else the model, marked *generated* (F-205).
- 108 tests.

### 2026-10-31 · Phase 2 closed; study sounds
- Owner decision: the ledger is not reviewed by hand. It is accepted when every item is well-formed, checked automatically; quality tuning moves to a new last phase, Phase 10 (`plan.md` §2, §15).
- Check on the textbook ledger (1,006 items, 1,047 anchors): no bad types, empty titles, short statements, unanchored items or anchors outside their section. 819 quotes match the page exactly, 145 apart from spacing, 51 are on pages read from images (formulas drawn as pictures), 32 differ in typography (split headings, hyphenation). 28 titles appear more than once: merge misses, left for Phase 10.
- Study sounds (F-1313): rain, ocean, brown noise and fan, generated live with the Web Audio API; play/pause and volume from a headphones button in every top bar; sound and volume remembered.
- New-chat screen: model picker in the composer; its heading (which never appeared, waiting for a class nothing added) now animates on its own.

### 2026-11-01 · Shared learning schema
- A parallel build of Phases 3–8 was tried and stopped by the owner; phases go one at a time on `main` again (`plan.md` §2).
- Kept from it: migration 9 (briefs, plans, units, lessons, lesson items and prerequisites, `chats.lesson_id`, `items.provenance`, learner evidence `item_events`, `cards`), `server/learning/types.ts` (Brief schema, statuses, event kinds) and `server/learning/learner.ts` (evidence log; statuses only move forward). The later phases build on it. 113 tests.

### 2026-11-01 · Phase 3 — Study Plan
- Brief Compiler (F-101…F-105) on the cheap slot: a sentence (or nothing) becomes a full brief, with at most three question chips for what it couldn't infer; code drops past dates, bad options and extra questions. Stored per folder, inherited by subfolders, and sent with every chat in the folder.
- Planner (F-501, F-304, F-508, F-510) on the strong slot, 150 ledger items per part, saved part by part so a stopped job resumes. Code reviews each reply (unknown or missing items, oversized lessons, bad or cyclic prerequisites) and sends the problems back; after three attempts it repairs the plan itself, so coverage is always 100 %. Lessons carry minutes, suggested aids, exam weight (only when a syllabus or past paper is in the folder) and prerequisites. Skill plans add projects and work without material.
- Deadline mode (F-505): lessons spread over the days left with revision and mock-exam days before the exam, days off respected, more hours a day when the learner's aren't enough (shown as a warning); re-balanced once a day when the learner falls behind or gets ahead. Exports to Markdown and iCalendar.
- Plan tab: the brief card (Fill in for me, chips, Just go), then a left-to-right lesson map or an outline, the schedule strip, a lesson card with its items, and edits that keep prerequisites in order (rename, move, split, merge, mark done, I know this already). Up to three saved plans to switch between; re-planning with three asks which to replace (owner). "Plan them" plans items added after planning.
- Start lesson (F-504): one chat per lesson with the brief and the lesson's items in its prompt, until Phase 4's teacher (flagged in `plan.md` §2). Lessons record when they were finished (`done_at`), so a rename doesn't move them on the calendar.
- Today (F-506): today's lessons across subjects, Up next with Start lesson, cards due, where practice would help, coverage per subject and the week before the nearest exam. Ledger: coverage bars in percent, and a Gaps filter for items with no lesson or not taught in a started lesson (F-305, F-307).
- Themed scrollbars app-wide; the fake model (`scripts/fake-llm.mjs`) also answers the brief and planner prompts.
- Checked against the fake model on the textbook (997 items: 153 lessons, 100 % planned) in dark and light, desktop and phone width. Smoke test on the owner's Google key: the brief read "midterm on 20 November, about an hour a day" correctly without questions, and the plan for the 5-item DSP folder was two ordered lessons covering every item, scheduled with mock and revision days. 137 tests.

### 2026-11-01 · Plan tab feedback
- Each plan keeps the brief it was built from (migration 11); switching plans brings its brief back. Re-plan asks: same brief (the replaced plan's when three are saved, else the active one's) or change the brief, which opens the brief editor first (owner).
- Plan view filters: search, unit and day (the schedule strip's days also pick a day); the map dims what's filtered out and scrolls to the first match. Units on the map are shaded bands with their number and title.
- The mouse wheel scrolls horizontal strips (map, Today's week) sideways while hovering anywhere over them (`web/src/lib/wheel.ts`). Fixed: the brief dialog's footer wrapping, and an expanded outline lesson repeating its title and actions. 138 tests.
- Lesson chats show their lesson in a bar under the top bar: unit and lesson number, one mark per item (taught, checked), the unit's lessons done, Mark done and a link to the plan; it refreshes after each reply. Item marks move once Phase 4 records teaching. Fixed: a provider error with a long URL widened the chat on phones.
- Keys: a rate-limited or out-of-quota model is tried on the provider's other saved keys before the next fallback model (owner).
- Lesson chats (owner test): the stopgap teaching prompt quizzed course admin (what a chapter covers, which fields use statistics) and moved on after a wrong answer. It now only mentions admin, explains with an example, asks questions that need thinking, and re-explains and re-asks after a wrong answer. A question whose reply failed is left out of the history, so retries don't repeat it. Phase 4's teacher takes these rules over. 140 tests.
- Lesson progress: after each reply in a lesson chat, the cheap model reads the exchange and records which items were taught and which the learner answered correctly on their own (`server/plan/progress.ts`); a lesson whose items are all understood is done. The lesson bar became a ring button in the top bar that opens a lesson dialog (items, taught, understood, unit lessons). Checked live on Gemini 3.5 Flash Lite: a right answer counted, a wrong one didn't, and the tutor re-asked on the same item. Owner added F-617 (teach from every source on a topic) and F-618 (format fits the content) to Phase 4. 141 tests.

### 2026-11-01 · Phase 4 — retrieval
- Owner decisions for Phase 4 recorded in `plan.md` §2 ("Teach decisions"): all three search kinds, optional confidence, two repairs then move on, probe only when it helps.
- Search by meaning (F-1005): Settings › Models offers Off, a provider embedding model (Gemini and OpenAI-compatible keys list theirs) or a model on this computer (Small, Medium, High through `@huggingface/transformers` — added this phase; its blocked install scripts only fetch CUDA builds and image tools, which Distil doesn't use). A local model downloads only after a dialog shows its exact size from Hugging Face, and can be removed. Chunks are embedded by a background job (migration 12, `chunk_vectors`) that runs when the model changes and after a file is read, and waits out per-minute quota limits instead of failing.
- Retrieval (F-1004): keyword and meaning rankings merged by reciprocal rank fusion, falling back to keyword search when embeddings are off or failing; for lesson items it gathers each item's own source passages plus what every other file in the folder says about it (F-617).
- Checked live on Gemini `gemini-embedding-001`: the free tier's 30k tokens a minute limit is waited out while the textbook folder indexes. 147 tests.

### 2026-11-01 · Phase 4 — Teach
- Teaching engine (`server/teach/`, migrations 13–14): each lesson chat runs as a session of steps. The strong model splits the lesson's items into steps, with course admin as an orientation that is mentioned, never quizzed; if its split misses an item, one item per step is used. A probe question runs first only when the lesson builds on earlier ones or the brief says the learner knows some of it (F-601).
- Each step is taught from the item's own passages plus what the rest of the folder says about it, with numbered citations stored on the reply (F-617), in a form that fits the content (F-618), and ends with a check: multiple choice, number, short answer, ordering or explain (F-604). The answer never reaches the browser before the learner answers; ordering steps are shown shuffled. Code grades choice, number and order; the cheap model grades written answers.
- After an answer: right moves on (a right answer marked "guess" gets one follow-up first); wrong, partly or "I don't know" gets a repair, at most two, then the step is marked shaky and the lesson moves on; a recap names what was learned, what is shaky and the next lesson, and finishes the lesson (F-605–F-607, F-610, F-613). Probe answers are recorded as evidence without moving statuses.
- Lesson screen: a lesson document with citations that open the material viewer, note cards for the learner, check cards (folded until opened, keys 1–6 and Ctrl+Enter), Probe / Teaching / Recap dividers, quick actions (explain differently, simpler, deeper, example), an ask box for questions mid-lesson, and a session plan panel (F-602, F-603, F-609, F-611, F-612, F-616). Replaces the Phase 3 lesson prompt and the tracker (`server/plan/progress.ts` removed); lesson chats no longer take plain messages.
- Checked live on Gemini 3.5 Flash Lite through a whole lesson (probe, four steps, a repair, a guess follow-up, a quick action, a question, two shaky steps, recap): statuses moved, the lesson was marked done. 153 tests.

## Open questions

See `plan.md` §18.

## Known issues

- Custom installed fonts are found by family name. Chromium (the desktop build) sees user-installed fonts; Safari only exposes system fonts.
- On Google's free tier the strong model's daily request quota is very small; a textbook-sized audit needs several days or a paid key.
- Adding a link (and transcribing a video) runs inside the request; a long video keeps the dialog waiting for minutes. Move to a background job if that becomes a problem.
- Only Google AI Studio has been tested for real; Anthropic, OpenAI and the other providers are still checked only against fakes.
- The web bundle is one 614 kB chunk (KaTeX and highlight.js). Fine when served locally; split it if load time ever matters.

- Caps are in tokens only. Cost caps need per-model prices; planned with the usage dashboard (Phase 8).
- A cap is checked before each request, so one reply already in flight can finish past 100 %.
- Keys are in a user-only file, not yet the OS credential store; the desktop build (Phase 9) moves them.
- Inline maths (KaTeX) doesn't wrap, so a long formula in a chat reply widens the column on a phone.
- The fake model's plans are mechanical (one unit per heading); judge plan quality only with a real model.
- Ledger quality gaps for Phase 10: some duplicates survive merging on the cheap model (28 repeated titles on the textbook), and 32 quotes don't match their page text exactly.
- Keyword search has an API but no screen yet; Ask with sources (Phase 4) is its first user.
- A fallback model answering a chat is shown under the reply only while its model differs from the chat's own model.
- `npm audit`: two low-severity advisories in a build-time dependency of the Svelte Vite plugin (deepmerge); nothing ships to users.
