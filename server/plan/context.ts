import type { Db } from "../db.ts";
import type { Chat } from "../library.ts";
import { briefContext } from "./brief.ts";

// What every Q&A turn knows besides the conversation: the nearest study brief (F-105) and, unless the chat
// is set to Independent, a digest of what the learner has studied in the folder (F-925). Lesson chats are
// taught by the teaching engine (server/teach/), which adds the brief itself.
export function chatContext(db: Db, digest?: (folderId: string) => string) {
  return (chat: Chat): string => {
    if (!chat.folderId) return "";
    return [briefContext(db, chat.folderId), chat.independent ? "" : digest?.(chat.folderId) ?? ""].filter(Boolean).join("\n\n");
  };
}
