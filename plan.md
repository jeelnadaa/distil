# Distil — Product Plan & Scope

> Status: **DRAFT v1 — awaiting owner review.** Nothing here is built yet.
> Next step after approval: `DESIGN.md` (UX + visual design), then implementation in phases.
> Every feature has an ID (`F-xxx`) so you can say "drop F-312" or "move F-205 to Phase 2".
> Priority: **M** = must (v1), **S** = should (v1 if time), **C** = could (later).

---

## 0. One-paragraph pitch

A local-first, open-source study app where you drop in your material (or just a goal) and get a
**complete, structured study plan that provably covers everything in the material**, then learn it
inside the same app: an AI teacher that probes what you know, teaches one step at a time with
diagrams, graphs and small interactive apps, checks you after every step, drills you with
practice problems and mock exams, and keeps you retaining it with flashcards, a knowledge graph
and progress tracking. The system — not the user's prompt-writing skill — is responsible for
quality and completeness.

---

## 1. The problems we are solving

| # | Problem | Why it happens | Our answer (section) |
|---|---------|----------------|----------------------|
| P1 | Bad/short prompts produce shallow plans | LLM output quality tracks prompt quality | **Brief Compiler** turns any request into a full study spec (§4.1) |
| P2 | Big material (e.g. a whole unit) produces a thin plan | One LLM call over a huge input summarises instead of enumerating | **Chunked extraction** — material is split by structure and each piece is mined separately (§4.2) |
| P3 | LLM silently skips content | No one checks completeness | **Coverage Ledger** + recall audit + code-enforced 100 % mapping (§4.3) |
| P4 | Learning from plain text/formulae is weak | Chat UIs are text-first | **Interactive widget library** + sandboxed mini-apps + diagrams (§7) |
| P5 | Too many aids nobody asked for | Agents over-produce | **Interactivity dial** per chat/folder/global (§7.4) |
| P6 | Users leave to study elsewhere (flashcards app, quiz site, notes app, calendar) | Tools are scattered | Plan + teach + practice + flashcards + schedule + progress in one app (§5–§9) |
| P7 | Chats become an unorganised pile | Flat chat lists | Nested **subject workspaces** with shared materials (§3) |
| P8 | Cost is invisible | No usage accounting | Token meter, graphs, caps (§10) |

---

## 2. Decisions already made (from owner Q&A, 2026-10-31)

| Topic | Decision |
|---|---|
| Product name | **Distil** (British spelling, one "l") — boiling material down to its essence. Decided 2026-10-31. |
| Logo | **Condense** mark (three strokes narrowing to a drop). Decided 2026-10-31. |
| Default theme | **Dark on first run**; Settings offers Dark / Light / System. Decided 2026-10-31. |
| Colour palettes | Five user-selectable palettes (Copper, Verdigris, Oxblood, Cobalt, Citron), each with light and dark; **Copper is the default**. Chosen in Settings › Appearance. Decided 2026-10-31. |
| Deployment & data | **Local-first, open source.** Runs on the user's machine; chats, materials, keys stay on disk. No accounts, no server of ours. |
| Platform | Web app served locally **and** packaged as a Windows desktop app (macOS/Linux later). |
| Coverage strictness | **Exhaustive + visible ledger.** Every item in the material is extracted, mapped to a lesson, shown with a coverage %; gaps are flagged before studying starts. |
| Interactives | **Agent decides, user tunes** via a dial (text-only / balanced / visual-heavy) and per-request "no visuals here". |
| Google login for Gemini | **Included, opt-in, experimental, with a clear ToS/account-suspension warning.** API keys stay the main path. |
| Modes | **All four:** Study Plan, Teach (Socratic), Practice / Mock Exam, Quick Q&A. |
| Scheduling | **Optional deadline mode.** Plans are sequences; adding exam date + hours/day turns it into a re-balancing day-by-day schedule. |
| Retention | **Knowledge graph, flashcards + spaced repetition, mastery/progress view, streaks/gamification** — all in. |
| Inputs | **PDF/slides/docs, images & handwriting, web links & YouTube, and topic-only (no material).** |
| Folders | **Subject workspaces** — folders hold shared materials, a master plan, a coverage ledger and their slice of the graph. Subfolders = units. |
| Nesting | **Up to 5 levels.** |
| Token caps | **Warn at threshold, hard stop at cap.** Daily/monthly, global and per provider. |
| Relation to LearnHarness | **Ideas only, our own code.** Credit in README. |
| Licence | **MIT** (owner deferred to our recommendation, 2026-10-31): a local-first tool that should be easy to reuse. LearnHarness is AGPL, but no code is taken, so nothing obliges a copyleft licence. |
| Text font | **Satoshi by default**; Settings › Appearance offers **Anthropic Sans** (used when installed on the machine, never shipped) and **added fonts** (an installed font by name, or an uploaded font file). Each added font is saved under an optional name and becomes a pill next to Satoshi and Anthropic Sans, so it is never added twice. The choice replaces Satoshi everywhere; the display serif and mono stay. Decided 2026-10-31. |
| Generated visuals | **Always in Distil's design language** (owner, 2026-10-31). Models describe *what* to show in compact grammars or data; Distil's renderer decides *how it looks* with its own tokens. See §7.5. |
| Mastery display | **Both, configurable:** named level + percentage by default; Settings can show levels only, percentages only, or both. Decided 2026-10-31. |
| Gamification | **Off until the user turns it on.** Decided 2026-10-31. |
| Sibling chats | **Shared by default, compactly** (our recommendation): a new chat in a folder gets a short digest from the folder's ledger and graph (what was taught, mastery, open misconceptions), never sibling transcripts. A per-chat "Independent" switch turns it off. |
| Practice grading | **First attempt counts; hinted retries allowed** (our recommendation): the first answer sets mastery credit; after that, up to two progressive hints and retries, recorded as "with help" at reduced credit. Mock exams stay strictly one attempt, no hints. |
| Material storage | **Distil keeps its own copy** of every added file in the data folder; if the original changes, Distil notices and offers a re-import with a diff (F-212). Decided 2026-10-31. |
| Extraction strategy | **Cheap model extracts, strong model audits and merges** by default (about 3–5× cheaper than strong-everywhere); a per-subject switch uses the strong model for everything. Decided 2026-10-31. |
| YouTube transcripts | **A Gemini model watches the video, or the learner pastes YouTube's transcript.** The learner picks per video (Gemini costs about 6k tokens a minute; paste is free but misses what is only on screen). Captions are not fetched: YouTube has no public caption download for other people's videos, and its internal player API counts as bot-check circumvention. Decided 2026-10-31, replacing the earlier "captions first" order. |
| Phase 2 test material | **An openly licensed textbook** for development and the exit test; the owner judges completeness on their own material later. Decided 2026-10-31. |
| Exercises and worked examples | **Keep everything in the ledger**: exercise set-ups, worked-example arithmetic and calculator steps are extracted like any other content, not filtered out or set aside for practice. Decided 2026-10-31. |
| Model suggestions | **Suggested per role** during onboarding and in Settings › Models, picked from the models the user's key actually lists; always overridable. Decided 2026-10-31. |
| Rate limits and fallback | **An ordered fallback list per model slot**, each entry a (provider, key, model). A provider can hold several labelled keys. A call that hits a rate limit, an outage, an exhausted quota or a cap moves to the next entry without waiting; it waits only when every entry is busy. Chat falls back only before any text has streamed. The chat and the activity panel say which model answered. Extra keys are for separate accounts and only as each provider's terms allow (Google's don't allow extra keys or projects to get around rate limits). Decided 2026-10-31 (F-1211, F-1212). |
| Background status | **An app-wide activity panel** (clock button in every top bar): running jobs with progress, stop and resume, and what finished or failed in the last 24 hours. Closing a dialog never hides a job's status. Decided 2026-10-31 (F-1310). |
| Distil progress | **Both numbers, labelled:** the running job shows "Distilling pages 17–176 · 98%" (progress of this run); otherwise the file shows "N% of the file distilled". Decided 2026-10-31. |
| New chats | **One start screen** for the logo, "New chat" and "New chat in folder"; it names the folder when there is one. A chat is created when its first message is sent, so empty chats never reach the library. Decided 2026-10-31. |
| Finding things in the sources | **Ledger + keyword index + embeddings, all configurable.** The ledger is the map of what must be learned. A local keyword index (SQLite FTS5, BM25, stemming) is built at import with no model and finds exact terms, symbols and names (done, F-214). Embeddings add meaning-based search, from the provider (e.g. Gemini or OpenAI embedding models) or a local model in three sizes (small, medium, high); off is allowed. Answers retrieve with both and merge the rankings, every hit anchored to its page, slide or line. A local model is downloaded only after the user agrees, with its size shown. Decided 2026-10-31 (F-1004, F-1005). |
| Controls | **Themed everywhere:** dropdowns are Distil's own (the open list follows the palette and theme), and every control has a tooltip (icon buttons from their label, the rest where the meaning isn't obvious). Decided 2026-10-31 (F-1311). |
| Grounding | **Material first, labelled, never silently mixed** (§4.5). Answers say whether they come from the material (cited, quotes checked in code), partly from it, or from general knowledge. A question the material doesn't cover is **answered at once from general knowledge, labelled "Not in your material"**; where the model and the material disagree, the material wins and the difference is pointed out. Decided 2026-10-31 (F-1006). |
| Topics outside the material | **Offered, not added:** a labelled out-of-material answer has an "Add to this subject" button that adds it to the ledger as an *extra* item, so the plan, practice and cards include it. Decided 2026-10-31 (F-314). |
| Topic-only subjects | **Web search when set up, else the model's knowledge.** The researcher cites web sources when a search key is added; otherwise the syllabus is built from the model and every item is marked *generated*. Decided 2026-10-31 (F-205). |
| Memory | **Learner state in the database, not chat history** (§4.5): recent turns verbatim, a rolling summary per chat, per-item learner state (taught, mastery, mistakes, misconceptions) and the folder digest. Decided 2026-10-31 (F-1007). |
| Ledger review | **No manual review; the model's ledger is trusted** as long as every item is well-formed: a valid type, a title, a real statement, and a source anchor whose quote is on that page. These are checked automatically. Tuning ledger and answer quality is the last phase (Phase 10). Decided 2026-10-31, replacing "owner judges completeness" as the Phase 2 exit test. |
| Study sounds | **Generated in the app** (rain, ocean, brown noise, fan) with play/pause and volume in every top bar; the sound and volume are remembered, and playback starts on a click. Nothing is downloaded. Decided 2026-10-31 (F-1313). |
| Built-in tutorial | **One "How to use Distil" chat**, shipped with the app, that walks through the whole app in the chat window and answers questions about it. Built last, when the app is done (Phase 9, F-1312). Decided 2026-10-31. |

---

## 3. Information architecture

```
Library (root)
└── Folder (Subject workspace)          ≤ 5 levels deep
    ├── Materials        (files, links, videos, notes — shared by everything below)
    ├── Coverage Ledger  (every learning item extracted from Materials)
    ├── Master Plan      (units → lessons → steps, optional schedule)
    ├── Flashcard deck   (auto + manual cards)
    ├── Progress         (mastery per item/lesson)
    ├── Subfolder (Unit) ... inherits parent materials, can add its own
    └── Chats
        ├── "Unit 2 – Fourier Series: Teaching"      (mode: Teach)
        ├── "Laplace transform quick questions"      (mode: Q&A)
        └── "Mock exam #1 – Units 1-3"               (mode: Practice)
```

| ID | Feature | Pri |
|----|---------|-----|
| F-001 | Folders nest up to 5 levels; create, rename, move (drag & drop), delete (with confirm + trash) | M |
| F-002 | A folder is a **workspace**: Materials, Ledger, Plan, Deck, Progress tabs at folder level | M |
| F-003 | **Inheritance:** a chat sees materials of its folder and all ancestor folders; a subfolder can add its own | M |
| F-004 | Chats can live at root (unfiled) or in any folder; move between folders | M |
| F-005 | **Auto chat naming:** after the first exchange a cheap model names the chat specifically ("Unit 3 – Bayes' Theorem: Teaching", not "Help with stats"). Renameable; manual name is never overwritten | M |
| F-006 | Auto folder naming suggestion when a folder is created from uploaded material (e.g. syllabus title) | S |
| F-007 | Sidebar tree with collapse state, pin, sort (recent / name / manual), unread/active-job dots | M |
| F-008 | Global search across chat titles, messages, materials, ledger items, flashcards | M |
| F-009 | Find-in-chat (Ctrl+F inside a session) | S |
| F-010 | Trash with restore (30 days) instead of hard delete | S |
| F-011 | Export: chat → Markdown/PDF; plan → Markdown/PDF; deck → Anki/CSV; folder → zip | S |
| F-012 | Import: folder zip from another install (share a subject with a friend) | C |

---

## 4. The Harness — how we get "best of the best" from bad prompts

This is the core of the product. The principle: **LLMs make judgments; code enforces guarantees.**
No single LLM call is ever trusted with "the whole thing".

### 4.1 Brief Compiler (fixes P1)

Every new plan/teach request first goes through a compiler that turns whatever the user typed
("make me a plan for unit 3", "learn rust") into a **Study Brief**:

| Field | Example | Source |
|---|---|---|
| Goal | "Pass DSP mid-sem, Units 1-3" | inferred / asked |
| Scope | Units 1-3 of attached syllabus | materials + text |
| Current level | "Knows calculus, new to signals" | asked or probed |
| Depth | survey / standard / exam-ready / mastery | inferred, editable |
| Deadline & time budget | 14 days, 2 h/day (optional) | asked |
| Preferences | interactivity dial, language, example style | settings + inferred |
| Assessment style | numericals-heavy, theory, MCQ, coding | inferred from material/past papers |

| ID | Feature | Pri |
|----|---------|-----|
| F-101 | Brief Compiler produces a structured brief from any input, shown as an editable card before work starts | M |
| F-102 | Asks **at most 3** clarifying questions as clickable cards, only for fields it cannot infer; everything else gets a visible default | M |
| F-103 | "Just go" button — skip questions, use defaults | M |
| F-104 | Brief is stored on the folder/chat and re-used by every later agent call (no re-asking) | M |
| F-105 | Prompt amplification for all modes: even in Q&A the agent's system prompt carries the brief + relevant ledger items, so short questions get context-rich answers | M |

### 4.2 Material ingestion (fixes P2)

| ID | Feature | Pri |
|----|---------|-----|
| F-201 | Ingest PDF, PPTX, DOCX, MD, TXT | M |
| F-202 | Ingest images (photos, scans, handwriting, whiteboards) via vision model / OCR | M |
| F-203 | Ingest web articles by URL (readable-text extraction) | M |
| F-204 | Ingest YouTube by URL (transcript with timestamps): Gemini reading the URL, or a pasted transcript | M |
| F-205 | Topic-only mode: no material → a **researcher agent** builds a reference syllabus, from the web with cited sources when a search key is set up (F-1209), otherwise from the model's own knowledge with every item marked *generated*; it then becomes the "material" | M |
| F-206 | **Structure-aware chunking:** split by headings / slides / pages / timestamps into small chunks with stable anchors (file, page, slide, timestamp) | M |
| F-207 | **Per-chunk extraction** of atomic *learning items* (see 4.3), so a 300-page PDF is mined page-group by page-group, never summarised in one call. Default: cheap model extracts, strong model audits (F-302) and merges (F-303); per-subject "strong for everything" switch | M |
| F-208 | Pre-flight **cost estimate** before ingesting large material ("~180k tokens ≈ $0.40 on model X — continue?") | M |
| F-209 | Ingestion runs as a background job with progress, pause/abort, resume after restart | M |
| F-210 | Material viewer: open the original file at the anchored page/slide/timestamp from any item, lesson or answer | M |
| F-211 | Syllabus / past-paper detection: if a file looks like a syllabus or exam paper, it is used to set scope and exam weighting | S |
| F-212 | Re-ingest on file change; diff shows new/removed items | S |
| F-213 | Math-aware extraction (LaTeX for formulae, tables kept as tables) | M |
| F-214 | **Local keyword index** of every chunk (SQLite FTS5, BM25 ranking, stemming), built at import and kept in step on re-import and delete, no model involved. Search returns hits anchored to the exact page/slide/line of the first match | M |

### 4.3 Coverage Ledger (fixes P3 — "don't miss a single thing")

A **learning item** is the atomic unit of content:
`concept · definition · formula · theorem/law · derivation · procedure/algorithm · fact · example/worked problem · diagram · code snippet`.
Each item has: title, statement, type, source anchor(s), dependencies, exam weight (if known), status.

| ID | Feature | Pri |
|----|---------|-----|
| F-301 | Extracted items stored in a per-folder **Coverage Ledger** with source anchors | M |
| F-302 | **Recall audit:** a second pass re-reads each chunk against its extracted items and reports misses; loop until clean or budget hit | M |
| F-303 | **Dedup/merge auditor** across chunks (same formula on slide 4 and page 12 → one item, two anchors). Conservative: duplicates over wrong merges | M |
| F-304 | **Code-enforced mapping:** plan generation is rejected and retried until every non-skipped item maps to ≥ 1 lesson. This is a deterministic check, not an LLM promise | M |
| F-305 | Ledger UI: table grouped by source/unit, filters by type/status, coverage % bar, "unmapped" and "untaught" highlights | M |
| F-306 | Item statuses: `pending → planned → taught → checked → mastered`, plus user marks `skip / already know / not in syllabus` | M |
| F-307 | **Coverage at every level:** plan coverage (mapped), teaching coverage (taught in a session), check coverage (verified by a question) — three bars | M |
| F-308 | Teaching sessions receive their lesson's exact items + source excerpts as grounding, and the lesson cannot be marked complete while any item is untaught (agent is told what is left) | M |
| F-309 | "What did we miss?" button — runs the recall audit again on demand | S |
| F-310 | User can add items manually ("my professor said this is important") | S |
| F-311 | Every taught item links back to the chat message(s) where it was taught | M |
| F-314 | *Extra* items: a topic learned outside the material (from a labelled general-knowledge answer) can be added to the ledger with one click; extras are marked, have no source anchor, and are planned, taught, practised and carded like any item | S |

### 4.4 Agent architecture (summary; details go in DESIGN/architecture docs)

| Agent | Job | Model slot |
|---|---|---|
| Brief Compiler | request → Study Brief | cheap |
| Extractor | chunk → learning items | cheap (strong when the subject asks for it) |
| Recall Auditor | chunk + items → misses | strong |
| Merger/Dedup Auditor | items → merged ledger | strong |
| Planner | ledger + brief → dependency DAG → units/lessons/steps | strong |
| Prober | finds where the learner's knowledge ends | strong |
| Teacher | teaches one step at a time, checks, repairs | strong |
| Q&A | quick answers with brief + ledger context | user's choice |
| Researcher | web search + fetch → sourced brief | cheap/strong |
| Widget/Demo builder | builds & **tests** interactive mini-apps before showing them | strong |
| Visual maker | SVG/diagram → render → look → fix | vision-capable |
| Problem generator / Grader | practice sets and mock exams | strong |
| Card maker | lessons → flashcards | cheap |
| Graph extractor/auditor | sessions → knowledge-graph propositions | strong |
| Namer | chat/folder titles | cheap |

| ID | Feature | Pri |
|----|---------|-----|
| F-401 | Two model slots (**strong**, **cheap**) + optional per-role override | M |
| F-402 | Background jobs never block the lesson; live activity dock shows what each job is doing, with abort | M |
| F-403 | Shared concurrency limit for background LLM work (configurable) | M |
| F-404 | All system prompts visible and editable in Settings, with "reset to default" | S |
| F-405 | Every structured agent output is schema-validated; invalid output is retried with the error, never silently accepted | M |
| F-406 | Steering: user can type while the agent is working; message is queued and delivered at the next safe point | S |
| F-407 | Abort current turn | M |
| F-408 | Context compaction with an education-aware summary (keeps plan position, open misconceptions, items left) | M |

---

### 4.5 Grounding and memory — how every mode avoids hallucinating and forgetting

Two stores do different jobs. The **ledger** is the checklist of what must be learned (it stops
*forgetting*: plans are checked in code to cover all of it). **Retrieval** over the material's chunks is
the source text (it stops *hallucinating*: the model explains from real passages). Ledger items carry
anchors, so when a lesson teaches an item its exact passage (and neighbours) is fetched directly, with
no search; search (keyword F-214 + embeddings F-1005, merged F-1004) is for free-form questions.

| Mode | Where the content comes from | How it stays grounded |
|---|---|---|
| Quick Q&A | Search the folder → top passages → answer | Grounding label + citations (F-1006); uncovered questions answered from general knowledge, labelled, with "Add to this subject" (F-314) |
| Study Plan | The **whole ledger**, never retrieval | Coverage of 100 % enforced in code (F-304) |
| Teach | Plan's next items → their anchored passages → explain, check, repair | Item statuses and misconceptions written to learner state as the lesson runs |
| Practice / Mock exam | Questions from an item and its passage; past papers set style and weighting | Answer key derived from the source; grading checked against it by a second pass |
| Flashcards | One card per item; back taken from the source | Card links to its page |
| Knowledge graph | Ledger items and their relations | Every node links to its source |
| Topic only | Researcher's syllabus becomes the material (F-205) | Web sources cited, or items marked *generated* |

Rules for every mode:
- Formulas are shown as stored in the ledger (LaTeX from the source), never regenerated by the model.
- Prompts carry a few anchored passages, not whole chapters: cheaper, faster, less drift.
- Memory is layered (F-1007): what the learner knows lives in the database, so a new chat or a lesson next week starts with it.

## 5. Mode 1 — Study Plan

| ID | Feature | Pri |
|----|---------|-----|
| F-501 | Plan = **Units → Lessons → Steps**, built from the ledger's dependency DAG (prerequisites first) | M |
| F-502 | Each lesson shows: items covered, prerequisites, estimated time, suggested aids (diagram/sim/practice) | M |
| F-503 | Visible **plan map** (DAG view) and **outline view**; current position highlighted | M |
| F-504 | One-click "Start lesson" → opens a Teach chat pre-loaded with the lesson's items | M |
| F-505 | **Deadline mode:** exam date + hours/day (+ days off) → calendar schedule; re-balances automatically when you fall behind or get ahead; buffer days for revision and mock exams | M |
| F-506 | Today view: "today's lessons + due flashcards + one practice set" | M |
| F-507 | Plan editing: reorder, split/merge lessons, mark known; ledger coverage re-checked after each edit | S |
| F-508 | Exam-weighted plans when past papers/syllabus weights exist | S |
| F-509 | Plan export (Markdown/PDF, .ics calendar) | S |
| F-510 | General (non-university) goals: skill plans with milestones and projects ("learn guitar chords", "learn Rust") | M |

## 6. Mode 2 — Teach (Socratic)

Theory borrowed from LearnHarness and kept: **probe → plan → teach one reasoning step at a time → check after every step → repair before building on it.** The goal is for each fact to feel obviously true, not merely familiar.

| ID | Feature | Pri |
|----|---------|-----|
| F-601 | **Probe phase:** short diagnostic questions on the lesson's prerequisites; result decides the starting point | M |
| F-602 | Visible phase divider (Probe → Teaching) | M |
| F-603 | Session plan panel (right side, collapsible) showing steps: done / current / next / upcoming | M |
| F-604 | **Check after every step** — question cards: MCQ, numeric, short answer, ordering, "explain in your words" | M |
| F-605 | Every answer has a **confidence** choice (guess / unsure / sure) and an optional "thinking" field to reason out loud | M |
| F-606 | "I don't know" is a first-class answer (no penalty) | M |
| F-607 | Wrong or low-confidence answers trigger a repair step before continuing | M |
| F-608 | Predict-before-reveal prompts ("what do you think happens if…?") | S |
| F-609 | Teaching-phase checks start collapsed behind "Check your understanding" so the learner reads first | S |
| F-610 | Answers update the ledger item statuses (taught / checked) and mastery | M |
| F-611 | "Explain differently" / "simpler" / "deeper" / "show example" quick actions on any teacher block | M |
| F-612 | Teacher writes as a **lesson document** (headings, callouts, worked examples), learner input renders as distinct note cards — not chat bubbles | S |
| F-613 | Session recap at end: what was learned, what is shaky, cards created, next lesson | M |
| F-614 | Opening retrieval: each new session starts with 1–3 recall questions from the previous lesson | S |
| F-615 | Dictation (speech-to-text) for answers and thinking fields | C |
| F-616 | Keyboard-first answering (1-4, j/k, Enter) | S |

## 7. Interactive learning (fixes P4, P5)

### 7.1 Built-in widget catalog (fast, reliable, themed)

The agent emits a **typed spec** (JSON) and the app renders a native component. Cheaper and more
reliable than generating code every time.

| ID | Widget | Pri |
|----|--------|-----|
| F-701 | Flowchart / process diagram / mind map (Mermaid-class) with pan & zoom | M |
| F-702 | Function plotter (sliders for parameters, multiple curves, derivatives/areas) | M |
| F-703 | Data charts (bar/line/scatter) from given data | M |
| F-704 | Step-through derivation / worked example (reveal one line at a time, each line justified) | M |
| F-705 | Comparison table / pros-cons / "X vs Y" | M |
| F-706 | Timeline (history, processes) | S |
| F-707 | Concept map (ledger items + relations, clickable) | S |
| F-708 | Interactive quiz cards inside lessons (drag-to-order, match pairs, fill-in-the-blank, label-the-diagram) | S |
| F-709 | Code runner (JS in browser; Python via in-browser runtime) with editable examples | S |
| F-710 | Formula explorer (hover each symbol for meaning/units; plug in numbers) | S |
| F-711 | Geometry / vector / matrix visualiser | C |
| F-712 | Circuit / state-machine / tree / graph-algorithm step visualiser | C |

### 7.2 Free-form mini-apps (the long tail)

| ID | Feature | Pri |
|----|---------|-----|
| F-721 | Agent can build a **self-contained HTML/JS mini-app** (simulation, game, explorable) rendered in a sandboxed frame with no access to app data | M |
| F-722 | Built by a sub-agent that **runs and tests it headlessly before showing it**; runtime errors are auto-reported back and fixed | M |
| F-723 | Versioning: re-requests create v2, v3; user can switch versions | S |
| F-724 | "Open full screen" and "save to folder" (becomes a reusable material) | S |
| F-725 | Precise visuals (SVG diagrams) via a visual-maker sub-agent that renders and checks its own output | S |

### 7.3 Rich text basics

| ID | Feature | Pri |
|----|---------|-----|
| F-731 | Markdown, LaTeX math (inline + display), syntax-highlighted code, tables | M |
| F-732 | Images from material shown inline with source anchor | S |

### 7.4 Interactivity dial (P5)

| ID | Feature | Pri |
|----|---------|-----|
| F-741 | Dial: **Text-only / Balanced (default) / Visual-heavy** — global default, override per folder and per chat | M |
| F-742 | Text-only = no widgets unless explicitly requested; Balanced = only when the concept is dynamic/spatial/process-like; Visual-heavy = prefer a visual for every step | M |
| F-743 | Natural-language overrides respected for the rest of the session ("no more diagrams") | M |
| F-744 | Thumbs up/down on any widget feeds a per-user preference note the agent reads | S |

### 7.5 Generated visuals in Distil's design language

**Principle:** the model says *what* to show; Distil decides *how it looks*. Generated output
never carries colours, fonts, sizes, spacing or CSS. Our components render it with the design
tokens (DESIGN.md §8.1), so every visual matches the app and re-themes live when the palette,
light/dark or text font changes. This is also the token-efficient path: styling is the most
verbose part of any visual, and the model never writes it.

Four layers, cheapest first:

1. **Typed widgets (F-701…F-712)** use small line-based grammars inside fenced blocks
   (`flow`, `plot`, `chart`, `steps`, `compare`, `timeline`, `quiz`, `formula`). The only styling
   hooks are semantic: `!` marks the one emphasised element (accent), `~` de-emphasises (muted),
   `tone=good|warn|bad`, and series `1…6` map to the data-viz palette. Example:

   ````
   ```flow
   sig[Signal] -> smp[Sampler]: fs
   smp -> q{Aliasing?}
   q -yes-> fix[Raise fs]!
   ```
   ````

   That is roughly a third of the tokens of the same diagram as JSON and a tenth of it as SVG.
2. **Knowledge graph, concept maps, plan map (F-503, F-707, F-921)** are generated as **data only**
   (propositions, items, relations). Layout and appearance are entirely ours, so they cost no visual tokens.
3. **Precise SVG visuals (F-725)** use a restricted profile: shapes, paths and text with classes
   from a fixed set (`ink`, `muted`, `accent`, `fill-1…6`, `label`, `grid`); no `style`, colour
   attributes or `font-*`. A sanitiser in code removes anything else and maps stray colours to the nearest token.
4. **Free-form mini-apps (F-721)** run in a sandbox that the host preloads with the **Distil kit**:
   tokens for the current theme, base CSS, and a few helpers (slider, button, readout, plot canvas,
   step controls). The model writes markup and logic with kit classes, never CSS. The
   test-before-show step (F-722) lints for hard-coded colours, fonts and stylesheets that fight
   the kit, and sends a fix request carrying only the lint errors.

| ID | Feature | Pri |
|----|---------|-----|
| F-751 | Widget grammars: compact, line-based, one example each in the prompt; parsed and validated in code | M |
| F-752 | Semantic styling only (emphasis, muted, tone, series); literal colours, fonts or sizes are never accepted | M |
| F-753 | SVG sanitiser: allow-listed elements and classes, strips scripts and styles, maps colours to tokens | M |
| F-754 | Distil kit injected into every sandboxed mini-app, themed by the host and updated live on theme change | M |
| F-755 | Design lint in the test-before-show loop; violations repaired by a short fix call carrying only the errors | M |
| F-756 | Live re-theme: palette, light/dark and text-font changes restyle every visual already on screen | M |
| F-757 | Prompt budget: the grammar reference (about 400 tokens) is sent only when the interactivity dial allows visuals, and sits in the static prompt prefix so provider prompt caching makes repeats cheap | M |
| F-758 | Repair and fallback: an invalid block gets one repair call with the parser error only; if that fails, it shows as readable text with "Couldn't draw this", never a broken render | M |
| F-759 | Streaming: a visual shows a quiet placeholder while its block streams and renders when the block closes | S |
| F-760 | Fidelity tests: every grammar sample rendered in both themes and all palettes; a lint corpus keeps violations out of prompts | S |

## 8. Mode 3 — Practice & Mock Exams

| ID | Feature | Pri |
|----|---------|-----|
| F-801 | Practice set from: a lesson, a unit, selected ledger items, weak items, or graph nodes | M |
| F-802 | Difficulty ladder (worked example → completion → direct → composition → open problem) and "distance" (same context → new context → far transfer) | S |
| F-803 | **Mock exam** generator matching the course's style (from past papers if provided): sections, marks, time limit, instructions | M |
| F-804 | Timer + exam mode (one attempt, no hints) vs practice mode: the first attempt sets mastery credit, then up to two progressive hints and retries, recorded as "with help" at reduced credit | M |
| F-805 | Every problem is generated **with its solution and rubric first**, then shown (prevents grading drift) | M |
| F-806 | Grading: score, rubric points met/missed, model solution, which item failed to come to mind; handwritten answers via photo | M |
| F-807 | Results feed mastery + create flashcards for missed items | M |
| F-808 | No repeated problems across sets for the same items | S |
| F-809 | Exam report: per-unit score, time per question, weak items → "Fix these" lesson button | S |

## 9. Retention & progress

### 9.1 Flashcards + spaced repetition

| ID | Feature | Pri |
|----|---------|-----|
| F-901 | Auto-generate cards from taught items and missed questions; types: basic, reverse, cloze, formula, image-occlusion (C) | M |
| F-902 | Modern spaced-repetition scheduler (FSRS-class), daily review queue per folder and global | M |
| F-903 | Manual card creation/edit; card links back to item + lesson | M |
| F-904 | Anki import/export | S |
| F-905 | Optional AI "explain this card" during review | S |

### 9.2 Mastery / progress

| ID | Feature | Pri |
|----|---------|-----|
| F-911 | Mastery per item derived from checks, practice, card reviews (with decay over time) | M |
| F-912 | Progress view per folder: coverage bars, mastery heatmap by unit/lesson, weak spots list | M |
| F-913 | "What should I do now?" recommender (due cards, weak items, next lesson, deadline pressure) | M |
| F-914 | Mastery display setting: levels (new / shaky / solid / mastered), percentages, or both (default both) | M |

### 9.3 Knowledge graph (LearnHarness-inspired)

| ID | Feature | Pri |
|----|---------|-----|
| F-921 | Persistent cross-chat graph: nodes = propositions/concepts, edges = *follows from* / *supports* | S |
| F-922 | Built by a background extractor → auditor pipeline over sessions (and materials), updating continuously, even from unfinished sessions | S |
| F-923 | Nodes link to ledger items and to exact source messages | S |
| F-924 | Clusters by topic, pan/zoom, label fade by zoom, filter by folder | S |
| F-925 | Graph as context: new sessions on related topics see what you already know. A new chat in a folder gets a short ledger + graph digest of its siblings by default (never their transcripts); a per-chat "Independent" switch turns it off | S |
| F-926 | Import notes (Markdown/Obsidian vault) into the graph | C |
| F-927 | Chain/table view for managing nodes (search, select, delete, make practice set) | C |

### 9.4 Streaks & gamification (opt-in)

| ID | Feature | Pri |
|----|---------|-----|
| F-931 | Daily study streak (lesson, review or practice counts), with freeze days | S |
| F-932 | XP / levels tied to *verified* learning (checks passed, cards reviewed), never to time spent or messages sent | S |
| F-933 | Milestone badges (first unit 100 % covered, first mock exam, 30-day streak…) | C |
| F-934 | Whole system is switched on in Settings; **off by default** | M |

## 10. Mode 4 — Quick Q&A

| ID | Feature | Pri |
|----|---------|-----|
| F-1001 | Plain ask-anything chat with folder materials + brief as context, with citations to material anchors | M |
| F-1002 | "Turn this into a lesson" / "make cards from this" buttons on answers | S |
| F-1003 | Mode can be switched inside a chat (Q&A → Teach) without losing history | S |
| F-1004 | **Retrieval for answers and lessons:** the ledger picks what matters; the keyword index (F-214) and embeddings (F-1005) each rank chunks, merged by reciprocal rank fusion; the top chunks go to the model with their anchors, and answers cite them. Used by Q&A (F-1001), Teach and Practice | M |
| F-1006 | **Grounding labels** on every answer: *From your material* (citations; each quote verified in code against its chunk), *Partly* (cited parts marked), or *Not in your material* (general knowledge). Before "not in your material", the ledger, keyword index and embeddings are all checked. Conflicts with the material are flagged and the material wins | M |
| F-1007 | **Chat memory in layers:** recent turns verbatim; a rolling summary of older turns stored per chat (refreshed by the cheap model when the context fills); learner state per ledger item in the database; the folder digest (F-925). Every chat and lesson reads learner state, so nothing depends on the model remembering a transcript | M |
| F-1005 | **Embeddings, configurable** in Settings › Models: Off · Provider (an embedding model the user's key lists, e.g. Gemini or OpenAI; counted in usage and caps) · Local (Small, Medium, High; runs on this computer, free after download). Local models download only after consent with the file size shown, and can be removed. Vectors stored per chunk in the data folder and rebuilt when the embedding model changes; a pre-flight shows the cost for provider embeddings | M |

---

## 11. Tokens, cost & caps

| ID | Feature | Pri |
|----|---------|-----|
| F-1101 | Record per request: provider, model, role (teacher/extractor/…), input, output, cached, reasoning tokens, estimated cost, chat, folder, timestamp | M |
| F-1102 | Live meter in chat: this chat's tokens + context-window fill | M |
| F-1103 | Usage dashboard: graphs by day/week/month; breakdown by model, provider, role, folder, chat; input vs output stacked | M |
| F-1104 | Caps: daily and monthly, global and per provider; in tokens or estimated cost | M |
| F-1105 | Warning at configurable threshold (default 80 %); **hard stop at 100 %** with "raise cap / wait for reset" dialog | M |
| F-1106 | Background jobs count toward caps and show their own spend | M |
| F-1107 | Pre-flight estimate for expensive actions (ingestion, mock exam, full re-audit) | M |
| F-1108 | Export usage as CSV | S |
| F-1109 | Subscription/OAuth providers show token counts (no fake dollar figures) | M |

## 12. Providers & models

| ID | Feature | Pri |
|----|---------|-----|
| F-1201 | Bring-your-own API keys: Google Gemini, OpenAI, Anthropic, OpenRouter, DeepSeek, Mistral, Groq, xAI (list extensible) | M |
| F-1202 | Custom OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, any proxy) | M |
| F-1203 | **Sign in with Google (experimental)** — use Gemini models via Google account OAuth, no API key. Off by default; enabling shows a plain warning that this reuses Google's CLI login and Google may restrict or suspend accounts for third-party use | M |
| F-1204 | Guided 30-second setup for a free Google AI Studio API key (the safe default path) | M |
| F-1205 | Model picker with capabilities (vision, context size, reasoning, price) | M |
| F-1210 | Suggested model per role (strong, cheap, vision), matched against the user's own model list and labelled "suggested"; never selected without the user seeing it. Google free tier (measured 2026-10-31): Pro models have a quota of 0, so suggest a Flash model for strong and Flash-Lite for cheap there; prefer pinned versions over `-latest` aliases, which can hit 503 "high demand" | M |
| F-1206 | Keys stored locally, encrypted with the OS credential store where available; never sent anywhere but the provider | M |
| F-1207 | Graceful capability fallback (e.g. no vision model → images ingested via OCR or flagged) | M |
| F-1208 | Other subscription logins (ChatGPT, Copilot) — same opt-in/warning pattern | C |
| F-1209 | Web search provider for researcher agent (key-based; optional) | S |
| F-1211 | Several labelled keys per provider (e.g. personal and work); the first is the default; removing one moves choices that used it to the default | M |
| F-1212 | **Fallback list per model slot** of (provider, key, model): rate limits, outages, exhausted quota and caps move the call to the next entry; waits only when all are busy; chat falls back before any text streams; the answering model is shown | M |

## 13. App, settings & quality of life

| ID | Feature | Pri |
|----|---------|-----|
| F-1301 | First-run onboarding: pick provider → key or Google sign-in → pick models (a suggested model per role, from what the key actually lists) → create first subject | M |
| F-1302 | Settings: providers, models/roles, interactivity dial, caps, appearance (light/dark/system, palette, text font), keyboard, prompts, gamification, data location | M |
| F-1303 | Keyboard shortcuts for everything; shortcut sheet (`?`) | S |
| F-1304 | Data stored in a user-chosen folder; backup/restore | M |
| F-1305 | Windows installer + auto-update; local web mode for any OS | M |
| F-1306 | Crash-safe: background jobs resume or report "interrupted" honestly after restart | M |
| F-1307 | Accessibility: screen-reader labels, focus order, contrast, reduced motion | S |
| F-1308 | Multilingual: learn in any language the model supports (UI English first) | S |
| F-1309 | Text font: Satoshi (default), Anthropic Sans (only if installed locally; never bundled), or added fonts (installed font name or uploaded .woff2/.woff/.ttf/.otf), each saved under an optional name as its own pill. Replaces Satoshi everywhere; display and mono unchanged | M |
| F-1310 | Activity panel in every top bar: running jobs (progress, which fallback model is answering, stop) and the last 24 hours (done, stopped, failed, resume) | M |
| F-1311 | Themed controls: Distil's own dropdown in place of the browser's, and a tooltip on every control | M |
| F-1313 | Study sounds: rain, ocean, brown noise and fan, synthesised live (no files); play/pause and volume from a top-bar button; sound and volume remembered | S |
| F-1312 | Built-in tutorial: one "How to use Distil" chat that explains the whole app in the chat window and answers questions about it; kept in step with the shipped features | M |

---

## 14. Feature parity matrix vs LearnHarness

✅ = we match · ➕ = we extend · 🆕 = new in ours · ⏸ = later

| LearnHarness feature | Ours | Notes |
|---|---|---|
| Probe → plan → teach → practice loop | ✅ F-601…F-613, F-801 | Same theory, credited |
| Plan DAG visible, agent-editable | ✅ F-503, F-603 | Plus outline view |
| One reasoning step + check after every step | ✅ F-604, F-607 | |
| Confidence + thinking fields | ✅ F-605 | |
| Collapsed teach-phase checks, phase divider | ✅ F-602, F-609 | |
| Practice problem sets (rungs, cue distance), grading 0–10 + rubric | ➕ F-801…F-809 | Plus mock exams, timer, handwritten answers |
| Knowledge graph, provenance, clusters, notes import | ✅/⏸ F-921…F-927 | Linked to ledger items |
| Researcher sub-agent | ✅ F-205 | Also drives topic-only curricula |
| Interactive HTML demos tested headlessly | ✅ F-721, F-722 | |
| Visual maker (SVG, verify by looking) | ✅ F-725 | |
| Mermaid diagrams | ➕ F-701 | Inside a typed widget catalog |
| Activity dock, abort, steering | ✅ F-402, F-406, F-407 | |
| Compaction + context meter | ✅ F-408, F-1102 | |
| Cost meter | ➕ F-1101…F-1109 | Graphs, caps, pre-flight estimates |
| 30+ providers BYOK, custom endpoints | ✅ F-1201, F-1202 | |
| Subscription logins (ChatGPT/Copilot/Grok) | ➕ F-1203, F-1208 | Google/Gemini added |
| Dictation | ⏸ F-615 | |
| Editable system prompts | ✅ F-404 | |
| Keyboard-first, vim keys | ✅ F-616, F-1303 | |
| Session search, markdown export | ✅ F-008, F-009, F-011 | |
| Desktop app with auto-update | ✅ F-1305 | Windows first |
| PDF reading, learner files | ➕ F-201…F-213 | Plus slides, docs, images, web, YouTube |
| — | 🆕 Brief Compiler F-101…F-105 | Fixes bad prompts |
| — | 🆕 Coverage Ledger F-301…F-311 | "Miss nothing", enforced in code |
| — | 🆕 Folders as workspaces F-001…F-004 | Nested, inherited materials |
| — | 🆕 Auto chat naming F-005 | |
| — | 🆕 Deadline schedule F-505, F-506 | |
| — | 🆕 Widget catalog F-701…F-712 + dial F-741 | |
| — | 🆕 Flashcards + SRS F-901…F-905 | |
| — | 🆕 Mastery view F-911…F-913 | LearnHarness deliberately has no ratings |
| — | 🆕 Streaks/XP F-931…F-934 | LearnHarness deliberately rejects; ours is opt-in (off by default) and tied to verified learning |
| — | 🆕 Q&A mode F-1001…F-1003 | |

---

## 15. Build phases

Each phase ends with: features working end-to-end, tests green, docs updated (`PROGRESS.md`,
`README.md`, `AGENTS.md` if conventions changed), **one or more local commits — never pushed**.

| Phase | Name | Contents | Exit criteria |
|---|---|---|---|
| 0 | Plan & design | `plan.md` ✅, `DESIGN.md` (UX flows, screens, visual system), architecture notes | Owner approves both |
| 1 | Foundation | App shell, local data store, settings, BYOK providers + model picker, streaming chat, folders (5 levels) + chats, auto-naming, markdown/math/code rendering, token recording + chat meter + caps (F-1101, F-1102, F-1104, F-1105) | Create folder → chat → talk to a model; usage recorded; cap blocks |
| 2 | Materials & Ledger | Ingestion (PDF/slides/docs/images/web/YouTube), chunking, extraction, recall audit, dedup, ledger UI, cost pre-flight, material viewer | A real textbook yields a well-formed ledger: every item typed, titled, stated and anchored to a page that holds its quote (checked automatically; owner review not required) |
| 3 | Study Plan | Brief Compiler, planner with code-enforced coverage, plan map/outline (data-only rendering, §7.5), deadline schedule, today view | Plan covers 100 % of ledger; schedule re-balances |
| 4 | Teach | Retrieval with keyword index + configurable embeddings (F-1004, F-1005), probe, session plan panel, checks + confidence + thinking, repair loop, item status updates, recap, quick actions | Full lesson from plan click to recap; ledger statuses move |
| 5 | Interactives | Widget grammars + renderer in the design language (§7.5), SVG sanitiser, Distil kit for sandboxed mini-apps with test-before-show and design lint, visual maker, interactivity dial | Dial demonstrably changes behaviour; mini-app errors self-heal; every visual follows the active theme, palette and font with no hard-coded styling |
| 6 | Practice & Exams | Practice sets, mock exams, timer, grading incl. handwritten, results → mastery/cards | Mock exam generated, taken, graded |
| 7 | Retention | Flashcards + FSRS, mastery view (levels/percent setting), recommender, streaks/XP (off by default), knowledge graph as data rendered by Distil (§7.5), sibling-chat digest | Daily loop: today view → lesson → reviews |
| 8 | Providers+ & usage | Google sign-in (experimental), usage dashboard + graphs, custom endpoints, researcher/topic-only, web search | Gemini via Google login works behind the warning |
| 9 | Ship | Windows installer, auto-update, export/import, keyboard pass, accessibility pass, README/credits, built-in tutorial chat (F-1312) | Installable build; the tutorial chat walks a new user through every mode |

| 10 | Tune | Ledger quality (merge misses, quote matching across hyphenation and ligatures, extraction noise) and answer quality (grounding, teaching, grading), measured with saved evaluation sets and fixed against them | Agreed quality bar met on the textbook and the owner's own material |

Phases 5–8 can be re-ordered on request. Quality tuning is deliberately last (owner, 2026-10-31).

---

## 16. Non-goals (v1)

- No hosted service, accounts, or cloud sync (local-first decision).
- No social features / leaderboards.
- No video generation or text-to-speech lectures.
- No mobile app (local web works on a phone over LAN at best).
- No copying of LearnHarness code — ideas only.

## 17. Risks

| Risk | Mitigation |
|---|---|
| Google OAuth reuse violates ToS → user accounts suspended | Off by default, explicit warning + confirmation, API key path always primary |
| Exhaustive extraction is expensive on big material | Pre-flight estimate, cheap-model first pass option, caps, resumable jobs |
| "Complete" extraction still misses implicit content (things only in diagrams) | Vision pass on figure-heavy pages, recall audit, user "what did we miss?", manual items |
| Generated mini-apps are buggy | Test-before-show sub-agent, error auto-report loop, widget catalog for common cases |
| Scope is large | Strict phases, M/S/C priorities, owner prunes this list |
| YouTube transcript availability varies | Fallback: user uploads audio/video → transcription (C) |

## 18. Open questions for the owner

1. ~~**Product name.**~~ **Resolved 2026-10-31:** the app is called **Distil** (see §2).
2. ~~**License.**~~ **Resolved:** MIT (§2).
3. ~~**Mastery display.**~~ **Resolved:** both, configurable (§2, F-914).
4. ~~**Gamification default.**~~ **Resolved:** off until enabled (F-934).
5. ~~**Chats in the same folder.**~~ **Resolved:** shared digest by default, "Independent" switch (F-925).
6. ~~**Practice grading.**~~ **Resolved:** first attempt counts, then hinted retries; exams one attempt (F-804).
7. ~~**Default model suggestions.**~~ **Resolved:** suggested per role (F-1210).
8. Anything in §16 Non-goals you actually want in v1?
