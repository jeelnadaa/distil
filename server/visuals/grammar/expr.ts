// A small, safe expression language for plots and formula explorers: numbers, + - * / ^, implicit
// multiplication (2x, 3(x+1)), named variables, and a fixed set of maths functions. Never uses eval.

import { GrammarError } from "./common.ts";

export type Env = Record<string, number>;
export type Compiled = (env: Env) => number;

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, ln: Math.log, log: Math.log10, log2: Math.log2,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
  min: Math.min, max: Math.max, pow: Math.pow, hypot: Math.hypot, mod: (a, b) => ((a % b) + b) % b,
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };

type Token = { kind: "num"; value: number } | { kind: "id"; name: string } | { kind: "op"; op: string };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const re = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(\*\*|[-+*/^(),·×π]))/y;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new GrammarError(`Can't read "${src.slice(pos).trim().slice(0, 12)}" in ${src}.`);
    pos = re.lastIndex;
    if (m[1] !== undefined) tokens.push({ kind: "num", value: Number(m[1]) });
    else if (m[2] !== undefined) tokens.push({ kind: "id", name: m[2] });
    else if (m[3] === "π") tokens.push({ kind: "id", name: "pi" });
    else tokens.push({ kind: "op", op: m[3] === "**" ? "^" : m[3] === "·" || m[3] === "×" ? "*" : m[3]! });
  }
  return tokens;
}

export function compile(src: string, variables: readonly string[]): Compiled {
  if (src.length > 300) throw new GrammarError("Expression is too long (300 characters max).");
  const tokens = tokenize(src);
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (op: string) => { const t = peek(); return t?.kind === "op" && t.op === op; };
  const expect = (op: string) => {
    if (!isOp(op)) throw new GrammarError(`Expected "${op}" in ${src}.`);
    i++;
  };

  const expr = (): Compiled => {
    let left = term();
    while (isOp("+") || isOp("-")) {
      const op = (tokens[i++] as { op: string }).op;
      const a = left, b = term();
      left = op === "+" ? (env) => a(env) + b(env) : (env) => a(env) - b(env);
    }
    return left;
  };
  const term = (): Compiled => {
    let left = unary();
    for (;;) {
      const t = peek();
      if (isOp("*") || isOp("/")) {
        const op = (tokens[i++] as { op: string }).op;
        const a = left, b = unary();
        left = op === "*" ? (env) => a(env) * b(env) : (env) => a(env) / b(env);
      } else if (t && (t.kind === "num" || t.kind === "id" || isOp("("))) {
        const a = left, b = power(); // implicit multiplication: 2x, 3(x + 1), x y
        left = (env) => a(env) * b(env);
      } else {
        return left;
      }
    }
  };
  const unary = (): Compiled => {
    if (isOp("-")) { i++; const a = unary(); return (env) => -a(env); }
    if (isOp("+")) { i++; return unary(); }
    return power();
  };
  const power = (): Compiled => {
    const base = primary();
    if (!isOp("^")) return base;
    i++;
    const exponent = unary();
    return (env) => Math.pow(base(env), exponent(env));
  };
  const primary = (): Compiled => {
    const t = tokens[i++];
    if (!t) throw new GrammarError(`The expression ${src} ends too early.`);
    if (t.kind === "num") return () => t.value;
    if (t.kind === "op") {
      if (t.op !== "(") throw new GrammarError(`Unexpected "${t.op}" in ${src}.`);
      const inner = expr();
      expect(")");
      return inner;
    }
    const fn = FUNCTIONS[t.name];
    if (fn && isOp("(")) {
      i++;
      const args: Compiled[] = [expr()];
      while (isOp(",")) { i++; args.push(expr()); }
      expect(")");
      return (env) => fn(...args.map((a) => a(env)));
    }
    if (variables.includes(t.name)) return (env) => env[t.name] ?? NaN;
    if (t.name in CONSTANTS) { const value = CONSTANTS[t.name]!; return () => value; }
    if (fn) throw new GrammarError(`${t.name} needs brackets: ${t.name}(…).`);
    throw new GrammarError(`Unknown name "${t.name}" in ${src}.${variables.length ? ` Known: ${variables.join(", ")}.` : ""}`);
  };

  if (!tokens.length) throw new GrammarError("Empty expression.");
  const compiled = expr();
  if (i < tokens.length) throw new GrammarError(`Unexpected "${src.trim()}" after a complete expression.`);
  return compiled;
}

export const evaluateConst = (src: string): number => compile(src, [])({});

// Names an expression uses, so a formula explorer can check its inputs.
export const namesIn = (src: string): string[] =>
  tokenize(src).flatMap((t) => (t.kind === "id" && !(t.name in FUNCTIONS) && !(t.name in CONSTANTS) ? [t.name] : []));
