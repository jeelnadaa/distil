// `plot` (F-702): functions of x with sliders, derivatives and shaded areas; `chart` (F-703): bar, line
// and scatter charts from data. Series colours come from the data-viz palette, in order or by series=.

import { GrammarError, header, limit, linesOf, type Mark, oneAccent, rejectStyling, range, requireText, takeMarks, title } from "./common.ts";
import { compile, evaluateConst } from "./expr.ts";

export type Slider = { name: string; min: number; max: number; value: number; step: number };
export type Curve = { name: string; expr: string; mark: Mark; derivativeOf?: string };
export type PlotSpec = {
  kind: "plot"; title?: string; x: [number, number]; y?: [number, number]; xLabel?: string; yLabel?: string;
  sliders: Slider[]; curves: Curve[]; areas: { of: string; from: number; to: number }[];
  points: { x: number; y: number; label?: string; mark: Mark }[];
};
export type ChartSpec = {
  kind: "chart"; title?: string; type: "bar" | "line" | "scatter"; xLabel?: string; yLabel?: string;
  series: { name: string; mark: Mark }[]; rows: { key: string; values: (number | null)[] }[];
};

const RESERVED = new Set(["x", "pi", "e", "tau"]);
const constant = (src: string) => evaluateConst(src);

export function parsePlot(source: string): PlotSpec {
  const { title: name, rest } = title(linesOf(source));
  const spec: PlotSpec = { kind: "plot", ...(name ? { title: name } : {}), x: [-5, 5], sliders: [], curves: [], areas: [], points: [] };
  const names = () => spec.sliders.map((s) => s.name);
  const curveNamed = (n: string, line: number) => {
    const c = spec.curves.find((c) => c.name === n);
    if (!c) throw new GrammarError(`No function named ${n} (define it first, e.g. ${n}(x) = …).`, line);
    return c;
  };
  for (const line of rest) {
    try {
      let value: string | null;
      if ((value = header(line, "x")) !== null) {
        const [r, label] = value.split(/\s*\|\s*/);
        spec.x = range(r!, line.n, constant);
        if (label) { rejectStyling(label, line.n); spec.xLabel = label; }
      } else if ((value = header(line, "y")) !== null) {
        const [r, label] = value.split(/\s*\|\s*/);
        if (r && r !== "auto") spec.y = range(r, line.n, constant);
        if (label) { rejectStyling(label, line.n); spec.yLabel = label; }
      } else if (/^slider\s/i.test(line.text)) {
        const m = line.text.match(/^slider\s+([A-Za-z_]\w*)\s*:\s*(.+?)\s*\.\.\s*(.+?)(?:\s*=\s*(.+?))?(?:\s+step\s+(.+))?$/i);
        if (!m) throw new GrammarError("Write a slider as: slider a: 0..2 = 1", line.n);
        if (RESERVED.has(m[1]!) || names().includes(m[1]!)) throw new GrammarError(`"${m[1]}" can't be a slider name here.`, line.n);
        const [min, max] = range(`${m[2]}..${m[3]}`, line.n, constant);
        const v = m[4] !== undefined ? constant(m[4]) : (min + max) / 2;
        const step = m[5] !== undefined ? constant(m[5]) : (max - min) / 100;
        if (!(v >= min && v <= max)) throw new GrammarError(`The slider's start value ${m[4]} is outside ${m[2]}..${m[3]}.`, line.n);
        if (!(step > 0)) throw new GrammarError("A slider step must be positive.", line.n);
        spec.sliders.push({ name: m[1]!, min, max, value: v, step });
      } else if (/^derivative\s/i.test(line.text)) {
        const { text, mark } = takeMarks(line.text.replace(/^derivative\s+/i, ""), line.n);
        const of = curveNamed(text.trim(), line.n);
        spec.curves.push({ name: `${of.name}'`, expr: of.expr, derivativeOf: of.name, mark });
      } else if (/^area\s/i.test(line.text)) {
        const m = line.text.match(/^area\s+(\w+)\s*:\s*(.+)$/i);
        if (!m) throw new GrammarError("Write an area as: area f: 0..1", line.n);
        curveNamed(m[1]!, line.n);
        const [from, to] = range(m[2]!, line.n, constant);
        spec.areas.push({ of: m[1]!, from, to });
      } else if (/^point\s/i.test(line.text)) {
        const { text, mark } = takeMarks(line.text.replace(/^point\s+/i, ""), line.n);
        const m = text.match(/^\(\s*(.+?)\s*,\s*(.+?)\s*\)\s*(.*)$/);
        if (!m) throw new GrammarError("Write a point as: point (1, 2) label", line.n);
        spec.points.push({ x: constant(m[1]!), y: constant(m[2]!), ...(m[3] ? { label: m[3] } : {}), mark });
      } else {
        const { text, mark } = takeMarks(line.text, line.n);
        const m = text.match(/^(?:([A-Za-z_]\w*)\s*\(\s*x\s*\)|y)\s*=\s*(.+)$/);
        if (!m) throw new GrammarError(`Expected f(x) = …, slider, derivative, area, point, x: or y: (got "${line.text.slice(0, 30)}").`, line.n);
        const curveName = m[1] ?? `y${spec.curves.length + 1}`;
        if (spec.curves.some((c) => c.name === curveName)) throw new GrammarError(`${curveName} is defined twice.`, line.n);
        compile(m[2]!, ["x", ...names()]);
        spec.curves.push({ name: curveName, expr: m[2]!, mark });
      }
    } catch (err) {
      if (err instanceof GrammarError && err.line === null) throw new GrammarError(err.message, line.n);
      throw err;
    }
  }
  if (!spec.curves.length && !spec.points.length) throw new GrammarError("The plot has nothing to draw: add a line like f(x) = x^2.");
  limit(spec.curves.length, 6, "curves");
  limit(spec.sliders.length, 6, "sliders");
  limit(spec.points.length, 40, "points");
  oneAccent([...spec.curves, ...spec.points]);
  return spec;
}

export function parseChart(source: string): ChartSpec {
  const { title: name, rest } = title(linesOf(source));
  const spec: ChartSpec = { kind: "chart", ...(name ? { title: name } : {}), type: "bar", series: [], rows: [] };
  for (const line of rest) {
    let value: string | null;
    if ((value = header(line, "type")) !== null) {
      if (value !== "bar" && value !== "line" && value !== "scatter") throw new GrammarError(`type must be bar, line or scatter (not "${value}").`, line.n);
      spec.type = value;
    } else if ((value = header(line, "x")) !== null) {
      rejectStyling(value, line.n);
      spec.xLabel = value;
    } else if ((value = header(line, "y")) !== null) {
      rejectStyling(value, line.n);
      spec.yLabel = value;
    } else if ((value = header(line, "series")) !== null) {
      spec.series = value.split(",").map((s) => {
        const { text, mark } = takeMarks(s.trim(), line.n);
        requireText(text, "A series name", line.n);
        return { name: text, mark };
      });
    } else {
      const m = line.text.match(/^(.+?)\s*:\s*(.+)$/);
      if (!m) throw new GrammarError(`Expected a data row like "Jan: 3, 4" (got "${line.text.slice(0, 30)}").`, line.n);
      rejectStyling(m[1]!, line.n);
      const values = m[2]!.split(",").map((v) => {
        const t = v.trim();
        if (t === "-" || t === "") return null;
        const n = Number(t.replace(/_/g, ""));
        if (!Number.isFinite(n)) throw new GrammarError(`"${t}" is not a number (use - for a missing value).`, line.n);
        return n;
      });
      spec.rows.push({ key: m[1]!, values });
    }
  }
  if (!spec.rows.length) throw new GrammarError("The chart has no data rows.");
  const width = Math.max(...spec.rows.map((r) => r.values.length));
  if (!spec.series.length) spec.series = Array.from({ length: width }, (_, i) => ({ name: width === 1 ? spec.yLabel ?? "Value" : `Series ${i + 1}`, mark: {} }));
  if (width > spec.series.length) throw new GrammarError(`A row has ${width} values but there are ${spec.series.length} series.`);
  if (spec.type === "scatter" && spec.rows.some((r) => !Number.isFinite(Number(r.key)))) {
    throw new GrammarError("A scatter chart needs a number before each colon (the x value).");
  }
  limit(spec.series.length, 6, "series");
  limit(spec.rows.length, 200, "rows");
  oneAccent(spec.series);
  return spec;
}
