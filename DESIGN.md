# Distil — Design

> Status: **DRAFT v1, awaiting owner review.** Scope lives in `plan.md`; this file decides how
> Distil looks, moves and flows. Feature IDs (`F-xxx`) point into `plan.md`.
>
> **Living reference:** `design/` holds clickable mock-ups of the landing page, every key screen and
> every dialog, built on the real tokens (`design/css/tokens.css`). Open `design/index.html`.

---

## 1. Point of view

Distil boils material down to its essence. The interface should feel the same way: **clear, quiet and
concentrated.** It should feel like a well-made instrument, not a chat toy.

Five principles, in priority order:

1. **Clarity over decoration.** Every pixel either carries meaning or gives meaning room. Decoration has to earn its place.
2. **Type does the work.** Hierarchy comes from typography and whitespace first. Colour, borders and shadows come after.
3. **One essence per screen.** Copper, the accent, marks the single most important thing: the current step, the primary action, or the coverage that's left. If everything is copper, nothing is.
4. **Motion explains.** Every animation shows where something came from, where it went, or what changed. There is no motion just for delight, but the signature moments are allowed to be memorable.
5. **Calm under load.** Background jobs, token counts and long material never make the screen noisy. Status lives at the edges and steps forward only when it needs you.

### What we refuse

Purple or blue gradients, glassmorphism, glow blobs, emoji used as icons, stock or 3D illustrations,
"AI sparkle" iconography, uniform card grids, and chat bubbles. We also refuse pill-shaped everything,
drop shadows on every surface, and centred hero copy over a gradient mesh.

---

## 2. Brand motif — distillation, used subtly

The motif shows up as **behaviour and geometry**, never as pictures of flasks or beakers.

| Motif | Meaning | Where it shows up |
|---|---|---|
| **The Drop** | The essence; the single concentrated point | Current position in a plan, "you are here", unread marker, coverage-complete mark, the logo's core |
| **The Filter Line** | A hairline that tapers from 2px to 0, like liquid narrowing through a neck | Section dividers, the active-tab indicator, the progress track's leading edge |
| **Condensation** | Diffuse becomes crisp | Headline entrances (letter-spacing and blur settle into place), loading becoming loaded, wrong-to-right repair |
| **Concentration gradient** | Raw on one side, refined on the other | The ingestion screen (raw chunks on the left, ledger items on the right), the landing-page hero |
| **Fewer, denser** | Many items reduce to a few | Collapsing lists into counts, three coverage bars merging into one drop at 100 % |

### 2.1 Logo (under review)

The wordmark is "distil" in Instrument Serif with accent drops for the two i-dots. Three marks share
it, all on a 32-unit grid and all ending in the accent drop. Compare them in `design/logo.html`.

| Direction | Idea | Verdict |
|---|---|---|
| Condense (current placeholder) | Three bars narrowing to a drop | Clear, but reads as the standard UI filter icon |
| **Drop-d** (recommended) | A lowercase d whose bowl is a drop; the essence sits in the counter | Ownable letterform, crisp at 16px, works in one colour |
| Converge | Five lines converging into a drop | Expressive, but blurs below 24px; better as illustration |

Each ships as `design/assets/logo/distil-<id>.svg` plus `-icon` (app tile), `-mono` (single colour;
Drop-d knocks the counter out) and `-animated` (2.8 s loop, still under reduced motion). The wordmark
must be outlined to paths before it ships as a standalone file.

---

## 3. Typography

Typography is the hero. There are three families, each with one clear job.

| Role | Family | Licence | Use |
|---|---|---|---|
| **Display** | **Instrument Serif** (Regular + Italic) | SIL OFL | Headlines, hero, screen titles, lesson titles, big numbers. The italic is reserved for *the essence word* in a headline. |
| **Text / UI** | **Satoshi** (Variable, 300–900) | Fontshare ITF Free Font Licence | Default for everything else: UI, body, lesson prose, controls |
| **Mono** | **JetBrains Mono** (Variable) | SIL OFL | Code, token counts, keyboard hints, eyebrow labels, source anchors (`p.14`, `slide 6`, `12:40`) |

**Why this pairing:** Satoshi is geometric and neutral but warm, which makes long reading comfortable.
Instrument Serif is condensed and sharply contrasted: an editorial voice that no AI-app template uses.
The mono adds a "lab notebook" precision for numbers and sources.

**Self-hosting:** WOFF2 files go in `public/fonts/` and load through `@font-face` with
`font-display: swap`. The Satoshi variable file and Instrument Serif Regular are preloaded; italic
and mono load lazily. Subset to Latin + Latin-Extended + math symbols. No Google Fonts or Fontshare
CDN at runtime, because the app is local-first and must work offline.

> ⚠ Satoshi's ITF Free Font Licence allows embedding in apps and sites but forbids distributing the
> files from a repository or public server. So the font files are gitignored and
> `design/scripts/fetch-fonts.sh` downloads them from Fontshare; the app build will do the same.

### Type scale

UI steps use a 1.2 ratio from a 16px base. Display steps jump harder (about 1.33). Display sizes use
`clamp()` so they scale fluidly between 360px and 1440px viewports.

| Token | Family | Size / line-height | Weight | Tracking | Use |
|---|---|---|---|---|---|
| `display-2xl` | Instrument Serif | clamp(56px, 9vw, 128px) / 0.92 | 400 | -0.025em | Landing hero |
| `display-xl` | Instrument Serif | clamp(44px, 6vw, 88px) / 0.95 | 400 | -0.02em | Landing section heads |
| `display-lg` | Instrument Serif | clamp(36px, 4vw, 56px) / 1.0 | 400 | -0.015em | Screen titles (Today, workspace name) |
| `display-md` | Instrument Serif | 36px / 1.05 | 400 | -0.01em | Lesson title, empty states, big stats |
| `heading-lg` | Satoshi | 24px / 30px | 700 | -0.01em | Panel titles, dialog titles |
| `heading-md` | Satoshi | 20px / 28px | 600 | -0.005em | Section heads in lessons |
| `heading-sm` | Satoshi | 17px / 24px | 600 | 0 | Card titles, list group heads |
| `body-lg` | Satoshi | 18px / 30px | 400 | 0 | **Lesson reading text**, measure ≤ 68ch |
| `body` | Satoshi | 16px / 26px | 400 | 0 | Default UI text, Q&A answers |
| `body-sm` | Satoshi | 14px / 20px | 450 | 0.003em | Secondary UI, table cells, sidebar |
| `caption` | Satoshi | 12px / 16px | 500 | 0.01em | Meta, timestamps, helper text |
| `eyebrow` | JetBrains Mono | 11px / 16px | 500 | 0.08em, UPPERCASE | Section labels, phase labels ("PROBE", "TEACHING") |
| `mono` | JetBrains Mono | 14px / 22px | 400 | 0 | Code, numbers, anchors |
| `mono-num` | JetBrains Mono | inherits | 500 | tabular-nums | Token counters, timers, scores |

**Rules**
- A screen gets **one** display-face element. Never use two serif headlines that compete.
- Italic Instrument Serif marks the essence word only: "Everything in your syllabus, *distilled*."
- Numbers that change (tokens, timers, scores) always use `mono-num` so they don't jitter.
- Lesson prose sets `font-feature-settings: "ss01", "kern"`. Math renders in KaTeX's own fonts, sized to `1.05em` so it optically matches Satoshi.
- Minimum UI size is 12px. Minimum reading size is 16px.

---

## 4. Colour

### 4.1 Palette philosophy

**Warm paper and ink, with one copper accent.** Copper nods to the copper still without drawing it.
Neutrals are warm, never blue-grey. Semantic colours are earthy and desaturated so they sit inside
the palette instead of shouting over it.

### 4.2 Semantic tokens

All text pairs below pass **WCAG AA** (≥ 4.5:1 for text, ≥ 3:1 for control boundaries). I checked
them with the WCAG 2.x luminance formula; the lowest measured ratio is in the last column.

| Token | Light | Dark | Use | Min contrast |
|---|---|---|---|---|
| `--bg` | `#F5F2EB` | `#11100E` | App canvas | — |
| `--surface` | `#FBFAF6` | `#1A1815` | Panels, cards, composer | — |
| `--surface-sunken` | `#ECE8DE` | `#0B0A09` | Wells, code blocks, sidebar | — |
| `--text` | `#15130F` | `#F1EDE4` | Primary text | 15.2 / 15.2 |
| `--text-muted` | `#57524A` | `#B5AEA2` | Secondary text | 6.3 / 8.1 |
| `--text-faint` | `#6E675E` | `#948C80` | Meta, placeholders | 4.6 / 5.3 |
| `--border` | `#DAD4C8` | `#2E2A25` | Decorative hairlines | (non-text) |
| `--border-control` | `#8A8276` | `#756E63` | Input/checkbox outlines | 3.4 / 3.5 |
| `--accent` | `#A8461A` | `#E07A45` | **Copper**: the essence | 4.8 / 5.9 |
| `--on-accent` | `#FFF8F2` | `#1A0D05` | Text on copper fill | 5.6 / 6.4 |
| `--accent-wash` | `#A8461A` @ 8 % | `#E07A45` @ 12 % | Current-row tint, selection | — |
| `--success` | `#2F6B3F` | `#7BC48D` | Correct, mastered, covered | 5.2 / 8.5 |
| `--warning` | `#855600` | `#E3B34A` | Cap warning, shaky | 5.2 / 9.1 |
| `--danger` | `#B3261E` | `#F2857B` | Errors, hard stop, delete | 5.3 / 7.1 |
| `--focus` | `--accent` | `--accent` | 2px focus ring, 2px offset | ≥ 3 |
| `--primary` | `#15130F` | `#F1EDE4` | Primary button fill (ink) | — |
| `--on-primary` | `#FBFAF6` | `#11100E` | Text on primary | 17.8 / 15.2 |

**Opinionated choice:** the primary button is **ink**, not copper. Copper is saved for the one
essential thing on each screen (for example "Start lesson" on Today). That keeps the accent rare and
meaningful.

### 4.3 Data-visualisation palette (usage graphs, mastery, ledger types)

These are categorical and ordered for maximum separation. Each sits at ≥ 4.8:1 against `--surface` in its theme (measured).

| Slot | Light | Dark | Typical series |
|---|---|---|---|
| 1 Ink | `#2A2723` | `#E8E2D6` | Input tokens |
| 2 Copper | `#A8461A` | `#E07A45` | Output tokens |
| 3 Sage | `#4F6E4B` | `#8FB58A` | Cached tokens |
| 4 Slate | `#4A5F6B` | `#9AB0BC` | Reasoning tokens |
| 5 Ochre | `#8A6A1E` | `#D2B062` | Background jobs |
| 6 Clay | `#7E4E40` | `#C99482` | Other |

Mastery uses a **sequential copper ramp**, not traffic lights: new → shaky → solid → mastered is
4 % → 30 % → 65 % → 100 % copper on surface. Every state also carries a text label, so colour is
never the only signal.

### 4.4 Palettes (user setting)

Users pick one of five palettes in **Settings › Appearance** (F-1302); **Copper is the default**. Each
swaps paper, ink and the single accent together, in both themes; success, warning and
danger stay shared. All text pairs pass AA (accent ≥ 5.0:1 on every surface, muted ≥ 6:1, faint ≥ 4.5:1).
Values live in `design/css/palettes.css` (applied as `:root[data-palette]`, saved per user); compare
them in `design/palettes.html`.

| Palette | Mood | Accent light / dark |
|---|---|---|
| Copper (default) | Warm paper and ink | `#A8461A` / `#E07A45` |
| Verdigris | Cool stone, deep teal: copper's patina | `#1C6B62` / `#5CC2B2` |
| Oxblood | Parchment and wine, bookish | `#862B3A` / `#E8899A` |
| Cobalt | Lab-glass white, cobalt ink (flat, never a gradient) | `#2A47C9` / `#8FA3FF` |
| Citron | Neutral graphite, sharp citron; best in dark | `#566600` / `#D2E35A` |

Watch-outs: Oxblood's accent sits near `danger`, so danger UI must keep its icon and label; Verdigris
sits near `success`.

### 4.5 Theme switching

The theme follows `prefers-color-scheme`, with a System / Light / Dark override in Settings. Themes
are set on `:root[data-theme]`. Switching crossfades `background-color` and `color` over
`--dur-base`, with no flash.

---

## 5. Space, layout, shape, depth

| Token | Value |
|---|---|
| Base unit | 4px |
| Spacing scale | `--s-1` 4 · `--s-2` 8 · `--s-3` 12 · `--s-4` 16 · `--s-5` 24 · `--s-6` 32 · `--s-7` 48 · `--s-8` 64 · `--s-9` 96 · `--s-10` 144 |
| Radius | `--r-xs` 2 (chips, tags) · `--r-sm` 6 (inputs, buttons) · `--r-md` 10 (cards, panels) · `--r-lg` 16 (dialogs, composer) · `--r-full` (only avatars and the Drop) |
| Hairline | 1px `--border`. Hairlines are the default separator; shadows are not. |
| Shadow | One shadow, used only for floating layers (menus, popovers, dialogs, toasts): `0 1px 0 rgb(0 0 0/.04), 0 12px 32px -8px rgb(40 24 10/.18)`. In dark mode: `0 12px 40px -8px rgb(0 0 0/.6)`. |
| Measure | Lesson prose max 68ch; Q&A max 72ch; tables full width |

**App shell (≥ 1200px)**

```
┌──────────────┬──────────────────────────────────────────┬───────────────┐
│ SIDEBAR 272  │ MAIN (fluid, content max 880, centred)   │ CONTEXT 336   │
│ wordmark     │ top bar: title · mode · meter            │ plan / ledger │
│ Today        │                                          │ / sources     │
│ Library tree │                                          │ (collapsible  │
│  ▸ Folders   │                                          │  to 48px rail)│
│  ▸ Chats     │                                          │               │
│ ───────────  │                                          │               │
│ Usage · ⚙    │                       [ composer ]       │               │
└──────────────┴──────────────────────────────────────────┴───────────────┘
```

- **Breakpoints:** `sm` 640, `md` 900, `lg` 1200, `xl` 1536.
- **Under `lg`:** the context panel becomes a sheet that slides in from the right.
- **Under `md`:** the sidebar becomes an overlay, the top bar collapses, and the composer pins to the bottom.
- **Grid:** 12 columns, 24px gutters on desktop and 16px on mobile. The landing page uses an asymmetric 12-column editorial grid, with headlines spanning 1–8 and copy offset to 7–12.

---

## 6. Motion

### 6.1 Philosophy

Motion is **physical and condensing**: things settle rather than slide on rails. Springs drive
anything the user directly causes. Timed easings drive ambient and choreographed sequences. Nothing
loops forever in the app; looping is allowed only on the landing page and on loading marks.

### 6.2 Tokens

**Springs** (framer-motion / CSS `linear()` approximations generated at build time)

| Token | Stiffness | Damping | Mass | Feel | Use |
|---|---|---|---|---|---|
| `spring-snappy` | 520 | 38 | 1 | Crisp, no overshoot | Buttons, toggles, checkboxes, tab indicator |
| `spring-smooth` | 260 | 30 | 1 | Calm glide | Panels, sheets, sidebar, popovers |
| `spring-gentle` | 140 | 22 | 1 | Unhurried | Page and shared-element transitions |
| `spring-settle` | 180 | 14 | 1 | One soft overshoot, like a drop landing | Signature moments, the Drop, success ticks |

**Durations and easings** (for non-spring transitions)

| Token | Value | Use |
|---|---|---|
| `--dur-instant` | 80ms | Hover colour, pressed state |
| `--dur-fast` | 140ms | Tooltip, focus ring, small fades |
| `--dur-base` | 220ms | Most fades and crossfades, theme switch |
| `--dur-slow` | 360ms | Content reveals, list stagger total |
| `--dur-deliberate` | 600ms | Condense headline reveal |
| `--dur-signature` | 1200ms | Signature sequences (coverage complete, ingest settle) |
| `--stagger` | 32ms | Per-item list stagger (cap: 8 items, then the rest appear together) |
| `--ease-out` | `cubic-bezier(.16, 1, .3, 1)` | Entrances |
| `--ease-in-out` | `cubic-bezier(.65, 0, .35, 1)` | Moves, morphs |
| `--ease-condense` | `cubic-bezier(.7, 0, .2, 1)` | Blur/tracking settle: slow start, firm landing |
| `--ease-in` | `cubic-bezier(.4, 0, 1, 1)` | Exits (always ≤ 0.7× the entrance duration) |

### 6.3 Signature moments

1. **Condense (headlines).** Display text enters at `letter-spacing: +0.12em; filter: blur(6px);
   opacity: 0` and settles to its final tracking, sharp and opaque, over `--dur-deliberate` with
   `--ease-condense`. It plays once per screen title and on landing-page section heads. This is
   vapour becoming type.
2. **The Still (ingestion, F-209).** Raw chunks render as faint horizontal strips on the left (one per
   page or slide) and stream right through a vertical **Filter Line**. Each extracted learning item
   condenses on the right as a crisp row, its type chip settling with `spring-settle`. A mono counter
   ticks up. The recall audit appears as a second, slower pass of the filter line.
3. **Coverage complete (F-307).** When planned, taught and checked all reach 100 %, the three bars
   compress horizontally into one copper **Drop**. It falls 8px and settles with `spring-settle`,
   with the caption "Fully distilled." This is the only celebratory animation in the core loop.
4. **Clarify (correct answer, F-604).** A correct check card gets a sharpness sweep: a 1px copper
   Filter Line travels left to right in 360ms, the answer text goes from 0.5px blur to sharp, and a
   tick draws on. A wrong answer gets no shake or red flash: the card calmly opens a repair block
   below with `spring-smooth`.
5. **Shared-element morphs.** A plan lesson morphs into the Teach session header (`spring-gentle`).
   A ledger row morphs into its source viewer at the anchored page. A folder in the sidebar morphs
   into the workspace title.
6. **The Drop as loader.** Every loading state uses the animated logo mark (see Step 3), never a
   generic spinner. Streaming text shows a 6px copper Drop pulsing at the caret.

### 6.4 Reduced motion

Under `@media (prefers-reduced-motion: reduce)`, or the in-app "Reduce motion" setting:
- All springs become **opacity-only fades at 120ms**.
- No blur, no letter-spacing animation, no parallax, no scroll-scrubbed animation, and no shared-element movement (crossfade instead).
- Signature moments render their **end state** directly. The Drop appears without falling.
- Loaders become a static Drop with a slow opacity pulse (2s), or text ("Distilling… 42 %").
- Auto-playing landing-page loops pause; the hero shows a still frame.

---

## 7. Iconography and imagery

- **Icons:** the Phosphor *Regular* set at 20px (16px in dense tables), coloured with `currentColor`. One family only; mixing sets isn't allowed. Custom icons (the Drop, Filter, Ledger) are drawn on Phosphor's 256 grid with matching stroke.
- **No emoji** anywhere in the UI chrome. User and model text may contain emoji; we don't strip them, but the system never generates them in its own labels.
- **No illustrations.** Empty states use a large display-face line plus one short sentence and one action. Example: *Nothing here yet.* — "Drop in a syllabus, slides or a link and Distil will pull out everything that matters." `[Add material]`
- **Imagery:** product screenshots and real rendered widgets only. The landing page shows the actual app UI, never mock-ups with fake gradients.

---

## 8. Components (key)

| Component | Spec highlights |
|---|---|
| **Button** | Heights 32/40/48. Variants: `primary` (ink fill), `accent` (copper, max one per screen), `secondary` (surface + control border), `ghost`, `danger`. Press: scale .98 with `spring-snappy`. Label in Satoshi 600. |
| **Input / Textarea** | `--surface`, 1px `--border-control`, `--r-sm`. Focus: copper ring with offset; the border doesn't change colour. |
| **Composer** | A floating `--r-lg` surface at the bottom of the main column with a mode switch (Plan · Teach · Practice · Ask), attach, interactivity dial, mic (later) and send. It grows to 40 % of the viewport height. Queued steer messages stack above it as small mono-labelled chips. |
| **Teacher block** | Not a bubble. Document typography: `body-lg`, headings, callouts with a left Filter Line, worked examples in a sunken well. |
| **Learner card** | Full width, `--accent-wash` tint, 2px copper left rule, eyebrow `YOU · 15:41`. Never right-aligned. |
| **Check card** | Eyebrow (`CHECK 3 / 7`), question in `heading-sm`, options as large hit-target rows with mono key hints `1`–`4`, confidence segmented control (Guess · Unsure · Sure), collapsible "Think out loud" field, and the "I don't know" ghost button. |
| **Widget frame** | `--r-md` surface with a hairline, a title bar (eyebrow type, e.g. `SIMULATION`), actions (full screen, version v2 ▾, save to folder, thumbs up/down as Phosphor icons), and an error chip. Sandboxed content has its own neutral background. |
| **Ledger row** | Type chip (mono, `--r-xs`), item title, source anchor in mono (`unit2.pdf · p.14`), lesson mapping, status as text plus a small copper Drop fill level. |
| **Coverage bars** | Three thin 4px tracks (Planned, Taught, Checked) with a tapered Filter-Line leading edge and mono percentage on the right. |
| **Plan map node** | Rounded rectangle, `heading-sm` title, mono item count. States: done (ink text, muted), current (copper outline + Drop), next (ink outline), upcoming (faint). |
| **Flashcard** | Large centred card, `display-md` front, flip with a 3D Y-rotation on `spring-gentle` (a crossfade under reduced motion). Grade buttons Again · Hard · Good · Easy, each with a mono interval hint. |
| **Token meter** | Top bar: mono `12.4k / 200k` with a hairline fill track, coloured warning at 80 % and danger at 100 %. Clicking opens the usage popover. |
| **Activity dock** | Bottom-left in the sidebar: one line per background job (`Extracting · unit2.pdf · 34/120`), an abort ×, and the Drop loader. |
| **Toast** | Bottom-centre, ink surface (inverted), max 2 visible, auto-dismiss 5s, pauses on hover. |
| **Dialog** | `--r-lg`, shadow, `heading-lg` title, scrim at `--bg` 70 %. Enter: scale .97 → 1 with `spring-smooth`. **Esc always closes the topmost element.** |

---

## 9. UX flows

### F1 — First run (F-1301)
1. **Welcome:** the animated logo, then the condense headline "Learn anything. *Miss nothing.*" and one button, `[Get started]`.
2. **Connect a model:** provider tiles as a list (not a card grid). "Google AI Studio (free key)" sits on top with a "Recommended" eyebrow. "Sign in with Google (experimental)" is below, behind an expandable warning. Other providers and a custom endpoint follow.
3. **Pick models:** a Strong and a Cheap slot with sensible defaults per provider, editable.
4. **Create your first subject:** a name plus a drop zone, or "Just a topic" or "Skip". This lands on the workspace with ingestion running.

### F2 — New subject from material (F-201…F-311, F-501)
1. Drag files or paste links onto a folder (or the sidebar `+ Subject`).
2. **Pre-flight sheet:** files listed with page counts, estimated tokens and cost in mono, and the model slot used. `[Distil it]` (accent) or `[Cancel]`.
3. **The Still:** the ingestion screen (signature moment 2). You can leave it; the job continues in the activity dock.
4. **Ledger review:** items grouped by source and unit, with the gaps banner ("3 items unmapped. Re-run audit · Mark as skip"). You can mark *skip / already know / not in syllabus*.
5. **Brief card:** inferred goal, scope, level, depth and optional deadline, plus up to 3 question chips and `[Just go]`.
6. **Plan generated:** outline and map, with coverage bars at 100 % planned. `[Start first lesson]` (accent).

### F3 — Topic only (F-205)
Type "Learn Rust well enough to build a CLI in 4 weeks". Distil compiles a brief (one or two question chips), then the researcher job builds a reference syllabus with sources. That syllabus becomes material, and the flow joins F2 at step 4.

### F4 — The daily loop (F-506, F-913)
Open the app to **Today**:
- A display headline with the date and a one-line nudge ("2 lessons and 18 cards before Thursday's exam").
- "Up next" (one accent action), the review queue, and "Weak spots". Streak and XP show as a quiet mono line, if enabled.

### F5 — Teach session (F-601…F-614)
1. Opening retrieval: 1–3 recall checks from the last lesson.
2. **PROBE** eyebrow: auto-open diagnostic checks, with confidence and thinking.
3. Phase divider: a Filter Line with `TEACHING · 6 STEPS`.
4. Step → collapsed "Check your understanding" → answer → clarify or repair → next. The context panel shows the step list and the lesson's ledger items ticking taught → checked.
5. **Recap:** learned, shaky, cards created, next lesson, and the coverage delta animating.

### F6 — Mock exam (F-803…F-809)
1. Configure: scope (units/items), style (from past paper), duration, practice or exam mode.
2. **Exam surface:** a distraction-free full-screen view. The sidebar and context panel are hidden; a mono timer sits top right with a section index; there's a per-question answer area (type, or upload a photo of handwriting).
3. Submit, then the **report**: a score in display type, per-unit bars, time per question, weak items, and `[Fix these]` (accent).

### F7 — Cap reached (F-1104, F-1105)
- **At 80 %:** a warning toast and a warning-coloured meter.
- **At 100 %:** the next request is blocked with a dialog showing the usage chart for the period, and the options `[Raise cap]`, `[Switch provider]` and `[Wait — resets in 6h 12m]`. Running background jobs pause, not fail.

### F8 — Google sign-in, experimental (F-1203)
1. Settings → Providers → "Sign in with Google (experimental)" toggle.
2. Turning it on opens a **danger-bordered dialog** in plain language. It explains that this reuses Google's command-line login, that Google may restrict or suspend accounts used this way in third-party apps, and that a free API key is the safe path.
3. A checkbox "I understand the risk" plus `[Continue to Google]`. It stays labelled *Experimental* everywhere it appears.

### F9 — Quick Q&A (F-1001)
Ask in a chat with mode Ask. The answer uses folder materials, with inline source anchors as mono chips that open the material viewer. Footer actions: `Turn into lesson · Make cards`.

---

## 10. Key screens

### S1 — Today
```
 TODAY · FRI 31 OCT                                           12.4k tok · 3d streak
 Thursday is the DSP mid-sem.
 ───────────────────────────────────────────── (filter line)
 UP NEXT                                     REVIEW            WEAK SPOTS
 Unit 2 · Fourier series   [Start lesson]    18 cards due      Convolution (shaky)
 ~35 min · 9 items                            ~12 min           Z-transform ROC
```

### S2 — Subject workspace
```
 Digital Signal Processing                                        (display-lg)
 Materials  Ledger  Plan  Deck  Progress  Chats      ▔▔▔▔ (tapered tab indicator)
 ┌ coverage ─────────────────────────────────────────────────────────┐
 │ PLANNED ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 100 %   │
 │ TAUGHT  ━━━━━━━━━━━━━━━━━━━━━━━╸                            48 %   │
 │ CHECKED ━━━━━━━━━━━━━━━━╸                                   31 %   │
 └───────────────────────────────────────────────────────────────────┘
```

### S3 — Ingestion ("The Still")
```
 raw chunks          │ filter │         ledger items
 ░░░░░░░ p.1–4       │   ┃    │  FORMULA  Euler's identity      p.3
 ░░░░░░░ p.5–8   ──▶ │   ┃    │  DEF      Periodic signal       p.5
 ░░░░░░░ p.9–12      │   ┃    │  THEOREM  Dirichlet conditions  p.9
                         EXTRACTED 64 · AUDITING 2/12 · ~$0.18
```

### S4 — Teach session
Main column: lesson document plus check cards. Context panel: step list (done / current with Drop /
upcoming), this lesson's ledger items with status, and a sources tab. Top bar: lesson title
(display-md on scroll-top, shrinking to heading-sm), mode, meter.

### S5 — Plan
Toggle between Outline and Map. The Map is a left-to-right dependency DAG with clean orthogonal
edges; the current node carries the Drop. Deadline mode adds a calendar strip above it: days as
columns, lessons as blocks, revision and mock-exam days marked.

### S6 — Practice / exam report
A score in `display-xl` mono-num, per-unit bars, and question list with rubric reveal.

### S7 — Flashcard review
A centred card, a progress hairline at the top, grade buttons with keys `1`–`4` and interval hints.

### S8 — Usage
A period switcher (Day · Week · Month), a stacked bar chart (data-viz palette), breakdown tables
(by model, provider, role, folder, chat), cap editor rows with threshold sliders, and `Export CSV`.

### S9 — Settings
A two-column list-detail layout: Providers · Models · Learning (interactivity dial, gamification) ·
Limits · Appearance · Keyboard · Prompts · Data.

---

## 11. Voice and copy

- Plain, warm, exact. Second person. No exclamation marks in system copy. No "AI-powered", "magic" or "supercharge".
- Name things by what the learner gets: "Coverage", "Weak spots", "Up next", not "Insights" or "Dashboard".
- Numbers carry units and sources: "64 items from 3 files", "p.14".
- Errors say what happened and what to do: "The model stopped mid-answer (output limit). [Continue]".
- Distil verbs, sparingly: *distil, condense, clarify, essence*. At most one per screen.

---

## 12. Accessibility

- All text pairs ≥ 4.5:1 and controls ≥ 3:1 (§4.2). Never colour alone: every state has text or an icon.
- Visible focus everywhere (copper 2px ring with offset). Logical tab order. Every action is reachable by keyboard; shortcuts are listed with `?`.
- Hit targets ≥ 40px (44px on touch).
- Live regions announce streaming completion, check results, job completion and cap warnings.
- Sandboxed widgets get a title and a text description fallback.
- Reduced motion is honoured fully (§6.4). There's also an in-app toggle that overrides the OS setting in either direction.
- Respect the user's zoom setting up to 200 % without horizontal scroll (except data tables, which scroll inside their own container).

---

## 13. Open design questions

1. **Satoshi licence:** checked. The licence forbids distributing the files from a repo or public server, so (b) is out. Current approach is (a): the build downloads Satoshi from Fontshare. The alternative is (c), switching to a SIL OFL face such as *Outfit* or *Manrope*, which could ship in the repo.
2. ~~**Palette.**~~ **Resolved:** all five ship as a user setting, Copper by default (§4.4).
3. **Learner cards vs bubbles:** the design follows LearnHarness's "document, not chat" idea for Teach mode. Should Ask mode use the same treatment, or a lighter conversational one?
4. **Default theme on first run:** System (proposed), or always dark/light?
