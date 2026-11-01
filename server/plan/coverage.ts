import { breakCycles, type Requires, topoOrder } from "./dag.ts";

// Coverage is enforced in code (F-304): a planner reply is reviewed here, and every problem goes back to
// the model. When retries run out, the same review repairs the reply deterministically, so a plan always
// maps every in-scope item to at least one lesson.

export const MAX_LESSON_ITEMS = 40;
export const AIDS = ["diagram", "simulation", "practice", "example"] as const;
export type Aid = (typeof AIDS)[number];
export type LessonKind = "lesson" | "project";

// key: the planner's own name for a lesson ("L3"), used for prerequisites; after: keys it requires.
export type DraftLesson = {
  key: string; title: string; summary: string; minutes: number; kind: LessonKind; weight: number; aids: Aid[];
  items: string[]; after: string[];
};
export type DraftUnit = { title: string; summary: string; lessons: DraftLesson[] };

const list = (ids: string[], max = 30) => ids.length > max ? `${ids.slice(0, max).join(", ")} and ${ids.length - max} more` : ids.join(", ");
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// items: this part's item ids in reading order. earlier: lesson keys from parts already planned.
// projects: a skill plan (F-510), whose lessons may be projects without items.
export function reviewBatch(input: DraftUnit[], o: { items: string[]; earlier: Set<string>; projects: boolean }): { problems: string[]; units: DraftUnit[] } {
  const problems: string[] = [];
  const inPart = new Set(o.items);
  const keys = new Set(o.earlier);
  let units = input.map((u) => ({ ...u, lessons: u.lessons.map((l) => ({ ...l, items: [...new Set(l.items)], after: [...l.after] })) }));
  const lessons = () => units.flatMap((u) => u.lessons);

  for (const lesson of lessons()) {
    if (keys.has(lesson.key)) {
      problems.push(`The lesson key ${lesson.key} is used twice; give every lesson its own key.`);
      let n = 2;
      while (keys.has(`${lesson.key}-${n}`)) n++;
      lesson.key = `${lesson.key}-${n}`;
    }
    keys.add(lesson.key);
    const unknown = lesson.items.filter((id) => !inPart.has(id));
    if (unknown.length) {
      problems.push(`Lesson ${lesson.key} lists ${list(unknown)}, which ${unknown.length === 1 ? "is" : "are"} not among the items to plan.`);
      lesson.items = lesson.items.filter((id) => inPart.has(id));
    }
    if (lesson.kind === "project" && !o.projects) lesson.kind = "lesson";
    lesson.minutes = clamp(Math.round(lesson.minutes) || lesson.items.length * 4, 5, 240);
    lesson.weight = clamp(Math.round(lesson.weight) || 1, 1, 3);
  }

  // A lesson teaches something: only a skill plan's project, or a skill plan with no material at all, has lessons without items.
  for (const unit of units) {
    unit.lessons = unit.lessons.filter((l) => {
      if (l.items.length || l.kind === "project" || (o.projects && !o.items.length)) return true;
      problems.push(`Lesson ${l.key} has no items; every lesson must teach at least one item.`);
      return false;
    });
  }

  // Oversized lessons are split in reading order.
  for (const unit of units) {
    unit.lessons = unit.lessons.flatMap((l) => {
      if (l.items.length <= MAX_LESSON_ITEMS) return [l];
      problems.push(`Lesson ${l.key} has ${l.items.length} items; split it so no lesson has more than ${MAX_LESSON_ITEMS}.`);
      const parts = Math.ceil(l.items.length / MAX_LESSON_ITEMS);
      const size = Math.ceil(l.items.length / parts);
      return Array.from({ length: parts }, (_, p) => ({
        ...l, key: p ? `${l.key}-part${p + 1}` : l.key, title: p ? `${l.title} (${p + 1})` : l.title,
        minutes: Math.max(5, Math.round(l.minutes / parts)), items: l.items.slice(p * size, (p + 1) * size), after: p ? [l.key] : l.after,
      }));
    });
  }

  // Every item in at least one lesson. Leftovers join the lesson holding their nearest neighbour in reading order.
  const mapped = new Set(lessons().flatMap((l) => l.items));
  const unmapped = o.items.filter((id) => !mapped.has(id));
  if (unmapped.length) {
    problems.push(`These items are in no lesson: ${list(unmapped)}. Put every item in a lesson.`);
    if (!lessons().some((l) => l.kind === "lesson")) units.push({ title: "More to learn", summary: "", lessons: [] });
    const holder = new Map<string, DraftLesson>();
    for (const l of lessons()) for (const id of l.items) if (!holder.has(id)) holder.set(id, l);
    const rank = new Map(o.items.map((id, i) => [id, i]));
    for (const id of unmapped) {
      const i = rank.get(id)!;
      let target: DraftLesson | undefined;
      for (let d = 1; !target && d < o.items.length; d++) target = holder.get(o.items[i - d]!) ?? holder.get(o.items[i + d]!);
      if (!target || target.items.length >= MAX_LESSON_ITEMS) {
        target = { key: `extra${keys.size + 1}`, title: "More to learn", summary: "", minutes: 0, kind: "lesson", weight: 1, aids: [], items: [], after: [] };
        keys.add(target.key);
        units.at(-1)!.lessons.push(target);
      }
      target.items.push(id);
      target.minutes = Math.max(target.minutes, target.items.length * 4);
      holder.set(id, target);
    }
  }

  // Prerequisites: known lessons only, never a later unit's, and no cycles. Each unit is put in prerequisite order.
  const unitOf = new Map<string, number>();
  units.forEach((u, i) => u.lessons.forEach((l) => unitOf.set(l.key, i)));
  for (const [u, unit] of units.entries()) {
    for (const l of unit.lessons) {
      l.after = [...new Set(l.after)].filter((ref) => {
        if (ref === l.key) return false;
        if (!unitOf.has(ref) && !o.earlier.has(ref)) {
          problems.push(`Lesson ${l.key} requires ${ref}, which doesn't exist.`);
          return false;
        }
        if ((unitOf.get(ref) ?? -1) > u) {
          problems.push(`Lesson ${l.key} requires ${ref}, which is in a later unit; order the units so prerequisites come first.`);
          return false;
        }
        return true;
      });
    }
    const ids = unit.lessons.map((l) => l.key);
    let requires: Requires = new Map(unit.lessons.map((l) => [l.key, l.after]));
    let { order, cycle } = topoOrder(ids, requires);
    if (cycle.length) {
      problems.push(`Lessons ${list(cycle)} require each other in a cycle.`);
      requires = breakCycles(ids, requires);
      for (const l of unit.lessons) l.after = l.after.filter((ref) => !ids.includes(ref) || (requires.get(l.key) ?? []).includes(ref));
      order = topoOrder(ids, requires).order;
    }
    const byKey = new Map(unit.lessons.map((l) => [l.key, l]));
    unit.lessons = order.map((k) => byKey.get(k)!);
  }
  units = units.filter((u) => u.lessons.length);
  return { problems, units };
}

export type CoverageItem = { id: string; mark: string | null; status: string };
const TAUGHT = ["taught", "checked", "mastered"];
const CHECKED = ["checked", "mastered"];

// The three bars (F-307) over in-scope items: planned (in a lesson of the plan), taught and checked.
export function coverageOf(items: CoverageItem[], mapped: Set<string>) {
  const inScope = items.filter((i) => !i.mark);
  return {
    total: inScope.length,
    planned: inScope.filter((i) => mapped.has(i.id)).length,
    taught: inScope.filter((i) => TAUGHT.includes(i.status)).length,
    checked: inScope.filter((i) => CHECKED.includes(i.status)).length,
    unmapped: inScope.filter((i) => !mapped.has(i.id)).map((i) => i.id),
  };
}

// Items in a lesson that was started or finished but which haven't been taught yet (F-305).
export function untaught(lessons: { status: string; items: string[] }[], items: CoverageItem[]): string[] {
  const open = new Map(items.filter((i) => !i.mark && !TAUGHT.includes(i.status)).map((i) => [i.id, i]));
  return [...new Set(lessons.filter((l) => l.status !== "todo").flatMap((l) => l.items).filter((id) => open.has(id)))];
}
