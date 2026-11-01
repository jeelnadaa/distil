import { randomUUID } from "node:crypto";
import { type Db, transaction } from "../db.ts";
import { AppError, notFound } from "../errors.ts";
import type { Aid, DraftUnit, LessonKind } from "./coverage.ts";
import { misplaced } from "./dag.ts";
import type { ScheduleState } from "./schedule.ts";

// Study plans (F-501, F-507): one active plan per folder, units of lessons in one plan-wide order, each
// lesson teaching ordered items (its steps) after the lessons it requires. A new plan is built as a draft
// and replaces the active one only when it is complete.

export type PlanKind = "course" | "skill";
export type LessonStatus = "todo" | "in_progress" | "done";
export type Unit = { id: string; ord: number; title: string; summary: string };
export type Lesson = {
  id: string; unitId: string; ord: number; title: string; summary: string; minutes: number; status: LessonStatus;
  kind: LessonKind; weight: number; aids: Aid[]; items: string[]; requires: string[]; doneAt: number | null; scheduledFor: string | null;
};
export type Plan = {
  id: string; folderId: string; status: "draft" | "active" | "archived"; kind: PlanKind;
  units: Unit[]; lessons: Lesson[]; schedule: ScheduleState; createdAt: number; updatedAt: number;
};

type PlanRow = { id: string; folder_id: string; status: Plan["status"]; kind: PlanKind; schedule: string | null; created_at: number; updated_at: number };
type LessonRow = {
  id: string; unit_id: string; ord: number; title: string; summary: string; minutes: number; status: LessonStatus;
  kind: LessonKind; weight: number; aids: string; scheduled_for: string | null; done_at: number | null;
};

const NO_SCHEDULE: ScheduleState = { bufferDays: 2, baselineDay: null, note: null };

export function createPlans(db: Db, now = () => Date.now()) {
  const load = (row: PlanRow): Plan => {
    const units = db.prepare("SELECT id, ord, title, summary FROM plan_units WHERE plan_id = ? ORDER BY ord").all(row.id) as Unit[];
    const rows = db.prepare("SELECT * FROM lessons WHERE plan_id = ? ORDER BY ord").all(row.id) as LessonRow[];
    const items = new Map<string, string[]>();
    for (const r of db.prepare("SELECT li.lesson_id, li.item_id FROM lesson_items li JOIN lessons l ON l.id = li.lesson_id WHERE l.plan_id = ? ORDER BY li.ord").all(row.id) as { lesson_id: string; item_id: string }[]) {
      items.set(r.lesson_id, [...(items.get(r.lesson_id) ?? []), r.item_id]);
    }
    const requires = new Map<string, string[]>();
    for (const r of db.prepare("SELECT p.lesson_id, p.requires_id FROM lesson_prereqs p JOIN lessons l ON l.id = p.lesson_id WHERE l.plan_id = ?").all(row.id) as { lesson_id: string; requires_id: string }[]) {
      requires.set(r.lesson_id, [...(requires.get(r.lesson_id) ?? []), r.requires_id]);
    }
    const lessons = rows.map((r): Lesson => ({
      id: r.id, unitId: r.unit_id, ord: r.ord, title: r.title, summary: r.summary, minutes: r.minutes, status: r.status,
      kind: r.kind, weight: r.weight, aids: JSON.parse(r.aids) as Aid[], items: items.get(r.id) ?? [], requires: requires.get(r.id) ?? [],
      doneAt: r.done_at, scheduledFor: r.scheduled_for,
    }));
    return {
      id: row.id, folderId: row.folder_id, status: row.status, kind: row.kind, units, lessons,
      schedule: row.schedule ? { ...NO_SCHEDULE, ...JSON.parse(row.schedule) as ScheduleState } : NO_SCHEDULE, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  };
  const get = (id: string): Plan => {
    const row = db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as PlanRow | undefined;
    if (!row) throw notFound("Plan");
    return load(row);
  };
  const planOf = (lessonId: string) => {
    const row = db.prepare("SELECT plan_id FROM lessons WHERE id = ?").get(lessonId) as { plan_id: string } | undefined;
    if (!row) throw notFound("Lesson");
    return get(row.plan_id);
  };
  const touch = (planId: string) => db.prepare("UPDATE plans SET updated_at = ? WHERE id = ?").run(now(), planId);

  // Writes a new plan-wide lesson order (and unit membership), refusing one that puts a lesson before what it requires.
  const reorder = (plan: Plan, order: { id: string; unitId: string }[]) => {
    const bad = misplaced(order.map((l) => l.id), new Map(plan.lessons.map((l) => [l.id, l.requires])));
    if (bad.length) {
      const title = (id: string) => plan.lessons.find((l) => l.id === id)?.title ?? id;
      const [lesson, needs] = bad[0]!;
      throw new AppError(409, "prerequisite_order", `“${title(lesson)}” needs “${title(needs)}” first, so it can't go there.`);
    }
    const update = db.prepare("UPDATE lessons SET ord = ?, unit_id = ? WHERE id = ?");
    order.forEach((l, i) => update.run(i, l.unitId, l.id));
  };

  return {
    get,
    lessonPlan: planOf,

    active(folderId: string): Plan | null {
      const row = db.prepare("SELECT * FROM plans WHERE folder_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").get(folderId) as PlanRow | undefined;
      return row ? load(row) : null;
    },

    // Folders with an active plan (the Today view walks them).
    activeFolders(): string[] {
      return (db.prepare("SELECT DISTINCT folder_id FROM plans WHERE status = 'active'").all() as { folder_id: string }[]).map((r) => r.folder_id);
    },

    createDraft(folderId: string, kind: PlanKind, schedule?: ScheduleState): string {
      const id = randomUUID();
      const at = now();
      db.prepare("INSERT INTO plans (id, folder_id, status, kind, schedule, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?, ?, ?)")
        .run(id, folderId, kind, JSON.stringify(schedule ?? NO_SCHEDULE), at, at);
      return id;
    },

    // Appends reviewed units after the plan's last lesson. keys maps planner keys of earlier lessons to
    // lesson ids; it is extended with this part's lessons so later parts can require them.
    append(planId: string, units: DraftUnit[], keys: Map<string, string>) {
      transaction(db, () => {
        const at = now();
        let unitOrd = (db.prepare("SELECT COALESCE(MAX(ord), -1) AS n FROM plan_units WHERE plan_id = ?").get(planId) as { n: number }).n;
        let lessonOrd = (db.prepare("SELECT COALESCE(MAX(ord), -1) AS n FROM lessons WHERE plan_id = ?").get(planId) as { n: number }).n;
        const insertUnit = db.prepare("INSERT INTO plan_units (id, plan_id, ord, title, summary) VALUES (?, ?, ?, ?, ?)");
        const insertLesson = db.prepare(`INSERT INTO lessons (id, plan_id, unit_id, ord, title, summary, minutes, kind, weight, aids, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const insertItem = db.prepare("INSERT OR IGNORE INTO lesson_items (lesson_id, item_id, ord) VALUES (?, ?, ?)");
        const insertPrereq = db.prepare("INSERT OR IGNORE INTO lesson_prereqs (lesson_id, requires_id) VALUES (?, ?)");
        for (const unit of units) for (const l of unit.lessons) keys.set(l.key, randomUUID());
        for (const unit of units) {
          const unitId = randomUUID();
          insertUnit.run(unitId, planId, ++unitOrd, unit.title.trim(), unit.summary.trim());
          for (const l of unit.lessons) {
            const id = keys.get(l.key)!;
            insertLesson.run(id, planId, unitId, ++lessonOrd, l.title.trim(), l.summary.trim(), l.minutes, l.kind, l.weight, JSON.stringify(l.aids), at, at);
            l.items.forEach((item, i) => insertItem.run(id, item, i));
            for (const ref of l.after) if (keys.has(ref)) insertPrereq.run(id, keys.get(ref)!);
          }
        }
        touch(planId);
      });
    },

    // Makes a finished draft the folder's plan. Lessons whose items were all taught already count as done.
    activate(planId: string) {
      transaction(db, () => {
        const plan = get(planId);
        db.prepare("UPDATE plans SET status = 'archived', updated_at = ? WHERE folder_id = ? AND status = 'active'").run(now(), plan.folderId);
        db.prepare("UPDATE plans SET status = 'active', updated_at = ? WHERE id = ?").run(now(), planId);
        db.prepare(`UPDATE lessons SET status = 'done', done_at = ?, updated_at = ? WHERE plan_id = ? AND kind = 'lesson' AND NOT EXISTS (
          SELECT 1 FROM lesson_items li JOIN items i ON i.id = li.item_id WHERE li.lesson_id = lessons.id AND i.status IN ('pending', 'planned'))`).run(now(), now(), planId);
      });
    },

    remove(planId: string) {
      db.prepare("DELETE FROM plans WHERE id = ?").run(planId);
    },

    // Item ids the folder's active plan maps to a lesson.
    mapped(folderId: string): Set<string> {
      return new Set((db.prepare(`SELECT DISTINCT li.item_id FROM lesson_items li JOIN lessons l ON l.id = li.lesson_id
        JOIN plans p ON p.id = l.plan_id WHERE p.folder_id = ? AND p.status = 'active'`).all(folderId) as { item_id: string }[]).map((r) => r.item_id));
    },

    lesson(id: string): Lesson {
      const lesson = planOf(id).lessons.find((l) => l.id === id);
      if (!lesson) throw notFound("Lesson");
      return lesson;
    },

    updateLesson(id: string, patch: { title?: string; summary?: string; minutes?: number; status?: LessonStatus }) {
      const plan = planOf(id);
      const fields: [string, string | number | null][] = Object.entries(patch).filter(([, v]) => v !== undefined);
      // The day a lesson was finished stays put when it is renamed later; reopening it clears it.
      if (patch.status) fields.push(["done_at", patch.status === "done" ? now() : null]);
      if (fields.length) {
        db.prepare(`UPDATE lessons SET ${fields.map(([k]) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
          .run(...fields.map(([, v]) => (typeof v === "string" ? v.trim() : v)), now(), id);
        touch(plan.id);
      }
      return get(plan.id);
    },

    // Moves a lesson to position `index` of a unit (F-507), keeping every prerequisite before it.
    move(id: string, unitId: string, index: number) {
      const plan = planOf(id);
      if (!plan.units.some((u) => u.id === unitId)) throw notFound("Unit");
      const rest = plan.lessons.filter((l) => l.id !== id).map((l) => ({ id: l.id, unitId: l.unitId }));
      const inUnit = rest.filter((l) => l.unitId === unitId);
      // Insert before the unit's index-th lesson, or after the unit's last one (or after the previous units' lessons).
      const anchor = inUnit[index];
      const unitOrd = plan.units.find((u) => u.id === unitId)!.ord;
      const ordOf = (uid: string) => plan.units.find((u) => u.id === uid)!.ord;
      const at = anchor ? rest.indexOf(anchor) : rest.filter((l) => ordOf(l.unitId) <= unitOrd).length;
      rest.splice(at, 0, { id, unitId });
      transaction(db, () => {
        reorder(plan, rest);
        touch(plan.id);
      });
      return get(plan.id);
    },

    // Splits a lesson before its item at `at`: the rest becomes a new lesson right after it, which every
    // lesson requiring the original now requires too.
    split(id: string, at: number) {
      const plan = planOf(id);
      const lesson = plan.lessons.find((l) => l.id === id)!;
      if (at < 1 || at >= lesson.items.length) throw new AppError(400, "invalid_split", "Pick an item after the first one to split before.");
      const second = randomUUID();
      const share = Math.max(5, Math.round(lesson.minutes * (lesson.items.length - at) / lesson.items.length));
      transaction(db, () => {
        const t = now();
        db.prepare("UPDATE lessons SET ord = ord + 1 WHERE plan_id = ? AND ord > ?").run(plan.id, lesson.ord);
        db.prepare(`INSERT INTO lessons (id, plan_id, unit_id, ord, title, summary, minutes, kind, weight, aids, status, created_at, updated_at)
          SELECT ?, plan_id, unit_id, ord + 1, title || ' (2)', '', ?, kind, weight, aids, status, ?, ? FROM lessons WHERE id = ?`).run(second, share, t, t, id);
        db.prepare("UPDATE lessons SET minutes = ?, updated_at = ? WHERE id = ?").run(Math.max(5, lesson.minutes - share), t, id);
        lesson.items.slice(at).forEach((item, i) => {
          db.prepare("UPDATE lesson_items SET lesson_id = ?, ord = ? WHERE lesson_id = ? AND item_id = ?").run(second, i, id, item);
        });
        db.prepare("INSERT INTO lesson_prereqs (lesson_id, requires_id) VALUES (?, ?)").run(second, id);
        db.prepare("INSERT OR IGNORE INTO lesson_prereqs (lesson_id, requires_id) SELECT lesson_id, ? FROM lesson_prereqs WHERE requires_id = ? AND lesson_id != ?").run(second, id, second);
        touch(plan.id);
      });
      return get(plan.id);
    },

    // Folds the next lesson into this one: items, minutes and prerequisites join, and whatever required
    // the next lesson now requires this one.
    merge(id: string) {
      const plan = planOf(id);
      const i = plan.lessons.findIndex((l) => l.id === id);
      const lesson = plan.lessons[i]!;
      const next = plan.lessons[i + 1];
      if (!next) throw new AppError(400, "nothing_to_merge", "This is the last lesson, so there is nothing after it to merge.");
      transaction(db, () => {
        const t = now();
        next.items.forEach((item, k) => {
          db.prepare("INSERT OR IGNORE INTO lesson_items (lesson_id, item_id, ord) VALUES (?, ?, ?)").run(id, item, lesson.items.length + k);
        });
        for (const r of next.requires) if (r !== id) db.prepare("INSERT OR IGNORE INTO lesson_prereqs (lesson_id, requires_id) VALUES (?, ?)").run(id, r);
        db.prepare("INSERT OR IGNORE INTO lesson_prereqs (lesson_id, requires_id) SELECT lesson_id, ? FROM lesson_prereqs WHERE requires_id = ? AND lesson_id != ?").run(id, next.id, id);
        const status = lesson.status === next.status ? lesson.status : "in_progress";
        db.prepare("UPDATE lessons SET minutes = ?, status = ?, updated_at = ? WHERE id = ?").run(lesson.minutes + next.minutes, status, t, id);
        db.prepare("DELETE FROM lessons WHERE id = ?").run(next.id);
        db.prepare("DELETE FROM plan_units WHERE plan_id = ? AND id NOT IN (SELECT unit_id FROM lessons WHERE plan_id = ?)").run(plan.id, plan.id);
        touch(plan.id);
      });
      return get(plan.id);
    },

    // Saves the schedule state and each lesson's planned day (lessons.scheduled_for).
    setSchedule(planId: string, state: ScheduleState, baseline: Record<string, string>) {
      transaction(db, () => {
        db.prepare("UPDATE plans SET schedule = ? WHERE id = ?").run(JSON.stringify(state), planId);
        db.prepare("UPDATE lessons SET scheduled_for = NULL WHERE plan_id = ?").run(planId);
        const update = db.prepare("UPDATE lessons SET scheduled_for = ? WHERE id = ? AND plan_id = ?");
        for (const [id, day] of Object.entries(baseline)) update.run(day, id, planId);
      });
    },
  };
}

export type Plans = ReturnType<typeof createPlans>;
