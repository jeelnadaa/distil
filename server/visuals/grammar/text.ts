// Text-shaped widgets: `steps` (F-704), `compare` (F-705), `timeline` (F-706), `quiz` (F-708),
// `formula` (F-710), and the briefs for built visuals: `app` (F-721) and `figure` (F-725).

import { GrammarError, header, limit, linesOf, type Mark, oneAccent, rejectStyling, requireText, takeMarks, title } from "./common.ts";
import { compile, namesIn } from "./expr.ts";

export type StepsSpec = { kind: "steps"; title?: string; steps: { tex: string; why?: string; mark: Mark }[] };
export type CompareSpec = { kind: "compare"; title?: string; columns: { label: string; mark: Mark }[]; rows: { label: string; cells: { text: string; mark: Mark }[] }[] };
export type TimelineSpec = { kind: "timeline"; title?: string; events: { when: string; what: string; detail?: string; mark: Mark }[] };
export type Question =
  | { type: "choice"; prompt: string; options: { text: string; correct: boolean }[]; why?: string }
  | { type: "order"; prompt: string; items: string[]; why?: string }
  | { type: "match"; prompt: string; pairs: [string, string][]; why?: string }
  | { type: "blank"; prompt: string; answers: string[][]; why?: string };
export type QuizSpec = { kind: "quiz"; title?: string; questions: Question[] };
export type FormulaSymbol = { tex: string; name: string; meaning: string; unit?: string; value?: number; compute?: string };
export type FormulaSpec = { kind: "formula"; title?: string; tex: string; symbols: FormulaSymbol[] };
export type BriefSpec = { kind: "app" | "figure"; title?: string; brief: string };

const cells = (text: string) => text.split("|").map((c) => c.trim());

export function parseSteps(source: string): StepsSpec {
  const { title: name, rest } = title(linesOf(source));
  const steps = rest.map((line) => {
    const { text, mark } = takeMarks(line.text, line.n);
    const [tex, ...why] = cells(text);
    requireText(tex ?? "", "A step", line.n);
    const reason = why.join(" | ");
    return { tex: tex!.replace(/^\$+|\$+$/g, ""), ...(reason ? { why: reason } : {}), mark };
  });
  if (!steps.length) throw new GrammarError("The derivation has no steps.");
  limit(steps.length, 30, "steps");
  return { kind: "steps", ...(name ? { title: name } : {}), steps: oneAccent(steps) };
}

export function parseCompare(source: string): CompareSpec {
  const { title: name, rest } = title(linesOf(source));
  const head = rest[0];
  if (!head?.text.startsWith("|")) throw new GrammarError("Start with the column headers: | A | B", head?.n ?? null);
  const columns = cells(head.text.slice(1)).map((c) => {
    const { text, mark } = takeMarks(c, head.n);
    requireText(text, "A column header", head.n);
    return { label: text, mark };
  });
  const rows = rest.slice(1).map((line) => {
    const [label, ...values] = cells(line.text);
    rejectStyling(label!, line.n);
    if (values.length > columns.length) throw new GrammarError(`This row has ${values.length} cells but there are ${columns.length} columns.`, line.n);
    return {
      label: label!,
      cells: columns.map((_, i) => {
        const { text, mark } = takeMarks(values[i] ?? "", line.n);
        return { text, mark };
      }),
    };
  });
  if (!rows.length) throw new GrammarError("The comparison has no rows.");
  limit(columns.length, 6, "columns");
  limit(rows.length, 30, "rows");
  oneAccent([...columns, ...rows.flatMap((r) => r.cells)]);
  return { kind: "compare", ...(name ? { title: name } : {}), columns, rows };
}

export function parseTimeline(source: string): TimelineSpec {
  const { title: name, rest } = title(linesOf(source));
  const events = rest.map((line) => {
    const { text, mark } = takeMarks(line.text, line.n);
    const [when, what, ...detail] = cells(text);
    if (!what) throw new GrammarError("Write an event as: when | what | detail (optional)", line.n);
    requireText(when!, "The date", line.n);
    const more = detail.join(" | ");
    return { when: when!, what, ...(more ? { detail: more } : {}), mark };
  });
  if (!events.length) throw new GrammarError("The timeline has no events.");
  limit(events.length, 40, "events");
  return { kind: "timeline", ...(name ? { title: name } : {}), events: oneAccent(events) };
}

// Questions start with "q:"; the lines under one decide its type: "- / *" options (choice, * is correct),
// "1." steps in the right order (order), "left -> right" pairs (match), or [[answer]] blanks in the question.
export function parseQuiz(source: string): QuizSpec {
  const { title: name, rest } = title(linesOf(source));
  type Draft = { n: number; prompt: string; options: { text: string; correct: boolean }[]; items: string[]; pairs: [string, string][]; why?: string };
  const drafts: Draft[] = [];
  for (const line of rest) {
    const q = header(line, "q");
    if (q !== null) {
      requireText(q, "The question", line.n);
      rejectStyling(q, line.n);
      drafts.push({ n: line.n, prompt: q, options: [], items: [], pairs: [] });
      continue;
    }
    const current = drafts.at(-1);
    if (!current) throw new GrammarError("Start each question with q: …", line.n);
    rejectStyling(line.text, line.n);
    const why = header(line, "why");
    let m: RegExpMatchArray | null;
    if (why !== null) current.why = why;
    else if ((m = line.text.match(/^([-*])\s+(.+)$/))) current.options.push({ text: m[2]!, correct: m[1] === "*" });
    else if ((m = line.text.match(/^\d+[.)]\s+(.+)$/))) current.items.push(m[1]!);
    else if ((m = line.text.match(/^(.+?)\s+->\s+(.+)$/))) current.pairs.push([m[1]!, m[2]!]);
    else throw new GrammarError(`Expected "- option", "* correct option", "1. step", "left -> right" or "why: …" (got "${line.text.slice(0, 30)}").`, line.n);
  }
  const questions = drafts.map((d): Question => {
    const blanks = [...d.prompt.matchAll(/\[\[(.+?)\]\]/g)].map((m) => m[1]!.split("|").map((a) => a.trim()).filter(Boolean));
    const kinds = [d.options.length > 0, d.items.length > 0, d.pairs.length > 0, blanks.length > 0].filter(Boolean).length;
    if (kinds !== 1) throw new GrammarError("Each question needs exactly one kind of answer: options, numbered steps, pairs or [[blanks]].", d.n);
    const why = d.why ? { why: d.why } : {};
    if (d.options.length) {
      if (d.options.length < 2) throw new GrammarError("A choice question needs at least two options.", d.n);
      if (!d.options.some((o) => o.correct)) throw new GrammarError("Mark the correct option with * instead of -.", d.n);
      return { type: "choice", prompt: d.prompt, options: d.options, ...why };
    }
    if (d.items.length) {
      if (d.items.length < 2) throw new GrammarError("An ordering question needs at least two steps.", d.n);
      return { type: "order", prompt: d.prompt, items: d.items, ...why };
    }
    if (d.pairs.length) {
      if (d.pairs.length < 2) throw new GrammarError("A matching question needs at least two pairs.", d.n);
      return { type: "match", prompt: d.prompt, pairs: d.pairs, ...why };
    }
    if (blanks.some((b) => !b.length)) throw new GrammarError("A blank [[…]] is empty.", d.n);
    return { type: "blank", prompt: d.prompt, answers: blanks, ...why };
  });
  if (!questions.length) throw new GrammarError("The quiz has no questions (start each with q:).");
  limit(questions.length, 12, "questions");
  return { kind: "quiz", ...(name ? { title: name } : {}), questions };
}

// "C_{d}" and "\rho" become the expression names "C_d" and "rho".
export const symbolName = (tex: string) => tex.replace(/[\\{}\s$]/g, "");

export function parseFormula(source: string): FormulaSpec {
  const { title: name, rest } = title(linesOf(source));
  const first = rest[0];
  const tex = first ? header(first, "formula") : null;
  if (!tex) throw new GrammarError("Start with the formula: formula: F = ma", first?.n ?? null);
  const symbols = rest.slice(1).map((line): FormulaSymbol => {
    const [sym, meaning, unit, value] = cells(line.text);
    if (!sym || !meaning) throw new GrammarError("Write a symbol as: symbol | meaning | unit | value (or = expression)", line.n);
    rejectStyling(meaning, line.n);
    const name = symbolName(sym);
    if (!/^[A-Za-z_]\w*$/.test(name)) throw new GrammarError(`"${sym}" can't be used as a name in calculations; use letters, digits and _.`, line.n);
    const base = { tex: sym, name, meaning, ...(unit ? { unit } : {}) };
    if (!value) return base;
    if (value.startsWith("=")) return { ...base, compute: value.slice(1).trim() };
    const n = Number(value);
    if (!Number.isFinite(n)) throw new GrammarError(`"${value}" is not a number.`, line.n);
    return { ...base, value: n };
  });
  if (!symbols.length) throw new GrammarError("List at least one symbol under the formula.");
  limit(symbols.length, 12, "symbols");
  const computed = symbols.filter((s) => s.compute);
  if (computed.length > 1) throw new GrammarError("Only one symbol can be computed (= …).");
  for (const c of computed) {
    const inputs = symbols.filter((s) => s.value !== undefined).map((s) => s.name);
    const missing = namesIn(c.compute!).filter((n) => !inputs.includes(n));
    if (missing.length) throw new GrammarError(`${missing.join(", ")} need a value to compute ${c.tex}.`);
    compile(c.compute!, inputs);
  }
  return { kind: "formula", ...(name ? { title: name } : {}), tex, symbols };
}

export const parseBrief = (kind: BriefSpec["kind"]) => (source: string): BriefSpec => {
  const { title: name, rest } = title(linesOf(source));
  const brief = rest.map((l) => l.text).join("\n");
  if (!brief) throw new GrammarError(`Describe what the ${kind === "app" ? "mini-app" : "figure"} should show.`);
  if (brief.length > 2000) throw new GrammarError("The brief is too long (2000 characters max).");
  return { kind, ...(name ? { title: name } : {}), brief };
};
