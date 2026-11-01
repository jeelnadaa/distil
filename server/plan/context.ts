import type { Db } from "../db.ts";
import type { Chat } from "../library.ts";
import type { Ledger } from "../ledger/store.ts";
import { briefContext } from "./brief.ts";
import type { Plans } from "./store.ts";

// What every chat turn knows besides the conversation (F-105): the nearest study brief and, in a lesson
// chat, the lesson and the ledger items it must teach. Phase 4 replaces the lesson block with the
// teaching engine; the brief block stays.
export function chatContext(db: Db, plans: Plans, ledger: Ledger) {
  return (chat: Chat): string => {
    const parts = chat.folderId ? [briefContext(db, chat.folderId)] : [];
    if (chat.lessonId) {
      const lesson = plans.lesson(chat.lessonId);
      const items = lesson.items.map((id, i) => {
        const item = ledger.get(id);
        return `${i + 1}. ${item.title} (${item.type}): ${item.statement}`;
      });
      parts.push([
        `This chat is the lesson "${lesson.title}". ${lesson.summary}`.trim(),
        "Teach these items in order, one at a time, checking understanding before moving on. Stay within them.",
        ...items,
      ].join("\n"));
    }
    return parts.filter(Boolean).join("\n\n");
  };
}
