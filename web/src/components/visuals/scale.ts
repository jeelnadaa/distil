import type { Mark } from "../../../../server/visuals/grammar/common.ts";

// Axis maths and colours shared by plots and charts (DESIGN.md §8.1).

// Round tick values that cover [lo, hi] in about `count` steps.
export function ticks(lo: number, hi: number, count = 6): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

// Short labels: 1200 → 1.2k, 0.000012 → 1.2e-5.
export function fmt(v: number): string {
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 1e6 || a < 1e-3) return v.toExponential(1).replace("e+", "e");
  if (a >= 1e4) return `${+(v / 1000).toFixed(1)}k`;
  return String(+v.toPrecision(4));
}

export const linear = (d0: number, d1: number, r0: number, r1: number) => (v: number) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);

// Series colours: an explicit series= slot, the accent for the one emphasised series, else the data-viz
// palette in order with copper (slot 2, the accent's hue) left for last.
const ORDER = [1, 3, 4, 5, 6, 2];
export function seriesColor(mark: Mark, index: number): string {
  if (mark.emphasis) return "var(--accent)";
  if (mark.tone) return `var(--${mark.tone === "good" ? "success" : mark.tone === "warn" ? "warning" : "danger"})`;
  if (mark.muted) return "var(--text-faint)";
  return `var(--viz-${mark.series ?? ORDER[index % ORDER.length]})`;
}
