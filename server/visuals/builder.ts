import { randomUUID } from "node:crypto";
import type { Db } from "../db.ts";
import { AppError, notFound } from "../errors.ts";
import type { Library } from "../library.ts";
import { complete, type LlmDeps } from "../llm.ts";
import type { Messages } from "../messages.ts";
import { fencedBlocks } from "./blocks.ts";
import { KIT_GUIDE } from "./kit.ts";
import { lintMiniApp } from "./lint.ts";
import { sanitizeSvg, SVG_CLASSES } from "./sanitize.ts";

// Built visuals: a reply's ```app block becomes a mini-app (F-721) and a ```figure block a precise SVG
// figure (F-725). A sub-agent on the strong slot writes each from the block's brief and the reply around
// it, then checks its own output: a mini-app against the design lint (F-755), a figure against the SVG
// profile (F-753), each repaired by short calls carrying only the problems. The browser then runs the
// mini-app hidden and sends back any runtime errors for one more fix before showing it (F-722).
// Rebuilding adds a version (F-723).

export type VisualKind = "app" | "figure";
export type Visual = { id: string; messageId: string; block: number; version: number; kind: VisualKind; content: string; createdAt: number };
type Row = { id: string; message_id: string; block: number; version: number; kind: VisualKind; content: string; created_at: number };
const toVisual = (r: Row): Visual => ({ id: r.id, messageId: r.message_id, block: r.block, version: r.version, kind: r.kind, content: r.content, createdAt: r.created_at });

export type VisualDeps = LlmDeps & { db: Db; library: Library; messages: Messages; log?: (msg: string) => void };

const LINT_ROUNDS = 2;
const CONTEXT_CHARS = 2500;

const APP_SYSTEM = `You build one small interactive learning mini-app: a simulation, explorable, game or calculator that makes one idea click.
Reply with only an HTML fragment for inside <body>: markup, an optional <style> for layout only (grid, flex, sizes, gaps), and one inline <script>. No <html>, <head> or <body> tags.
It runs in a sandbox with no network, storage, dialogs or external files, at widths from 320 to 800 px, and must not throw.
Start in a sensible state, label every control and readout with units, and keep it under 250 lines.
The frame around it already shows the title, so don't repeat it. Maths can't be typeset here: write it as plain text with Unicode (x̄, σ, ², ≤), never LaTeX or $ signs.
${KIT_GUIDE}
Never write colours, fonts or font sizes: the kit and its variables supply them.`;

const FIGURE_SYSTEM = `You draw one precise, labelled diagram as SVG.
Reply with only <svg viewBox="…">…</svg>, about 640 units wide, with a <title>.
Use only: svg g defs marker path rect circle ellipse line polyline polygon text tspan title desc.
Colour and type come only from these classes: ${SVG_CLASSES.join(", ")} (ink: lines and text; muted: secondary; accent: the one key element; fill-1…fill-6: area fills; label: text; grid: hairlines).
No style attributes or elements, no fill/stroke colours, fonts or font sizes, no scripts or links. Keep labels short and clear of the lines.`;

const FIX_SYSTEM = `You fix a generated mini-app. Change only what the listed problems need.
Reply with only the corrected HTML fragment: no fences, no explanation.`;

const unfence = (text: string) => text.trim().replace(/^```[\w-]*\n?/, "").replace(/\n?```\s*$/, "").trim();

export function createVisuals(deps: VisualDeps) {
  const { db, messages } = deps;

  const versions = (messageId: string, block: number) =>
    (db.prepare("SELECT * FROM visuals WHERE message_id = ? AND block = ? ORDER BY version").all(messageId, block) as Row[]).map(toVisual);

  const get = (id: string): Visual => {
    const row = db.prepare("SELECT * FROM visuals WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw notFound("Visual");
    return toVisual(row);
  };

  // The block's brief and the reply around it, found by its place among the reply's app and figure blocks.
  function briefOf(messageId: string, block: number) {
    const message = messages.get(messageId);
    if (!message) throw notFound("Message");
    const blocks = fencedBlocks(message.content).filter((b) => b.closed && (b.lang === "app" || b.lang === "figure"));
    const found = blocks[block];
    if (!found) throw new AppError(404, "not_found", "That visual isn't in this reply any more.");
    const before = message.content.slice(Math.max(0, found.start - CONTEXT_CHARS), found.start);
    const chat = deps.library.getChat(message.chatId);
    return { kind: found.lang as VisualKind, brief: found.source, before, folderId: chat.folderId };
  }

  const call = (system: string, prompt: string, folderId: string | null, signal?: AbortSignal) =>
    complete(deps, { slot: "strong", role: "visuals", folderId, system, prompt, maxTokens: 8000, signal }).then(unfence);

  // Lint, then fix with only the problems, until clean or out of rounds.
  async function lintAndFix(html: string, folderId: string | null, signal?: AbortSignal): Promise<string> {
    let current = html;
    for (let round = 0; round < LINT_ROUNDS; round++) {
      const errors = lintMiniApp(current);
      if (!errors.length) break;
      current = await call(FIX_SYSTEM, `Problems:\n${errors.join("\n")}\n\nThe mini-app:\n${current}`, folderId, signal);
    }
    return current;
  }

  async function buildApp(brief: string, before: string, folderId: string | null, signal?: AbortSignal) {
    const html = await call(APP_SYSTEM, `What it should show:\n${brief}\n\nThe lesson text just before it, for context:\n${before || "(none)"}`, folderId, signal);
    if (!html) throw new AppError(502, "empty_visual", "The model returned nothing to show.");
    return lintAndFix(html, folderId, signal);
  }

  async function buildFigure(brief: string, before: string, folderId: string | null, signal?: AbortSignal) {
    const prompt = `What it should show:\n${brief}\n\nThe lesson text just before it, for context:\n${before || "(none)"}`;
    const raw = await call(FIGURE_SYSTEM, prompt, folderId, signal);
    const first = sanitizeSvg(raw);
    // Colours mapped to tokens are expected; anything else removed means the figure lost something.
    const lost = first.removed.filter((r) => !/^(fill|stroke)=/.test(r));
    if (!lost.length) return first.svg;
    const again = await call(FIGURE_SYSTEM, `${prompt}\n\nYour last attempt used things the profile doesn't allow, which were removed: ${lost.join(", ")}. Draw it again within the profile.`, folderId, signal).catch(() => null);
    if (!again) return first.svg;
    try { return sanitizeSvg(again).svg; } catch { return first.svg; }
  }

  return {
    list(messageId: string): Visual[] {
      return (db.prepare("SELECT * FROM visuals WHERE message_id = ? ORDER BY block, version").all(messageId) as Row[]).map(toVisual);
    },

    // The latest version, built now if there is none; rebuild adds a new version.
    async build(messageId: string, block: number, rebuild: boolean, signal?: AbortSignal): Promise<Visual> {
      const existing = versions(messageId, block);
      if (existing.length && !rebuild) return existing.at(-1)!;
      const { kind, brief, before, folderId } = briefOf(messageId, block);
      const content = kind === "app" ? await buildApp(brief, before, folderId, signal) : await buildFigure(brief, before, folderId, signal);
      const visual: Visual = { id: randomUUID(), messageId, block, version: (existing.at(-1)?.version ?? 0) + 1, kind, content, createdAt: Date.now() };
      db.prepare("INSERT INTO visuals (id, message_id, block, version, kind, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(visual.id, visual.messageId, visual.block, visual.version, visual.kind, visual.content, visual.createdAt);
      return visual;
    },

    // Runtime errors the browser saw while running the mini-app hidden (F-722): fixed in place, then linted again.
    async fix(id: string, errors: string[], signal?: AbortSignal): Promise<Visual> {
      const visual = get(id);
      if (visual.kind !== "app") throw new AppError(400, "not_an_app", "Only mini-apps are fixed from runtime errors.");
      const { folderId } = briefOf(visual.messageId, visual.block);
      const fixed = await call(FIX_SYSTEM, `It threw these errors when run:\n${errors.join("\n")}\n\nThe mini-app:\n${visual.content}`, folderId, signal);
      const content = await lintAndFix(fixed, folderId, signal);
      db.prepare("UPDATE visuals SET content = ? WHERE id = ?").run(content, id);
      return { ...visual, content };
    },
  };
}

export type Visuals = ReturnType<typeof createVisuals>;
