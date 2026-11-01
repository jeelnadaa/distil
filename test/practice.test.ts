import { describe, expect, it } from "vitest";
import { openDb } from "../server/db.ts";
import { createJobs } from "../server/jobs.ts";
import { createLearner } from "../server/learning/learner.ts";
import { createLedger } from "../server/ledger/store.ts";
import { createLibrary } from "../server/library.ts";
import { createSearch } from "../server/materials/search.ts";
import { createPlans } from "../server/plan/store.ts";
import { createPractice } from "../server/practice/engine.ts";
import { markExact, QuestionSpec } from "../server/practice/questions.ts";
import { createPapers, questionView } from "../server/practice/store.ts";
import type { Providers } from "../server/providers/service.ts";
import type { LocalModels } from "../server/retrieval/local.ts";
import { createRetrieval } from "../server/retrieval/retrieve.ts";
import { createVectors } from "../server/retrieval/vectors.ts";
import { createSettings } from "../server/settings.ts";
import { createUsage } from "../server/usage.ts";

type Request = { system: string; messages: { content: string; images?: unknown[] }[] };
const base = { solution: "Sum 9 over 3 is 3.", rubric: [{ point: "Finds 3", marks: 2 }], hints: ["Add them up.", "Divide by how many there are."] };
const MCQ = { type: "mcq", prompt: "Which is the mean of 1, 2, 6?", marks: 2, level: "direct", items: ["i1"], options: ["2", "3", "6"], answer: 1, ...base };
const PROBLEM = {
  type: "problem", prompt: "Find the variance of 1, 2, 3.", marks: 4, level: "composition", section: "Spread", items: ["i3", "i9"],
  solution: "Mean 2; squared deviations 1, 0, 1; variance 2/3.", rubric: [{ point: "Mean is 2", marks: 1 }, { point: "Variance 2/3", marks: 3 }], hints: [],
};

// Practice and exams on a fake model: the writer returns `questions`, the marker `marked`.
function setup(o: { questions?: unknown[]; marked?: string; debrief?: string } = {}) {
  const db = openDb(":memory:");
  const settings = createSettings(db);
  settings.update({ models: { strong: { provider: "google", id: "strong" }, cheap: { provider: "google", id: "cheap" } } });
  const library = createLibrary(db);
  const ledger = createLedger(db);
  const plans = createPlans(db);
  const learner = createLearner(db);
  const usage = createUsage(db);
  const requests: Request[] = [];
  const providers = {
    async *stream(_ref: unknown, req: Request) {
      requests.push(req);
      const text = req.system.startsWith("You write practice") ? JSON.stringify({ title: "Set", instructions: "Go.", questions: o.questions ?? [MCQ, PROBLEM] })
        : req.system.startsWith("You mark") ? o.marked ?? `{"met":[true,false],"feedback":"Mean right, variance wrong.","missed":["i2"]}`
        : o.debrief ?? `{"summary":"Good start.","cards":[{"item":"m1","front":"What is variance?","back":"Mean squared deviation."}]}`;
      yield { type: "text" as const, text };
      yield { type: "usage" as const, usage: { input: 100, output: 20, cached: 0, reasoning: 0 } };
    },
    describe: () => "fake",
    withKeys: (chain: unknown[]) => chain,
  } as unknown as Providers;
  const jobs = createJobs(db);
  const retrieval = createRetrieval({ db, search: createSearch(db), vectors: createVectors(db), local: {} as LocalModels, providers, settings, usage });
  const papers = createPapers(db);
  const practice = createPractice({ providers, settings, usage, db, jobs, library, ledger, plans, learner, retrieval, papers });

  const folder = library.createFolder("Statistics", null);
  const items = ["Mean", "Median", "Variance"].map((title) => ledger.addManual(folder.id, { type: "concept", title, statement: `${title}, stated.` }));
  const planId = plans.createDraft(folder.id, "course");
  plans.append(planId, [
    { title: "Centre", summary: "", lessons: [{ key: "a", title: "Averages", summary: "", kind: "lesson", minutes: 40, weight: 1, aids: [], items: [items[0]!.id, items[1]!.id], after: [] }] },
    { title: "Spread", summary: "", lessons: [{ key: "b", title: "Variance", summary: "", kind: "lesson", minutes: 40, weight: 1, aids: [], items: [items[2]!.id], after: ["a"] }] },
  ], new Map());
  plans.activate(planId);
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
    expect(ok()).toBe(true);
  };
  const written = async (chatId: string) => until(() => papers.get(chatId).status !== "writing");
  return { db, practice, papers, ledger, learner, library, folder, items, plans, planId, requests, until, written };
}

describe("questions", () => {
  it("marks choices and numbers in code, and keeps the solution hidden until marked", () => {
    const q = QuestionSpec.parse({ ...MCQ, items: ["x"] });
    expect(markExact("q", q, { value: 1, photo: null })).toMatchObject({ score: 2, marks: 2, missed: [] });
    expect(markExact("q", q, { value: 0, photo: null })).toMatchObject({ score: 0, missed: ["x"] });
    const num = QuestionSpec.parse({ ...base, type: "numeric", prompt: "Mean?", marks: 2, items: ["x"], answer: 3, unit: "" });
    expect(markExact("q", num, { value: "3.01", photo: null })!.score).toBe(2);
    expect(markExact("q", QuestionSpec.parse({ ...PROBLEM, items: ["x"] }), { value: "2/3", photo: null })).toBeNull();
    const view = questionView({ id: "q", chatId: "c", ord: 0, section: "", items: ["x"], spec: q, answer: null, timeMs: 0, attempts: [], hints: 0, result: null });
    expect(view).toMatchObject({ solution: null, rubric: null, correct: null, hintsShown: [], hintsLeft: 2 });
    expect(JSON.stringify(view)).not.toContain("Sum 9");
  });
});

describe("practice sets", () => {
  it("writes a set on the strong model with keys mapped to items, and marks with hints and helped retries", async () => {
    const s = setup();
    const { chat } = s.practice.create(s.folder.id, { kind: "practice", scope: { kind: "all" } });
    expect(chat.mode).toBe("practice");
    expect(s.library.list().chats.some((c) => c.id === chat.id)).toBe(true);
    await s.written(chat.id);
    const v = s.practice.view(chat.id);
    expect(v.paper.status).toBe("ready");
    expect(v.questions.map((q) => q.type)).toEqual(["mcq", "problem"]);
    const writer = s.requests.find((r) => r.system.startsWith("You write practice"))!;
    expect(writer.messages[0]!.content).toContain("i3 · concept · Variance");
    // Keys are the ledger's ids now; an unknown key ("i9") is dropped; marks follow the rubric.
    expect(s.papers.questions(chat.id)[1]!.items).toEqual([s.items[2]!.id]);
    expect(v.questions[1]!.marks).toBe(4);

    expect(() => s.practice.hint(chat.id, v.questions[0]!.id)).toThrow(/Start/);
    s.practice.start(chat.id);
    expect(() => s.practice.hint(chat.id, v.questions[0]!.id)).toThrow(/first attempt/);
    // A wrong first attempt sets the credit; a hint and a right retry count as helped, at half.
    let after = await s.practice.answer(chat.id, v.questions[0]!.id, { value: 0, photo: null }, 5000);
    expect(after.questions[0]!.result).toBeNull();
    after = s.practice.hint(chat.id, v.questions[0]!.id);
    expect(after.questions[0]!.hintsShown).toEqual(["Add them up."]);
    after = await s.practice.answer(chat.id, v.questions[0]!.id, { value: 1, photo: null }, 3000);
    expect(after.questions[0]!.result).toMatchObject({ score: 1, marks: 2 });
    expect(after.questions[0]!.solution).toContain("Sum 9");
    expect(s.learner.events(s.items[0]!.id).map((e) => [e.score, e.withHelp])).toEqual([[0, 0], [0.5, 1]]);
    expect(s.ledger.get(s.items[0]!.id).status).not.toBe("checked");

    // A written answer is marked by the model against the rubric.
    after = await s.practice.answer(chat.id, v.questions[1]!.id, { value: "mean 2, variance 1", photo: null }, 9000);
    const marker = s.requests.find((r) => r.system.startsWith("You mark"))!;
    expect(marker.messages[0]!.content).toContain("[3] Variance 2/3");
    expect(after.questions[1]!.attempts[0]!.grade).toMatchObject({ score: 1, met: [true, false] });

    const done = await s.practice.submit(chat.id, 20000);
    expect(done.paper.status).toBe("done");
    expect(done.paper.report).toMatchObject({ score: 2, marks: 6, summary: "Good start." });
    // Unanswered questions aren't counted in practice; missed items became cards.
    expect(done.paper.report!.questions).toHaveLength(2);
    expect(done.paper.report!.weak).toEqual(expect.arrayContaining([s.items[0]!.id, s.items[2]!.id]));
    const cards = s.db.prepare("SELECT front, origin FROM cards ORDER BY front").all() as { front: string; origin: string }[];
    expect(cards.every((c) => c.origin === "missed")).toBe(true);
    expect(cards.map((c) => c.front)).toContain("What is variance?");
  });

  it("practises a plan unit, refuses an empty weak scope, and doesn't repeat earlier questions", async () => {
    const s = setup();
    expect(() => s.practice.create(s.folder.id, { kind: "practice", scope: { kind: "weak" } })).toThrow(/Nothing is weak/);
    const unit = s.plans.get(s.planId).units[1]!;
    const first = s.practice.create(s.folder.id, { kind: "practice", scope: { kind: "unit", id: unit.id } });
    expect(first.chat.title).toBe("Practice · Spread");
    await s.written(first.chat.id);
    const prompt = s.requests.at(-1)!.messages[0]!.content;
    expect(prompt).toContain("Variance");
    expect(prompt).not.toContain("Median");
    const again = s.practice.create(s.folder.id, { kind: "practice", scope: { kind: "unit", id: unit.id } });
    await s.written(again.chat.id);
    expect(s.requests.at(-1)!.messages[0]!.content).toContain("Already asked:\n- Which is the mean of 1, 2, 6?");
    // A wrong answer makes the item weak.
    s.learner.record({ itemId: s.items[2]!.id, kind: "check", score: 0 });
    expect(s.practice.list(s.folder.id)).toMatchObject({ weak: 1, papers: [{ label: "Spread", questions: 1 }, { label: "Spread" }] });
  });

  it("marks a failed write and retries it", async () => {
    const s = setup({ questions: [{ type: "mcq", prompt: "broken" }] });
    const { chat } = s.practice.create(s.folder.id, { kind: "practice", scope: { kind: "all" } });
    await s.written(chat.id);
    expect(s.papers.get(chat.id)).toMatchObject({ status: "failed", error: expect.stringMatching(/no usable questions/) });
    expect(s.practice.retry(chat.id).paper.status).toBe("writing");
  });
});

describe("mock exams", () => {
  it("is timed, one attempt, no hints, and marked as a whole with a report by unit", async () => {
    const s = setup({ questions: [{ ...MCQ, section: "Centre" }, PROBLEM] });
    const { chat } = s.practice.create(s.folder.id, { kind: "exam", scope: { kind: "all" }, minutes: 30 });
    expect(s.papers.get(chat.id).config).toMatchObject({ minutes: 30, count: 5 });
    await s.written(chat.id);
    expect(s.requests[0]!.messages[0]!.content).toMatch(/Variance: Variance, stated\. · Spread/);
    const v = s.practice.start(chat.id);
    await expect(s.practice.answer(chat.id, v.questions[0]!.id, { value: 1, photo: null }, 0)).rejects.toThrow(/submitted/);
    expect(() => s.practice.hint(chat.id, v.questions[0]!.id)).toThrow(/off in exam mode/);
    s.practice.save(chat.id, { questionId: v.questions[0]!.id, answer: { value: 1, photo: null }, timeMs: 60000, elapsedMs: 61000 });
    const photo = "data:image/jpeg;base64,/9j/AAAA";
    s.practice.save(chat.id, { questionId: v.questions[1]!.id, answer: { value: "", photo }, timeMs: 120000, elapsedMs: 190000 });
    expect(s.papers.get(chat.id).elapsedMs).toBe(190000);

    expect((await s.practice.submit(chat.id, 200000)).paper.status).toBe("grading");
    await s.until(() => s.papers.get(chat.id).status === "done");
    const marker = s.requests.find((r) => r.system.startsWith("You mark"))!;
    expect(marker.messages[0]!.images).toEqual([{ mime: "image/jpeg", data: "/9j/AAAA" }]);
    const report = s.papers.get(chat.id).report!;
    expect(report).toMatchObject({ score: 3, marks: 6, sections: [{ name: "Centre", score: 2, marks: 2 }, { name: "Spread", score: 1, marks: 4 }] });
    expect(report.questions.map((q) => q.timeMs)).toEqual([60000, 120000]);
    expect(s.learner.events(s.items[0]!.id)).toMatchObject([{ kind: "exam", score: 1 }]);
    expect(s.ledger.get(s.items[0]!.id).status).toBe("checked");
    expect(() => s.practice.save(chat.id, { elapsedMs: 0 })).toThrow(/finished/);
  });

  it("keeps a paper chat in the library across restarts though it has no messages", () => {
    const s = setup();
    const { chat } = s.practice.create(s.folder.id, { kind: "exam", scope: { kind: "all" } });
    s.library.createChat(s.folder.id);
    expect(s.library.removeEmptyChats()).toBe(1);
    expect(s.library.getChat(chat.id).mode).toBe("exam");
  });
});
