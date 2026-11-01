# Credits

Distil is MIT-licensed (see `LICENSE`) and built on open-source work.

## Fonts

- **Satoshi** by Indian Type Foundry, from Fontshare (ITF Free Font License; `design/assets/fonts/Satoshi-LICENSE-FFL.txt`).
- **Instrument Serif** by Instrument (SIL Open Font License 1.1).
- **JetBrains Mono** by JetBrains (SIL Open Font License 1.1).

## Main libraries

- **Svelte** and **Vite**: the interface and its build.
- **Hono**: the local API server.
- **Zod**: request and settings validation.
- **pdf.js** (Mozilla): reading PDFs. **Readability** (Mozilla) and **linkedom**: reading web pages.
- **fflate**: Word and PowerPoint files, backups and updates.
- **markdown-it**, **KaTeX** and **highlight.js**: rendering replies, maths and code.
- **dagre**: laying out plan maps, diagrams and the knowledge graph.
- **Transformers.js** (Hugging Face) with **ONNX Runtime**: the optional local embedding model.
- **Node.js**: the runtime, including its built-in SQLite.

Flashcard scheduling follows the FSRS-5 algorithm by Jarrett Ye and the open-spaced-repetition project, written into Distil with its published default parameters.

The idea and the teaching theory come from LearnHarness by amosblomqvist; see the README.
