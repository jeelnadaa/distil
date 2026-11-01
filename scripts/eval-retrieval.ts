// Measures retrieval (Phase 10): `node scripts/eval-retrieval.ts <data dir> <folder id> <name> [--save]`.
// The set is every item in the folder that has an anchor: searching for an item should bring back a chunk it
// was found in. Keyword search only, so it costs no tokens; retrieval adds embeddings on top when they're on.
// An item's words came from its chunk, so this measures whether search can find a known passage, not how good
// an answer is. Reads the database read-only; --save writes evals/retrieval/<name>.json, counts only.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createSearch } from "../server/materials/search.ts";

const [dataDir, folderId, name] = process.argv.slice(2);
if (!dataDir || !folderId || !name) throw new Error("Usage: node scripts/eval-retrieval.ts <data dir> <folder id> <name> [--save]");
const db = new DatabaseSync(join(dataDir, "distil.db"), { readOnly: true });
const search = createSearch(db);

const items = db.prepare(`SELECT i.id, i.title, i.statement, group_concat(s.chunk_id) AS chunks FROM items i
  JOIN item_sources s ON s.item_id = i.id WHERE i.folder_id = ? GROUP BY i.id ORDER BY i.created_at, i.rowid`)
  .all(folderId) as { id: string; title: string; statement: string; chunks: string }[];

const KS = [1, 3, 6, 20];
const measure = (query: (item: (typeof items)[number]) => string) => {
  const hits = Object.fromEntries(KS.map((k) => [k, 0]));
  let reciprocal = 0;
  let nothing = 0;
  for (const item of items) {
    const anchored = new Set(item.chunks.split(","));
    const found = search.search(folderId, query(item), Math.max(...KS));
    if (!found.length) nothing++;
    const rank = found.findIndex((h) => anchored.has(h.chunkId));
    if (rank === -1) continue;
    reciprocal += 1 / (rank + 1);
    for (const k of KS) if (rank < k) hits[k]!++;
  }
  const rate = (n: number) => +(n / (items.length || 1)).toFixed(4);
  return { hitAt: Object.fromEntries(KS.map((k) => [k, rate(hits[k]!)])), mrr: rate(reciprocal), noResults: nothing };
};

const result = {
  name, measuredAt: new Date().toISOString().slice(0, 10), items: items.length,
  byTitle: measure((i) => i.title),
  // What forItems searches for when teaching an item.
  byTitleAndStatement: measure((i) => `${i.title}. ${i.statement}`),
};
console.log(JSON.stringify(result, null, 2));
if (process.argv.includes("--save")) {
  mkdirSync(join(import.meta.dirname, "..", "evals", "retrieval"), { recursive: true });
  writeFileSync(join(import.meta.dirname, "..", "evals", "retrieval", `${name}.json`), `${JSON.stringify(result, null, 2)}\n`);
}
