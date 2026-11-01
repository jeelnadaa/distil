import { describe, expect, it } from "vitest";
import { compile, evaluateConst } from "../server/visuals/grammar/expr.ts";
import { GRAMMAR_LANGS, parseWidget, SAMPLES, type GrammarLang } from "../server/visuals/grammar/index.ts";
import { widgetPromptReference } from "../server/visuals/reference.ts";
import { estimateTokens } from "../server/usage.ts";

const parse = (lang: GrammarLang, source: string) => {
  const result = parseWidget(lang, source);
  if (!result.ok) throw new Error(result.error);
  return result.spec as never;
};
const error = (lang: GrammarLang, source: string) => {
  const result = parseWidget(lang, source);
  if (result.ok) throw new Error(`expected ${lang} to fail`);
  return result.error;
};

describe("expressions", () => {
  it("follows maths precedence, implicit multiplication and functions", () => {
    expect(evaluateConst("2+3*4^2")).toBe(50);
    expect(evaluateConst("-2^2")).toBe(-4);
    expect(evaluateConst("2^3^2")).toBe(512);
    expect(evaluateConst("2pi")).toBeCloseTo(2 * Math.PI);
    expect(evaluateConst("3(1+1)")).toBe(6);
    expect(evaluateConst("sqrt(16) + max(1, 5, 2)")).toBe(9);
    expect(compile("a x^2 + 1", ["x", "a"])({ x: 3, a: 2 })).toBe(19);
  });

  it("refuses unknown names and anything that isn't maths", () => {
    expect(() => compile("alert(1)", ["x"])).toThrow(/Unknown name "alert"/);
    expect(() => compile("x.constructor", ["x"])).toThrow();
    expect(() => compile("sin x", ["x"])).toThrow(/needs brackets/);
    expect(() => compile("(1 + 2", [])).toThrow(/Expected "\)"/);
  });
});

describe("grammars", () => {
  it("parses every sample", () => {
    for (const lang of Object.keys(SAMPLES) as (keyof typeof SAMPLES)[]) expect(parseWidget(lang, SAMPLES[lang]).ok, lang).toBe(true);
    expect(GRAMMAR_LANGS).toContain("app");
  });

  it("flow: shapes, labelled and muted edges, chains and one accent", () => {
    const spec = parse("flow", "title: Loop\na[Start] -> b{Ok?} -yes-> c(End)! tone=good\nb ~> a: retry\nd[Extra]!");
    expect(spec).toMatchObject({ title: "Loop", dir: "TB" });
    const { nodes, edges } = spec as { nodes: { id: string; shape: string; mark: object }[]; edges: object[] };
    expect(nodes.map((n) => [n.id, n.shape])).toEqual([["a", "box"], ["b", "decision"], ["c", "round"], ["d", "box"]]);
    expect(nodes[2]!.mark).toEqual({ emphasis: true, tone: "good" });
    expect(nodes[3]!.mark).toEqual({});
    expect(edges).toEqual([
      { from: "a", to: "b", mark: {} }, { from: "b", to: "c", label: "yes", mark: {} }, { from: "b", to: "a", label: "retry", mark: { muted: true } },
    ]);
  });

  it("flow: reports the line of a mistake", () => {
    expect(error("flow", "a -> b\nb => c")).toMatch(/^Line 2: Expected an arrow/);
    expect(error("flow", "a[One]\na[Two]")).toMatch(/labelled twice/);
    expect(error("flow", "dir: diagonal")).toMatch(/dir must be TB/);
  });

  it("plot: sliders, derivatives, areas and points", () => {
    const spec = parse("plot", "x: -2pi..2pi | t\nslider a: 0..2 = 0.5 step 0.1\nf(x) = sin(a x)\nderivative f\narea f: 0..1\npoint (0, 0) origin !");
    expect(spec).toMatchObject({ x: [-2 * Math.PI, 2 * Math.PI], xLabel: "t", sliders: [{ name: "a", min: 0, max: 2, value: 0.5, step: 0.1 }] });
    expect((spec as { curves: unknown[] }).curves).toEqual([
      { name: "f", expr: "sin(a x)", mark: {} }, { name: "f'", expr: "sin(a x)", derivativeOf: "f", mark: {} },
    ]);
    expect(error("plot", "f(x) = b*x")).toMatch(/Line 1: Unknown name "b"/);
    expect(error("plot", "slider a: 0..1 = 5\nf(x)=a")).toMatch(/outside/);
    expect(error("plot", "area g: 0..1")).toMatch(/No function named g/);
  });

  it("chart: series, missing values and scatter keys", () => {
    const spec = parse("chart", "type: line\ny: mm\nseries: A, B ~\nJan: 1, -\nFeb: 2, 3");
    expect(spec).toMatchObject({ type: "line", yLabel: "mm", series: [{ name: "A", mark: {} }, { name: "B", mark: { muted: true } }] });
    expect((spec as { rows: unknown }).rows).toEqual([{ key: "Jan", values: [1, null] }, { key: "Feb", values: [2, 3] }]);
    expect(parse("chart", "a: 1\nb: 2")).toMatchObject({ series: [{ name: "Value" }] });
    expect(error("chart", "type: scatter\nJan: 1")).toMatch(/scatter chart needs a number/);
    expect(error("chart", "series: A\nJan: 1, 2")).toMatch(/2 values but there are 1 series/);
    expect(error("chart", "Jan: lots")).toMatch(/not a number/);
  });

  it("steps, compare and timeline", () => {
    expect(parse("steps", "$x = 1$ | given\nx + 1 = 2 ! ")).toMatchObject({ steps: [{ tex: "x = 1", why: "given" }, { tex: "x + 1 = 2", mark: { emphasis: true } }] });
    const cmp = parse("compare", "| A | B!\nSpeed | fast tone=good | slow tone=bad\nCost | low");
    expect(cmp).toMatchObject({ columns: [{ label: "A" }, { label: "B!", mark: {} }] });
    expect(parse("compare", "| A | B !\nx | 1 | 2")).toMatchObject({ columns: [{ label: "A" }, { label: "B", mark: { emphasis: true } }] });
    expect((cmp as { rows: { cells: unknown[] }[] }).rows[1]!.cells).toEqual([{ text: "low", mark: {} }, { text: "", mark: {} }]);
    expect(error("compare", "A | B")).toMatch(/column headers/);
    expect(parse("timeline", "1905 | Relativity | Einstein")).toMatchObject({ events: [{ when: "1905", what: "Relativity", detail: "Einstein" }] });
    expect(error("timeline", "1905")).toMatch(/when \| what/);
  });

  it("quiz: infers each question's type", () => {
    const spec = parse("quiz", "q: Pick\n- a\n* b\nq: Order\n1. one\n2. two\nq: Match\nx -> 1\ny -> 2\nq: Fill [[2x|2*x]] and [[c]]");
    expect((spec as { questions: { type: string }[] }).questions.map((q) => q.type)).toEqual(["choice", "order", "match", "blank"]);
    expect((spec as { questions: { answers?: unknown }[] }).questions[3]!.answers).toEqual([["2x", "2*x"], ["c"]]);
    expect(error("quiz", "q: Pick\n- a\n- b")).toMatch(/Mark the correct option/);
    expect(error("quiz", "q: Mixed\n- a\n* b\n1. c\n2. d")).toMatch(/exactly one kind/);
    expect(error("quiz", "- a")).toMatch(/Start each question/);
  });

  it("formula: symbols, units and one computed value", () => {
    const spec = parse("formula", "formula: v = \\sqrt{2gh}\ng | gravity | m/s^2 | 9.81\nh | height | m | 5\nv | speed | m/s | = sqrt(2 g h)");
    expect((spec as { symbols: unknown[] }).symbols).toEqual([
      { tex: "g", name: "g", meaning: "gravity", unit: "m/s^2", value: 9.81 },
      { tex: "h", name: "h", meaning: "height", unit: "m", value: 5 },
      { tex: "v", name: "v", meaning: "speed", unit: "m/s", compute: "sqrt(2 g h)" },
    ]);
    expect(parse("formula", "formula: x\n\\rho | density | kg/m^3 | 1.2\nC_{d} | drag | | 1")).toMatchObject({ symbols: [{ name: "rho" }, { name: "C_d" }] });
    expect(error("formula", "formula: F = ma\nm | mass | kg\nF | force | N | = m*a")).toMatch(/m, a need a value/);
  });

  it("concept maps and briefs", () => {
    const spec = parse("map", "Force -causes-> Acceleration\nmass -resists-> acceleration !");
    expect(spec).toMatchObject({ nodes: [{ label: "Force" }, { label: "Acceleration", mark: { emphasis: true } }, { label: "mass" }] });
    expect((spec as { edges: unknown[] }).edges).toHaveLength(2);
    expect(parse("app", "title: Pendulum\nSwing a pendulum; change its length.")).toEqual({ kind: "app", title: "Pendulum", brief: "Swing a pendulum; change its length." });
    expect(error("figure", "title: Empty")).toMatch(/Describe what the figure/);
  });
});

describe("semantic styling only (F-752)", () => {
  const hostile: [GrammarLang, string][] = [
    ["flow", "a[Red] -> b color=red"],
    ["flow", "a[<span style='color:red'>x</span>]"],
    ["flow", "a[#ff0000 box]"],
    ["plot", "f(x) = x fill=#f00"],
    ["chart", "series: A colour=blue\nx: 1"],
    ["steps", "x | why font-size=20px"],
    ["compare", "| A | B\nx | rgb(255,0,0) | y"],
    ["timeline", "1905 | Relativity | background: yellow"],
    ["map", "A -to-> B style=bold"],
    ["flow", "a[A] tone=pink"],
    ["chart", "series: A series=9\nx: 1"],
    ["flow", "a[A] size=12"],
  ];
  it.each(hostile)("refuses %s: %s", (lang, source) => {
    expect(error(lang, source)).toMatch(/Styling is not allowed|HTML tags|tone must|series must/);
  });

  it("leaves ordinary text with # and = alone", () => {
    expect(parseWidget("timeline", "2001 | Issue #123 fixed").ok).toBe(true);
    expect(parseWidget("steps", "a = b | given").ok).toBe(true);
  });
});

describe("prompt reference (F-757)", () => {
  it("is empty for Text-only and about 400 tokens otherwise", () => {
    expect(widgetPromptReference("text")).toBe("");
    const balanced = widgetPromptReference("balanced");
    expect(estimateTokens(balanced)).toBeLessThan(500);
    expect(balanced).toContain("```flow");
    expect(widgetPromptReference("visual")).not.toEqual(balanced);
  });

  it("is identical across calls, so it can sit in a cached prefix", () => {
    expect(widgetPromptReference("balanced")).toBe(widgetPromptReference("balanced"));
  });
});
