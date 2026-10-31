# Parallel build of Phases 3–8

Owner decision 2026-11-01 (`plan.md` §2, "Parallel build"). Six phases are built at the same time, one
agent per phase, each on its own branch and worktree. Phases 9 (Ship) and 10 (Tune) run after the merge.
This file is the hand-off: if a run stops (usage limit, crash), read it, then the phase's own log, and
carry on from that log's "Next steps".

## Status

| Phase | Branch | Worktree | Log | Agent status |
|---|---|---|---|---|
| 3 Study Plan | `phase-3` | `D:/learning-harness-wt/phase-3` | `progress/phase-3.md` | not started |
| 4 Teach | `phase-4` | `D:/learning-harness-wt/phase-4` | `progress/phase-4.md` | not started |
| 5 Interactives | `phase-5` | `D:/learning-harness-wt/phase-5` | `progress/phase-5.md` | not started |
| 6 Practice & Exams | `phase-6` | `D:/learning-harness-wt/phase-6` | `progress/phase-6.md` | not started |
| 7 Retention | `phase-7` | `D:/learning-harness-wt/phase-7` | `progress/phase-7.md` | not started |
| 8 Providers+ & usage | `phase-8` | `D:/learning-harness-wt/phase-8` | `progress/phase-8.md` | not started |
| Merge | `main` | `D:/learning-harness` | this file | waiting |

The coordinator (the session that started the agents) updates this table. Each agent keeps only its own log current.

## Resuming

1. `git -c safe.directory=* worktree list`: each phase's worktree and branch.
2. In the phase's worktree, read `progress/phase-N.md`: "Next steps" is where to pick up. `git log --oneline main..` shows what is committed.
3. Uncommitted changes in a worktree are work in progress from the interrupted run: finish or discard them deliberately; never lose them silently.
4. When every phase's log says **Status: done**, merge in order 3, 4, 5, 6, 7, 8 (see "Merging").

## The shared contract (on `main` before the branches were cut)

- **Schema:** migration 9 in `server/db.ts`: `briefs`, `plans`, `plan_units`, `lessons`, `lesson_items`,
  `lesson_prereqs`, `chats.lesson_id`, `items.provenance`, `item_events`, `cards`. Never edit it on a branch.
  A phase that needs more appends its own migration *after* it; that migration must not touch another
  phase's new tables. The merge renumbers branch migrations into phase order, so keep each one self-contained.
- **`server/learning/types.ts`:** `Brief` (Zod), item statuses, event kinds, chat modes, provenance.
- **`server/learning/learner.ts`:** `learner.record(event)` appends evidence; `learner.advance(ids, status)` moves
  statuses forward only. Every mode writes learner state through it (available as `deps.learner` in `server/http.ts`).
- **Item statuses:** Phase 3 sets `planned`; Phase 4 records `taught` and checks; Phases 4 and 6 record
  check/practice/exam evidence; Phase 7 owns `mastered` and the mastery formula.

## Who owns what

Each phase works only in its own files and API prefix. Shared files (`server/http.ts`, `server/main.ts`,
`server/settings.ts`, `web/src/lib/state.svelte.ts`, `web/src/lib/api.ts`, `web/src/components/App.svelte`,
`WorkspaceView.svelte`, `SettingsView.svelte`, `Sidebar.svelte`) get **small additive edits only**: register
routes from your own module (`registerXRoutes(app, deps)` in `server/<area>/routes.ts`), add your route and tab,
add your settings fields. No reformatting or reordering in shared files, so the merge stays mechanical.

| Phase | Features | Server | API | Web routes |
|---|---|---|---|---|
| 3 | F-101…F-105, F-304, F-305/F-307 coverage bars, F-501…F-510 | `server/plan/` | `/folders/:id/brief`, `/folders/:id/plan…`, `/lessons/:id` (GET, PATCH), `/today` | `#/folder/:id/plan`, `#/today` |
| 4 | F-601…F-616, F-308, F-311, F-314, F-406, F-408, F-1001…F-1007 | `server/teach/`, `server/retrieval/` | `POST /lessons/:id/start` → `{ chatId }`, `/chats/:id/teach/…`, `/folders/:id/retrieve`, embeddings settings | Teach inside `#/chat/:id` (mode `teach`); grounding in Ask |
| 5 | F-701…F-712, F-721…F-725, F-731, F-732, F-741…F-744, F-751…F-760 | `server/visuals/` | `/visuals/…` | widget renderers in `web/src/lib/widgets/` and `web/src/components/widgets/`, hooked into `markdown.ts` |
| 6 | F-801…F-809 | `server/practice/` | `/folders/:id/practice…`, `/practice/:id…`, `/exams/:id…` | `#/folder/:id/practice`, `#/practice/:id`, `#/exam/:id` |
| 7 | F-901…F-905, F-911…F-914, F-921…F-925, F-931…F-934 | `server/retention/` | `/cards…`, `/review…`, `/folders/:id/mastery`, `/graph…`, `/streaks` | `#/review`, `#/review/:folderId`, `#/folder/:id/progress`, `#/graph` |
| 8 | F-1103…F-1109, F-1203, F-1205, F-1209, F-1210, F-205 | `server/usage/`, `server/auth/`, `server/research/` | `/usage/…`, `/auth/google/…`, `/research/…` | `#/settings/usage`, Google sign-in in Settings › Providers, topic-only start |

Cross-phase hand-offs, built against the contract and joined at the merge:
- Phase 3's "Start lesson" calls `POST /api/lessons/:id/start` (Phase 4) and opens `#/chat/<chatId>`.
- Phase 3's Today view counts due cards straight from `cards` (`due_at <= now`) and links to `#/review`;
  it links a practice suggestion to `#/folder/:id/practice`. Phase 7's recommender (F-913) replaces the ordering after the merge.
- Phases 4 and 6 create cards with `state = '{}'` and `due_at = now`; Phase 7's scheduler takes them from there.
- Phase 4 teaches with Markdown; fenced widget blocks render once Phase 5 is merged. Phase 4 includes the grammar
  reference in its prompt only through a function Phase 5 exports (`widgetPromptReference(dial)`); until then, none.
- Phase 3 exposes `briefContext(folderId)` for prompts (F-105); Phases 4 and 6 use it after the merge.

## Rules for every phase agent

1. Read `AGENTS.md`, `PROGRESS.md`, `plan.md` (your sections and §4.5), `DESIGN.md` (your screens), this file, then your log.
2. Work only in your worktree, on your branch. Never touch another worktree, `main`, or another phase's files.
3. **Commit after every coherent step**, with your log updated in the same commit (`feat(plan): … (F-501)`). Never push.
4. **Log as you go** in `progress/phase-N.md`: what is done (with F-ids), what is in progress, the exact next steps,
   decisions needing owner review, packages added, test counts, anything a fresh agent needs to resume.
5. **Decisions** not covered by `plan.md`/`DESIGN.md`: pick the option most consistent with them, build it, and list
   it under "Needs owner review" with the alternatives.
6. **Packages:** well-known npm packages only, each listed in your log with why. No other downloads, binaries or models.
7. **Testing:** every feature ships with Vitest tests for its deterministic logic (fake models, no network).
   Before marking the phase done: `npm test` and `npm run check` clean, and every screen checked in a browser
   against a fake model (desktop and phone width, dark and light). Then **one** short smoke test with the owner's
   real Google key on your data copy; never print, log or commit the key.
8. **Dev server:** your own port and data copy (table below). Start it with
   `DISTIL_DATA_DIR=<data> npx vite --port <port> --strictPort` in the background; stop it when done.
9. Finish when your phase's exit criteria (`plan.md` §15) are met, or a feature can't be built without another
   phase: build against the contract, note it in your log, and stop there. Set **Status: done** when finished.

| Phase | Dev port | Fake model port | Data copy |
|---|---|---|---|
| 3 | 5183 | 12003 | `D:/learning-harness-wt/data/phase-3` |
| 4 | 5184 | 12004 | `D:/learning-harness-wt/data/phase-4` |
| 5 | 5185 | 12005 | `D:/learning-harness-wt/data/phase-5` |
| 6 | 5186 | 12006 | `D:/learning-harness-wt/data/phase-6` |
| 7 | 5187 | 12007 | `D:/learning-harness-wt/data/phase-7` |
| 8 | 5188 | 12008 | `D:/learning-harness-wt/data/phase-8` |

A sample fake OpenAI-compatible server is at `progress/fake-llm.mjs` (`node progress/fake-llm.mjs <port>`); adapt
a copy for your agents' JSON replies. Point a custom provider at it in Settings › Providers.

## Merging

In the main checkout, phase order 3 → 8: merge each branch, renumber its migrations to follow the ones already
merged, resolve the additive conflicts in shared files, then run `npm test`, `npm run check` and a browser pass
over every screen. Fold each phase log into `PROGRESS.md`, update `README.md` and `AGENTS.md`, commit. Then Phases 9 and 10.
