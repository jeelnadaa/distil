import type { Db } from "../db.ts";
import type { Chat } from "../library.ts";
import type { Ledger } from "../ledger/store.ts";
import { briefContext } from "./brief.ts";
import type { Plans } from "./store.ts";

// How a lesson chat teaches until Phase 4's teacher: real content gets taught and checked, course
// admin is only mentioned, and a wrong answer is worked through before moving on.
const LESSON_RULES = `Teach the items below in order, a few related ones at a time, and stay within them. Each item shows where the learner is with it.
- A wrong or partly wrong answer comes first, before anything new: say what was right and what was not, explain the idea again another way (a new example or analogy), and ask a new question on the same item. Do not start the next item in that reply. Move on only once the learner answers it correctly or asks to move on.
- A right answer: confirm it in a sentence, add one detail that deepens it, then continue with the next item.
- Course admin (what a chapter covers, learning objectives, which fields use the subject, how the book is organised) is not something to learn: sum it up in a sentence or two as orientation, and never quiz it.
- For each real item: say why it matters, explain it plainly, then give a concrete example. Use a formula, worked example or small table where it helps.
- Check understanding with one short question that needs thinking (apply, compare, explain why), not recall of a list or a fact you just stated. Then stop and wait for the answer.
- Keep each reply short: one idea and one question at a time, no long recaps. When every item is understood, give a three-line summary and say the lesson is done.`;

const WHERE: Record<string, string> = { pending: "not taught", planned: "not taught", taught: "taught, not yet answered correctly", checked: "understood", mastered: "understood" };

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
        return `${i + 1}. [${WHERE[item.status] ?? item.status}] ${item.title} (${item.type}): ${item.statement}`;
      });
      parts.push([
        `This chat is the lesson "${lesson.title}". ${lesson.summary}`.trim(),
        LESSON_RULES,
        "The items:",
        ...items,
      ].join("\n"));
    }
    return parts.filter(Boolean).join("\n\n");
  };
}
