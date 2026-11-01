import type { Jobs } from "../jobs.ts";
import type { Ledger } from "../ledger/store.ts";
import { chunkBlocks } from "./chunk.ts";
import { parseMaterial } from "./parse.ts";
import type { Materials } from "./store.ts";

// Parsing and chunking run locally and cost no tokens, so they start as soon as a file is added.
// Extraction (which spends tokens) is a separate job the learner starts after seeing the estimate (F-208).
// onRead: a material's chunks changed (search by meaning indexes them).
export function registerIngest(jobs: Jobs, materials: Materials, ledger: Ledger, onRead?: () => void) {
  jobs.register("parse", async (job, { signal, progress }) => {
    const id = job.materialId!;
    const material = materials.get(id);
    materials.setStatus(id, "parsing");
    progress(0, 1);
    try {
      const parsed = await parseMaterial(material.kind, materials.read(id).bytes);
      if (signal.aborted) return materials.setStatus(id, "error", "Stopped before it finished reading.");
      const chunks = materials.saveChunks(id, parsed.unit, parsed.length, chunkBlocks(parsed.unit, parsed.blocks), parsed.visual);
      // Re-reading a material replaces its changed chunks; items that were only found in the old ones go too.
      const removed = ledger.removeOrphans();
      if ((job.params as { reimport?: boolean }).reimport) materials.setReimport(id, { at: Date.now(), ...chunks, items: removed.slice(0, 500) });
      progress(1, 1);
      onRead?.();
    } catch (err) {
      materials.setStatus(id, "error", err instanceof Error ? err.message : String(err));
      throw err;
    }
  });
}

export const parseLabel = (name: string) => `Reading ${name}`;
export const reimportLabel = (name: string) => `Re-reading ${name}`;
