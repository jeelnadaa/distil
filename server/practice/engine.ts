import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db.ts";
import { AppError } from "../errors.ts";
import type { Job, Jobs } from "../jobs.ts";
import type { Item, Ledger } from "../ledger/store.ts";
import type { Library } from "../library.ts";
import { type Learner, PASS } from "../learning/learner.ts";
import { completeJson, type LlmDeps } from "../llm.ts";
import type { Plans } from "../plan/store.ts";
import type { Retrieval } from "../retrieval/retrieve.ts";
import { type AnswerValue, type Grade, LEVEL_LABELS, markExact, markWritten, QuestionSpec, rubricTotal } from "./questions.ts";
import { type Paper, type PaperConfig, type PaperKind, type Papers, type Question, type QuestionView, questionView, type Report, type Scope } from "./store.ts";

// Practice sets and mock exams (F-801…F-809). A paper is written by a background job on the strong model,
// every question with its solution, rubric and hints first (F-805). Practice marks each answer at once and
// offers two hints and retries after the first attempt, which alone sets the mastery credit (F-804);
// a mock exam is timed, one attempt, no hints, and marked as a whole when submitted. Results become
// learner evidence, missed items become flashcards (F-807), and the report names the weak items (F-809).

export type PracticeDeps = LlmDeps & {
  db: Db; jobs: Jobs; library: Library; ledger: Ledger; plans: Plans; learner: Learner; retrieval: Retrieval; papers: Papers;
};

export const NewPaper = z.object({
  kind: z.enum(["practice", "exam"]),
  scope: z.object({ kind: z.enum(["all", "weak", "unit", "lesson", "items"]), id: z.string().min(1).optional(), items: z.array(z.string().min(1)).max(200).optional() }),
  count: z.number().int().min(1).max(20).optional(),
  minutes: z.number().int().min(5).max(240).optional(),
});
export type NewPaper = z.infer<typeof NewPaper>;

const PHOTO_MAX = 6_000_000;
export const AnswerBody = z.object({
  value: z.union([z.string().max(20000), z.number(), z.array(z.number().int()).max(10), z.null()]),
  photo: z.string().max(PHOTO_MAX).regex(/^data:image\/(jpeg|png|webp);base64,/).nullable().default(null),
});

// Helped retries count for half (F-804): the first attempt sets the credit.
const HELPED = 0.5;
const TRIES = 3;
const ITEMS_PER_PAPER = 40;
const PASSAGE_CHARS = 900;
const PASSAGES_CHARS = 16000;
const STYLE_CHARS = 5000;
// Materials whose names suggest past papers set the exam's style (F-803).
const PAST_PAPER = /\b(past|exam|paper|midterm|mid-term|final|quiz|test|questions?|worksheet|problem ?set)\b/i;

export type PaperView = { paper: Paper; questions: QuestionView[]; items: Record<string, string>; job: Job | null };
export type PaperSummary = Pick<Paper, "chatId" | "kind" | "status" | "title" | "createdAt"> & { label: string; score: number | null; marks: number | null; questions: number };

const WRITER = `You write practice questions and mock exams for one learner, from their own course material.
Reply with JSON only: {"title": "short name for this paper", "instructions": "one or two lines of instructions for the learner", "questions": [Question, …]}
Each Question: {"type": "mcq" | "numeric" | "order" | "short" | "problem", "prompt": "…", "marks": n, "level": "worked" | "completion" | "direct" | "composition" | "open", "section": "…", "items": ["i3", …], "solution": "the full worked solution", "rubric": [{"point": "what earns the marks", "marks": n}, …], "hints": ["a nudge", "a bigger nudge"], …type fields}
Type fields: mcq has "options" (2–6) and "answer" (index of the right option); numeric has "answer" (a number), "tolerance" (relative, e.g. 0.01) and "unit"; order has "steps" in the right order (3–7); short and problem have none (a short answer is a sentence or two, a problem needs working).
Rules:
- Write the solution and rubric first in your head and make the question fit them; every question must be answerable from the material and have one defensible answer. The rubric's marks add up to the question's marks.
- items: the keys of the ledger items the question tests (1–3), from the list given. Test what matters in them, not trivia about the course.
- Levels: worked = a short worked example followed by a near-identical question to solve; completion = a partly done solution to finish; direct = apply one idea; composition = combine several ideas; open = a less structured problem.
- Vary the context as difficulty rises: same context as the material, then a new context, then far transfer.
- Hints never give the answer away: the first points to the idea to use, the second to the first step.
- Use $…$ for maths. Never mention "the material", "the ledger" or item keys in what the learner sees.
- Don't repeat or lightly reword any question listed under "Already asked".`;

const Written = z.object({ title: z.string().max(120).default(""), instructions: z.string().max(600).default(""), questions: z.array(z.unknown()).min(1).max(30) });

const Debrief = z.object({
  summary: z.string().max(600),
  cards: z.array(z.object({ item: z.string(), front: z.string().min(1).max(400), back: z.string().min(1).max(800) })).max(30).default([]),
});
const DEBRIEF = `You write the short debrief after a practice set or mock exam, and flashcards for what didn't come to mind.
Reply with JSON only: {"summary": "one or two sentences to the learner: what went well and what to work on, plainly, no praise inflation", "cards": [{"item": "key", "front": "a question that makes them recall it", "back": "the answer, short"}]}
Write one card for each missed item listed, from its statement and the question they missed it on.`;

export function createPractice(deps: PracticeDeps) {
  const { db, papers, library, ledger, learner } = deps;
  const now = () => Date.now();

  const folderItems = (folderId: string) => ledger.list(folderId).filter((i) => !i.mark);

  // Items whose latest checked answer fell short, or that were taught and never checked.
  function weakItems(folderId: string): Item[] {
    const latest = db.prepare(`SELECT item_id, score FROM item_events WHERE folder_id IN (WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id) SELECT id FROM sub)
      AND kind IN ('check', 'practice', 'exam', 'review') AND with_help = 0 ORDER BY at, id`).all(folderId) as { item_id: string; score: number | null }[];
    const last = new Map(latest.map((r) => [r.item_id, r.score ?? 0]));
    return folderItems(folderId).filter((i) => last.has(i.id) ? last.get(i.id)! < PASS : i.status === "taught");
  }

  // The items a scope covers, and the plan unit each sits in (the exam's sections).
  function scopeItems(folderId: string, scope: Scope): { items: Item[]; unitOf: Map<string, string>; label: string } {
    const plan = deps.plans.active(folderId);
    const unitOf = new Map<string, string>();
    for (const l of plan?.lessons ?? []) {
      const unit = plan!.units.find((u) => u.id === l.unitId)?.title ?? "";
      for (const id of l.items) if (!unitOf.has(id)) unitOf.set(id, unit);
    }
    const all = folderItems(folderId);
    const pick = (ids: string[]) => { const want = new Set(ids); return all.filter((i) => want.has(i.id)); };
    if (scope.kind === "weak") return { items: weakItems(folderId), unitOf, label: "Weak items" };
    if (scope.kind === "items") return { items: pick(scope.items ?? []), unitOf, label: "Chosen items" };
    if (scope.kind === "lesson" || scope.kind === "unit") {
      const lessons = (plan?.lessons ?? []).filter((l) => (scope.kind === "lesson" ? l.id : l.unitId) === scope.id);
      if (!lessons.length) throw new AppError(404, "not_found", `That ${scope.kind} isn't in the active plan.`);
      const name = scope.kind === "lesson" ? lessons[0]!.title : plan!.units.find((u) => u.id === scope.id)!.title;
      return { items: pick(lessons.flatMap((l) => l.items)), unitOf, label: name };
    }
    return { items: all, unitOf, label: "Everything" };
  }

  // An even spread over a long list, keeping its order (the ledger's order follows the material).
  const spread = <T>(list: T[], n: number) => list.length <= n ? list : Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]!);

  function create(folderId: string, body: NewPaper) {
    const { items, label } = scopeItems(folderId, body.scope);
    if (!items.length) {
      throw new AppError(400, "empty_scope", body.scope.kind === "weak" ? "Nothing is weak yet: practise after a few lessons." : "There are no items to practise here yet. Distil the material first.");
    }
    const exam = body.kind === "exam";
    const minutes = exam ? body.minutes ?? 45 : null;
    const count = body.count ?? (exam ? Math.min(12, Math.max(3, Math.round(minutes! / 6))) : 6);
    const config: PaperConfig = { scope: { ...body.scope, items: body.scope.kind === "items" ? items.map((i) => i.id) : undefined }, count, minutes, ladder: exam ? "mixed" : "rising", label };
    const title = `${exam ? "Mock exam" : "Practice"} · ${label}`;
    const chat = library.createChat(folderId, undefined, { mode: body.kind, title });
    const paper = papers.create({ chatId: chat.id, folderId, kind: body.kind, config });
    papers.update(chat.id, { title });
    deps.jobs.enqueue("paper", exam ? "Writing a mock exam" : "Writing a practice set", { folderId, params: { chatId: chat.id, task: "write" } });
    return { chat, paper: papers.get(paper.chatId) };
  }

  // ----- Writing (F-802, F-803, F-805, F-808) -----

  async function write(chatId: string, signal: AbortSignal) {
    const paper = papers.get(chatId);
    const { items: scoped, unitOf } = scopeItems(paper.folderId, paper.config.scope);
    const items = spread(scoped, ITEMS_PER_PAPER);
    if (!items.length) throw new AppError(400, "empty_scope", "There are no items left in this scope.");
    const keys: Record<string, string> = Object.fromEntries(items.map((it, i) => [`i${i + 1}`, it.id]));
    const keyOf = new Map(Object.entries(keys).map(([k, id]) => [id, k]));

    const passages = await deps.retrieval.forItems(paper.folderId, items.slice(0, 16), 1, signal).catch(() => []);
    let budget = PASSAGES_CHARS;
    const excerpts = passages.flatMap((p) => {
      if (budget <= 0) return [];
      const text = p.text.slice(0, Math.min(PASSAGE_CHARS, budget));
      budget -= text.length;
      return [`[${p.headings.join(" › ") || p.materialName}]\n${text}`];
    });
    const style = pastPapers(paper.folderId);
    const asked = papers.asked(paper.folderId, items.map((i) => i.id));
    const exam = paper.kind === "exam";
    const minutes = paper.config.minutes ?? 0;

    const prompt = [
      exam
        ? `Write a mock exam of ${paper.config.count} questions for ${minutes} minutes, about ${minutes} marks in total, with "section" set to the unit each question belongs to (use the units given). Levels mostly direct, composition and open; no worked examples. Instructions say how long it is, that it's one attempt, and how to answer (type, or a photo of handwritten working).`
        : `Write a practice set of ${paper.config.count} questions rising in difficulty: start with a worked example or completion problem, then direct, then composition, ending with an open problem if there are enough questions. Each worth 1–6 marks. Leave "section" empty. Mix the types: choice and number questions for quick recall, short and problem questions for understanding.`,
      `Ledger items (key · type · title: statement${exam ? " · unit" : ""}):\n${items.map((it) => `${keyOf.get(it.id)} · ${it.type} · ${it.title}: ${it.statement.slice(0, 400)}${exam ? ` · ${unitOf.get(it.id) || "General"}` : ""}`).join("\n")}`,
      excerpts.length ? `From the material:\n${excerpts.join("\n\n")}` : "",
      style ? `Past papers in the course, to match their style, phrasing and mark scheme:\n${style}` : "",
      asked.length ? `Already asked:\n${asked.map((a) => `- ${a.replace(/\s+/g, " ")}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n");

    const reply = await completeJson(deps, Written, { slot: "strong", role: exam ? "examiner" : "practice", folderId: paper.folderId, system: WRITER, prompt, maxTokens: 16000, signal });
    const questions = reply.questions.flatMap((raw) => {
      const parsed = QuestionSpec.safeParse(raw);
      if (!parsed.success) return [];
      const q = parsed.data;
      const ids = q.items.map((k) => keys[k] ?? (keyOf.has(k) ? k : null)).filter((id): id is string => !!id);
      if (!ids.length) return [];
      return [{ ...q, items: [...new Set(ids)], marks: rubricTotal(q), section: exam ? q.section || unitOf.get(ids[0]!) || "" : "" }];
    });
    if (!questions.length) throw new AppError(502, "invalid_model_output", "The model wrote no usable questions. Try again, or pick another model.");
    papers.setQuestions(chatId, questions);
    papers.update(chatId, { status: "ready", error: null, title: reply.title || paper.title, instructions: reply.instructions });
  }

  function pastPapers(folderId: string): string {
    const rows = db.prepare(`WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id)
      SELECT m.id, m.name FROM materials m JOIN sub ON m.folder_id = sub.id WHERE m.status = 'ready'`).all(folderId) as { id: string; name: string }[];
    const chunk = db.prepare("SELECT text FROM chunks WHERE material_id = ? ORDER BY ord LIMIT 8");
    let out = "";
    for (const m of rows.filter((r) => PAST_PAPER.test(r.name))) {
      for (const c of chunk.all(m.id) as { text: string }[]) {
        if (out.length >= STYLE_CHARS) return out;
        out += `${c.text.slice(0, STYLE_CHARS - out.length)}\n`;
      }
    }
    return out;
  }

  // ----- Marking -----

  const itemKeys = (q: Question) => Object.fromEntries(q.items.map((id, i) => [`i${i + 1}`, id]));
  const mark = async (q: Question, answer: AnswerValue, folderId: string, signal?: AbortSignal): Promise<Grade> =>
    markExact(q.id, q.spec, answer) ?? markWritten(deps, q.spec, answer, itemKeys(q), folderId, signal);

  const record = (q: Question, chatId: string, kind: "practice" | "exam", score: number, withHelp: boolean) => {
    for (const itemId of q.items) {
      try { learner.record({ itemId, kind, score, withHelp, chatId, ref: q.id }); } catch { /* the item was deleted since */ }
    }
  };

  const taking = (chatId: string) => {
    const paper = papers.get(chatId);
    if (paper.status !== "taking") throw new AppError(409, "not_taking", paper.status === "ready" ? "Start the paper first." : "This paper is finished.");
    return paper;
  };

  // Practice: marks one attempt at once. The first sets the credit; retries after hints count as helped.
  async function answer(chatId: string, questionId: string, value: AnswerValue, timeMs: number, signal?: AbortSignal) {
    const paper = taking(chatId);
    if (paper.kind !== "practice") throw new AppError(409, "exam", "Exam answers are marked when the paper is submitted.");
    const q = papers.question(chatId, questionId);
    if (q.result) throw new AppError(409, "answered", "This question is finished.");
    const grade = await mark(q, value, paper.folderId, signal);
    const first = q.attempts.length === 0;
    const withHelp = !first || q.hints > 0;
    q.attempts = [...q.attempts, { ...value, grade, withHelp }];
    q.answer = value;
    q.timeMs += Math.max(0, Math.round(timeMs));
    const full = grade.score >= grade.marks;
    record(q, chatId, "practice", (grade.score / grade.marks) * (withHelp ? HELPED : 1), withHelp);
    // Finished when it's fully right, after a retry with every hint used, or after three tries.
    if (full || (!first && q.hints >= q.spec.hints.length) || q.attempts.length >= TRIES) q.result = settle(q);
    papers.saveQuestion(q);
    return view(chatId);
  }

  // The credit a practice question ends with: the first attempt's score, or a helped retry's at half.
  function settle(q: Question): Grade {
    const [first, ...rest] = q.attempts;
    if (!first) return { score: 0, marks: q.spec.marks, met: q.spec.rubric.map(() => false), feedback: "", missed: q.items };
    const best = rest.reduce((b, a) => (a.grade.score > b.grade.score ? a : b), first);
    const score = best === first ? first.grade.score : Math.max(first.grade.score, Math.round(best.grade.score * HELPED * 2) / 2);
    return { ...best.grade, score };
  }

  function hint(chatId: string, questionId: string) {
    const paper = taking(chatId);
    if (paper.kind !== "practice") throw new AppError(409, "exam", "Hints are off in exam mode.");
    const q = papers.question(chatId, questionId);
    if (!q.attempts.length) throw new AppError(409, "first_attempt", "Answer once first: your first attempt counts on its own.");
    if (q.result || q.hints >= q.spec.hints.length) throw new AppError(409, "no_hints", "No hints are left for this question.");
    q.hints++;
    papers.saveQuestion(q);
    return view(chatId);
  }

  // Practice: show the solution and finish the question with what was earned so far.
  function reveal(chatId: string, questionId: string) {
    taking(chatId);
    const q = papers.question(chatId, questionId);
    if (!q.result) {
      q.result = settle(q);
      papers.saveQuestion(q);
    }
    return view(chatId);
  }

  // Exam (and practice drafts): keeps the latest answer and time, with the paper's clock.
  function save(chatId: string, body: { questionId?: string; answer?: AnswerValue; timeMs?: number; elapsedMs: number }) {
    const paper = taking(chatId);
    if (body.questionId) {
      const q = papers.question(chatId, body.questionId);
      if (!q.result) {
        if (body.answer) q.answer = body.answer;
        if (body.timeMs !== undefined) q.timeMs = Math.max(q.timeMs, Math.round(body.timeMs));
        papers.saveQuestion(q);
      }
    }
    papers.update(chatId, { elapsedMs: Math.max(paper.elapsedMs, Math.round(body.elapsedMs)) });
    return { ok: true };
  }

  function start(chatId: string) {
    const paper = papers.get(chatId);
    if (paper.status === "ready") papers.update(chatId, { status: "taking" });
    else if (paper.status !== "taking") throw new AppError(409, "not_ready", "This paper isn't ready to start.");
    return view(chatId);
  }

  // Finishes the paper: an exam is marked by a job; a practice set's report is written at once.
  async function submit(chatId: string, elapsedMs: number, signal?: AbortSignal) {
    const paper = taking(chatId);
    papers.update(chatId, { elapsedMs: Math.max(paper.elapsedMs, Math.round(elapsedMs)), status: "grading" });
    if (paper.kind === "exam") {
      deps.jobs.enqueue("paper", "Marking a mock exam", { folderId: paper.folderId, params: { chatId, task: "grade" } });
      return view(chatId);
    }
    for (const q of papers.questions(chatId)) {
      if (!q.result && q.attempts.length) { q.result = settle(q); papers.saveQuestion(q); }
    }
    await finish(chatId, signal);
    return view(chatId);
  }

  async function grade(chatId: string, signal: AbortSignal, progress: (done: number, total: number) => void) {
    const paper = papers.get(chatId);
    const all = papers.questions(chatId);
    let done = all.filter((q) => q.result).length;
    progress(done, all.length);
    for (const q of all.filter((x) => !x.result)) {
      const g = await mark(q, q.answer ?? { value: null, photo: null }, paper.folderId, signal);
      q.result = g;
      papers.saveQuestion(q);
      record(q, chatId, "exam", g.score / g.marks, false);
      progress(++done, all.length);
    }
    await finish(chatId, signal);
  }

  // The report (F-809), and flashcards for items that didn't come to mind (F-807).
  async function finish(chatId: string, signal?: AbortSignal) {
    const paper = papers.get(chatId);
    const exam = paper.kind === "exam";
    const counted = papers.questions(chatId).filter((q) => exam || q.result);
    const rows = counted.map((q) => {
      const r = q.result ?? { score: 0, marks: q.spec.marks, missed: q.items };
      // A helped retry can be right and still leave the credit short: its items are still weak.
      const missed = r.missed.length || r.score >= r.marks * PASS ? r.missed : q.items;
      return { id: q.id, ord: q.ord, section: q.section, score: r.score, marks: r.marks, timeMs: q.timeMs, missed };
    });
    const score = rows.reduce((s, r) => s + r.score, 0);
    const marks = rows.reduce((s, r) => s + r.marks, 0);
    const names = [...new Set(rows.map((r) => r.section))];
    const sections = names.length > 1 || names[0] ? names.map((name) => {
      const own = rows.filter((r) => r.section === name);
      return { name: name || "General", score: own.reduce((s, r) => s + r.score, 0), marks: own.reduce((s, r) => s + r.marks, 0) };
    }) : [];
    const weak = [...new Set(rows.filter((r) => r.score < r.marks * PASS).flatMap((r) => r.missed))];
    const { summary, cards } = await debrief(paper, counted, weak, score, marks, signal);
    const report: Report = { score, marks, summary, cards, weak, sections, questions: rows };
    papers.update(chatId, { status: "done", report });
    library.touchChat(chatId);
  }

  async function debrief(paper: Paper, questions: Question[], weak: string[], score: number, marks: number, signal?: AbortSignal) {
    const items = new Map(ledger.list(paper.folderId).map((i) => [i.id, i]));
    const has = db.prepare("SELECT 1 FROM cards WHERE item_id = ? LIMIT 1");
    const fresh = weak.filter((id) => items.has(id) && !has.get(id)).slice(0, 20);
    const keys = new Map(fresh.map((id, i) => [`m${i + 1}`, id]));
    const fallback = `You scored ${fmt(score)} of ${fmt(marks)}.`;
    let summary = fallback;
    let drafts: { item: string; front: string; back: string }[] = [];
    try {
      const reply = await completeJson(deps, Debrief, {
        slot: "cheap", role: "practice", folderId: paper.folderId, system: DEBRIEF, maxTokens: 2500, signal,
        prompt: [
          `${paper.kind === "exam" ? "Mock exam" : "Practice set"}: ${fmt(score)} of ${fmt(marks)} marks.`,
          `Questions:\n${questions.map((q) => `- [${q.result ? fmt(q.result.score) : 0}/${q.spec.marks}] ${LEVEL_LABELS[q.spec.level]}: ${q.spec.prompt.slice(0, 200).replace(/\s+/g, " ")}${q.result?.feedback ? ` — ${q.result.feedback.slice(0, 200)}` : ""}`).join("\n")}`,
          fresh.length ? `Missed items:\n${[...keys].map(([k, id]) => `${k} · ${items.get(id)!.title}: ${items.get(id)!.statement.slice(0, 300)}`).join("\n")}` : "No missed items need cards.",
        ].join("\n\n"),
      });
      summary = reply.summary || fallback;
      drafts = reply.cards;
    } catch (err) {
      if (signal?.aborted) throw err;
    }
    const made = new Set<string>();
    const insert = db.prepare(`INSERT INTO cards (id, folder_id, item_id, kind, front, back, origin, due_at, created_at, updated_at)
      VALUES (?, ?, ?, 'basic', ?, ?, 'missed', ?, ?, ?)`);
    const add = (id: string, front: string, back: string) => {
      if (made.has(id)) return;
      const item = items.get(id)!;
      insert.run(randomUUID(), item.folderId, id, front, back, now(), now(), now());
      made.add(id);
    };
    for (const d of drafts) { const id = keys.get(d.item); if (id) add(id, d.front, d.back); }
    for (const id of fresh) add(id, items.get(id)!.title, items.get(id)!.statement);
    return { summary, cards: made.size };
  }

  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  // ----- Views -----

  function view(chatId: string): PaperView {
    const paper = papers.get(chatId);
    const questions = papers.questions(chatId);
    const ids = new Set([...questions.flatMap((q) => q.items), ...(paper.report?.weak ?? [])]);
    const items = Object.fromEntries(ledger.list(paper.folderId).filter((i) => ids.has(i.id)).map((i) => [i.id, i.title]));
    const job = deps.jobs.list().find((j) => j.kind === "paper" && j.params.chatId === chatId && (j.status === "queued" || j.status === "running" || j.status === "error")) ?? null;
    return { paper, questions: questions.map(questionView), items, job };
  }

  function list(folderId: string): { papers: PaperSummary[]; weak: number } {
    const count = db.prepare("SELECT COUNT(*) AS n FROM questions WHERE chat_id = ?");
    return {
      weak: weakItems(folderId).length,
      papers: papers.list(folderId).map((p) => ({
        chatId: p.chatId, kind: p.kind, status: p.status, title: p.title, createdAt: p.createdAt, label: p.config.label,
        score: p.report?.score ?? null, marks: p.report?.marks ?? null, questions: (count.get(p.chatId) as { n: number }).n,
      })),
    };
  }

  // Runs a failed step again: writing, or marking a submitted exam.
  function retry(chatId: string) {
    const paper = papers.get(chatId);
    const task = paper.status === "grading" ? "grade" : paper.status === "failed" && !papers.questions(chatId).length ? "write" : null;
    if (!task) throw new AppError(409, "nothing_to_retry", "There's nothing to retry here.");
    if (task === "write") papers.update(chatId, { status: "writing", error: null });
    deps.jobs.enqueue("paper", task === "write" ? (paper.kind === "exam" ? "Writing a mock exam" : "Writing a practice set") : "Marking a mock exam",
      { folderId: paper.folderId, params: { chatId, task } });
    return view(chatId);
  }

  deps.jobs.register("paper", async (job, { signal, progress }) => {
    const { chatId, task } = job.params as { chatId: string; task: "write" | "grade" };
    if (!papers.find(chatId)) return;
    try {
      if (task === "write") await write(chatId, signal);
      else await grade(chatId, signal, progress);
    } catch (err) {
      // Marking keeps its status so a retry resumes; a failed write has nothing to show.
      if (!signal.aborted && task === "write") papers.update(chatId, { status: "failed", error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  });

  return { create, view, list, start, save, answer, hint, reveal, submit, retry, weakItems, write, grade };
}

export type Practice = ReturnType<typeof createPractice>;
