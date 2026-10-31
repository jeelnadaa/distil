# PROGRESS

Living status log. Update in the same commit as every change.

## Current phase

**Phase 0 — Plan & design.**

## Next up

1. Owner reviews the clickable mock-ups in `design/` (run `bash design/scripts/fetch-fonts.sh`, then serve `design/` and open `index.html`), approves or requests changes.
2. Owner picks a palette (`design/palettes.html`; copper or one of four alternatives) and answers the other `DESIGN.md` §13 questions.
3. Logo: 3 SVG directions, recommendation, icon-only, monochrome and animated versions (current mark is provisional).

## Phase checklist

- [x] Phase 0a — Study the LearnHarness reference and draft `plan.md`
- [ ] Phase 0b — Owner approves `plan.md`
- [ ] Phase 0c — `DESIGN.md` written (done) and approved (pending)
- [ ] Phase 0d — Logo directions
- [ ] Phase 0e — Landing page and app mock-ups built (done), approved (pending)
- [ ] Phase 1 — Foundation
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

## Open questions

See `plan.md` §18.

## Known issues

None yet.
