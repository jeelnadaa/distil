import { randomUUID } from "node:crypto";
import type { Db } from "../db.ts";
import { notFound } from "../errors.ts";
import { type CheckSpec, publicCheck, type PublicCheck, type Result } from "./checks.ts";

export type StepKind = "orientation" | "teach";
export type StepStatus = "upcoming" | "current" | "done" | "shaky";
export type Step = { title: string; kind: StepKind; items: string[]; status: StepStatus };
export type Phase = "probe" | "teach" | "recap" | "done";
export type Session = { chatId: string; lessonId: string; phase: Phase; steps: Step[]; step: number; repairs: number; probe: { prompt: string; verdict: string }[] };
export type Check = { id: string; chatId: string; messageId: string; step: number; items: string[]; spec: CheckSpec; result: Result | null; createdAt: number };
// A check as the browser sees it: the answer only once answered.
export type CheckView = { id: string; messageId: string; step: number; question: PublicCheck; result: Result | null };

type SessionRow = { chat_id: string; lesson_id: string; phase: Phase; steps: string; step: number; repairs: number; probe: string };
type CheckRow = { id: string; chat_id: string; message_id: string; step: number; items: string; spec: string; result: string | null; created_at: number };

const toCheck = (r: CheckRow): Check => ({
  id: r.id, chatId: r.chat_id, messageId: r.message_id, step: r.step, items: JSON.parse(r.items), spec: JSON.parse(r.spec),
  result: r.result ? JSON.parse(r.result) : null, createdAt: r.created_at,
});
export const checkView = (c: Check): CheckView => ({ id: c.id, messageId: c.messageId, step: c.step, question: publicCheck(c.id, c.spec), result: c.result });

export function createTeachStore(db: Db, now = () => Date.now()) {
  const store = {
    session(chatId: string): Session | null {
      const r = db.prepare("SELECT * FROM teach_sessions WHERE chat_id = ?").get(chatId) as SessionRow | undefined;
      return r ? { chatId: r.chat_id, lessonId: r.lesson_id, phase: r.phase, steps: JSON.parse(r.steps), step: r.step, repairs: r.repairs, probe: JSON.parse(r.probe) } : null;
    },
    create(s: Omit<Session, "repairs">): Session {
      db.prepare(`INSERT INTO teach_sessions (chat_id, lesson_id, phase, steps, step, repairs, probe, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`).run(s.chatId, s.lessonId, s.phase, JSON.stringify(s.steps), s.step, JSON.stringify(s.probe), now(), now());
      return store.session(s.chatId)!;
    },
    save(s: Session) {
      db.prepare("UPDATE teach_sessions SET phase = ?, steps = ?, step = ?, repairs = ?, probe = ?, updated_at = ? WHERE chat_id = ?")
        .run(s.phase, JSON.stringify(s.steps), s.step, s.repairs, JSON.stringify(s.probe), now(), s.chatId);
    },

    addCheck(c: Omit<Check, "id" | "result" | "createdAt">): Check {
      const check: Check = { ...c, id: randomUUID(), result: null, createdAt: now() };
      db.prepare("INSERT INTO checks (id, chat_id, message_id, step, items, spec, result, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)")
        .run(check.id, check.chatId, check.messageId, check.step, JSON.stringify(check.items), JSON.stringify(check.spec), check.createdAt);
      return check;
    },
    check(id: string): Check {
      const r = db.prepare("SELECT * FROM checks WHERE id = ?").get(id) as CheckRow | undefined;
      if (!r) throw notFound("Check");
      return toCheck(r);
    },
    checks(chatId: string): Check[] {
      return (db.prepare("SELECT * FROM checks WHERE chat_id = ? ORDER BY created_at, rowid").all(chatId) as CheckRow[]).map(toCheck);
    },
    // The question waiting for an answer, if any.
    open(chatId: string): Check | null {
      const r = db.prepare("SELECT * FROM checks WHERE chat_id = ? AND result IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1").get(chatId) as CheckRow | undefined;
      return r ? toCheck(r) : null;
    },
    answer(id: string, result: Result) {
      db.prepare("UPDATE checks SET result = ? WHERE id = ?").run(JSON.stringify(result), id);
    },
  };
  return store;
}

export type TeachStore = ReturnType<typeof createTeachStore>;
