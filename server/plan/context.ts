import type { Db } from "../db.ts";
import type { Chat } from "../library.ts";
import { briefContext } from "./brief.ts";

// What every Q&A turn knows besides the conversation (F-105): the nearest study brief. Lesson chats are
// taught by the teaching engine (server/teach/), which adds the brief itself.
export function chatContext(db: Db) {
  return (chat: Chat): string => (chat.folderId ? briefContext(db, chat.folderId) : "");
}
