import type { Library } from "../library.ts";
import { daysBetween } from "./schedule.ts";
import { type PlanDeps, planView, type PlanView } from "./view.ts";
import type { Day } from "./schedule.ts";

// The Today view (F-506): today's lessons from every subject with a plan, due flashcards and one practice
// suggestion. Phase 7's recommender replaces the ordering after the merge.

export type TodayLesson = {
  id: string; title: string; minutes: number; items: number; status: string; kind: string;
  folderId: string; folderName: string; unit: string; index: number; total: number;
};
export type Subject = { folderId: string; name: string; goal: string | null; deadline: string | null; daysLeft: number | null; coverage: PlanView["coverage"]; lessonsLeft: number };
export type TodayView = {
  date: string;
  exam: { folderId: string; name: string; goal: string; date: string; daysLeft: number } | null;
  lessons: TodayLesson[];
  // Lessons after today's, for the "later" list when today's are done or there is no schedule.
  later: TodayLesson[];
  cards: { due: number; folders: { folderId: string; name: string; due: number }[] };
  practice: { folderId: string; name: string; items: number } | null;
  subjects: Subject[];
  week: { folderId: string; name: string; days: Day[]; titles: Record<string, string> } | null;
};

// Lessons a day shows when there is no schedule: the next ones not done.
const NEXT_WITHOUT_SCHEDULE = 2;

export function todayView(deps: PlanDeps & { library: Library }, today: string, now = Date.now()): TodayView {
  const folders = new Map(deps.library.list().folders.map((f) => [f.id, f]));
  const views = deps.plans.activeFolders().filter((id) => folders.has(id)).map((id) => ({ id, name: folders.get(id)!.name, view: planView(deps, id, today) }));

  const lessons: TodayLesson[] = [];
  const later: TodayLesson[] = [];
  for (const { id, name, view } of views) {
    const plan = view.plan!;
    const units = new Map(plan.units.map((u) => [u.id, u.title]));
    const describe = (lessonId: string): TodayLesson => {
      const index = plan.lessons.findIndex((l) => l.id === lessonId);
      const l = plan.lessons[index]!;
      return { id: l.id, title: l.title, minutes: l.minutes, items: l.items.length, status: l.status, kind: l.kind, folderId: id, folderName: name, unit: units.get(l.unitId) ?? "", index: index + 1, total: plan.lessons.length };
    };
    const open = plan.lessons.filter((l) => l.status !== "done");
    // In progress first, then the plan's order.
    open.sort((a, b) => Number(b.status === "in_progress") - Number(a.status === "in_progress"));
    const todays = view.schedule ? (view.schedule.days.find((d) => d.date === today)?.lessons ?? []) : open.slice(0, NEXT_WITHOUT_SCHEDULE).map((l) => l.id);
    const mine = open.filter((l) => todays.includes(l.id));
    lessons.push(...mine.map((l) => describe(l.id)));
    later.push(...open.filter((l) => !todays.includes(l.id)).slice(0, 3).map((l) => describe(l.id)));
  }

  const due = deps.db.prepare("SELECT folder_id, COUNT(*) AS n FROM cards WHERE due_at IS NOT NULL AND due_at <= ? GROUP BY folder_id").all(now) as { folder_id: string; n: number }[];
  const cardFolders = due.filter((r) => folders.has(r.folder_id)).map((r) => ({ folderId: r.folder_id, name: folders.get(r.folder_id)!.name, due: r.n }));

  // Practice where the most was taught but not yet checked.
  const unchecked = views.map(({ id, name, view }) => ({ folderId: id, name, items: view.coverage.taught - view.coverage.checked })).sort((a, b) => b.items - a.items)[0];

  const subjects = views.map(({ id, name, view }): Subject => {
    const deadline = view.brief?.brief.deadline ?? null;
    return {
      folderId: id, name, goal: view.brief?.brief.goal ?? null, deadline, daysLeft: deadline ? daysBetween(today, deadline) : null,
      coverage: view.coverage, lessonsLeft: view.plan!.lessons.filter((l) => l.status !== "done").length,
    };
  });
  const next = subjects.filter((s) => s.deadline && s.deadline >= today).sort((a, b) => a.deadline!.localeCompare(b.deadline!))[0];
  const nextView = next && views.find((v) => v.id === next.folderId)!;

  return {
    date: today,
    exam: next ? { folderId: next.folderId, name: next.name, goal: next.goal ?? next.name, date: next.deadline!, daysLeft: next.daysLeft! } : null,
    lessons, later: later.slice(0, 3),
    cards: { due: cardFolders.reduce((n, f) => n + f.due, 0), folders: cardFolders },
    practice: unchecked && unchecked.items > 0 ? unchecked : null,
    subjects,
    week: nextView?.view.schedule ? {
      folderId: nextView.id, name: nextView.name,
      days: nextView.view.schedule.days.filter((d) => d.date >= today).slice(0, 7),
      titles: Object.fromEntries(nextView.view.plan!.lessons.map((l) => [l.id, l.title])),
    } : null,
  };
}
