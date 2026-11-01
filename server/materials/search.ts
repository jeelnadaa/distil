import type { Db } from "../db.ts";
import { locAt } from "./chunk.ts";

// Keyword search over a folder's materials (plan.md §2, indexing): SQLite FTS5 with BM25 ranking and
// stemming, built locally at import. Every hit is anchored to the exact page, slide or line of its
// first matching word, so answers can cite and open the source. Embeddings come later, alongside it.
export type SearchHit = {
  chunkId: string; materialId: string; materialName: string; loc: number;
  headings: string[]; snippet: string; score: number;
};

const MAX_TERMS = 12;
// Snippet highlight markers: control characters never found in extracted text.
export const HIT_START = "\u0002";
export const HIT_END = "\u0003";

// Question words that would otherwise have to appear in every hit.
const FILLER = new Set(("a an and are as at be by can do does for from how i in is it me of on or that the this to " +
  "was what when where which who why with you explain tell about").split(" "));

// Words only, each quoted, so punctuation or FTS syntax in a question can't break the query.
// Filler words are dropped unless the question has nothing else.
export function ftsTerms(query: string) {
  const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
  const content = words.filter((w) => !FILLER.has(w));
  return (content.length ? content : words).slice(0, MAX_TERMS).map((w) => `"${w}"`);
}

export function createSearch(db: Db) {
  const run = (match: string, folderId: string, limit: number) => db.prepare(`
    SELECT c.id, c.material_id, m.name, c.loc_from, c.headings, c.text, c.marks,
           snippet(chunks_fts, 1, char(2), char(3), '…', 24) AS snippet,
           bm25(chunks_fts, 2.0, 1.0) AS score
    FROM chunks_fts
    JOIN chunks c ON c.rowid = chunks_fts.rowid
    JOIN materials m ON m.id = c.material_id
    WHERE chunks_fts MATCH ? AND m.folder_id = ?
    ORDER BY score LIMIT ?`).all(match, folderId, limit) as {
      id: string; material_id: string; name: string; loc_from: number; headings: string; text: string; marks: string; snippet: string; score: number;
    }[];

  return {
    // Chunks holding every word first; when too few do, chunks holding any of them fill the rest.
    search(folderId: string, query: string, limit = 20): SearchHit[] {
      const terms = ftsTerms(query);
      if (!terms.length) return [];
      const rows = run(terms.join(" "), folderId, limit);
      const seen = new Set(rows.map((r) => r.id));
      const more = rows.length < limit && terms.length > 1 ? run(terms.join(" OR "), folderId, limit).filter((r) => !seen.has(r.id)) : [];
      return [...rows, ...more].slice(0, limit).map((r) => {
        const word = r.snippet.split(HIT_START)[1]?.split(HIT_END)[0] ?? "";
        const offset = word ? r.text.toLowerCase().indexOf(word.toLowerCase()) : -1;
        return {
          chunkId: r.id, materialId: r.material_id, materialName: r.name,
          loc: offset >= 0 ? locAt(JSON.parse(r.marks), offset, r.loc_from) : r.loc_from,
          headings: JSON.parse(r.headings), snippet: r.snippet, score: -r.score,
        };
      });
    },
  };
}

export type Search = ReturnType<typeof createSearch>;
