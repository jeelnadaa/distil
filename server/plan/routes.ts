import type { Context, Hono } from "hono";
import { z } from "zod";
import { AppError } from "../errors.ts";
import { type AppDeps, body } from "../http.ts";
import { Brief } from "../learning/types.ts";
import { compileBrief } from "./brief.ts";
import { planIcs, planMarkdown } from "./export.ts";
import { type PlanJob, planLabel } from "./planner.ts";
import { localDate } from "./schedule.ts";
import { itemsInOrder, sectionList } from "./sections.ts";
import { todayView } from "./today.ts";
import { planView } from "./view.ts";

// Study Plan API (Phase 3): the brief, the plan and its edits, exports, and the Today view. Dates are the
// learner's local day, sent as ?today=YYYY-MM-DD (the server's own day when missing).

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Kind = z.enum(["course", "skill"]);
const LessonPatch = z.object({
  title: z.string().min(1).max(200).optional(), summary: z.string().max(600).optional(),
  minutes: z.number().int().min(5).max(600).optional(), status: z.enum(["todo", "in_progress", "done"]).optional(),
  move: z.object({ unitId: z.string().min(1), index: z.number().int().min(0) }).optional(),
});

const today = (c: Context) => {
  const q = c.req.query("today");
  return q && Day.safeParse(q).success ? q : localDate();
};
const download = (c: Context, text: string, name: string, type: string) =>
  c.body(text, 200, { "content-type": `${type}; charset=utf-8`, "content-disposition": `attachment; filename="${name.replace(/[^\w .-]+/g, "_")}"` });

export function registerPlanRoutes(app: Hono, deps: AppDeps) {
  const { library, plans, briefs, jobs, ledger, materials, learner } = deps;
  const view = (c: Context, folderId: string) => c.json(planView(deps, folderId, today(c)));
  const folderOfLesson = (id: string) => plans.lessonPlan(id).folderId;
  const activePlan = (folderId: string) => {
    const plan = plans.active(folderId);
    if (!plan) throw new AppError(404, "no_plan", "This folder has no plan yet.");
    return plan;
  };
  const runningPlanJob = (folderId: string) => jobs.list().find((j) => j.kind === "plan" && j.folderId === folderId && (j.status === "queued" || j.status === "running"));

  /* ---------- Study Brief (F-101…F-104) ---------- */
  app.get("/folders/:id/brief", (c) => {
    library.requireFolder(c.req.param("id"));
    return c.json(briefs.nearest(c.req.param("id")));
  });
  app.post("/folders/:id/brief/compile", async (c) => {
    const { request } = await body(c, z.object({ request: z.string().max(2000).default("") }));
    const folderId = c.req.param("id");
    const folder = library.requireFolder(folderId);
    const items = itemsInOrder(deps.db, folderId);
    return c.json(await compileBrief(deps, {
      folderId, folderName: folder.name, request, today: today(c), current: briefs.nearest(folderId)?.brief ?? null,
      materials: materials.list(folderId).filter((m) => m.status === "ready"), sections: sectionList(items), items: items.length,
    }, c.req.raw.signal));
  });
  app.put("/folders/:id/brief", async (c) => {
    const { brief, kind } = await body(c, z.object({ brief: Brief, kind: Kind }));
    library.requireFolder(c.req.param("id"));
    return c.json(briefs.save(c.req.param("id"), brief, kind));
  });

  /* ---------- Plan (F-501…F-509) ---------- */
  app.get("/folders/:id/plan", (c) => {
    library.requireFolder(c.req.param("id"));
    return view(c, c.req.param("id"));
  });
  // Builds a new plan from the whole ledger as a draft; it replaces the current plan when it is complete.
  app.post("/folders/:id/plan", (c) => {
    const folderId = c.req.param("id");
    const folder = library.requireFolder(folderId);
    const brief = briefs.nearest(folderId);
    if (!brief) throw new AppError(400, "no_brief", "Set up the study brief first.");
    const running = runningPlanJob(folderId);
    if (running) jobs.abort(running.id);
    for (const draft of deps.db.prepare("SELECT id FROM plans WHERE folder_id = ? AND status = 'draft'").all(folderId) as { id: string }[]) plans.remove(draft.id);
    if (brief.kind === "course" && !itemsInOrder(deps.db, folderId).length) {
      throw new AppError(400, "empty_ledger", "There is nothing in the ledger to plan yet. Distil the materials first, or make this a skill plan.");
    }
    const schedule = plans.active(folderId)?.schedule;
    const planId = plans.createDraft(folderId, brief.kind, schedule && { ...schedule, baselineDay: null, note: null });
    const params: PlanJob = { planId, mode: "build" };
    return c.json(jobs.enqueue("plan", planLabel(folder.name, "build"), { folderId, params }), 202);
  });
  // Plans the in-scope items the active plan doesn't map yet (added to the ledger after planning).
  app.post("/folders/:id/plan/extend", (c) => {
    const folderId = c.req.param("id");
    const folder = library.requireFolder(folderId);
    const plan = activePlan(folderId);
    const running = runningPlanJob(folderId);
    if (running) return c.json(running, 202);
    const params: PlanJob = { planId: plan.id, mode: "extend" };
    return c.json(jobs.enqueue("plan", planLabel(folder.name, "extend"), { folderId, params }), 202);
  });
  // Deadline settings that live on the plan: revision and mock-exam days before the exam.
  app.patch("/folders/:id/plan", async (c) => {
    const { bufferDays } = await body(c, z.object({ bufferDays: z.number().int().min(0).max(14) }));
    const plan = activePlan(c.req.param("id"));
    plans.setSchedule(plan.id, { ...plan.schedule, bufferDays, baselineDay: null }, {});
    return view(c, plan.folderId);
  });
  app.get("/folders/:id/plan/export.md", (c) => {
    const folder = library.requireFolder(c.req.param("id"));
    const v = planView(deps, folder.id, today(c));
    if (!v.plan) throw new AppError(404, "no_plan", "This folder has no plan yet.");
    const items = new Map(ledger.list(folder.id).map((i) => [i.id, i]));
    return download(c, planMarkdown({ title: folder.name, plan: v.plan, brief: v.brief?.brief ?? null, items, schedule: v.schedule }), `${folder.name} plan.md`, "text/markdown");
  });
  app.get("/folders/:id/plan/export.ics", (c) => {
    const folder = library.requireFolder(c.req.param("id"));
    const v = planView(deps, folder.id, today(c));
    if (!v.plan || !v.schedule) throw new AppError(404, "no_schedule", "Add an exam date and hours per day to the brief to get a calendar.");
    return download(c, planIcs({ title: folder.name, plan: v.plan, schedule: v.schedule, stamp: new Date() }), `${folder.name} plan.ics`, "text/calendar");
  });

  /* ---------- Lessons (F-502, F-507) ---------- */
  app.get("/lessons/:id", (c) => {
    const lesson = plans.lesson(c.req.param("id"));
    const plan = plans.lessonPlan(lesson.id);
    const titles = new Map(plan.lessons.map((l) => [l.id, l]));
    return c.json({
      lesson, folderId: plan.folderId, planKind: plan.kind, unit: plan.units.find((u) => u.id === lesson.unitId)!,
      index: plan.lessons.findIndex((l) => l.id === lesson.id) + 1, total: plan.lessons.length,
      items: lesson.items.map((id) => ledger.get(id)),
      requires: lesson.requires.map((id) => ({ id, title: titles.get(id)?.title ?? "", status: titles.get(id)?.status ?? "todo" })),
    });
  });
  app.patch("/lessons/:id", async (c) => {
    const { move, ...patch } = await body(c, LessonPatch);
    const id = c.req.param("id");
    plans.updateLesson(id, patch);
    if (move) plans.move(id, move.unitId, move.index);
    return view(c, folderOfLesson(id));
  });
  app.post("/lessons/:id/split", async (c) => {
    const { at } = await body(c, z.object({ at: z.number().int() }));
    plans.split(c.req.param("id"), at);
    return view(c, folderOfLesson(c.req.param("id")));
  });
  app.post("/lessons/:id/merge", (c) => {
    plans.merge(c.req.param("id"));
    return view(c, folderOfLesson(c.req.param("id")));
  });
  // "I know this already": the lesson's untaught items are marked known (out of the coverage count) and the lesson is done.
  app.post("/lessons/:id/known", (c) => {
    const lesson = plans.lesson(c.req.param("id"));
    for (const id of lesson.items) {
      const item = ledger.get(id);
      if (!item.mark && (item.status === "pending" || item.status === "planned")) ledger.update(id, { mark: "known" });
    }
    plans.updateLesson(lesson.id, { status: "done" });
    learner.advance(lesson.items, "planned");
    return view(c, folderOfLesson(lesson.id));
  });

  // Start lesson (F-504): reopens the lesson's chat, or creates one that carries the lesson as context.
  app.post("/lessons/:id/start", (c) => {
    const lesson = plans.lesson(c.req.param("id"));
    const existing = library.lessonChat(lesson.id);
    if (lesson.status === "todo") plans.updateLesson(lesson.id, { status: "in_progress" });
    return c.json(existing ?? library.createChat(folderOfLesson(lesson.id), lesson), existing ? 200 : 201);
  });

  /* ---------- Today (F-506) ---------- */
  app.get("/today", (c) => c.json(todayView(deps, today(c))));
}
