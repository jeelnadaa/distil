// Spaced repetition (F-902): FSRS-5 with its published default weights. A card's memory has a stability
// (days until recall falls to 90 %) and a difficulty (1–10). New and forgotten cards go through short
// learning steps in minutes; after that each review schedules the day recall is expected to hit the target.

export type Grade = 1 | 2 | 3 | 4; // again, hard, good, easy
export type CardPhase = "new" | "learning" | "review" | "relearning";
export type CardState = {
  phase: CardPhase; stability: number; difficulty: number; reps: number; lapses: number;
  // When it was first and last reviewed (ms), and the learning step it's on.
  seen: number | null; last: number | null; step: number;
};

const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const DECAY = -0.5;
const FACTOR = 19 / 81;
export const RETENTION = 0.9;
const MAX_DAYS = 36500;
const DAY = 86_400_000;
const MINUTE = 60_000;
// Learning steps for new cards, and the one relearning step after a lapse.
const LEARNING = [1, 10];
const RELEARNING = [10];

export const NEW_CARD: CardState = { phase: "new", stability: 0, difficulty: 0, reps: 0, lapses: 0, seen: null, last: null, step: 0 };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// Probability of recall after `days` with stability `s`.
export const retrievability = (days: number, s: number) => (s > 0 ? (1 + (FACTOR * Math.max(0, days)) / s) ** DECAY : 0);
const interval = (s: number) => clamp(Math.round((s / FACTOR) * (RETENTION ** (1 / DECAY) - 1)), 1, MAX_DAYS);

const initStability = (g: Grade) => Math.max(W[g - 1]!, 0.1);
const initDifficulty = (g: Grade) => clamp(W[4]! - Math.exp(W[5]! * (g - 1)) + 1, 1, 10);
function nextDifficulty(d: number, g: Grade) {
  const delta = -W[6]! * (g - 3);
  const damped = d + (delta * (10 - d)) / 9;
  return clamp(W[7]! * initDifficulty(4) + (1 - W[7]!) * damped, 1, 10);
}
function recallStability(d: number, s: number, r: number, g: Grade) {
  const hard = g === 2 ? W[15]! : 1;
  const easy = g === 4 ? W[16]! : 1;
  return s * (Math.exp(W[8]!) * (11 - d) * s ** -W[9]! * (Math.exp(W[10]! * (1 - r)) - 1) * hard * easy + 1);
}
const forgetStability = (d: number, s: number, r: number) =>
  Math.min(s, W[11]! * d ** -W[12]! * ((s + 1) ** W[13]! - 1) * Math.exp(W[14]! * (1 - r)));
// A second review on the same day moves stability only a little.
const sameDayStability = (s: number, g: Grade) => s * Math.exp(W[17]! * (g - 3 + W[18]!));

// The card after a review at `now`, and when it's next due.
export function review(card: CardState, grade: Grade, now: number): { state: CardState; due: number } {
  const days = card.last === null ? 0 : (now - card.last) / DAY;
  const r = retrievability(days, card.stability);
  let { stability: s, difficulty: d, phase, step, lapses } = card;

  if (phase === "new") {
    s = initStability(grade);
    d = initDifficulty(grade);
  } else {
    d = nextDifficulty(d, grade);
    s = days < 1 ? sameDayStability(s, grade) : grade === 1 ? forgetStability(card.difficulty, s, r) : recallStability(card.difficulty, s, r, grade);
  }
  s = clamp(s, 0.1, MAX_DAYS);

  let due: number;
  if (phase === "review" && grade === 1) {
    phase = "relearning";
    step = 0;
    lapses++;
    due = now + RELEARNING[0]! * MINUTE;
  } else if (phase === "review") {
    due = now + interval(s) * DAY;
  } else {
    // New, learning or relearning: Again restarts the steps, Hard repeats this one, Good moves on, Easy graduates.
    const steps = phase === "relearning" ? RELEARNING : LEARNING;
    const at = phase === "new" ? 0 : step;
    const next = grade === 1 ? 0 : grade === 2 ? at : grade === 3 ? at + 1 : steps.length;
    if (next >= steps.length) {
      phase = "review";
      step = 0;
      due = now + interval(s) * DAY;
    } else {
      phase = phase === "new" ? "learning" : phase;
      step = next;
      const minutes = grade === 2 && next === 0 ? (steps[0]! + (steps[1] ?? steps[0]! * 2)) / 2 : steps[next]!;
      due = now + minutes * MINUTE;
    }
  }
  return { state: { phase, stability: s, difficulty: d, reps: card.reps + 1, lapses, seen: card.seen ?? now, last: now, step }, due };
}

// When each grade would bring the card back, for the grade buttons' hints.
export const preview = (card: CardState, now: number) =>
  ([1, 2, 3, 4] as Grade[]).map((g) => review(card, g, now).due - now);

// Reads a stored state; anything missing or malformed is a new card.
export function parseState(raw: string | null | undefined): CardState {
  try {
    const s = JSON.parse(raw ?? "{}") as Partial<CardState>;
    return s.phase ? { ...NEW_CARD, ...s } : NEW_CARD;
  } catch {
    return NEW_CARD;
  }
}
