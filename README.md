# learning-harness

> Working name. Status: **planning** — no app code yet. See [plan.md](plan.md).

A local-first, open-source study app. Bring your material (PDFs, slides, notes, photos, links,
YouTube) or just a goal, and get a study plan that provably covers everything in it. Then learn it
in the same app: an AI teacher that probes what you know, teaches one step at a time with
diagrams and interactive mini-apps, checks you after every step, and keeps you retaining it with
practice exams, flashcards, a knowledge graph and progress tracking.

## Planned highlights

- **Brief Compiler** — turns a vague prompt into a full study spec, so output quality does not depend on prompt-writing skill.
- **Coverage Ledger** — every concept, formula and example in your material is extracted and tracked; the plan is checked in code to cover 100 % of it.
- **Four modes** — Study Plan, Teach (Socratic), Practice & Mock Exams, Quick Q&A.
- **Interactive learning** — plots, flowcharts, step-through derivations, simulations; you control how much with an interactivity dial.
- **Subject workspaces** — nested folders (up to 5 levels) sharing materials, plan, ledger and deck.
- **Retention** — flashcards with spaced repetition, mastery view, knowledge graph, opt-out streaks.
- **Your keys, your data** — bring your own provider keys or (experimental) sign in with Google for Gemini; everything stays on your machine. Token usage graphs and spending caps built in.

## Documentation

| File | What |
|---|---|
| [plan.md](plan.md) | Full scope, decisions, feature IDs, phases |
| [PROGRESS.md](PROGRESS.md) | Current status |
| [AGENTS.md](AGENTS.md) | Rules for coding agents working on this repo |

## Credits

The idea and the teaching theory (probe → plan → teach one reasoning step at a time → check →
practice, plus the cross-session knowledge graph) come from
[LearnHarness](https://github.com/amosblomqvist/learnharness) by amosblomqvist (AGPL-3.0).
This project is an independent re-implementation — no code is copied. What we add on top:
material ingestion with an enforced coverage ledger, a brief compiler for weak prompts, nested
subject workspaces, deadline scheduling, a typed widget catalog with an interactivity dial,
mock exams, flashcards with spaced repetition, mastery tracking, and token caps with usage graphs.

## License

To be decided (proposed MIT) — see `plan.md` §18.
