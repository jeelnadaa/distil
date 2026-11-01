// Shared pieces of the widget grammars (plan.md §7.5). Pure: no Node or DOM imports, so the browser
// renders with the same parsers the server validates repairs with.
//
// Styling is semantic only (F-752): `!` marks the one emphasised element, `~` mutes one, `tone=good|warn|bad`
// and `series=1…6` pick a token. Anything that looks like a literal colour, font or size is refused.

export type Tone = "good" | "warn" | "bad";
export type Mark = { emphasis?: true; muted?: true; tone?: Tone; series?: number };

export class GrammarError extends Error {
  readonly line: number | null;
  constructor(message: string, line: number | null = null) {
    super(line === null ? message : `Line ${line}: ${message}`);
    this.line = line;
  }
}

export type Line = { n: number; text: string };

// Non-blank lines, numbered from 1 as the model wrote them.
export const linesOf = (source: string): Line[] =>
  source.split(/\r?\n/).map((text, i) => ({ n: i + 1, text: text.trim() })).filter((l) => l.text !== "");

const STYLE_KEYS = /^(colou?r|fill|stroke|background|bg|font|font-family|family|font-size|size|style|class|width|height|opacity|weight|bold|italic|css)$/i;
const COLOUR_LITERAL = /(^|\s)(#(?=[0-9a-f]*[a-f])(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|(?:rgba?|hsla?|oklch|lab|lch)\()/i;
const STYLE_HINT = "Styling is not allowed: use ! (emphasis), ~ (muted), tone=good|warn|bad or series=1…6";

// Refuses literal styling anywhere in a label: colour codes and CSS-ish declarations.
export function rejectStyling(text: string, line: number) {
  if (COLOUR_LITERAL.test(text)) throw new GrammarError(`${STYLE_HINT} (found a colour).`, line);
  if (/(^|[\s;{])(colou?r|background|font-family|font-size|fill|stroke)\s*:/i.test(text)) throw new GrammarError(`${STYLE_HINT} (found CSS).`, line);
  if (/<\s*\/?\s*(span|font|div|b|i|style|svg)\b/i.test(text)) throw new GrammarError("Write plain text: HTML tags are not allowed.", line);
}

// Peels trailing marks off a line or label: standalone `!` / `~` tokens and `key=value` attributes.
// "q[Raise fs]!" keeps its attached `!` for the caller; "Done tone=good !" yields { tone, emphasis }.
export function takeMarks(text: string, line: number): { text: string; mark: Mark } {
  const mark: Mark = {};
  let rest = text;
  for (;;) {
    const m = rest.match(/(?:^|\s)(!|~|([\w-]+)=(\S+))$/);
    if (!m) break;
    const [, token, key, value] = m;
    if (token === "!") mark.emphasis = true;
    else if (token === "~") mark.muted = true;
    else if (key === "tone") {
      if (value !== "good" && value !== "warn" && value !== "bad") throw new GrammarError(`tone must be good, warn or bad (not "${value}").`, line);
      mark.tone = value;
    } else if (key === "series") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 6) throw new GrammarError(`series must be a whole number from 1 to 6 (not "${value}").`, line);
      mark.series = n;
    } else if (STYLE_KEYS.test(key!)) {
      throw new GrammarError(`${STYLE_HINT} (found ${key}=).`, line);
    } else {
      throw new GrammarError(`Unknown attribute ${key}=. Only tone= and series= are allowed.`, line);
    }
    rest = rest.slice(0, rest.length - m[0].length).trimEnd();
  }
  rejectStyling(rest, line);
  return { text: rest, mark };
}

// At most one emphasised element per visual (DESIGN.md §8.1): code keeps the first and drops the rest.
export function oneAccent<T extends { mark: Mark }>(things: T[]): T[] {
  let seen = false;
  for (const t of things) {
    if (!t.mark.emphasis) continue;
    if (seen) delete t.mark.emphasis;
    seen = true;
  }
  return things;
}

// `key: value` header lines (title:, x:, type: …) that come before or among the body.
export function header(line: Line, key: string): string | null {
  const m = line.text.match(new RegExp(`^${key}\\s*:\\s*(.*)$`, "i"));
  return m ? m[1]!.trim() : null;
}

export function title(lines: Line[]): { title?: string; rest: Line[] } {
  const first = lines[0];
  const value = first ? header(first, "title") : null;
  if (value === null) return { rest: lines };
  rejectStyling(value, first!.n);
  return { title: value.slice(0, 120), rest: lines.slice(1) };
}

export function limit(count: number, max: number, what: string) {
  if (count > max) throw new GrammarError(`Too many ${what} (${count}); keep it to ${max} or fewer.`);
}

export function requireText(text: string, what: string, line: number) {
  if (!text.trim()) throw new GrammarError(`${what} is empty.`, line);
  if (text.length > 400) throw new GrammarError(`${what} is too long (400 characters max).`, line);
}

// "a..b" with numbers or constant expressions such as -2pi..2pi.
export function range(text: string, line: number, evaluate: (src: string) => number): [number, number] {
  const m = text.match(/^(.+?)\s*\.\.\s*(.+)$/);
  if (!m) throw new GrammarError(`Expected a range like 0..10 (got "${text}").`, line);
  const lo = evaluate(m[1]!);
  const hi = evaluate(m[2]!);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) throw new GrammarError(`The range ${text} must go from a smaller to a larger number.`, line);
  return [lo, hi];
}
