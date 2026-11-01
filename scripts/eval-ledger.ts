// Measures a folder's ledger (Phase 10): `node scripts/eval-ledger.ts <data dir> <folder id> <name> [--save]`.
// Reads the database read-only. With --save it writes evals/ledger/<name>.json: counts only, never
// the material's text, so results can be committed and compared run to run.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { findQuote, normaliseForMatch } from "../server/ledger/quote.ts";
import { duplicateGroups, exactDuplicates } from "../server/ledger/store.ts";

const [dataDir, folderId, name] = process.argv.slice(2);
if (!dataDir || !folderId || !name) throw new Error("Usage: node scripts/eval-ledger.ts <data dir> <folder id> <name> [--save]");
const db = new DatabaseSync(join(dataDir, "distil.db"), { readOnly: true });

const items = db.prepare(`WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id)
  SELECT i.id, i.type, i.title, i.statement FROM items i JOIN sub ON i.folder_id = sub.id`).all(folderId) as { id: string; type: string; title: string; statement: string }[];
const anchors = db.prepare(`WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id)
  SELECT s.quote, c.text, c.ord, c.material_id, m.kind FROM item_sources s JOIN items i ON i.id = s.item_id JOIN sub ON i.folder_id = sub.id
  JOIN chunks c ON c.id = s.chunk_id JOIN materials m ON m.id = s.material_id`).all(folderId) as { quote: string; text: string; ord: number; material_id: string; kind: string }[];
const nearby = db.prepare("SELECT text FROM chunks WHERE material_id = ? AND ord != ? AND ord BETWEEN ? AND ?");

// The matching Distil used before Phase 10: case and spacing only, then the first 24 characters.
const strict = (text: string, quote: string) => {
  const n = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const hay = n(text);
  const needle = n(quote);
  return !!needle && (hay.includes(needle) || (needle.length > 24 && hay.includes(needle.slice(0, 24))));
};

const quotes = { total: 0, empty: 0, strict: 0, full: 0, partial: 0, neighbour: 0, missing: 0 };
const misses: { kind: string; quote: string }[] = [];
const cache = new Map<string, ReturnType<typeof normaliseForMatch>>();
for (const a of anchors) {
  quotes.total++;
  if (!a.quote.trim()) { quotes.empty++; continue; }
  if (strict(a.text, a.quote)) quotes.strict++;
  const hay = cache.get(a.text) ?? normaliseForMatch(a.text);
  cache.set(a.text, hay);
  const m = findQuote(hay, a.quote);
  if (m) quotes[m.how]++;
  else if (normaliseForMatch(a.quote).text.length >= 12 && (nearby.all(a.material_id, a.ord, a.ord - 2, a.ord + 2) as { text: string }[]).some((c) => findQuote(c.text, a.quote))) quotes.neighbour++;
  else { quotes.missing++; misses.push({ kind: a.kind, quote: a.quote }); }
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const titles = new Map<string, number>();
for (const i of items) titles.set(norm(i.title), (titles.get(norm(i.title)) ?? 0) + 1);
const repeated = [...titles.values()].filter((n) => n > 1);
const near = duplicateGroups(items);

const byType: Record<string, number> = {};
for (const i of items) byType[i.type] = (byType[i.type] ?? 0) + 1;
const missesByKind: Record<string, number> = {};
for (const m of misses) missesByKind[m.kind] = (missesByKind[m.kind] ?? 0) + 1;

const result = {
  name, measuredAt: new Date().toISOString().slice(0, 10),
  items: items.length, anchors: anchors.length, byType,
  quotes: { ...quotes, matchedStrict: +(quotes.strict / (quotes.total - quotes.empty)).toFixed(4), matched: +((quotes.full + quotes.partial + quotes.neighbour) / (quotes.total - quotes.empty)).toFixed(4), missesByKind },
  duplicates: { repeatedTitles: repeated.length, extraCopies: repeated.reduce((s, n) => s + n - 1, 0), exactGroups: exactDuplicates(items).length, nearDuplicateGroups: near.length },
};
console.log(JSON.stringify(result, null, 2));
if (process.argv.includes("--samples")) {
  console.log("\nUnmatched quotes (first 12):");
  for (const m of misses.slice(0, 12)) console.log(`  [${m.kind}] ${m.quote.slice(0, 140)}`);
  console.log("\nNear-duplicate groups (first 12):");
  for (const g of near.slice(0, 12)) console.log(`  ${g.map((i) => `${i.title} (${i.type})`).join(" | ")}`);
}
if (process.argv.includes("--save")) {
  mkdirSync(join(import.meta.dirname, "..", "evals", "ledger"), { recursive: true });
  writeFileSync(join(import.meta.dirname, "..", "evals", "ledger", `${name}.json`), `${JSON.stringify(result, null, 2)}\n`);
}
