import type { Db } from "../db.ts";
import { notFound } from "../errors.ts";
import { type ItemEvent, type ItemStatus, ITEM_STATUSES } from "./types.ts";

// Learner state, shared by every learning mode: evidence is appended per item, and an item's status only
// ever moves forward (pending → planned → taught → checked → mastered). Mastery itself is Phase 7's job.

// A check counts as passed at this score or above.
export const PASS = 0.7;

export function createLearner(db: Db, now = () => Date.now()) {
  const rank = (s: string) => ITEM_STATUSES.indexOf(s as ItemStatus);
  const folderOf = (itemId: string) => {
    const row = db.prepare("SELECT folder_id FROM items WHERE id = ?").get(itemId) as { folder_id: string } | undefined;
    if (!row) throw notFound("Item");
    return row.folder_id;
  };

  const learner = {
    // Moves items forward to `status`; items already at or past it are left alone. Returns how many moved.
    advance(itemIds: string[], status: ItemStatus): number {
      let moved = 0;
      const update = db.prepare("UPDATE items SET status = ?, updated_at = ? WHERE id = ? AND status = ?");
      for (const id of itemIds) {
        const row = db.prepare("SELECT status FROM items WHERE id = ?").get(id) as { status: string } | undefined;
        if (!row || rank(row.status) >= rank(status)) continue;
        moved += Number(update.run(status, now(), id, row.status).changes);
      }
      return moved;
    },

    // Records evidence and moves the status it implies: teaching → taught, a passed unaided check,
    // practice or exam answer → checked.
    record(event: ItemEvent): void {
      db.prepare(`INSERT INTO item_events (item_id, folder_id, kind, score, confidence, with_help, chat_id, message_id, ref, at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(event.itemId, folderOf(event.itemId), event.kind, event.score ?? null,
        event.confidence ?? null, event.withHelp ? 1 : 0, event.chatId ?? null, event.messageId ?? null, event.ref ?? null, now());
      if (event.kind === "taught") learner.advance([event.itemId], "taught");
      const verified = event.kind === "check" || event.kind === "practice" || event.kind === "exam";
      if (verified && !event.withHelp && (event.score ?? 0) >= PASS) learner.advance([event.itemId], "checked");
    },

    events(itemId: string) {
      return db.prepare("SELECT kind, score, confidence, with_help AS withHelp, ref, at FROM item_events WHERE item_id = ? ORDER BY at, id")
        .all(itemId) as { kind: string; score: number | null; confidence: string | null; withHelp: number; ref: string | null; at: number }[];
    },
  };
  return learner;
}
export type Learner = ReturnType<typeof createLearner>;
