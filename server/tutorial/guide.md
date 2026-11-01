# Distil user guide

Distil is a study app that runs on your own computer. You bring your course material and your own AI model key; Distil turns the material into a complete list of what there is to learn, plans it, teaches it step by step, tests you on it and schedules reviews so you keep it. Everything is stored locally in the data folder; only the text a model needs is sent to the model provider you chose.

## Getting started

1. Add a model key: [Settings › Providers](#/settings/providers). Google AI Studio has a free tier; OpenAI, Anthropic, OpenRouter, DeepSeek, Mistral, Groq, xAI and any OpenAI-compatible endpoint (Ollama, LM Studio, a proxy) also work. Keys stay on this computer.
2. Pick models: [Settings › Models](#/settings/models). The **strong** model teaches, plans and writes exams; the **cheap** model does the bulk work (reading material, naming chats, writing flashcards). Suggested models are marked. Each slot can have fallbacks, tried in order when a model is rate-limited, down or over its cap.
3. Make a folder for a subject in the sidebar (the folder button next to **Library**). Folders nest up to five levels; material in a folder is shared with everything inside it.
4. Add material to the folder and press **Distil**.

## The sidebar

- **Today**: what to do now, with the reason for each suggestion: today's lessons, due flashcards, a practice set when several items are weak, the next lesson. An exam within a week puts lessons first; 15 or more due cards put review first.
- **Review**: flashcards due across every folder.
- **New chat**: an Ask chat, in the open folder when there is one.
- **Library**: folders and chats. Drag to move; the menu on each one renames, moves or deletes it.
- At the bottom: **Settings**, **Usage** (the chart button), **Keyboard shortcuts** and the light/dark switch.
- Every top bar has **Study sounds** (rain, ocean, brown noise, fan; made in the app, nothing downloaded) and **Activity** (background jobs: what's running, which model is answering, stop; the last 24 hours).

## A subject folder

A folder opens on its workspace, with six tabs (keys 1–6):

### Materials
Drop files or click to choose: PDF, Word, PowerPoint, Markdown, text and images (photos of notes or whiteboards), up to 200 MB each. Or paste a link to a web page, a PDF or a YouTube video: the page is fetched now and kept as a copy; a video's transcript is either pasted by you (free) or written by a Gemini model that also notes formulas and slides shown on screen (about 6,000 tokens a minute). **No material?** Use **Research a topic**: the researcher writes a syllabus for the topic and adds it as a material. With a web search key ([Settings › Web search](#/settings/search), Tavily or Brave Search) it searches each section and cites its sources; without one it writes from the model's own knowledge and says so.

A material can be replaced with a new version (the upload button) or a link fetched again; unchanged parts keep their items. Click a material's name to read it in the viewer.

### Ledger
**Distil** reads the material and lists every learnable item: definitions, theorems, formulas, procedures, facts, examples and more, each with a statement and a link to the exact place it came from. A recall audit looks again for anything missed, and duplicates are merged. The Distil dialog shows the cost before it starts and lets you choose a range of pages and how thorough to be (Economy, Balanced, Thorough). You can add an item by hand, edit one, or mark it *skip*, *known* or *out of scope*. Coverage bars show how much of each material is done.

### Plan
A study plan covers 100 % of the ledger. It starts from a **study brief**: say in one sentence what you want (exam, date, level, time per day) and Distil fills in the rest for you to check. The plan groups items into units and lessons, in the order they build on each other, with a schedule up to your deadline that re-balances when you fall behind. **Re-plan** makes a new plan; up to three are kept, one active. Open a lesson on the plan map and press **Start lesson**.

### Practice
**New practice set** or **Mock exam**: written from your material by the strong model, each question with a worked solution, a mark scheme and two hints. Choose what it covers (everything, units or lessons) and how many questions or how long. Answers are marked automatically, including photos of handwritten working. A mock exam is timed (the timer pauses when you leave) and ends in a report; missed items become flashcards, and **Fix these** starts a practice set on them.

### Cards
Flashcards for the folder: written automatically after each lesson (question and answer, both ways, fill-the-gap, formula) and for every missed exam question. Add, edit or delete cards; import or export Anki tab-separated text. **Review** starts a session.

### Progress
Mastery per item (new, shaky, solid, mastered; shown as levels, percentages or both, set in [Settings › Learning](#/settings/learning)), a heatmap of every lesson by unit, weak spots with **Practise these**, and the **knowledge graph**: the items of one unit, linked by what each one builds on. Map a unit to draw it; drag items to arrange them; click an item for its statement, mastery and links; open it full screen.

The folder's header also has the **Visuals** setting (how much the model draws: Text-only, Balanced or Visual-heavy; by default the one in Settings) and the **Distil** button.

## Lessons

A lesson is taught step by step from your own material, citing it (the small links open the source). It may start with a short probe of what you already know. After every step comes a check: multiple choice, a number, a short answer, ordering, or an explanation in your own words; say how sure you are (guess, unsure, sure). A wrong answer gets a repair: the idea explained another way; after two repairs the item is marked shaky and comes back later. Lessons draw diagrams, plots, charts, worked steps and small simulations in Distil's style. The lesson ends with a recap; its items move to taught, and flashcards are written for them. The graph button in a lesson's top bar opens the unit's knowledge graph with the lesson's items marked.

## Ask chats

A chat answers questions about anything; in a folder it also knows the study brief and a short summary of what you've studied there (turn that off with **Independent** in the message box). The message box has the chat's model menu and its Visuals setting. Replies can include maths, code, diagrams, plots, quizzes and runnable code, as much as the Visuals setting allows. The meter shows the chat's tokens and how full the model's context is.

## Review

Flashcards come back on a spaced schedule (FSRS) set by how well you remembered them. Press Space to show the answer, then 1 Again, 2 Hard, 3 Good, 4 Easy; each grade shows when the card comes back. **Explain this** asks the cheap model about the card with its source passages. Up to 20 new cards are introduced a day.

## Usage and limits

[Usage](#/usage) shows tokens per hour today, or per day for a week or a month, input and output stacked, broken down by model, provider, task, folder or chat, with a CSV export. Distil counts tokens, not money. [Settings › Limits](#/settings/limits) sets daily and monthly token caps, overall and per provider, with a warning threshold; at 100 % Distil stops sending to that provider until you raise the cap or it resets, and moves to a fallback model if one is set.

## Settings

- **Providers**: keys (several per provider, labelled), custom endpoints.
- **Models**: strong and cheap models and their fallbacks; search by meaning (embeddings) for finding passages: off, your provider's embedding model, or a small local model downloaded once.
- **Web search**: a Tavily or Brave Search key for the researcher.
- **Limits**: token caps.
- **Learning**: the default Visuals setting, mastery display, streaks and XP (off by default; a streak counts days with real learning and forgives one missed day a week).
- **Appearance**: light, dark or system theme, colour palette, text font (Satoshi, Anthropic Sans if installed, or your own font), reduced motion.
- **Data**: where the data folder is, **Download backup** (a zip of everything except keys and downloaded models) and **Restore** (replaces everything with a backup; the current data is kept in *before-restore*).
- **About**: the version and updates (the installed app checks for updates and installs them on request).

## Keyboard

Press **?** anywhere for the full list. **n** new chat, **g** then **t**/**r**/**u**/**s** for Today, Review, Usage, Settings, **/** to write a message, **1–6** for folder tabs, **Esc** to close. In a chat, Enter sends and Shift+Enter starts a new line.

## Privacy and tokens

Your files, chats and progress never leave this computer except as the text sent to the model provider for a task. Keys are stored only in the data folder. Bulk work uses the cheap model; Economy distilling uses fewer tokens. Every model call is recorded on the Usage page.
