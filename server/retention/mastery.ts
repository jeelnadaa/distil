import { PASS } from "../learning/learner.ts";
import { type CardState, retrievability } from "./fsrs.ts";

// Mastery per item (F-911): how well the learner knows it now, from the evidence (checks, practice, exams,
// card reviews) and how long ago it was last recalled. Recent answers count more, help counts half, one
// answer alone can't make an item solid, and an item not recalled for a while slips back.

export const LEVELS = ["new", "shaky", "solid", "mastered"] as const;
export type Level = (typeof LEVELS)[number];
export type Evidence = { kind: string; score: number | null; withHelp: number | boolean; at: number };
export type Mastery = { value: number; level: Level };

const DAY = 86_400_000;
const WEIGHT: Record<string, number> = { check: 1, practice: 1, exam: 1.2, review: 0.8, probe: 0.5 };
const RECENCY_DAYS = 60;
export const SOLID = 0.5;
export const MASTERED = 0.85;

export function masteryOf(events: Evidence[], card: CardState | null, taught: boolean, now: number): Mastery {
  let sum = 0, weights = 0, raw = 0, successes = 0;
  let lastSuccess: number | null = null;
  for (const e of events) {
    const base = WEIGHT[e.kind];
    if (base === undefined || e.score === null) continue;
    const w = base * (e.withHelp ? 0.5 : 1);
    const recent = w * Math.exp(-Math.max(0, now - e.at) / DAY / RECENCY_DAYS);
    sum += recent * e.score;
    weights += recent;
    raw += w;
    if (e.score >= PASS && !e.withHelp) { successes++; lastSuccess = Math.max(lastSuccess ?? 0, e.at); }
  }
  if (!weights) return { value: 0, level: taught || events.length ? "shaky" : "new" };
  const confidence = 1 - Math.exp(-raw / 2);
  // Forgetting: the card's own memory model when it has one, else a stability that grows with each success.
  const r = card && card.stability > 0 && card.last !== null
    ? retrievability((now - card.last) / DAY, card.stability)
    : lastSuccess !== null ? retrievability((now - lastSuccess) / DAY, Math.min(60, 3 * 2 ** (successes - 1))) : 1;
  const value = Math.round((sum / weights) * confidence * (0.5 + 0.5 * r) * 100) / 100;
  return { value, level: value >= MASTERED ? "mastered" : value >= SOLID ? "solid" : "shaky" };
}
