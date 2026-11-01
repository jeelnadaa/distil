import { z } from "zod";
import type { Chat } from "../library.ts";
import type { Ledger } from "../ledger/store.ts";
import type { Learner } from "../learning/learner.ts";
import { completeJson, type LlmDeps } from "../llm.ts";
import type { ChatMessage } from "../providers/types.ts";
import type { Plans } from "./store.ts";

// Lesson progress until Phase 4's teacher: after each reply in a lesson chat the cheap model reads the
// latest exchange and says which items were taught and which the learner answered correctly on their own.
// Items only move forward, and a lesson whose items are all checked is done.

const SYSTEM = `You keep the record of a tutoring lesson. You get the lesson's numbered items with their status, and the latest exchange.
Reply with JSON only: {"taught": [numbers], "checked": [numbers]}
- taught: items the tutor explained in this exchange (a real explanation, not a passing mention or a plan of what comes next).
- checked: items the learner showed they understand in this exchange: their own answer was correct, without the tutor giving it away, and the tutor confirmed it. A wrong or partly wrong answer is not checked.
Leave both lists empty when nothing happened.`;

const Reply = z.object({ taught: z.array(z.number().int()).default([]), checked: z.array(z.number().int()).default([]) });
const EXCERPT = 4000;

export type ProgressDeps = LlmDeps & { plans: Plans; ledger: Ledger; learner: Learner };

// exchange: the tutor's previous reply, the learner's message and the new reply. Returns whether anything moved.
export function lessonProgress(deps: ProgressDeps) {
  return async (chat: Chat, exchange: ChatMessage[], messageId: string): Promise<boolean> => {
    if (!chat.lessonId) return false;
    const lesson = deps.plans.lesson(chat.lessonId);
    const items = lesson.items.map((id) => deps.ledger.get(id));
    const prompt = [
      "Items:",
      ...items.map((item, i) => `${i + 1}. [${item.status}] ${item.title}: ${item.statement}`),
      "",
      "Latest exchange:",
      ...exchange.map((m) => `${m.role === "user" ? "Learner" : "Tutor"}: ${m.content.slice(-EXCERPT)}`),
    ].join("\n");
    const reply = await completeJson(deps, Reply, { slot: "cheap", role: "tracker", folderId: chat.folderId, system: SYSTEM, prompt, maxTokens: 300 });

    const at = (numbers: number[]) => [...new Set(numbers)].map((n) => items[n - 1]).filter((item) => !!item);
    const event = { chatId: chat.id, messageId };
    let moved = false;
    for (const item of at(reply.taught)) {
      if (item.status !== "pending" && item.status !== "planned") continue;
      deps.learner.record({ itemId: item.id, kind: "taught", ...event });
      moved = true;
    }
    for (const item of at(reply.checked)) {
      if (item.status === "checked" || item.status === "mastered") continue;
      deps.learner.record({ itemId: item.id, kind: "check", score: 1, withHelp: false, ...event });
      moved = true;
    }
    const finished = lesson.items.map((id) => deps.ledger.get(id)).every((i) => i.status === "checked" || i.status === "mastered" || i.mark === "known");
    if (moved && finished && lesson.status !== "done") deps.plans.updateLesson(lesson.id, { status: "done" });
    return moved;
  };
}
