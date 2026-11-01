import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../server/db.ts";
import { createJobs } from "../server/jobs.ts";
import { createLearner } from "../server/learning/learner.ts";
import { createLedger } from "../server/ledger/store.ts";
import { createLibrary } from "../server/library.ts";
import { createServer } from "../server/main.ts";
import { createBriefs } from "../server/plan/brief.ts";
import { chatContext } from "../server/plan/context.ts";
import { registerPlanner } from "../server/plan/planner.ts";
import { createPlans } from "../server/plan/store.ts";
import type { Providers } from "../server/providers/service.ts";
import { createSettings } from "../server/settings.ts";
import { createUsage } from "../server/usage.ts";

type Request = { system: string; messages: { content: string }[] };

// A planner run on a fake model that answers with `reply(prompt)`.
function setup(reply: (prompt: string) => unknown) {
  const db = openDb(":memory:");
  const library = createLibrary(db);
  const settings = createSettings(db);
  const ledger = createLedger(db);
  const plans = createPlans(db);
  const briefs = createBriefs(db);
  const learner = createLearner(db);
  const jobs = createJobs(db, { concurrency: 1 });
  const prompts: string[] = [];
  const providers = {
    async *stream(_ref: unknown, req: Request) {
      const prompt = req.messages.at(-1)!.content;
      prompts.push(prompt);
      yield { type: "text" as const, text: JSON.stringify(reply(prompt)) };
      yield { type: "usage" as const, usage: { input: 100, output: 20, cached: 0, reasoning: 0 } };
    },
    describe: () => "fake",
  } as unknown as Providers;
  settings.update({ models: { strong: { provider: "google", id: "strong" }, cheap: { provider: "google", id: "cheap" } } });
  registerPlanner(jobs, { providers, settings, usage: createUsage(db), db, plans, briefs, learner });
  const folder = library.createFolder("Statistics", null);
  const add = (title: string) => ledger.addManual(folder.id, { type: "concept", title, statement: `${title}, stated.` });
  const plan = async (mode: "build" | "extend" = "build") => {
    const planId = mode === "build" ? plans.createDraft(folder.id, "course") : plans.active(folder.id)!.id;
    jobs.enqueue("plan", "Planning", { folderId: folder.id, params: { planId, mode } });
    await jobs.idle();
  };
  return { db, library, ledger, plans, briefs, folder, add, plan, prompts };
}

const lesson = (key: string, items: string[], after: string[] = []) => ({ key, title: `Lesson ${key}`, summary: "", kind: "lesson", minutes: 30, weight: 1, aids: [], items, after });

describe("planner", () => {
  it("plans every item even when the model keeps leaving one out", async () => {
    const t = setup(() => ({ units: [{ title: "Basics", lessons: [lesson("a", ["i1"]), lesson("b", ["i2"], ["a"])] }] }));
    const items = ["Mean", "Median", "Mode"].map(t.add);
    await t.plan();

    expect(t.prompts).toHaveLength(3);
    expect(t.prompts[1]).toContain("i3");
    const plan = t.plans.active(t.folder.id)!;
    expect(plan.lessons.flatMap((l) => l.items).sort()).toEqual(items.map((i) => i.id).sort());
    expect(plan.lessons[1]!.requires).toEqual([plan.lessons[0]!.id]);
    expect(t.ledger.list(t.folder.id).every((i) => i.status === "planned")).toBe(true);
  });

  it("extends an active plan with only the new items", async () => {
    const t = setup((prompt) => ({ units: [{ title: "More", lessons: [lesson("x", prompt.includes("i2") ? ["i1", "i2"] : ["i1"])] }] }));
    t.add("Mean");
    t.add("Median");
    await t.plan();
    const added = t.add("Variance");
    await t.plan("extend");

    expect(t.prompts.at(-1)).toContain("Variance");
    expect(t.prompts.at(-1)).not.toContain("i1 [concept] Mean");
    const plan = t.plans.active(t.folder.id)!;
    expect(plan.lessons.at(-1)!.items).toEqual([added.id]);
    expect(t.ledger.list(t.folder.id).find((i) => i.id === added.id)!.status).toBe("planned");
  });

  it("gives lesson chats the brief and the lesson's items", async () => {
    const t = setup(() => ({ units: [{ title: "Basics", lessons: [lesson("a", ["i1"])] }] }));
    t.add("Standard deviation");
    t.briefs.save(t.folder.id, { goal: "Pass the midterm", scope: "", level: "", depth: "exam_ready", deadline: null, hoursPerDay: null, daysOff: [], assessment: "", language: "English" }, "course");
    await t.plan();
    const first = t.plans.active(t.folder.id)!.lessons[0]!;
    const chat = t.library.createChat(t.folder.id, first);

    const context = chatContext(t.db, t.plans, t.ledger)(chat);
    expect(chat).toMatchObject({ mode: "teach", lessonId: first.id, title: first.title, titleSource: "manual" });
    expect(context).toContain("Pass the midterm");
    expect(context).toContain("Standard deviation, stated.");
  });
});

const HOST = "localhost:5173";
const req = (method: string, path: string, body: unknown = method === "GET" ? undefined : {}) => new Request(`http://${HOST}/api${path}`, {
  method, headers: { host: HOST, ...(body !== undefined && { "content-type": "application/json" }) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

// A real server with a plan written straight to its database: two lessons, the second after the first.
async function served() {
  const server = createServer({ port: 5173, dataDir: mkdtempSync(join(tmpdir(), "distil-plan-")) });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await server.app.fetch(req(method, path, body));
    return { status: res.status, body: res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text() };
  };
  const folder = (await call("POST", "/folders", { name: "Statistics", parentId: null })).body;
  const ledger = createLedger(server.db);
  const items = ["Mean", "Median", "Variance"].map((title) => ledger.addManual(folder.id, { type: "concept", title, statement: title }));
  const plans = createPlans(server.db);
  const planId = plans.createDraft(folder.id, "course");
  plans.append(planId, [{ title: "Centre", summary: "", lessons: [
    { key: "a", title: "Averages", summary: "", kind: "lesson", minutes: 40, weight: 1, aids: [], items: [items[0]!.id, items[1]!.id], after: [] },
    { key: "b", title: "Spread", summary: "", kind: "lesson", minutes: 40, weight: 1, aids: [], items: [items[2]!.id], after: ["a"] },
  ] }], new Map());
  plans.activate(planId);
  return { call, folder, items, plan: plans.get(planId) };
}

describe("plan API", () => {
  it("reports full coverage and refuses an order that breaks a prerequisite", async () => {
    const { call, folder, plan } = await served();
    const view = (await call("GET", `/folders/${folder.id}/plan?today=2026-11-01`)).body;
    expect(view.coverage).toMatchObject({ total: 3, planned: 3, unmapped: [] });

    const moved = await call("PATCH", `/lessons/${plan.lessons[1]!.id}`, { move: { unitId: plan.units[0]!.id, index: 0 } });
    expect(moved.status).toBe(409);
  });

  it("starts a lesson once and reopens the same chat after", async () => {
    const { call, plan } = await served();
    const first = await call("POST", `/lessons/${plan.lessons[0]!.id}/start`);
    const again = await call("POST", `/lessons/${plan.lessons[0]!.id}/start`);
    expect(first.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect((await call("GET", `/lessons/${plan.lessons[0]!.id}`)).body.lesson.status).toBe("in_progress");
  });

  it("marks a known lesson done and keeps its finish day when renamed", async () => {
    const { call, plan } = await served();
    const id = plan.lessons[0]!.id;
    await call("POST", `/lessons/${id}/known`);
    const done = (await call("GET", `/lessons/${id}`)).body.lesson;
    await call("PATCH", `/lessons/${id}`, { title: "Means and medians" });
    const renamed = (await call("GET", `/lessons/${id}`)).body.lesson;

    expect(done.status).toBe("done");
    expect(renamed.doneAt).toBe(done.doneAt);
    expect((await call("GET", `/lessons/${id}`)).body.items.map((i: { mark: string }) => i.mark)).toEqual(["known", "known"]);
  });

  it("schedules lessons before the deadline and exports them as a calendar", async () => {
    const { call, folder } = await served();
    const brief = { goal: "Pass the exam", depth: "exam_ready", deadline: "2026-11-10", hoursPerDay: 1, daysOff: [] };
    expect((await call("PUT", `/folders/${folder.id}/brief`, { brief, kind: "course" })).status).toBe(200);
    const view = (await call("GET", `/folders/${folder.id}/plan?today=2026-11-01`)).body;
    const scheduled = view.plan.lessons.map((l: { scheduledFor: string }) => l.scheduledFor);
    expect(scheduled.every((d: string) => d >= "2026-11-01" && d < "2026-11-10")).toBe(true);

    const ics = (await call("GET", `/folders/${folder.id}/plan/export.ics?today=2026-11-01`)).body as string;
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics.match(/BEGIN:VEVENT/g)!.length).toBeGreaterThanOrEqual(2);
    expect((await call("GET", "/today?today=2026-11-01")).body.exam).toMatchObject({ date: "2026-11-10" });
  });
});
