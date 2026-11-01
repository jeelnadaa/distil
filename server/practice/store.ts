import { randomUUID } from "node:crypto";
import type { Db } from "../db.ts";
import { notFound } from "../errors.ts";
import { shuffled } from "../teach/checks.ts";
import type { AnswerValue, Grade, Level, QuestionSpec } from "./questions.ts";

export type PaperKind = "practice" | "exam";
export type PaperStatus = "writing" | "ready" | "taking" | "grading" | "done" | "failed";
// What a paper covers (F-801): everything in the folder, the weak items, one plan unit or lesson, or chosen items.
export type Scope = { kind: "all" | "weak" | "unit" | "lesson" | "items"; id?: string; items?: string[] };
export type PaperConfig = { scope: Scope; count: number; minutes: number | null; ladder: "rising" | "mixed"; label: string };
export type Attempt = AnswerValue & { grade: Grade; withHelp: boolean };
export type ReportRow = { id: string; ord: number; section: string; score: number; marks: number; timeMs: number; missed: string[] };
export type Report = {
  score: number; marks: number; summary: string; cards: number; weak: string[];
  sections: { name: string; score: number; marks: number }[]; questions: ReportRow[];
};
export type Paper = {
  chatId: string; folderId: string; kind: PaperKind; config: PaperConfig; status: PaperStatus; error: string | null;
  title: string; instructions: string; elapsedMs: number; report: Report | null; createdAt: number; updatedAt: number;
};
export type Question = {
  id: string; chatId: string; ord: number; section: string; items: string[]; spec: QuestionSpec;
  answer: AnswerValue | null; timeMs: number; attempts: Attempt[]; hints: number; result: Grade | null;
};

type PaperRow = {
  chat_id: string; folder_id: string; kind: PaperKind; config: string; status: PaperStatus; error: string | null; title: string;
  instructions: string; elapsed_ms: number; report: string | null; created_at: number; updated_at: number;
};
type QuestionRow = {
  id: string; chat_id: string; ord: number; section: string; items: string; spec: string; answer: string | null;
  time_ms: number; attempts: string; hints: number; result: string | null;
};

const toPaper = (r: PaperRow): Paper => ({
  chatId: r.chat_id, folderId: r.folder_id, kind: r.kind, config: JSON.parse(r.config), status: r.status, error: r.error, title: r.title,
  instructions: r.instructions, elapsedMs: r.elapsed_ms, report: r.report ? JSON.parse(r.report) : null, createdAt: r.created_at, updatedAt: r.updated_at,
});
const toQuestion = (r: QuestionRow): Question => ({
  id: r.id, chatId: r.chat_id, ord: r.ord, section: r.section, items: JSON.parse(r.items), spec: JSON.parse(r.spec),
  answer: r.answer ? JSON.parse(r.answer) : null, timeMs: r.time_ms, attempts: JSON.parse(r.attempts), hints: r.hints, result: r.result ? JSON.parse(r.result) : null,
});

// What the browser sees of a question: no solution, rubric points or hints until they're earned, and
// ordering steps shuffled. Once marked (or after any practice attempt), the solution and rubric are shown.
export type QuestionView = {
  id: string; ord: number; section: string; type: QuestionSpec["type"]; prompt: string; marks: number; level: Level;
  options?: string[]; steps?: string[]; unit?: string;
  answer: AnswerValue | null; timeMs: number; attempts: Attempt[]; hintsShown: string[]; hintsLeft: number;
  result: Grade | null; solution: string | null; rubric: { point: string; marks: number }[] | null; correct: string | null;
};

export function correctText(q: QuestionSpec): string | null {
  if (q.type === "mcq") return q.options[q.answer]!;
  if (q.type === "numeric") return `${q.answer}${q.unit ? ` ${q.unit}` : ""}`;
  if (q.type === "order") return q.steps.join(" → ");
  return null;
}

export function questionView(q: Question): QuestionView {
  const s = q.spec;
  const revealed = q.result !== null;
  return {
    id: q.id, ord: q.ord, section: q.section, type: s.type, prompt: s.prompt, marks: s.marks, level: s.level,
    ...(s.type === "mcq" && { options: s.options }),
    ...(s.type === "order" && { steps: shuffled(s.steps.length, q.id).map((i) => s.steps[i]!) }),
    ...(s.type === "numeric" && { unit: s.unit }),
    answer: q.answer, timeMs: q.timeMs, attempts: q.attempts, hintsShown: s.hints.slice(0, q.hints), hintsLeft: s.hints.length - q.hints,
    result: q.result, solution: revealed ? s.solution : null, rubric: revealed ? s.rubric : null, correct: revealed ? correctText(s) : null,
  };
}

export function createPapers(db: Db, now = () => Date.now()) {
  const store = {
    create(p: { chatId: string; folderId: string; kind: PaperKind; config: PaperConfig }): Paper {
      db.prepare(`INSERT INTO papers (chat_id, folder_id, kind, config, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'writing', ?, ?)`)
        .run(p.chatId, p.folderId, p.kind, JSON.stringify(p.config), now(), now());
      return store.get(p.chatId);
    },
    find(chatId: string): Paper | null {
      const r = db.prepare("SELECT * FROM papers WHERE chat_id = ?").get(chatId) as PaperRow | undefined;
      return r ? toPaper(r) : null;
    },
    get(chatId: string): Paper {
      const p = store.find(chatId);
      if (!p) throw notFound("Practice set");
      return p;
    },
    // A folder's papers and those of its subfolders, newest first.
    list(folderId: string): Paper[] {
      return (db.prepare(`WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id)
        SELECT p.* FROM papers p JOIN sub ON p.folder_id = sub.id ORDER BY p.created_at DESC`).all(folderId) as PaperRow[]).map(toPaper);
    },
    update(chatId: string, patch: Partial<Pick<Paper, "status" | "error" | "title" | "instructions" | "elapsedMs" | "report">>) {
      const cols: Record<string, unknown> = {
        ...(patch.status !== undefined && { status: patch.status }), ...(patch.error !== undefined && { error: patch.error }),
        ...(patch.title !== undefined && { title: patch.title }), ...(patch.instructions !== undefined && { instructions: patch.instructions }),
        ...(patch.elapsedMs !== undefined && { elapsed_ms: patch.elapsedMs }),
        ...(patch.report !== undefined && { report: patch.report ? JSON.stringify(patch.report) : null }),
      };
      const keys = Object.keys(cols);
      db.prepare(`UPDATE papers SET ${keys.map((k) => `${k} = ?`).join(", ")}${keys.length ? ", " : ""}updated_at = ? WHERE chat_id = ?`)
        .run(...(Object.values(cols) as (string | number | null)[]), now(), chatId);
    },

    setQuestions(chatId: string, specs: QuestionSpec[]) {
      db.prepare("DELETE FROM questions WHERE chat_id = ?").run(chatId);
      const insert = db.prepare("INSERT INTO questions (id, chat_id, ord, section, items, spec) VALUES (?, ?, ?, ?, ?, ?)");
      specs.forEach((s, i) => insert.run(randomUUID(), chatId, i, s.section, JSON.stringify(s.items), JSON.stringify(s)));
    },
    questions(chatId: string): Question[] {
      return (db.prepare("SELECT * FROM questions WHERE chat_id = ? ORDER BY ord").all(chatId) as QuestionRow[]).map(toQuestion);
    },
    question(chatId: string, id: string): Question {
      const r = db.prepare("SELECT * FROM questions WHERE id = ? AND chat_id = ?").get(id, chatId) as QuestionRow | undefined;
      if (!r) throw notFound("Question");
      return toQuestion(r);
    },
    saveQuestion(q: Question) {
      db.prepare("UPDATE questions SET answer = ?, time_ms = ?, attempts = ?, hints = ?, result = ? WHERE id = ?")
        .run(q.answer ? JSON.stringify(q.answer) : null, q.timeMs, JSON.stringify(q.attempts), q.hints, q.result ? JSON.stringify(q.result) : null, q.id);
    },

    // Earlier questions on any of these items in this folder, so a new set doesn't repeat them (F-808).
    asked(folderId: string, itemIds: string[], limit = 30): string[] {
      if (!itemIds.length) return [];
      const want = new Set(itemIds);
      const rows = db.prepare(`SELECT q.items, q.spec FROM questions q JOIN papers p ON p.chat_id = q.chat_id
        WHERE p.folder_id = ? ORDER BY p.created_at DESC, q.ord LIMIT 400`).all(folderId) as { items: string; spec: string }[];
      return rows.filter((r) => (JSON.parse(r.items) as string[]).some((id) => want.has(id)))
        .slice(0, limit).map((r) => (JSON.parse(r.spec) as QuestionSpec).prompt.slice(0, 300));
    },
  };
  return store;
}
export type Papers = ReturnType<typeof createPapers>;
