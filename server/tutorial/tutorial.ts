import { readFileSync } from "node:fs";
import type { Db } from "../db.ts";
import type { Chat, Library } from "../library.ts";
import type { Messages } from "../messages.ts";

// The built-in tutorial (F-1312): one "How to use Distil" chat. It opens with a fixed tour of the app
// (no tokens) and answers questions from the user guide shipped beside this file, nothing else. It's
// added on the first start and can be opened again from Settings › About or the shortcut sheet.

const GUIDE = readFileSync(new URL("./guide.md", import.meta.url), "utf8");
export const WELCOME = readFileSync(new URL("./welcome.md", import.meta.url), "utf8").trim();
export const TUTORIAL_TITLE = "How to use Distil";

export const GUIDE_SYSTEM = `You are the guide built into Distil, a study app. You answer questions about using Distil from its user guide below, and nothing else.
- Be brief and concrete: say where to go and what to press, with screen, tab and button names in bold, and link screens the way the guide does, like [Today](#/today).
- If the guide doesn't cover something, say so plainly; never invent features, buttons, settings or shortcuts.
- A question about a study subject rather than about Distil: answer in a sentence or two, then suggest a New chat in the subject's folder, where answers use the learner's own material.

<guide>
${GUIDE}
</guide>`;

export function createTutorial({ db, library, messages }: { db: Db; library: Library; messages: Messages }) {
  const find = (): Chat | null => {
    const row = db.prepare("SELECT id FROM chats WHERE mode = 'guide' ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
    return row ? library.getChat(row.id) : null;
  };
  // The existing tutorial chat, or a new one with the tour as its first message.
  function open(): Chat {
    const existing = find();
    if (existing) return existing;
    const chat = library.createChat(null, undefined, { mode: "guide", title: TUTORIAL_TITLE });
    messages.add({ chatId: chat.id, role: "assistant", content: WELCOME, status: "done" });
    return chat;
  }
  // Added once, on the first start with this feature; a learner who deletes it isn't given it again.
  function addOnce() {
    if (db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('tutorial', 'added')").run().changes) open();
  }
  return { open, find, addOnce };
}

export type Tutorial = ReturnType<typeof createTutorial>;
