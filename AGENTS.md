# AGENTS.md — directions for coding agents

Read this file fully before doing anything in this repo.

## 1. Start of every session

1. Read `PROGRESS.md` — it says which phase we are in, what is done, and what is next.
2. Read `plan.md` — the approved scope. Feature IDs (`F-xxx`) are the shared vocabulary.
3. Read `DESIGN.md` once it exists — UX and visual rules. Do not invent UI that contradicts it.
4. Continue from the "Next up" item in `PROGRESS.md`. Do not start a later phase early.

## 2. Workflow rules

- **Work in phases** as defined in `plan.md` §15. One phase at a time.
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

## 4. Repository map

| Path | Purpose |
|---|---|
| `plan.md` | Product scope, decisions, phases, feature IDs |
| `DESIGN.md` | UX flows, screens, visual system, motion tokens (draft, awaiting approval) |
| `PROGRESS.md` | Living status log — the hand-off between sessions |
| `README.md` | User-facing overview, setup, credits |
| `AGENTS.md` | This file |
| `CLAUDE.md` | Pointer to this file |
| `design/` | Clickable design mock-ups (landing, app screens, dialogs) on the real tokens; open `design/index.html` |
| `design/scripts/fetch-fonts.sh` | Downloads Satoshi (licence forbids committing it) |
| `.claude/launch.json` | Preview server `design` on port 4173 |

Extend this table as code directories are created.
