// Deadline mode (F-505): the plan's lessons laid out day by day up to the exam. The schedule is computed
// afresh from today every time, so it re-balances by itself when the learner falls behind or gets ahead;
// the last baseline (each lesson's planned day) is kept to say how far things moved.

export type ScheduleSettings = { examDate: string; hoursPerDay: number; daysOff: number[]; bufferDays: number };
// done: the day the lesson was finished, or null while it's still to do.
export type SchedLesson = { id: string; minutes: number; done: string | null };
export type DayKind = "study" | "off" | "mock" | "revision" | "exam";
export type Day = { date: string; kind: DayKind; lessons: string[]; minutes: number };
export type Schedule = {
  days: Day[];
  // Minutes a study day holds: the learner's hours, or more when that isn't enough to finish in time.
  capacity: number; overloaded: boolean; finishes: string | null; examPassed: boolean;
};

const DAY_MS = 86_400_000;
const toMs = (date: string) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
export const addDays = (date: string, n: number) => new Date(toMs(date) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((toMs(to) - toMs(from)) / DAY_MS);
// 0 = Sunday … 6 = Saturday, as in Date.getDay().
export const weekday = (date: string) => new Date(toMs(date)).getUTCDay();
export const localDate = (at = new Date()) =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;

// from: the first day to show; days before today list the lessons finished on them.
export function buildSchedule(lessons: SchedLesson[], s: ScheduleSettings, today: string, from = today): Schedule {
  const cap = Math.round(s.hoursPerDay * 60);
  const days: Day[] = [];
  const doneOn = (date: string) => lessons.filter((l) => l.done === date);
  for (let d = from; d < today && d < s.examDate; d = addDays(d, 1)) {
    const done = doneOn(d);
    days.push({ date: d, kind: s.daysOff.includes(weekday(d)) && !done.length ? "off" : "study", lessons: done.map((l) => l.id), minutes: done.reduce((n, l) => n + l.minutes, 0) });
  }
  if (today > s.examDate) return { days, capacity: cap, overloaded: false, finishes: null, examPassed: true };

  const future: Day[] = [];
  for (let d = today; d < s.examDate; d = addDays(d, 1)) {
    const done = d === today ? doneOn(d) : [];
    future.push({ date: d, kind: s.daysOff.includes(weekday(d)) ? "off" : "study", lessons: done.map((l) => l.id), minutes: done.reduce((n, l) => n + l.minutes, 0) });
  }
  // The last study days before the exam are kept free for revision and a mock exam, but at least one day stays for learning.
  const study = future.filter((d) => d.kind === "study");
  const buffer = Math.min(Math.max(0, s.bufferDays), Math.max(0, study.length - 1));
  study.slice(study.length - buffer).reverse().forEach((d, i) => { d.kind = i % 2 ? "mock" : "revision"; });
  const learn = study.slice(0, study.length - buffer);
  // No day to learn on (every day before the exam is off, or the exam is today): the first day takes the rest.
  const exam: Day = { date: s.examDate, kind: "exam", lessons: [], minutes: 0 };
  if (!learn.length) {
    const first = future[0] ?? exam;
    if (first.kind === "off") first.kind = "study";
    learn.push(first);
  }

  const remaining = lessons.filter((l) => !l.done);
  const total = remaining.reduce((n, l) => n + l.minutes, 0) + learn.reduce((n, d) => n + d.minutes, 0);
  const capacity = Math.max(cap, Math.ceil(total / learn.length));
  let i = 0;
  for (const lesson of remaining) {
    // A lesson goes on the first day with room for it (10 % slack), an empty day, or the last day.
    while (i < learn.length - 1 && learn[i]!.minutes > 0 && learn[i]!.minutes + lesson.minutes > capacity * 1.1) i++;
    learn[i]!.lessons.push(lesson.id);
    learn[i]!.minutes += lesson.minutes;
  }
  days.push(...future, exam);
  const finishes = [...learn].reverse().find((d) => d.lessons.some((id) => remaining.some((l) => l.id === id)))?.date ?? null;
  return { days, capacity, overloaded: capacity > cap, finishes, examPassed: false };
}

// The day each remaining lesson is planned for.
export const plannedDays = (schedule: Schedule, today: string): Record<string, string> =>
  Object.fromEntries(schedule.days.filter((d) => d.date >= today).flatMap((d) => d.lessons.map((id) => [id, d.date])));

// How far the learner is from the baseline: lessons due before today and not done, and lessons done
// although they were planned for a later day.
export function drift(baseline: Record<string, string>, lessons: SchedLesson[], today: string) {
  let behind = 0;
  let ahead = 0;
  for (const l of lessons) {
    const planned = baseline[l.id];
    if (!planned) continue;
    if (!l.done && planned < today) behind++;
    if (l.done && planned > l.done) ahead++;
  }
  return { behind, ahead };
}

export type ScheduleState = { bufferDays: number; baselineDay: string | null; note: string | null };

// Once a day the schedule is re-laid from today. When the learner drifted from the old baseline, the new
// one is kept with a note saying what moved; otherwise the old note stays.
export function rebalance(state: ScheduleState, baseline: Record<string, string>, lessons: SchedLesson[], s: ScheduleSettings, today: string) {
  const schedule = buildSchedule(lessons, s, today);
  if (state.baselineDay === today) return { schedule, state, baseline, changed: false };
  const { behind, ahead } = drift(baseline, lessons, today);
  const parts = [behind && `${behind} ${behind === 1 ? "lesson" : "lessons"} behind`, ahead && `${ahead} ${ahead === 1 ? "lesson" : "lessons"} ahead`].filter(Boolean);
  const note = state.baselineDay && parts.length ? `Re-balanced on ${today}: ${parts.join(", ")}.` : state.note;
  return { schedule, state: { ...state, baselineDay: today, note }, baseline: plannedDays(schedule, today), changed: true };
}
