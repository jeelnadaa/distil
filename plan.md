# Learning Harness — Product Plan & Scope

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
| Relation to LearnHarness | **Ideas only, our own code.** Credit in README. We choose our own license (proposed MIT — see §15). |

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
| F-204 | Ingest YouTube by URL (transcript with timestamps) | M |
| F-205 | Topic-only mode: no material → a **researcher agent** builds a reference syllabus from the web (with sources) which then becomes the "material" | M |
| F-206 | **Structure-aware chunking:** split by headings / slides / pages / timestamps into small chunks with stable anchors (file, page, slide, timestamp) | M |
| F-207 | **Per-chunk extraction** of atomic *learning items* (see 4.3), so a 300-page PDF is mined page-group by page-group, never summarised in one call | M |
| F-208 | Pre-flight **cost estimate** before ingesting large material ("~180k tokens ≈ $0.40 on model X — continue?") | M |
| F-209 | Ingestion runs as a background job with progress, pause/abort, resume after restart | M |
| F-210 | Material viewer: open the original file at the anchored page/slide/timestamp from any item, lesson or answer | M |
| F-211 | Syllabus / past-paper detection: if a file looks like a syllabus or exam paper, it is used to set scope and exam weighting | S |
| F-212 | Re-ingest on file change; diff shows new/removed items | S |
| F-213 | Math-aware extraction (LaTeX for formulae, tables kept as tables) | M |

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

### 4.4 Agent architecture (summary; details go in DESIGN/architecture docs)

| Agent | Job | Model slot |
|---|---|---|
| Brief Compiler | request → Study Brief | cheap |
| Extractor | chunk → learning items | strong |
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

## 8. Mode 3 — Practice & Mock Exams

| ID | Feature | Pri |
|----|---------|-----|
| F-801 | Practice set from: a lesson, a unit, selected ledger items, weak items, or graph nodes | M |
| F-802 | Difficulty ladder (worked example → completion → direct → composition → open problem) and "distance" (same context → new context → far transfer) | S |
| F-803 | **Mock exam** generator matching the course's style (from past papers if provided): sections, marks, time limit, instructions | M |
| F-804 | Timer + exam mode (no hints) vs practice mode (hints allowed) | M |
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

### 9.3 Knowledge graph (LearnHarness-inspired)

| ID | Feature | Pri |
|----|---------|-----|
| F-921 | Persistent cross-chat graph: nodes = propositions/concepts, edges = *follows from* / *supports* | S |
| F-922 | Built by a background extractor → auditor pipeline over sessions (and materials), updating continuously, even from unfinished sessions | S |
| F-923 | Nodes link to ledger items and to exact source messages | S |
| F-924 | Clusters by topic, pan/zoom, label fade by zoom, filter by folder | S |
| F-925 | Graph as context: new sessions on related topics see what you already know | S |
| F-926 | Import notes (Markdown/Obsidian vault) into the graph | C |
| F-927 | Chain/table view for managing nodes (search, select, delete, make practice set) | C |

### 9.4 Streaks & gamification (opt-in)

| ID | Feature | Pri |
|----|---------|-----|
| F-931 | Daily study streak (lesson, review or practice counts), with freeze days | S |
| F-932 | XP / levels tied to *verified* learning (checks passed, cards reviewed), never to time spent or messages sent | S |
| F-933 | Milestone badges (first unit 100 % covered, first mock exam, 30-day streak…) | C |
| F-934 | Whole system can be turned off in Settings (default: on, subtle) | M |

## 10. Mode 4 — Quick Q&A

| ID | Feature | Pri |
|----|---------|-----|
| F-1001 | Plain ask-anything chat with folder materials + brief as context, with citations to material anchors | M |
| F-1002 | "Turn this into a lesson" / "make cards from this" buttons on answers | S |
| F-1003 | Mode can be switched inside a chat (Q&A → Teach) without losing history | S |

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
| F-1206 | Keys stored locally, encrypted with the OS credential store where available; never sent anywhere but the provider | M |
| F-1207 | Graceful capability fallback (e.g. no vision model → images ingested via OCR or flagged) | M |
| F-1208 | Other subscription logins (ChatGPT, Copilot) — same opt-in/warning pattern | C |
| F-1209 | Web search provider for researcher agent (key-based; optional) | S |

## 13. App, settings & quality of life

| ID | Feature | Pri |
|----|---------|-----|
| F-1301 | First-run onboarding: pick provider → key or Google sign-in → pick models → create first subject | M |
| F-1302 | Settings: providers, models/roles, interactivity dial, caps, appearance (light/dark/system), keyboard, prompts, gamification, data location | M |
| F-1303 | Keyboard shortcuts for everything; shortcut sheet (`?`) | S |
| F-1304 | Data stored in a user-chosen folder; backup/restore | M |
| F-1305 | Windows installer + auto-update; local web mode for any OS | M |
| F-1306 | Crash-safe: background jobs resume or report "interrupted" honestly after restart | M |
| F-1307 | Accessibility: screen-reader labels, focus order, contrast, reduced motion | S |
| F-1308 | Multilingual: learn in any language the model supports (UI English first) | S |

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
| — | 🆕 Streaks/XP F-931…F-934 | LearnHarness deliberately rejects; ours is opt-out and tied to verified learning |
| — | 🆕 Q&A mode F-1001…F-1003 | |

---

## 15. Build phases

Each phase ends with: features working end-to-end, tests green, docs updated (`PROGRESS.md`,
`README.md`, `AGENTS.md` if conventions changed), **one or more local commits — never pushed**.

| Phase | Name | Contents | Exit criteria |
|---|---|---|---|
| 0 | Plan & design | `plan.md` ✅, `DESIGN.md` (UX flows, screens, visual system), architecture notes | Owner approves both |
| 1 | Foundation | App shell, local data store, settings, BYOK providers + model picker, streaming chat, folders (5 levels) + chats, auto-naming, markdown/math/code rendering, token recording + chat meter + caps (F-1101, F-1102, F-1104, F-1105) | Create folder → chat → talk to a model; usage recorded; cap blocks |
| 2 | Materials & Ledger | Ingestion (PDF/slides/docs/images/web/YouTube), chunking, extraction, recall audit, dedup, ledger UI, cost pre-flight, material viewer | A 4-unit syllabus PDF yields a ledger the owner judges complete |
| 3 | Study Plan | Brief Compiler, planner with code-enforced coverage, plan map/outline, deadline schedule, today view | Plan covers 100 % of ledger; schedule re-balances |
| 4 | Teach | Probe, session plan panel, checks + confidence + thinking, repair loop, item status updates, recap, quick actions | Full lesson from plan click to recap; ledger statuses move |
| 5 | Interactives | Widget catalog (M items), sandboxed mini-apps with test-before-show, visual maker, interactivity dial | Dial demonstrably changes behaviour; mini-app errors self-heal |
| 6 | Practice & Exams | Practice sets, mock exams, timer, grading incl. handwritten, results → mastery/cards | Mock exam generated, taken, graded |
| 7 | Retention | Flashcards + FSRS, mastery view, recommender, streaks/XP, knowledge graph | Daily loop: today view → lesson → reviews |
| 8 | Providers+ & usage | Google sign-in (experimental), usage dashboard + graphs, custom endpoints, researcher/topic-only, web search | Gemini via Google login works behind the warning |
| 9 | Ship | Windows installer, auto-update, export/import, keyboard pass, accessibility pass, README/credits | Installable build |

Phases 5–8 can be re-ordered on request.

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

1. **Product name.** Working name "learning-harness" is very close to "LearnHarness". Keep, or pick a distinct name?
2. **License.** Proposed **MIT** (permissive). OK, or prefer AGPL/GPL to keep forks open?
3. **Mastery display:** numbers (72 %), named levels (new / shaky / solid / mastered), or colour only?
4. **Gamification default:** on-subtle (proposed) or off until enabled?
5. **Chats in the same folder** — should a new chat automatically know what was taught in sibling chats (via ledger/graph), or stay independent unless asked?
6. **Practice grading** — one attempt per problem (LearnHarness) or allow retries with hints?
7. **Default model suggestions** — should onboarding recommend specific models per role, or leave fully to the user?
8. Anything in §16 Non-goals you actually want in v1?
