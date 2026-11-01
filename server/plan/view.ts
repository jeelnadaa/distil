import type { Db } from "../db.ts";
import type { Jobs, Job } from "../jobs.ts";
import { type StoredBrief, type Briefs } from "./brief.ts";
import { coverageOf, untaught } from "./coverage.ts";
import { addDays, buildSchedule, localDate, rebalance, type Schedule, type ScheduleSettings, type SchedLesson } from "./schedule.ts";
import type { Plan, Plans, SavedPlan } from "./store.ts";

// What the Plan tab, the ledger highlights and the Today view need about a folder's plan, computed for
// the learner's local day. Reading it re-balances the schedule once a day (F-505).

export type PlanDeps = { db: Db; plans: Plans; briefs: Briefs; jobs: Jobs };
export type Coverage = ReturnType<typeof coverageOf> & { untaught: string[] };
export type PlanSchedule = Schedule & { settings: ScheduleSettings; note: string | null };
export type PlanView = { plan: Plan | null; saved: SavedPlan[]; brief: StoredBrief | null; job: Job | null; coverage: Coverage; schedule: PlanSchedule | null };

// Days before today shown in the schedule strip.
const PAST_DAYS = 3;

export const itemStates = (db: Db, folderId: string) => db.prepare(`WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id)
  SELECT i.id, i.mark, i.status FROM items i JOIN sub ON i.folder_id = sub.id`).all(folderId) as { id: string; mark: string | null; status: string }[];

export const settingsFor = (brief: StoredBrief | null, plan: Plan): ScheduleSettings | null =>
  brief?.brief.deadline && brief.brief.hoursPerDay
    ? { examDate: brief.brief.deadline, hoursPerDay: brief.brief.hoursPerDay, daysOff: brief.brief.daysOff, bufferDays: plan.schedule.bufferDays }
    : null;

export const schedLessons = (plan: Plan): SchedLesson[] =>
  plan.lessons.map((l) => ({ id: l.id, minutes: l.minutes, done: l.doneAt === null ? null : localDate(new Date(l.doneAt)) }));

export function planView(deps: PlanDeps, folderId: string, today: string): PlanView {
  let plan = deps.plans.active(folderId);
  const brief = deps.briefs.nearest(folderId);
  const job = deps.jobs.list().find((j) => j.kind === "plan" && j.folderId === folderId && (j.status === "queued" || j.status === "running")) ?? null;
  const items = itemStates(deps.db, folderId);
  const coverage = { ...coverageOf(items, deps.plans.mapped(folderId)), untaught: plan ? untaught(plan.lessons, items) : [] };
  let schedule: PlanSchedule | null = null;
  const settings = plan && settingsFor(brief, plan);
  if (plan && settings) {
    const lessons = schedLessons(plan);
    const baseline = Object.fromEntries(plan.lessons.filter((l) => l.scheduledFor).map((l) => [l.id, l.scheduledFor!]));
    const next = rebalance(plan.schedule, baseline, lessons, settings, today);
    if (next.changed) {
      deps.plans.setSchedule(plan.id, next.state, next.baseline);
      plan = deps.plans.get(plan.id);
    }
    const from = [addDays(today, -PAST_DAYS), localDate(new Date(plan.createdAt))].sort()[1]!;
    schedule = { ...buildSchedule(lessons, settings, today, from), settings, note: next.state.note };
  }
  return { plan, saved: deps.plans.saved(folderId), brief, job, coverage, schedule };
}
