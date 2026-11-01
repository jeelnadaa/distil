import { randomUUID } from "node:crypto";
import { type Db, transaction } from "../db.ts";
import { AppError, notFound } from "../errors.ts";
import { ITEM_STATUSES, type ItemStatus } from "../learning/types.ts";
import { locAt } from "../materials/chunk.ts";
import type { StoredChunk } from "../materials/store.ts";
import { ITEM_TYPES } from "../prompts.ts";
import { findQuote, normaliseForMatch } from "./quote.ts";

// The Coverage Ledger (F-301…F-310): every learning item found in a folder's materials, with the
// places it appears. Items belong to the folder of the material they came from.

export type ItemType = (typeof ITEM_TYPES)[number];
export type ItemOrigin = "extracted" | "audit" | "manual";
export type ItemMark = "skip" | "known" | "out_of_scope";
export type ItemDraft = { type: ItemType; title: string; statement: string; quote: string };
export type ItemSource = { materialId: string; materialName: string; unit: string | null; loc: number; quote: string };
export type Item = {
  id: string; folderId: string; type: ItemType; title: string; statement: string; origin: ItemOrigin;
  status: string; mark: ItemMark | null; sources: ItemSource[]; createdAt: number;
};

type ItemRow = {
  id: string; folder_id: string; type: ItemType; title: string; statement: string; origin: ItemOrigin;
  status: string; mark: ItemMark | null; created_at: number;
};

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// A quote this short can turn up anywhere ("Figure 1.1" in a sentence), so it's only looked for in its own chunk.
const MIN_NEIGHBOUR_QUOTE = 12;
type Locatable = Pick<StoredChunk, "text" | "marks" | "from">;

// The location where a quote starts: in its own chunk, else in the chunks around it (a chunk boundary can
// split what the model read), else the start of its chunk.
export function locate(chunk: Locatable, quote: string, around: Locatable[] = []): number {
  const own = findQuote(chunk.text, quote);
  if (own) return locAt(chunk.marks, own.at, chunk.from);
  if (normaliseForMatch(quote).text.length >= MIN_NEIGHBOUR_QUOTE) {
    for (const other of around) {
      const found = findQuote(other.text, quote);
      if (found) return locAt(other.marks, found.at, other.from);
    }
  }
  return chunk.from;
}

const STOP = new Set(["the", "a", "an", "of", "and", "or", "in", "on", "for", "to", "with", "its", "is", "by", "as", "at", "from"]);
const words = (s: string) => new Set(normalise(s).replace(/[^\p{L}\p{N} ]/gu, " ").split(" ").filter((w) => w && !STOP.has(w)));
const jaccard = (a: Set<string>, b: Set<string>) => {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared || 1);
};

// Groups of possibly-duplicate items: titles with real word overlap, or the same statement. Code
// proposes and the model decides. Pairs where both are already checked are left alone.
export function duplicateGroups<T extends { title: string; statement: string }>(rows: T[], checked: (r: T) => boolean = () => false): T[][] {
  const sets = rows.map((r) => words(r.title));
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (checked(rows[i]!) && checked(rows[j]!)) continue;
      const same = jaccard(sets[i]!, sets[j]!) >= 0.6 || normalise(rows[i]!.statement) === normalise(rows[j]!.statement);
      if (same) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, T[]>();
  rows.forEach((r, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), r]));
  return [...groups.values()].filter((g) => g.length > 1);
}

// How far around its chunk a quote is looked for.
const NEIGHBOURS = 2;
// Places that hold item ids inside JSON, which a merge must point at the item that stays.
const JSON_IDS = [["checks", "items"], ["questions", "items"], ["questions", "spec"], ["teach_sessions", "steps"], ["teach_sessions", "probe"], ["papers", "config"]] as const;

// What makes two items the same without asking a model. Definitions and concepts with one title are one
// idea ("Data", "Data definition"); formulas and theorems match on title and type. Everything else
// (a fact, an example, a procedure) can reuse a title for something different, so its statement must agree too.
const DEFINING = new Set(["definition", "concept"]);
const BY_TITLE = new Set(["formula", "theorem"]);
const SAME_STATEMENT = 0.6;
const titleKey = (title: string) => [...words(title)].filter((w) => w !== "definition").join(" ");

export function exactDuplicates<T extends { type: string; title: string; statement: string }>(rows: T[]): T[][] {
  const byKey = new Map<string, T[]>();
  for (const r of rows) {
    const title = titleKey(r.title);
    if (!title) continue;
    const key = `${DEFINING.has(r.type) ? "defining" : r.type}|${title}`;
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }
  return [...byKey.values()].flatMap((group) => {
    if (DEFINING.has(group[0]!.type) || BY_TITLE.has(group[0]!.type)) return [group];
    const clusters: T[][] = [];
    for (const r of group) {
      const home = clusters.find((c) => jaccard(words(c[0]!.statement), words(r.statement)) >= SAME_STATEMENT);
      if (home) home.push(r);
      else clusters.push([r]);
    }
    return clusters;
  }).filter((g) => g.length > 1);
}

export function createLedger(db: Db, now = () => Date.now()) {
  const sourcesFor = (ids: string[]): Map<string, ItemSource[]> => {
    const map = new Map<string, ItemSource[]>();
    if (!ids.length) return map;
    const rows = db.prepare(`SELECT s.item_id, s.material_id, s.loc, s.quote, m.name, m.unit FROM item_sources s
      JOIN materials m ON m.id = s.material_id WHERE s.item_id IN (${ids.map(() => "?").join(",")}) ORDER BY m.created_at, s.loc`)
      .all(...ids) as { item_id: string; material_id: string; loc: number; quote: string; name: string; unit: string | null }[];
    for (const r of rows) {
      const list = map.get(r.item_id) ?? [];
      list.push({ materialId: r.material_id, materialName: r.name, unit: r.unit, loc: r.loc, quote: r.quote });
      map.set(r.item_id, list);
    }
    return map;
  };
  const toItems = (rows: ItemRow[]): Item[] => {
    const sources = sourcesFor(rows.map((r) => r.id));
    return rows.map((r) => ({
      id: r.id, folderId: r.folder_id, type: r.type, title: r.title, statement: r.statement, origin: r.origin,
      status: r.status, mark: r.mark, sources: sources.get(r.id) ?? [], createdAt: r.created_at,
    }));
  };
  // The chunks around one, nearest first; read only when its quote isn't in the chunk itself.
  const around = (materialId: string, ord: number, quote: string, chunk: { text: string }): Locatable[] => {
    if (findQuote(chunk.text, quote)) return [];
    return (db.prepare("SELECT text, marks, loc_from FROM chunks WHERE material_id = ? AND ord != ? AND ord BETWEEN ? AND ? ORDER BY abs(ord - ?)")
      .all(materialId, ord, ord - NEIGHBOURS, ord + NEIGHBOURS, ord) as { text: string; marks: string; loc_from: number }[])
      .map((r) => ({ text: r.text, marks: JSON.parse(r.marks) as StoredChunk["marks"], from: r.loc_from }));
  };
  const get = (id: string): Item => {
    const row = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow | undefined;
    if (!row) throw notFound("Item");
    return toItems([row])[0]!;
  };

  return {
    get,

    // Adds items found in one chunk. An identical title already anchored in the same chunk is skipped.
    addFromChunk(folderId: string, materialId: string, chunk: StoredChunk, drafts: ItemDraft[], origin: ItemOrigin): number {
      return transaction(db, () => {
        const existing = new Set((db.prepare(`SELECT i.title FROM items i JOIN item_sources s ON s.item_id = i.id WHERE s.chunk_id = ?`)
          .all(chunk.id) as { title: string }[]).map((r) => normalise(r.title)));
        const insertItem = db.prepare("INSERT INTO items (id, folder_id, type, title, statement, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
        const insertSource = db.prepare("INSERT INTO item_sources (item_id, chunk_id, material_id, loc, quote) VALUES (?, ?, ?, ?, ?)");
        let added = 0;
        for (const d of drafts) {
          if (existing.has(normalise(d.title))) continue;
          existing.add(normalise(d.title));
          const id = randomUUID();
          const at = now();
          insertItem.run(id, folderId, d.type, d.title.trim(), d.statement.trim(), origin, at, at);
          insertSource.run(id, chunk.id, materialId, locate(chunk, d.quote, around(materialId, chunk.ord, d.quote, chunk)), d.quote.trim().slice(0, 300));
          added++;
        }
        return added;
      });
    },

    // Compact one-line summaries of the items anchored in a chunk (what the auditor checks against).
    summariesForChunk(chunkId: string): string[] {
      return (db.prepare("SELECT i.type, i.title, i.statement FROM items i JOIN item_sources s ON s.item_id = i.id WHERE s.chunk_id = ? ORDER BY i.created_at")
        .all(chunkId) as { type: string; title: string; statement: string }[])
        .map((r) => `- [${r.type}] ${r.title}: ${r.statement.length > 140 ? `${r.statement.slice(0, 140)}…` : r.statement}`);
    },

    // The ledger of a folder: items from its own and its subfolders' materials.
    list(folderId: string): Item[] {
      return toItems(db.prepare(`WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id)
        SELECT i.* FROM items i JOIN sub ON i.folder_id = sub.id ORDER BY i.created_at, i.rowid`).all(folderId) as ItemRow[]);
    },

    // Groups of possibly-duplicate items in one folder that still need a merge decision (F-303).
    mergeCandidates(folderId: string, maxGroup = 6): { id: string; type: string; title: string; statement: string }[][] {
      const rows = db.prepare("SELECT id, type, title, statement, merge_checked FROM items WHERE folder_id = ? ORDER BY created_at")
        .all(folderId) as { id: string; type: string; title: string; statement: string; merge_checked: number }[];
      // A chain of similar titles can run long; it goes in pieces, sorted so close titles sit together, never cut short.
      return duplicateGroups(rows, (r) => !!r.merge_checked).flatMap((group) => {
        const sorted = group.length > maxGroup ? [...group].sort((a, b) => a.title.localeCompare(b.title)) : group;
        const pieces: (typeof rows)[] = [];
        for (let i = 0; i < sorted.length; i += maxGroup) pieces.push(sorted.slice(i, i + maxGroup));
        return pieces.filter((p) => p.length > 1).map((p) => p.map(({ merge_checked: _, ...r }) => r));
      });
    },

    markMergeChecked(folderId: string) {
      db.prepare("UPDATE items SET merge_checked = 1 WHERE folder_id = ?").run(folderId);
    },

    // Folds duplicates into one item that keeps every source anchor and the learner's record: lessons,
    // evidence, cards, graph links, the furthest status and any mark.
    merge(keep: string, drop: string[], title: string, statement: string) {
      transaction(db, () => {
        const kept = db.prepare("SELECT folder_id, status, mark FROM items WHERE id = ?").get(keep) as { folder_id: string; status: ItemStatus; mark: ItemMark | null } | undefined;
        if (!kept) return;
        let { status, mark } = kept;
        for (const id of drop.filter((d) => d !== keep)) {
          const row = db.prepare("SELECT folder_id, status, mark FROM items WHERE id = ?").get(id) as typeof kept | undefined;
          if (!row || row.folder_id !== kept.folder_id) continue;
          if (ITEM_STATUSES.indexOf(row.status) > ITEM_STATUSES.indexOf(status)) status = row.status;
          mark ??= row.mark;
          db.prepare("INSERT OR IGNORE INTO item_sources (item_id, chunk_id, material_id, loc, quote) SELECT ?, chunk_id, material_id, loc, quote FROM item_sources WHERE item_id = ?").run(keep, id);
          db.prepare("UPDATE OR IGNORE lesson_items SET item_id = ? WHERE item_id = ?").run(keep, id);
          db.prepare("UPDATE item_events SET item_id = ? WHERE item_id = ?").run(keep, id);
          db.prepare("UPDATE cards SET item_id = ? WHERE item_id = ?").run(keep, id);
          db.prepare("UPDATE OR IGNORE item_links SET from_id = ? WHERE from_id = ?").run(keep, id);
          db.prepare("UPDATE OR IGNORE item_links SET to_id = ? WHERE to_id = ?").run(keep, id);
          for (const [table, column] of JSON_IDS) {
            db.prepare(`UPDATE ${table} SET ${column} = replace(${column}, ?, ?) WHERE instr(${column}, ?) > 0`).run(id, keep, id);
          }
          db.prepare("DELETE FROM items WHERE id = ?").run(id);
        }
        db.prepare("DELETE FROM item_links WHERE from_id = to_id").run();
        db.prepare("UPDATE items SET status = ?, mark = ? WHERE id = ?").run(status, mark, keep);
        if (title.trim() && statement.trim()) db.prepare("UPDATE items SET title = ?, statement = ?, updated_at = ? WHERE id = ?").run(title.trim(), statement.trim(), now(), keep);
      });
    },

    // Merges what code can tell is the same (F-303), before the model looks at what's left: the earliest
    // item stays, with the fullest statement. Items added by hand are left alone.
    mergeExact(folderId: string): number {
      const rows = db.prepare("SELECT id, type, title, statement FROM items WHERE folder_id = ? AND origin != 'manual' ORDER BY created_at, rowid")
        .all(folderId) as { id: string; type: string; title: string; statement: string }[];
      const groups = exactDuplicates(rows);
      for (const group of groups) {
        const fullest = group.reduce((a, b) => (b.statement.length > a.statement.length ? b : a));
        this.merge(group[0]!.id, group.slice(1).map((r) => r.id), group[0]!.title, fullest.statement);
      }
      return groups.reduce((n, g) => n + g.length - 1, 0);
    },

    // Once per database, for ledgers made before Phase 10: quotes are found again with the better matching,
    // exact duplicates merge, and groups the merge step cut short go back to it for the next distil.
    tidyOnce(maxGroup = 6): boolean {
      if (!db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('ledger-tidy-1', 'done')").run().changes) return false;
      const sources = db.prepare(`SELECT s.item_id, s.chunk_id, s.loc, s.quote, c.material_id, c.ord, c.text, c.marks, c.loc_from
        FROM item_sources s JOIN chunks c ON c.id = s.chunk_id`).all() as
        { item_id: string; chunk_id: string; loc: number; quote: string; material_id: string; ord: number; text: string; marks: string; loc_from: number }[];
      const update = db.prepare("UPDATE item_sources SET loc = ? WHERE item_id = ? AND chunk_id = ?");
      for (const s of sources) {
        const chunk = { text: s.text, marks: JSON.parse(s.marks) as StoredChunk["marks"], from: s.loc_from };
        const loc = locate(chunk, s.quote, around(s.material_id, s.ord, s.quote, chunk));
        if (loc !== s.loc) update.run(loc, s.item_id, s.chunk_id);
      }
      for (const { folder_id: folderId } of db.prepare("SELECT DISTINCT folder_id FROM items").all() as { folder_id: string }[]) {
        this.mergeExact(folderId);
        const rows = db.prepare("SELECT id, title, statement FROM items WHERE folder_id = ?").all(folderId) as { id: string; title: string; statement: string }[];
        for (const group of duplicateGroups(rows).filter((g) => g.length > maxGroup)) {
          for (const r of group) db.prepare("UPDATE items SET merge_checked = 0 WHERE id = ? AND origin != 'manual'").run(r.id);
        }
      }
      return true;
    },

    addManual(folderId: string, draft: { type: ItemType; title: string; statement: string }): Item {
      const title = draft.title.trim();
      if (!title) throw new AppError(400, "invalid_item", "Give the item a title.");
      const id = randomUUID();
      const at = now();
      db.prepare("INSERT INTO items (id, folder_id, type, title, statement, origin, merge_checked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'manual', 1, ?, ?)")
        .run(id, folderId, draft.type, title, draft.statement.trim(), at, at);
      return get(id);
    },

    update(id: string, patch: { title?: string; statement?: string; type?: ItemType; mark?: ItemMark | null }): Item {
      get(id);
      const fields = Object.entries(patch).filter(([, v]) => v !== undefined);
      if (fields.length) {
        db.prepare(`UPDATE items SET ${fields.map(([k]) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
          .run(...fields.map(([, v]) => (typeof v === "string" ? v.trim() : v) as string | null), now(), id);
      }
      return get(id);
    },

    remove(id: string) {
      get(id);
      db.prepare("DELETE FROM items WHERE id = ?").run(id);
    },

    // Extracted items whose every source is gone (their material was deleted or re-read) go with it.
    // Items left with no anchor (their text was removed) go; the ones removed are returned for the re-import diff.
    removeOrphans(): { type: string; title: string }[] {
      const where = "origin != 'manual' AND id NOT IN (SELECT item_id FROM item_sources)";
      const removed = db.prepare(`SELECT type, title FROM items WHERE ${where} ORDER BY created_at`).all() as { type: string; title: string }[];
      db.prepare(`DELETE FROM items WHERE ${where}`).run();
      return removed;
    },
  };
}

export type Ledger = ReturnType<typeof createLedger>;
