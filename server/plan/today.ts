import type { Library } from "../library.ts";
import { NEW_PER_DAY, startOfDay } from "../retention/cards.ts";
import { daysBetween } from "./schedule.ts";
import { type PlanDeps, planView, type PlanView } from "./view.ts";
import type { Day } from "./schedule.ts";

// The Today view (F-506): today's lessons from every subject with a plan, due flashcards, where practice
// would help most, and "what should I do now?" (F-913): the next few things in order, each with its reason.

export type TodayLesson = {
  id: string; title: string; minutes: number; items: number; status: string; kind: string;
  folderId: string; folderName: string; unit: string; index: number; total: number;
};
export type Subject = { folderId: string; name: string; goal: string | null; deadline: string | null; daysLeft: number | null; coverage: PlanView["coverage"]; lessonsLeft: number };
export type Next =
  | { kind: "review"; cards: number; reason: string }
  | { kind: "lesson"; lesson: TodayLesson; reason: string }
  | { kind: "practice"; folderId: string; name: string; items: number; reason: string };
export type TodayView = {
  date: string;
  next: Next[];
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

// Cards due before review is put first even with lessons waiting.
const REVIEW_FIRST = 15;
// Shaky items before a practice set is suggested.
const PRACTICE_AT = 3;

export function todayView(deps: PlanDeps & { library: Library; practice?: { weakItems: (folderId: string) => unknown[] } }, today: string, now = Date.now()): TodayView {
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

  // Cards due: those in review that are due, plus new ones up to what's left of today's allowance.
  const due = deps.db.prepare(`SELECT folder_id, SUM(json_extract(state, '$.phase') != 'new') AS due, SUM(json_extract(state, '$.phase') = 'new') AS fresh
    FROM cards WHERE due_at IS NOT NULL AND due_at <= ? GROUP BY folder_id ORDER BY MIN(created_at)`).all(now) as { folder_id: string; due: number; fresh: number }[];
  const introduced = (deps.db.prepare("SELECT COUNT(*) AS n FROM cards WHERE json_extract(state, '$.seen') >= ?").get(startOfDay(now)) as { n: number }).n;
  let allowance = Math.max(0, NEW_PER_DAY - introduced);
  const cardFolders = due.filter((r) => folders.has(r.folder_id)).map((r) => {
    const fresh = Math.min(r.fresh, allowance);
    allowance -= fresh;
    return { folderId: r.folder_id, name: folders.get(r.folder_id)!.name, due: r.due + fresh };
  }).filter((f) => f.due > 0);

  // Practice where the most is weak (fell short when last checked, or taught and never checked).
  const unchecked = views.map(({ id, name, view }) => ({
    folderId: id, name, items: deps.practice ? deps.practice.weakItems(id).length : view.coverage.taught - view.coverage.checked,
  })).sort((a, b) => b.items - a.items)[0];

  const subjects = views.map(({ id, name, view }): Subject => {
    const deadline = view.brief?.brief.deadline ?? null;
    return {
      folderId: id, name, goal: view.brief?.brief.goal ?? null, deadline, daysLeft: deadline ? daysBetween(today, deadline) : null,
      coverage: view.coverage, lessonsLeft: view.plan!.lessons.filter((l) => l.status !== "done").length,
    };
  });
  const next = subjects.filter((s) => s.deadline && s.deadline >= today).sort((a, b) => a.deadline!.localeCompare(b.deadline!))[0];
  const nextView = next && views.find((v) => v.id === next.folderId)!;

  const dueCards = cardFolders.reduce((n, f) => n + f.due, 0);
  const examSoon = !!next && next.daysLeft! <= 7;
  const review: Next | null = dueCards ? { kind: "review", cards: dueCards, reason: dueCards >= REVIEW_FIRST ? "They're due now; a short review first keeps them from piling up." : "A few minutes keeps what you've learned from fading." } : null;
  const todays: Next[] = lessons.map((l) => ({ kind: "lesson", lesson: l, reason: examSoon ? "Scheduled for today, to finish before the deadline." : "On today's schedule." }));
  const weak: Next | null = unchecked && unchecked.items >= PRACTICE_AT
    ? { kind: "practice", folderId: unchecked.folderId, name: unchecked.name, items: unchecked.items, reason: `${unchecked.items} items in ${unchecked.name} aren't holding yet.` } : null;
  const later1: Next[] = later.slice(0, 1).map((l) => ({ kind: "lesson", lesson: l, reason: "Next in your plan." }));
  const order = examSoon ? [...todays, weak, review, ...later1]
    : review && review.cards >= REVIEW_FIRST ? [review, ...todays, weak, ...later1]
    : [...todays, review, weak, ...later1];

  return {
    date: today,
    next: order.filter((n): n is Next => !!n).slice(0, 4),
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
