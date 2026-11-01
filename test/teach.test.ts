import { describe, expect, it } from "vitest";
import { openDb } from "../server/db.ts";
import { createLearner } from "../server/learning/learner.ts";
import { createLedger } from "../server/ledger/store.ts";
import { createLibrary } from "../server/library.ts";
import { createSearch } from "../server/materials/search.ts";
import { createMessages } from "../server/messages.ts";
import { createPlans } from "../server/plan/store.ts";
import type { Providers } from "../server/providers/service.ts";
import type { LocalModels } from "../server/retrieval/local.ts";
import { createRetrieval } from "../server/retrieval/retrieve.ts";
import { createVectors } from "../server/retrieval/vectors.ts";
import { createSettings } from "../server/settings.ts";
import { gradeExact, publicCheck, shuffled } from "../server/teach/checks.ts";
import { createTeacher, type TeachEvent } from "../server/teach/engine.ts";
import { createTeachStore } from "../server/teach/store.ts";
import { createUsage } from "../server/usage.ts";

type Request = { system: string; messages: { content: string }[] };
const MCQ = { type: "mcq", prompt: "Which is the mean of 1, 2, 6?", options: ["2", "3", "6"], answer: 1, why: "Sum 9 over 3." };

// A lesson on a fake model. The teacher's reply comes in five-character pieces, so a check tag is split across them.
function setup(o: { teach?: (prompt: string, n: number) => string; judge?: string; plan?: unknown } = {}) {
  const db = openDb(":memory:");
  const settings = createSettings(db);
  settings.update({ models: { strong: { provider: "google", id: "strong" }, cheap: { provider: "google", id: "cheap" } } });
  const library = createLibrary(db);
  const ledger = createLedger(db);
  const plans = createPlans(db);
  const learner = createLearner(db);
  const usage = createUsage(db);
  const messages = createMessages(db);
  const prompts: string[] = [];
  const models: string[] = [];
  let taught = 0;
  const providers = {
    async *stream(ref: { id: string }, req: Request) {
      const prompt = req.messages.at(-1)!.content;
      prompts.push(prompt);
      models.push(ref.id);
      const text = req.system.startsWith("You split") ? JSON.stringify(o.plan ?? { orientation: [], steps: [{ title: "Mean", items: [1] }, { title: "Median", items: [2] }] })
        : req.system.startsWith("You grade") ? o.judge ?? `{"verdict":"right","feedback":"Yes."}`
        : (o.teach ?? (() => `Here is the idea [1]. <check>${JSON.stringify(MCQ)}</check>`))(prompt, taught++);
      for (let i = 0; i < text.length; i += 5) yield { type: "text" as const, text: text.slice(i, i + 5) };
      yield { type: "usage" as const, usage: { input: 100, output: 20, cached: 0, reasoning: 0 } };
    },
    describe: () => "fake",
    withKeys: (chain: unknown[]) => chain,
  } as unknown as Providers;
  const retrieval = createRetrieval({ db, search: createSearch(db), vectors: createVectors(db), local: {} as LocalModels, providers, settings, usage });
  const teach = createTeachStore(db);
  const teacher = createTeacher({ providers, settings, usage, db, library, messages, plans, ledger, learner, retrieval, teach });

  const folder = library.createFolder("Statistics", null);
  const items = ["Mean", "Median", "Variance"].map((title) => ledger.addManual(folder.id, { type: "concept", title, statement: `${title}, stated.` }));
  const planId = plans.createDraft(folder.id, "course");
  plans.append(planId, [{ title: "Centre", summary: "", lessons: [
    { key: "a", title: "Averages", summary: "", kind: "lesson", minutes: 40, weight: 1, aids: [], items: [items[0]!.id, items[1]!.id], after: [] },
    { key: "b", title: "Spread", summary: "", kind: "lesson", minutes: 40, weight: 1, aids: [], items: [items[2]!.id], after: ["a"] },
  ] }], new Map());
  plans.activate(planId);
  const [first, second] = plans.get(planId).lessons;
  const chatFor = (lesson: typeof first) => library.createChat(folder.id, lesson!).id;

  const run = async (events: Promise<AsyncGenerator<TeachEvent>>) => {
    const out: TeachEvent[] = [];
    for await (const e of await events) out.push(e);
    return out;
  };
  const signal = new AbortController().signal;
  const status = () => items.map((i) => ledger.get(i.id).status);
  const answer = (chatId: string, value: number | string | null, confidence: "guess" | "unsure" | "sure" | null = null) =>
    run(teacher.answer(chatId, { checkId: teacher.view(chatId).session!.open!.id, value, confidence, thinking: "" }, signal));
  return { teacher, plans, messages, library, first: first!, second: second!, chatFor, run, signal, status, answer, prompts, models };
}

describe("checks", () => {
  it("never shows ordering steps in order, and grades the learner's order through the shuffle", () => {
    const spec = { type: "order" as const, prompt: "Order", steps: ["a", "b", "c", "d"], why: "" };
    const shown = shuffled(4, "id1");
    expect(shown).not.toEqual([0, 1, 2, 3]);
    expect(publicCheck("id1", spec)).toEqual({ type: "order", prompt: "Order", steps: shown.map((i) => spec.steps[i]) });
    expect(JSON.stringify(publicCheck("id1", spec))).not.toContain("answer");
    // The learner lists shown positions in the order they think is right.
    const right = [0, 1, 2, 3].map((orig) => shown.indexOf(orig));
    expect(gradeExact("id1", spec, right)).toBe("right");
    expect(gradeExact("id1", spec, [...right].reverse())).toBe("wrong");
    expect(gradeExact("id1", { type: "numeric", prompt: "", answer: 3, tolerance: 0.01, unit: "", why: "" }, "3.01")).toBe("right");
    expect(gradeExact("id1", MCQ as never, null)).toBe("unknown");
  });
});

describe("teaching engine", () => {
  it("teaches step by step, repairs twice, marks the step shaky, then recaps and finishes the lesson", async () => {
    const t = setup({ teach: (prompt) => prompt.includes("Phase: recap") ? "You learned the mean. <check>{}</check>" : `Here is the idea [1]. <check>${JSON.stringify(MCQ)}</check>` });
    const chatId = t.chatFor(t.first);

    const opening = await t.run(t.teacher.start(chatId, t.signal));
    const shown = opening.filter((e) => e.type === "delta").map((e) => e.text).join("");
    expect(shown.trim()).toBe("Here is the idea [1].");
    expect(opening.find((e) => e.type === "check")).toMatchObject({ check: { question: { type: "mcq", options: ["2", "3", "6"] }, result: null } });
    expect(JSON.stringify(opening.find((e) => e.type === "check"))).not.toContain("Sum 9");
    expect(t.status()).toEqual(["taught", "pending", "pending"]);
    expect(t.plans.lesson(t.first.id).status).toBe("in_progress");

    for (const n of [1, 2]) {
      const repair = await t.answer(chatId, 0);
      expect(repair[0]).toMatchObject({ type: "graded", check: { result: { verdict: "wrong", answer: "3", why: "Sum 9 over 3." } } });
      expect(t.teacher.view(chatId).session).toMatchObject({ step: 0, repairs: n });
      expect(t.prompts.at(-1)).toContain(`Repair ${n} of 2`);
    }
    await t.answer(chatId, null);
    expect(t.prompts.at(-1)).toContain("After 2 repairs");
    expect(t.teacher.view(chatId).session).toMatchObject({ step: 1, repairs: 0, steps: [{ status: "shaky" }, { status: "current" }] });

    const last = await t.answer(chatId, 1, "sure");
    expect(t.status()).toEqual(["taught", "checked", "pending"]);
    expect(last.some((e) => e.type === "check")).toBe(false);
    expect(t.prompts.at(-1)).toContain('still shaky and will come back in review: "Mean"');
    expect(t.teacher.view(chatId).session).toMatchObject({ phase: "done", open: null });
    expect(t.plans.lesson(t.first.id).status).toBe("done");
    // The recap's stray tag isn't shown.
    expect(t.messages.list(chatId).at(-1)!.content).toBe("You learned the mean.");
    await expect(t.teacher.start(chatId, t.signal)).rejects.toMatchObject({ code: "lesson_done" });
  });

  it("follows up a right answer marked as a guess before moving on", async () => {
    const t = setup();
    const chatId = t.chatFor(t.first);
    await t.run(t.teacher.start(chatId, t.signal));
    await t.answer(chatId, 1, "guess");
    expect(t.teacher.view(chatId).session).toMatchObject({ step: 0 });
    expect(t.status()[0]).toBe("taught");
    expect(t.prompts.at(-1)).toContain("marked it as a guess");
    await t.answer(chatId, 1, "guess");
    expect(t.teacher.view(chatId).session).toMatchObject({ step: 1 });
  });

  it("probes a lesson that builds on an earlier one, then teaches", async () => {
    const t = setup({ plan: { orientation: [], steps: [{ title: "Variance", items: [1] }] } });
    const chatId = t.chatFor(t.second);
    await t.run(t.teacher.start(chatId, t.signal));
    expect(t.prompts.at(-1)).toContain("Phase: probe");
    expect(t.prompts.at(-1)).toContain("Mean, stated.");
    expect(t.teacher.view(chatId).session).toMatchObject({ phase: "probe", open: { step: -1 } });
    await t.answer(chatId, 1);
    expect(t.teacher.view(chatId).session).toMatchObject({ phase: "teach", step: 0 });
    expect(t.prompts.at(-1)).toContain("Probe result");
    // A probe answer is evidence, not a check: the earlier lesson's items don't move.
    expect(t.status()).toEqual(["pending", "pending", "taught"]);
  });

  it("asks for the check on its own when the teacher's is broken, and teaches one item per step when the plan misses one", async () => {
    const t = setup({ plan: { orientation: [], steps: [{ title: "Mean", items: [1] }] }, teach: (_p, n) => n === 0 ? "Idea. <check>{not json" : JSON.stringify(MCQ) });
    const chatId = t.chatFor(t.first);
    const events = await t.run(t.teacher.start(chatId, t.signal));
    expect(events.find((e) => e.type === "check")).toBeTruthy();
    expect(t.teacher.view(chatId).session!.steps.map((s) => s.title)).toEqual(["Mean", "Median"]);
  });

  it("grades a written answer with the cheap model and refuses an answer to a closed question", async () => {
    const short = { type: "short", prompt: "What is the mean?", answer: "The sum over the count", why: "" };
    const t = setup({ teach: () => `Idea. <check>${JSON.stringify(short)}</check>`, judge: `{"verdict":"partly","feedback":"Say what you divide by."}` });
    const chatId = t.chatFor(t.first);
    await t.run(t.teacher.start(chatId, t.signal));
    const checkId = t.teacher.view(chatId).session!.open!.id;
    const [graded] = await t.answer(chatId, "The sum");
    expect(graded).toMatchObject({ check: { result: { verdict: "partly", feedback: "Say what you divide by." } } });
    await expect(t.teacher.answer(chatId, { checkId, value: "x", confidence: null, thinking: "" }, t.signal)).rejects.toMatchObject({ status: 409 });
  });

  it("teaches with the model picked for the chat", async () => {
    const t = setup();
    const chatId = t.chatFor(t.first);
    t.library.updateChat(chatId, { model: { provider: "google", id: "picked" } });
    const events = await t.run(t.teacher.start(chatId, t.signal));
    expect(t.models.at(-1)).toBe("picked");
    expect(events.find((e) => e.type === "done")).toMatchObject({ message: { model: "picked" } });
  });

  it("re-explains on a quick action without a new check while one is open", async () => {
    const t = setup();
    const chatId = t.chatFor(t.first);
    await t.run(t.teacher.start(chatId, t.signal));
    const events = await t.run(t.teacher.action(chatId, "simpler", t.signal));
    expect(events[0]).toMatchObject({ type: "start", user: { content: "Simpler, please" } });
    expect(events.some((e) => e.type === "check")).toBe(false);
    expect(t.prompts.at(-1)).toContain("don't write a new one");
  });
});
