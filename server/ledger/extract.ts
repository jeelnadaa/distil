import { z } from "zod";
import type { Jobs } from "../jobs.ts";
import { completeJson, type LlmDeps, type Slot } from "../llm.ts";
import { imageMime, openPdfRenderer } from "../materials/render.ts";
import type { Material, Materials, StoredChunk } from "../materials/store.ts";
import { AUDIT_SYSTEM, EXTRACT_SYSTEM, ITEM_TYPES, MERGE_SYSTEM } from "../prompts.ts";
import type { ImagePart } from "../providers/types.ts";
import { estimateTokens } from "../usage.ts";
import type { ItemDraft, Ledger } from "./store.ts";

// Exhaustive extraction (F-207, F-302, F-303). Default strategy (owner decision): the cheap model
// extracts every chunk, the strong model audits each chunk for misses and judges duplicates.
// "thorough" uses the strong model for everything; "economy" the cheap one, for when the strong
// model's quota is too small (Gemini's free tier allows a few dozen strong calls a day). Pages whose content is drawn rather than written
// (formulas, figures, scans) go to the model as images alongside their text.

export type Strategy = "balanced" | "thorough" | "economy";
// from/to: only the chunks overlapping this location range ("chapters 1 and 2 are in the exam").
export type ExtractParams = { strategy?: Strategy; from?: number; to?: number };
export const MAX_AUDIT_ROUNDS = 2;
const PARALLEL_CALLS = 3;
const MERGE_GROUPS_PER_CALL = 12;
// Thinking models (Gemini, o-series, Claude with thinking) bill hidden reasoning as output; measured ~300 per call on Gemini Flash.
const THINKING_PER_CALL = 400;
// A 1000 px page image: ~1030 tokens on Gemini (four tiles), ~1300 on Claude.
const TOKENS_PER_IMAGE = 1300;
const MAX_IMAGES_PER_CALL = 4;

const Draft = z.object({
  type: z.string().transform((t) => (ITEM_TYPES as readonly string[]).includes(t.toLowerCase()) ? t.toLowerCase() : "concept"),
  title: z.string().min(1).max(200),
  statement: z.string().min(1).max(2000),
  quote: z.string().default(""),
});
const Extracted = z.object({ items: z.array(Draft) });
const Audited = z.object({ missed: z.array(Draft) });
const Merged = z.object({ merges: z.array(z.object({ keep: z.string(), drop: z.array(z.string()), title: z.string(), statement: z.string() })) });

const slots = (strategy: Strategy): Record<"extract" | "audit" | "merge", Slot> =>
  strategy === "thorough" ? { extract: "strong", audit: "strong", merge: "strong" }
    : strategy === "economy" ? { extract: "cheap", audit: "cheap", merge: "cheap" }
    : { extract: "cheap", audit: "strong", merge: "strong" };

// The visual pages a chunk covers; their images go with its text.
export const visualPages = (material: Pick<Material, "visual">, chunk: Pick<StoredChunk, "from" | "to">) =>
  material.visual.filter((p) => p >= chunk.from && p <= chunk.to).slice(0, MAX_IMAGES_PER_CALL);

export const inRange = (chunk: Pick<StoredChunk, "from" | "to">, { from, to }: ExtractParams) =>
  (from === undefined || chunk.to >= from) && (to === undefined || chunk.from <= to);

const UNIT_LABEL: Record<string, [string, string]> = { page: ["page", "pages"], slide: ["slide", "slides"], para: ["paragraph", "paragraphs"], line: ["line", "lines"] };
const where = (unit: string | null, c: StoredChunk) => {
  const [one, many] = UNIT_LABEL[unit ?? ""] ?? ["part", "parts"];
  return c.from === c.to ? `${one} ${c.from}` : `${many} ${c.from}–${c.to}`;
};
const chunkPrompt = (name: string, unit: string | null, c: StoredChunk, pages: number[]) => {
  const head = `Material: ${name}\nLocation: ${where(unit, c)}${c.headings.length ? `\nSection: ${c.headings.join(" › ")}` : ""}`;
  const attached = pages.length
    ? `\n\nAttached: images of ${pages.length === 1 ? "page" : "pages"} ${pages.join(", ")}, in order. They show what the text above can miss: formulas, diagrams, tables, figures and handwriting. Cover those as items too, with their maths in LaTeX.`
    : "";
  return `${head}\n\n<chunk>\n${c.text}\n</chunk>${attached}`;
};

// Runs fn over items with at most `limit` in flight, stopping early when the signal aborts.
async function pool<T>(items: T[], limit: number, signal: AbortSignal, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !signal.aborted) await fn(items[next++]!);
  }));
}

// Token estimate before spending anything (F-208). Ratios are deliberately on the generous side.
// auditOnly: a "What did we miss?" pass, which re-audits chunks that were already extracted.
export function estimateExtraction(chunks: (Pick<StoredChunk, "tokens"> & { images?: number })[], strategy: Strategy, auditOnly = false) {
  const s = slots(strategy);
  const totals = { strong: { input: 0, output: 0 }, cheap: { input: 0, output: 0 } };
  const extractSys = estimateTokens(EXTRACT_SYSTEM);
  const auditSys = estimateTokens(AUDIT_SYSTEM);
  let images = 0;
  for (const chunk of chunks) {
    const { tokens } = chunk;
    const pictures = (chunk.images ?? 0) * TOKENS_PER_IMAGE;
    images += chunk.images ?? 0;
    if (!auditOnly) {
      totals[s.extract].input += extractSys + tokens + pictures + 40;
      totals[s.extract].output += Math.ceil(tokens * 0.6) + THINKING_PER_CALL;
    }
    // About 1.3 audit rounds per chunk on average; each re-reads the chunk plus a summary of its items.
    totals[s.audit].input += Math.ceil(1.3 * (auditSys + tokens * 1.5 + pictures + 40));
    totals[s.audit].output += Math.ceil(1.3 * (tokens * 0.15 + THINKING_PER_CALL));
  }
  const extractedOut = chunks.reduce((sum, c) => sum + Math.ceil(c.tokens * (auditOnly ? 0.15 : 0.6)), 0);
  totals[s.merge].input += Math.ceil(extractedOut * 0.2) + estimateTokens(MERGE_SYSTEM);
  totals[s.merge].output += Math.ceil(extractedOut * 0.05);
  return { chunks: chunks.length, images, ...totals, total: totals.strong.input + totals.strong.output + totals.cheap.input + totals.cheap.output };
}

export function registerExtraction(jobs: Jobs, deps: LlmDeps & { materials: Materials; ledger: Ledger }) {
  const { materials, ledger } = deps;

  async function mergeFolder(llm: LlmDeps, folderId: string, slot: Slot, signal: AbortSignal) {
    const groups = ledger.mergeCandidates(folderId);
    for (let i = 0; i < groups.length && !signal.aborted; i += MERGE_GROUPS_PER_CALL) {
      const batch = groups.slice(i, i + MERGE_GROUPS_PER_CALL);
      // Short ids keep the prompt small; they're mapped back to real ids below.
      const ids = new Map<string, string>();
      const text = batch.map((group, g) => `Group ${g + 1}:\n${group.map((item) => {
        const short = `i${ids.size + 1}`;
        ids.set(short, item.id);
        return `${short} [${item.type}] ${item.title}: ${item.statement}`;
      }).join("\n")}`).join("\n\n");
      const { merges } = await completeJson(llm, Merged, { slot, role: "merger", folderId, system: MERGE_SYSTEM, prompt: text, signal });
      for (const m of merges) {
        const keep = ids.get(m.keep);
        const drop = m.drop.map((d) => ids.get(d)).filter((d): d is string => !!d);
        if (keep && drop.length) ledger.merge(keep, drop, m.title, m.statement);
      }
    }
    if (!signal.aborted) ledger.markMergeChecked(folderId);
  }

  jobs.register("extract", async (job, { signal, progress, note }) => {
    const id = job.materialId!;
    const params = job.params as ExtractParams;
    const slot = slots(params.strategy ?? "balanced");
    // Say so in the activity dock while a fallback model is doing the work.
    const llm: LlmDeps = { ...deps, onAnswer: (ref, fellBack) => note(fellBack ? `Answered by ${deps.providers.describe(ref)}, a fallback` : null) };
    const material = materials.get(id);
    const chunks = materials.chunks(id).filter((c) => inRange(c, params));
    const total = chunks.length * 2 + 1;
    let done = chunks.filter((c) => c.extracted).length + chunks.filter((c) => c.audited).length;
    const step = () => progress(++done, total);
    progress(done, total);

    // Page images are rendered on demand from one open copy of the PDF; an image material is its own picture.
    const bytes = material.visual.length ? materials.read(id).bytes : null;
    const renderer = bytes && material.kind === "pdf" ? await openPdfRenderer(bytes) : null;
    const imagesFor = async (chunk: StoredChunk): Promise<{ images: ImagePart[]; pages: number[] }> => {
      if (bytes && material.kind === "image") return { images: [{ mime: imageMime(bytes), data: bytes.toString("base64") }], pages: [1] };
      const pages = renderer ? visualPages(material, chunk) : [];
      return { images: pages.length ? await renderer!.render(pages) : [], pages };
    };

    try {
      // 1. Extract every chunk that hasn't been mined yet.
      await pool(chunks.filter((c) => !c.extracted), PARALLEL_CALLS, signal, async (chunk) => {
        const { images, pages } = await imagesFor(chunk);
        const { items } = await completeJson(llm, Extracted, {
          slot: slot.extract, role: "extractor", folderId: material.folderId, system: EXTRACT_SYSTEM,
          prompt: chunkPrompt(material.name, material.unit, chunk, pages), maxTokens: 8192, signal, images,
        });
        ledger.addFromChunk(material.folderId, id, chunk, items as ItemDraft[], "extracted");
        materials.markExtracted(chunk.id);
        step();
      });
      if (signal.aborted) return;

      // 2. Recall audit: re-read each chunk against what was found, until nothing is missing (F-302).
      await pool(chunks.filter((c) => !c.audited), PARALLEL_CALLS, signal, async (chunk) => {
        // Rounds already used up (a run stopped between its last round and marking the chunk) count as done.
        if (chunk.auditRounds >= MAX_AUDIT_ROUNDS) {
          materials.markAudited(chunk.id, true);
          return step();
        }
        const { images, pages } = await imagesFor(chunk);
        for (let round = chunk.auditRounds; round < MAX_AUDIT_ROUNDS && !signal.aborted; round++) {
          const found = ledger.summariesForChunk(chunk.id);
          const { missed } = await completeJson(llm, Audited, {
            slot: slot.audit, role: "auditor", folderId: material.folderId, system: AUDIT_SYSTEM,
            prompt: `${chunkPrompt(material.name, material.unit, chunk, pages)}\n\nItems already extracted:\n${found.join("\n") || "(none)"}`,
            maxTokens: 4096, signal, images,
          });
          const added = ledger.addFromChunk(material.folderId, id, chunk, missed as ItemDraft[], "audit");
          const clean = added === 0 || round + 1 >= MAX_AUDIT_ROUNDS;
          materials.markAudited(chunk.id, clean);
          if (clean) break;
        }
        if (!signal.aborted) step();
      });
      if (signal.aborted) return;

      // 3. Merge duplicates across chunks and materials in this folder (F-303).
      await mergeFolder(llm, material.folderId, slot.merge, signal);
      progress(total, total);
    } finally {
      await renderer?.close();
    }
  });
}

// "Distilling notes.pdf · pages 17–176": the range is in the label so every place showing the job says what it covers.
export function extractLabel(name: string, unit: string | null, { from, to }: ExtractParams = {}) {
  if (from === undefined && to === undefined) return `Distilling ${name}`;
  const [one, many] = UNIT_LABEL[unit ?? ""] ?? ["part", "parts"];
  if (from !== undefined && from === to) return `Distilling ${name} · ${one} ${from}`;
  return `Distilling ${name} · ${many} ${from ?? 1}–${to ?? "end"}`;
}
