import { randomUUID } from "node:crypto";
import type { Db } from "../db.ts";
import { AppError, notFound } from "../errors.ts";
import { type CardState, type Grade, NEW_CARD, parseState, preview, review } from "./fsrs.ts";

// Flashcards (F-901…F-904): a card belongs to a folder and usually to a ledger item, and carries its
// scheduler state. New cards are introduced at most NEW_PER_DAY a day per queue; due cards come first.

export const CARD_KINDS = ["basic", "reverse", "cloze", "formula"] as const;
export type CardKind = (typeof CARD_KINDS)[number];
export type CardOrigin = "taught" | "missed" | "manual" | "import";
export type Card = {
  id: string; folderId: string; itemId: string | null; itemTitle: string | null; kind: CardKind; front: string; back: string;
  origin: CardOrigin; state: CardState; dueAt: number | null; createdAt: number; updatedAt: number;
};
// A card in the review queue, with when each grade would bring it back (ms from now) and where it comes from.
export type QueueCard = Card & { preview: number[]; folderName: string; source: { materialId: string; loc: number } | null };
export type Queue = { cards: QueueCard[]; due: number; fresh: number; reviewedToday: number; nextDue: number | null };

export const NEW_PER_DAY = 20;
const QUEUE_SIZE = 50;

type Row = {
  id: string; folder_id: string; item_id: string | null; item_title: string | null; kind: CardKind; front: string; back: string;
  origin: CardOrigin; state: string; due_at: number | null; created_at: number; updated_at: number;
};
const toCard = (r: Row): Card => ({
  id: r.id, folderId: r.folder_id, itemId: r.item_id, itemTitle: r.item_title, kind: r.kind, front: r.front, back: r.back,
  origin: r.origin, state: parseState(r.state), dueAt: r.due_at, createdAt: r.created_at, updatedAt: r.updated_at,
});

const SUBTREE = "WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id)";
const SELECT = "SELECT c.*, i.title AS item_title FROM cards c LEFT JOIN items i ON i.id = c.item_id";

export const startOfDay = (now: number) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); };

export function createCards(db: Db, now = () => Date.now()) {
  const store = {
    get(id: string): Card {
      const r = db.prepare(`${SELECT} WHERE c.id = ?`).get(id) as Row | undefined;
      if (!r) throw notFound("Card");
      return toCard(r);
    },
    list(folderId: string): Card[] {
      return (db.prepare(`${SUBTREE} ${SELECT} JOIN sub ON c.folder_id = sub.id ORDER BY c.created_at DESC, c.rowid DESC`).all(folderId) as Row[]).map(toCard);
    },
    create(c: { folderId: string; itemId?: string | null; kind: CardKind; front: string; back: string; origin: CardOrigin }): Card {
      const id = randomUUID();
      const t = now();
      db.prepare(`INSERT INTO cards (id, folder_id, item_id, kind, front, back, origin, state, due_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, c.folderId, c.itemId ?? null, c.kind, c.front.trim(), c.back.trim(), c.origin, JSON.stringify(NEW_CARD), t, t, t);
      return store.get(id);
    },
    update(id: string, patch: { front?: string; back?: string; kind?: CardKind }): Card {
      const card = store.get(id);
      const next = { ...card, ...patch };
      db.prepare("UPDATE cards SET front = ?, back = ?, kind = ?, updated_at = ? WHERE id = ?").run(next.front.trim(), next.back.trim(), next.kind, now(), id);
      return store.get(id);
    },
    remove(id: string) {
      store.get(id);
      db.prepare("DELETE FROM cards WHERE id = ?").run(id);
    },
    // Items in this list that already have a card.
    carded(itemIds: string[]): Set<string> {
      const has = db.prepare("SELECT 1 FROM cards WHERE item_id = ? LIMIT 1");
      return new Set(itemIds.filter((id) => has.get(id)));
    },

    // What to review now in a folder (with its subfolders) or everywhere: due cards by how overdue they
    // are, then new cards up to today's allowance.
    queue(folderId: string | null, at = now()): Queue {
      const scope = folderId ? `${SUBTREE} ${SELECT} JOIN sub ON c.folder_id = sub.id` : SELECT;
      const args = folderId ? [folderId] : [];
      const all = (db.prepare(`${scope} WHERE c.due_at IS NOT NULL ORDER BY c.due_at, c.rowid`).all(...args) as Row[]).map(toCard);
      const day = startOfDay(at);
      const introduced = all.filter((c) => c.state.seen !== null && c.state.seen >= day).length;
      const reviewedToday = all.filter((c) => c.state.last !== null && c.state.last >= day).length;
      const due = all.filter((c) => c.state.phase !== "new" && c.dueAt! <= at);
      const fresh = all.filter((c) => c.state.phase === "new").slice(0, Math.max(0, NEW_PER_DAY - introduced));
      const later = all.filter((c) => c.state.phase !== "new" && c.dueAt! > at).map((c) => c.dueAt!);
      const folders = new Map((db.prepare("SELECT id, name FROM folders").all() as { id: string; name: string }[]).map((f) => [f.id, f.name]));
      const anchor = db.prepare("SELECT material_id, loc FROM item_sources WHERE item_id = ? ORDER BY rowid LIMIT 1");
      const cards = [...due, ...fresh].slice(0, QUEUE_SIZE).map((c): QueueCard => {
        const a = c.itemId ? (anchor.get(c.itemId) as { material_id: string; loc: number } | undefined) : undefined;
        return { ...c, preview: preview(c.state, at), folderName: folders.get(c.folderId) ?? "", source: a ? { materialId: a.material_id, loc: a.loc } : null };
      });
      return { cards, due: due.length, fresh: fresh.length, reviewedToday, nextDue: later.length ? Math.min(...later) : null };
    },

    review(id: string, grade: Grade, at = now()): Card {
      const card = store.get(id);
      const { state, due } = review(card.state, grade, at);
      db.prepare("UPDATE cards SET state = ?, due_at = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(state), due, at, id);
      return store.get(id);
    },

    // Anki-compatible tab-separated text (F-904): front, back, then tags; HTML line breaks for new lines.
    exportTsv(folderId: string): string {
      const cell = (s: string) => s.replace(/\t/g, " ").replace(/\r?\n/g, "<br>");
      return ["#separator:tab", "#html:true", "#columns:Front\tBack\tTags",
        ...store.list(folderId).map((c) => [cell(c.front), cell(c.back), `distil ${c.kind}`].join("\t"))].join("\n") + "\n";
    },
    importTsv(folderId: string, text: string): number {
      const rows = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.split("\t"));
      const cards = rows.filter((r) => r.length >= 2 && r[0]!.trim() && r[1]!.trim());
      if (!cards.length) throw new AppError(400, "empty_import", "No cards found: each line needs a front and a back separated by a tab.");
      const uncell = (s: string) => s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
      for (const [front, back] of cards.slice(0, 5000)) {
        const f = uncell(front!), b = uncell(back!);
        if (f && b) store.create({ folderId, kind: /\{\{c\d+::/.test(f) ? "cloze" : "basic", front: f.slice(0, 2000), back: b.slice(0, 4000), origin: "import" });
      }
      return Math.min(cards.length, 5000);
    },
  };
  return store;
}
export type Cards = ReturnType<typeof createCards>;
