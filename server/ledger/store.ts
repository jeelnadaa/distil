import { randomUUID } from "node:crypto";
import { type Db, transaction } from "../db.ts";
import { AppError, notFound } from "../errors.ts";
import { locAt } from "../materials/chunk.ts";
import type { StoredChunk } from "../materials/store.ts";
import { ITEM_TYPES } from "../prompts.ts";

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

// Finds where a quote sits in its chunk, tolerating whitespace and case differences.
export function locate(chunk: Pick<StoredChunk, "text" | "marks" | "from">, quote: string): number {
  // Normalise the chunk while remembering each normalised character's original offset.
  let text = "";
  const offsets: number[] = [];
  for (let i = 0; i < chunk.text.length; i++) {
    const ch = chunk.text[i]!;
    if (/\s/.test(ch)) {
      if (!text || text.endsWith(" ")) continue;
      text += " ";
    } else {
      text += ch.toLowerCase();
    }
    offsets.push(i);
  }
  const needle = normalise(quote);
  let index = needle ? text.indexOf(needle) : -1;
  if (index === -1 && needle.length > 24) index = text.indexOf(needle.slice(0, 24));
  return index === -1 ? chunk.from : locAt(chunk.marks, offsets[index] ?? 0, chunk.from);
}

const STOP = new Set(["the", "a", "an", "of", "and", "or", "in", "on", "for", "to", "with", "its", "is", "by", "as", "at", "from"]);
const words = (s: string) => new Set(normalise(s).replace(/[^\p{L}\p{N} ]/gu, " ").split(" ").filter((w) => w && !STOP.has(w)));
const jaccard = (a: Set<string>, b: Set<string>) => {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared || 1);
};

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
          insertSource.run(id, chunk.id, materialId, locate(chunk, d.quote), d.quote.trim().slice(0, 300));
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
    // Code proposes, the model decides: only titles with real word overlap are ever sent.
    mergeCandidates(folderId: string, maxGroup = 6): { id: string; type: string; title: string; statement: string }[][] {
      const rows = db.prepare("SELECT id, type, title, statement, merge_checked FROM items WHERE folder_id = ? ORDER BY created_at")
        .all(folderId) as { id: string; type: string; title: string; statement: string; merge_checked: number }[];
      const sets = rows.map((r) => words(r.title));
      const parent = rows.map((_, i) => i);
      const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          if (rows[i]!.merge_checked && rows[j]!.merge_checked) continue;
          const same = jaccard(sets[i]!, sets[j]!) >= 0.6 || normalise(rows[i]!.statement) === normalise(rows[j]!.statement);
          if (same) parent[find(j)] = find(i);
        }
      }
      const groups = new Map<number, typeof rows>();
      rows.forEach((r, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), r]));
      return [...groups.values()].filter((g) => g.length > 1).map((g) => g.slice(0, maxGroup).map(({ merge_checked: _, ...r }) => r));
    },

    markMergeChecked(folderId: string) {
      db.prepare("UPDATE items SET merge_checked = 1 WHERE folder_id = ?").run(folderId);
    },

    // Folds duplicates into one item that keeps every source anchor.
    merge(keep: string, drop: string[], title: string, statement: string) {
      transaction(db, () => {
        const kept = db.prepare("SELECT folder_id FROM items WHERE id = ?").get(keep) as { folder_id: string } | undefined;
        if (!kept) return;
        for (const id of drop.filter((d) => d !== keep)) {
          const row = db.prepare("SELECT folder_id FROM items WHERE id = ?").get(id) as { folder_id: string } | undefined;
          if (!row || row.folder_id !== kept.folder_id) continue;
          db.prepare("INSERT OR IGNORE INTO item_sources (item_id, chunk_id, material_id, loc, quote) SELECT ?, chunk_id, material_id, loc, quote FROM item_sources WHERE item_id = ?").run(keep, id);
          db.prepare("DELETE FROM items WHERE id = ?").run(id);
        }
        if (title.trim() && statement.trim()) db.prepare("UPDATE items SET title = ?, statement = ?, updated_at = ? WHERE id = ?").run(title.trim(), statement.trim(), now(), keep);
      });
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
    removeOrphans() {
      db.prepare("DELETE FROM items WHERE origin != 'manual' AND id NOT IN (SELECT item_id FROM item_sources)").run();
    },
  };
}

export type Ledger = ReturnType<typeof createLedger>;
