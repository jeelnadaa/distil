import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";

export type MessageStatus = "streaming" | "done" | "aborted" | "error";
export type Message = {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  content: string;
  status: MessageStatus;
  error: string | null;
  provider: string | null;
  model: string | null;
  createdAt: number;
};

type Row = {
  id: string; chat_id: string; role: Message["role"]; content: string; status: MessageStatus;
  error: string | null; provider: string | null; model: string | null; created_at: number;
};

const toMessage = (r: Row): Message => ({
  id: r.id, chatId: r.chat_id, role: r.role, content: r.content, status: r.status, error: r.error,
  provider: r.provider, model: r.model, createdAt: r.created_at,
});

export function createMessages(db: Db, now = () => Date.now()) {
  return {
    list(chatId: string): Message[] {
      return (db.prepare("SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at, rowid").all(chatId) as Row[]).map(toMessage);
    },

    add(m: Pick<Message, "chatId" | "role" | "content" | "status"> & Partial<Pick<Message, "provider" | "model">>): Message {
      const message: Message = {
        id: randomUUID(), error: null, provider: null, model: null, createdAt: now(), ...m,
      };
      db.prepare(`INSERT INTO messages (id, chat_id, role, content, status, error, provider, model, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(message.id, message.chatId, message.role, message.content, message.status, message.error,
          message.provider, message.model, message.createdAt);
      return message;
    },

    // A reply answered by a fallback model is credited to that model.
    setModel(id: string, provider: string, model: string) {
      db.prepare("UPDATE messages SET provider = ?, model = ? WHERE id = ?").run(provider, model, id);
    },

    finish(id: string, content: string, status: Exclude<MessageStatus, "streaming">, error: string | null = null) {
      db.prepare("UPDATE messages SET content = ?, status = ?, error = ? WHERE id = ?").run(content, status, error, id);
    },

    // A crash or restart mid-reply leaves rows in "streaming"; mark them honestly as interrupted (F-1306).
    recoverInterrupted() {
      db.prepare("UPDATE messages SET status = 'aborted', error = 'Interrupted by a restart.' WHERE status = 'streaming'").run();
    },
  };
}

export type Messages = ReturnType<typeof createMessages>;
