import { z } from "zod";
import type { Jobs } from "../jobs.ts";
import { completeJson, type LlmDeps, type Slot } from "../llm.ts";
import type { StoredChunk, Materials } from "../materials/store.ts";
import { AUDIT_SYSTEM, EXTRACT_SYSTEM, ITEM_TYPES, MERGE_SYSTEM } from "../prompts.ts";
import { estimateTokens } from "../usage.ts";
import type { ItemDraft, Ledger } from "./store.ts";

// Exhaustive extraction (F-207, F-302, F-303). Default strategy (owner decision): the cheap model
// extracts every chunk, the strong model audits each chunk for misses and judges duplicates.
// "thorough" uses the strong model for everything.

export type Strategy = "balanced" | "thorough";
export const MAX_AUDIT_ROUNDS = 2;
const PARALLEL_CALLS = 3;
const MERGE_GROUPS_PER_CALL = 12;

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
  strategy === "thorough" ? { extract: "strong", audit: "strong", merge: "strong" } : { extract: "cheap", audit: "strong", merge: "strong" };

const UNIT_LABEL: Record<string, [string, string]> = { page: ["page", "pages"], slide: ["slide", "slides"], para: ["paragraph", "paragraphs"], line: ["line", "lines"] };
const where = (unit: string | null, c: StoredChunk) => {
  const [one, many] = UNIT_LABEL[unit ?? ""] ?? ["part", "parts"];
  return c.from === c.to ? `${one} ${c.from}` : `${many} ${c.from}–${c.to}`;
};
const chunkPrompt = (name: string, unit: string | null, c: StoredChunk) =>
  `Material: ${name}\nLocation: ${where(unit, c)}${c.headings.length ? `\nSection: ${c.headings.join(" › ")}` : ""}\n\n<chunk>\n${c.text}\n</chunk>`;

// Runs fn over items with at most `limit` in flight, stopping early when the signal aborts.
async function pool<T>(items: T[], limit: number, signal: AbortSignal, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !signal.aborted) await fn(items[next++]!);
  }));
}

// Token estimate before spending anything (F-208). Ratios are deliberately on the generous side.
// auditOnly: a "What did we miss?" pass, which re-audits chunks that were already extracted.
export function estimateExtraction(chunks: Pick<StoredChunk, "tokens">[], strategy: Strategy, auditOnly = false) {
  const s = slots(strategy);
  const totals = { strong: { input: 0, output: 0 }, cheap: { input: 0, output: 0 } };
  const extractSys = estimateTokens(EXTRACT_SYSTEM);
  const auditSys = estimateTokens(AUDIT_SYSTEM);
  for (const { tokens } of chunks) {
    if (!auditOnly) {
      totals[s.extract].input += extractSys + tokens + 40;
      totals[s.extract].output += Math.ceil(tokens * 0.6);
    }
    // About 1.3 audit rounds per chunk on average; each re-reads the chunk plus a summary of its items.
    totals[s.audit].input += Math.ceil(1.3 * (auditSys + tokens * 1.5 + 40));
    totals[s.audit].output += Math.ceil(tokens * 0.15);
  }
  const extractedOut = chunks.reduce((sum, c) => sum + Math.ceil(c.tokens * (auditOnly ? 0.15 : 0.6)), 0);
  totals[s.merge].input += Math.ceil(extractedOut * 0.2) + estimateTokens(MERGE_SYSTEM);
  totals[s.merge].output += Math.ceil(extractedOut * 0.05);
  return { chunks: chunks.length, ...totals, total: totals.strong.input + totals.strong.output + totals.cheap.input + totals.cheap.output };
}

export function registerExtraction(jobs: Jobs, deps: LlmDeps & { materials: Materials; ledger: Ledger }) {
  const { materials, ledger } = deps;

  async function mergeFolder(folderId: string, slot: Slot, signal: AbortSignal) {
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
      const { merges } = await completeJson(deps, Merged, { slot, role: "merger", folderId, system: MERGE_SYSTEM, prompt: text, signal });
      for (const m of merges) {
        const keep = ids.get(m.keep);
        const drop = m.drop.map((d) => ids.get(d)).filter((d): d is string => !!d);
        if (keep && drop.length) ledger.merge(keep, drop, m.title, m.statement);
      }
    }
    if (!signal.aborted) ledger.markMergeChecked(folderId);
  }

  jobs.register("extract", async (job, { signal, progress }) => {
    const id = job.materialId!;
    const { strategy = "balanced" } = job.params as { strategy?: Strategy };
    const slot = slots(strategy);
    const material = materials.get(id);
    const chunks = materials.chunks(id);
    const total = chunks.length * 2 + 1;
    let done = chunks.filter((c) => c.extracted).length + chunks.filter((c) => c.audited).length;
    const step = () => progress(++done, total);
    progress(done, total);

    // 1. Extract every chunk that hasn't been mined yet.
    await pool(chunks.filter((c) => !c.extracted), PARALLEL_CALLS, signal, async (chunk) => {
      const { items } = await completeJson(deps, Extracted, {
        slot: slot.extract, role: "extractor", folderId: material.folderId, system: EXTRACT_SYSTEM,
        prompt: chunkPrompt(material.name, material.unit, chunk), maxTokens: 8192, signal,
      });
      ledger.addFromChunk(material.folderId, id, chunk, items as ItemDraft[], "extracted");
      materials.markExtracted(chunk.id);
      step();
    });
    if (signal.aborted) return;

    // 2. Recall audit: re-read each chunk against what was found, until nothing is missing (F-302).
    await pool(chunks.filter((c) => !c.audited), PARALLEL_CALLS, signal, async (chunk) => {
      for (let round = chunk.auditRounds; round < MAX_AUDIT_ROUNDS && !signal.aborted; round++) {
        const found = ledger.summariesForChunk(chunk.id);
        const { missed } = await completeJson(deps, Audited, {
          slot: slot.audit, role: "auditor", folderId: material.folderId, system: AUDIT_SYSTEM,
          prompt: `${chunkPrompt(material.name, material.unit, chunk)}\n\nItems already extracted:\n${found.join("\n") || "(none)"}`,
          maxTokens: 4096, signal,
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
    await mergeFolder(material.folderId, slot.merge, signal);
    progress(total, total);
  });
}

export const extractLabel = (name: string) => `Extracting ${name}`;
