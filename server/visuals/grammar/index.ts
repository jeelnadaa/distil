// The widget grammars (F-751): fenced-block languages, their parsers, and one sample each. The samples
// are the prompt's examples (reference.ts) and the fidelity tests' corpus, so the two can't drift apart.

import { GrammarError } from "./common.ts";
import { type FlowSpec, type MapSpec, parseFlow, parseMap } from "./flow.ts";
import { type ChartSpec, parseChart, parsePlot, type PlotSpec } from "./plot.ts";
import {
  type BriefSpec, type CompareSpec, type FormulaSpec, parseBrief, parseCompare, parseFormula, parseQuiz, parseSteps, parseTimeline,
  type QuizSpec, type StepsSpec, type TimelineSpec,
} from "./text.ts";

export type WidgetSpec = FlowSpec | MapSpec | PlotSpec | ChartSpec | StepsSpec | CompareSpec | TimelineSpec | QuizSpec | FormulaSpec | BriefSpec;

const PARSERS = {
  flow: parseFlow, plot: parsePlot, chart: parseChart, steps: parseSteps, compare: parseCompare, timeline: parseTimeline,
  quiz: parseQuiz, formula: parseFormula, map: parseMap, app: parseBrief("app"), figure: parseBrief("figure"),
} satisfies Record<string, (source: string) => WidgetSpec>;

export type GrammarLang = keyof typeof PARSERS;
export const GRAMMAR_LANGS = Object.keys(PARSERS) as GrammarLang[];
export const isGrammar = (lang: string): lang is GrammarLang => Object.hasOwn(PARSERS, lang);

export type ParseResult = { ok: true; spec: WidgetSpec } | { ok: false; error: string };

export function parseWidget(lang: GrammarLang, source: string): ParseResult {
  if (source.length > 8000) return { ok: false, error: "The block is too long (8000 characters max)." };
  try {
    return { ok: true, spec: PARSERS[lang](source) };
  } catch (err) {
    if (err instanceof GrammarError) return { ok: false, error: err.message };
    throw err;
  }
}

export const SAMPLES: Record<Exclude<GrammarLang, "app" | "figure">, string> = {
  flow: `sig[Signal] -> smp[Sampler]: fs
smp -> q{Aliasing?}
q -yes-> fix[Raise fs]!
q -no-> ok(Done) tone=good`,
  plot: `x: -3..3
slider k: 0..2 = 1
f(x) = k*x^2 - 1 !
derivative f
area f: 0..1`,
  chart: `type: bar
series: 2023, 2024 !
Q1: 3, 4
Q2: 5, 2`,
  steps: `(a+b)^2 = (a+b)(a+b) | Definition of a square
= a^2 + 2ab + b^2 | Expand and collect ! `,
  compare: `| TCP | UDP
Delivery | Guaranteed tone=good | Best effort tone=warn
Speed | Slower | Faster`,
  timeline: `1687 | Principia | Newton's laws
1905 | Special relativity !`,
  quiz: `q: Which is prime?
- 9
* 7
why: 7 has no divisors but 1 and 7.
q: Match each to its role
Mitochondria -> Energy
Ribosome -> Protein
q: The derivative of $x^2$ is [[2x]].`,
  formula: `formula: F = ma
m | mass | kg | 2
a | acceleration | m/s^2 | 3
F | force | N | = m*a`,
  map: `Force -causes-> Acceleration
Mass -resists-> Acceleration !`,
};
