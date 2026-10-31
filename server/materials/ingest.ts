import type { Jobs } from "../jobs.ts";
import type { Ledger } from "../ledger/store.ts";
import { chunkBlocks } from "./chunk.ts";
import { parseMaterial } from "./parse.ts";
import type { Materials } from "./store.ts";

// Parsing and chunking run locally and cost no tokens, so they start as soon as a file is added.
// Extraction (which spends tokens) is a separate job the learner starts after seeing the estimate (F-208).
export function registerIngest(jobs: Jobs, materials: Materials, ledger: Ledger) {
  jobs.register("parse", async (job, { signal, progress }) => {
    const id = job.materialId!;
    const material = materials.get(id);
    materials.setStatus(id, "parsing");
    progress(0, 1);
    try {
      const parsed = await parseMaterial(material.kind, materials.read(id).bytes);
      if (signal.aborted) return materials.setStatus(id, "error", "Stopped before it finished reading.");
      materials.saveChunks(id, parsed.unit, parsed.length, chunkBlocks(parsed.unit, parsed.blocks));
      // Re-reading a material replaces its chunks; items that were only found in the old ones go too.
      ledger.removeOrphans();
      progress(1, 1);
    } catch (err) {
      materials.setStatus(id, "error", err instanceof Error ? err.message : String(err));
      throw err;
    }
  });
}

export const parseLabel = (name: string) => `Reading ${name}`;
