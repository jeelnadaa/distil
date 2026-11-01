import { describe, expect, it } from "vitest";
import { coverageOf, type DraftLesson, type DraftUnit, MAX_LESSON_ITEMS, reviewBatch, untaught } from "../server/plan/coverage.ts";
import { breakCycles, misplaced, topoOrder } from "../server/plan/dag.ts";
import { addDays, buildSchedule, drift, rebalance, type SchedLesson, weekday } from "../server/plan/schedule.ts";

const req = (entries: Record<string, string[]>) => new Map(Object.entries(entries));

describe("lesson DAG", () => {
  it("orders prerequisites first and keeps the preferred order otherwise", () => {
    expect(topoOrder(["a", "b", "c", "d"], req({ b: ["d"] }))).toEqual({ order: ["a", "c", "d", "b"], cycle: [] });
    expect(topoOrder(["a", "b"], req({ a: ["zz"] })).order).toEqual(["a", "b"]);
  });

  it("reports cycles and breaks them by keeping only backward requirements", () => {
    const requires = req({ a: ["c"], b: ["a"], c: ["b"] });
    expect(topoOrder(["a", "b", "c", "d"], requires)).toEqual({ order: ["d"], cycle: ["a", "b", "c"] });
    const broken = breakCycles(["a", "b", "c"], requires);
    expect(topoOrder(["a", "b", "c"], broken)).toEqual({ order: ["a", "b", "c"], cycle: [] });
  });

  it("finds lessons placed before what they require", () => {
    expect(misplaced(["b", "a"], req({ b: ["a"] }))).toEqual([["b", "a"]]);
    expect(misplaced(["a", "b"], req({ b: ["a"] }))).toEqual([]);
  });
});

const lesson = (key: string, items: string[], extra: Partial<DraftLesson> = {}): DraftLesson =>
  ({ key, title: key, summary: "", minutes: 20, kind: "lesson", weight: 1, aids: [], items, after: [], ...extra });
const unit = (title: string, lessons: DraftLesson[]): DraftUnit => ({ title, summary: "", lessons });
const opts = (items: string[], earlier: string[] = []) => ({ items, earlier: new Set(earlier), projects: false });

describe("reviewBatch (F-304)", () => {
  it("accepts a plan that maps every item", () => {
    const { problems, units } = reviewBatch([unit("U", [lesson("L1", ["i1", "i2"]), lesson("L2", ["i3"], { after: ["L1", "P1"] })])], opts(["i1", "i2", "i3"], ["P1"]));
    expect(problems).toEqual([]);
    expect(units[0]!.lessons.map((l) => l.key)).toEqual(["L1", "L2"]);
  });

  it("names unmapped items and attaches each to its reading-order neighbour's lesson", () => {
    const { problems, units } = reviewBatch([unit("U", [lesson("L1", ["i1"]), lesson("L2", ["i4"])])], opts(["i1", "i2", "i3", "i4"]));
    expect(problems).toEqual(["These items are in no lesson: i2, i3. Put every item in a lesson."]);
    expect(units[0]!.lessons.map((l) => l.items)).toEqual([["i1", "i2", "i3"], ["i4"]]);
  });

  it("drops unknown items and empty lessons, and builds lessons when the reply has none", () => {
    const { problems, units } = reviewBatch([unit("U", [lesson("L1", ["zz"])])], opts(["i1", "i2"]));
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain("zz");
    expect(units.flatMap((u) => u.lessons.flatMap((l) => l.items))).toEqual(["i1", "i2"]);
  });

  it("splits oversized lessons and renames duplicate keys", () => {
    const items = Array.from({ length: MAX_LESSON_ITEMS + 5 }, (_, i) => `i${i}`);
    const { problems, units } = reviewBatch([unit("U", [lesson("L1", items), lesson("L1", ["i0"])])], opts(items));
    expect(problems.some((p) => p.includes("used twice"))).toBe(true);
    expect(problems.some((p) => p.includes("split it"))).toBe(true);
    const sizes = units[0]!.lessons.map((l) => l.items.length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(MAX_LESSON_ITEMS);
    expect(new Set(units[0]!.lessons.map((l) => l.key)).size).toBe(units[0]!.lessons.length);
  });

  it("refuses unknown, forward-unit and cyclic prerequisites and orders each unit", () => {
    const { problems, units } = reviewBatch([
      unit("A", [lesson("L1", ["i1"], { after: ["L2"] }), lesson("L2", ["i2"], { after: ["L1"] }), lesson("L3", ["i3"], { after: ["L4", "nope"] })]),
      unit("B", [lesson("L4", ["i4"])]),
    ], opts(["i1", "i2", "i3", "i4"]));
    expect(problems.some((p) => p.includes("nope"))).toBe(true);
    expect(problems.some((p) => p.includes("later unit"))).toBe(true);
    expect(problems.some((p) => p.includes("cycle"))).toBe(true);
    expect(units[0]!.lessons.map((l) => [l.key, l.after])).toEqual([["L1", []], ["L2", ["L1"]], ["L3", []]]);
  });

  it("allows projects without items only in skill plans and clamps minutes and weight", () => {
    const project = lesson("P", [], { kind: "project", minutes: 999, weight: 7 });
    expect(reviewBatch([unit("U", [lesson("L1", ["i1"]), project])], { ...opts(["i1"]), projects: true }).units[0]!.lessons[1]).toMatchObject({ minutes: 240, weight: 3, kind: "project" });
    expect(reviewBatch([unit("U", [lesson("L1", ["i1"]), project])], opts(["i1"])).problems).toEqual(["Lesson P has no items; every lesson must teach at least one item."]);
  });
});

describe("coverage bars (F-307)", () => {
  const items = [
    { id: "a", mark: null, status: "planned" }, { id: "b", mark: null, status: "taught" },
    { id: "c", mark: null, status: "checked" }, { id: "d", mark: "skip", status: "pending" }, { id: "e", mark: null, status: "pending" },
  ];
  it("counts in-scope items planned, taught and checked, and lists the unmapped", () => {
    expect(coverageOf(items, new Set(["a", "b", "c"]))).toEqual({ total: 4, planned: 3, taught: 2, checked: 1, unmapped: ["e"] });
  });
  it("finds items left untaught in started lessons", () => {
    expect(untaught([{ status: "done", items: ["a", "b"] }, { status: "todo", items: ["e"] }], items)).toEqual(["a"]);
  });
});

const L = (id: string, minutes: number, done: string | null = null): SchedLesson => ({ id, minutes, done });

describe("deadline schedule (F-505)", () => {
  // 2026-11-02 is a Monday.
  const s = { examDate: "2026-11-09", hoursPerDay: 1, daysOff: [0], bufferDays: 2 };

  it("fills study days up to capacity, skips days off and keeps revision and mock days before the exam", () => {
    expect(weekday("2026-11-08")).toBe(0);
    const out = buildSchedule([L("a", 40), L("b", 30), L("c", 60), L("d", 20)], s, "2026-11-02");
    const byDate = Object.fromEntries(out.days.map((d) => [d.date, [d.kind, d.lessons]]));
    expect(byDate).toMatchObject({
      "2026-11-02": ["study", ["a"]], "2026-11-03": ["study", ["b"]], "2026-11-04": ["study", ["c"]], "2026-11-05": ["study", ["d"]],
      "2026-11-06": ["mock", []], "2026-11-07": ["revision", []], "2026-11-08": ["off", []], "2026-11-09": ["exam", []],
    });
    expect(out).toMatchObject({ capacity: 60, overloaded: false, finishes: "2026-11-05" });
  });

  it("raises the daily load when the hours aren't enough, so every lesson still fits", () => {
    const out = buildSchedule(Array.from({ length: 8 }, (_, i) => L(`l${i}`, 60)), s, "2026-11-02");
    expect(out.overloaded).toBe(true);
    expect(out.capacity).toBe(120);
    expect(out.days.filter((d) => d.kind === "study").flatMap((d) => d.lessons)).toHaveLength(8);
  });

  it("re-balances from today: finished lessons sit on their day and the rest move up", () => {
    const lessons = [L("a", 60, "2026-11-02"), L("b", 60), L("c", 60)];
    const out = buildSchedule(lessons, s, "2026-11-04", "2026-11-02");
    expect(out.days.slice(0, 3).map((d) => [d.date, d.lessons])).toEqual([["2026-11-02", ["a"]], ["2026-11-03", []], ["2026-11-04", ["b"]]]);
    expect(out.days[3]!.lessons).toEqual(["c"]);
  });

  it("puts everything on the last day when the exam is today, and stops after it", () => {
    expect(buildSchedule([L("a", 30)], { ...s, examDate: "2026-11-02" }, "2026-11-02").days).toEqual([{ date: "2026-11-02", kind: "exam", lessons: ["a"], minutes: 30 }]);
    expect(buildSchedule([L("a", 30)], s, addDays(s.examDate, 1)).examPassed).toBe(true);
  });

  it("measures drift from the baseline and re-baselines once a day with a note", () => {
    const baseline = { a: "2026-11-02", b: "2026-11-03", c: "2026-11-05" };
    const lessons = [L("a", 60), L("b", 60), L("c", 60, "2026-11-03")];
    expect(drift(baseline, lessons, "2026-11-04")).toEqual({ behind: 2, ahead: 1 });
    const state = { bufferDays: 2, baselineDay: "2026-11-02", note: null };
    const next = rebalance(state, baseline, lessons, s, "2026-11-04");
    expect(next.changed).toBe(true);
    expect(next.state.note).toBe("Re-balanced on 2026-11-04: 2 lessons behind, 1 lesson ahead.");
    expect(next.baseline).toEqual({ a: "2026-11-04", b: "2026-11-05" });
    expect(rebalance(next.state, next.baseline, lessons, s, "2026-11-04").changed).toBe(false);
  });
});
