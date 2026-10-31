# Distil

> Status: **early development** — Phase 1 (folders, chats, streaming Ask mode, your own keys, token caps) works. Study plans, teaching and the coverage ledger come next. See [PROGRESS.md](PROGRESS.md).

A local-first, open-source study app. Bring your material (PDFs, slides, notes, photos, links,
YouTube) or just a goal, and get a study plan that provably covers everything in it. Then learn it
in the same app: an AI teacher that probes what you know, teaches one step at a time with
diagrams and interactive mini-apps, checks you after every step, and keeps you retaining it with
practice exams, flashcards, a knowledge graph and progress tracking.

## Run it

Needs [Node.js](https://nodejs.org) 24 or newer.

```bash
npm install
npm run fonts   # downloads Satoshi once (its licence doesn't allow committing it)
npm run dev     # http://127.0.0.1:5173
```

For a production build: `npm run build`, then `npm start` (http://127.0.0.1:4321). Your data lives in
`~/Distil`; set `DISTIL_DATA_DIR` to put it elsewhere. Add a provider key under Settings › Providers.
Google AI Studio has a free tier. Keys stay in that folder and are only sent to their own provider.
Settings › Appearance changes the theme, the colour palette and the text font (Satoshi, Anthropic Sans if
you have it installed, or any font of your own).

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
| [DESIGN.md](DESIGN.md) | UX flows, screens, visual system |
| [design/](design/index.html) | Clickable mock-ups. Run `bash design/scripts/fetch-fonts.sh` once (Satoshi can't be committed), then `python -m http.server 4173 --directory design` |
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

[MIT](LICENSE). Fonts keep their own licences: Instrument Serif and JetBrains Mono are SIL OFL;
Satoshi (ITF Free Font Licence) is downloaded by `npm run fonts`, not shipped in this repository.
