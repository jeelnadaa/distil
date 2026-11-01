// Matching a model's quote to the page text it came from. PDF text differs from what a model writes
// back in ways that don't change the words: ligatures (ﬁ), words hyphenated across a line break,
// curly quotes and dashes, soft hyphens, Markdown emphasis, case and spacing. Both sides are
// normalised the same way, keeping each normalised character's offset in the original text.

const QUOTES: Record<string, string> = { "‘": "'", "’": "'", "‚": "'", "′": "'", "“": '"', "”": '"', "„": '"', "″": '"' };
const DASH = /[‐‑‒–—―−]/;
const DROP = /[­​-‍⁠﻿*_`]/;

export type Normalised = { text: string; offsets: number[] };

export function normaliseForMatch(source: string): Normalised {
  let text = "";
  const offsets: number[] = [];
  const push = (s: string, at: number) => { for (const c of s) { text += c; offsets.push(at); } };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (DROP.test(ch)) continue;
    // "transfor-\nmation" reads as "transformation".
    if (ch === "-" || DASH.test(ch)) {
      const rest = /^[ \t]*\r?\n\s*(?=\p{Ll})/u.exec(source.slice(i + 1, i + 12));
      if (rest && /\p{L}/u.test(source[i - 1] ?? "")) { i += rest[0].length; continue; }
      push("-", i);
      continue;
    }
    if (/\s/.test(ch)) {
      if (text && !text.endsWith(" ")) push(" ", i);
      continue;
    }
    push((QUOTES[ch] ?? ch).normalize("NFKC").toLowerCase(), i);
  }
  if (text.endsWith(" ")) { text = text.slice(0, -1); offsets.pop(); }
  return { text, offsets };
}

export type QuoteMatch = { at: number; how: "full" | "partial" } | null;

// A piece of a quote shorter than this could match by chance.
const MIN_PIECE = 12;

// The same text with spaces taken out, for pages whose extraction split or joined words ("Ageof", "S A M").
const squeeze = (n: Normalised): Normalised => {
  let text = "";
  const offsets: number[] = [];
  for (let i = 0; i < n.text.length; i++) {
    if (n.text[i] === " ") continue;
    text += n.text[i];
    offsets.push(n.offsets[i]!);
  }
  return { text, offsets };
};

// Where a quote starts in the text (an offset into the original), or null. A quote the model shortened,
// cut with an ellipsis or stitched together still matches on its longest piece or its opening or closing words.
export function findQuote(source: string | Normalised, quote: string): QuoteMatch {
  const hay = typeof source === "string" ? normaliseForMatch(source) : source;
  const needle = normaliseForMatch(quote).text;
  if (!needle) return null;
  let squeezed: Normalised | null = null;
  const search = (part: string): number | null => {
    const i = hay.text.indexOf(part);
    if (i !== -1) return hay.offsets[i]!;
    const tight = part.replaceAll(" ", "");
    if (tight.length < MIN_PIECE) return null;
    squeezed ??= squeeze(hay);
    const j = squeezed.text.indexOf(tight);
    return j !== -1 ? squeezed.offsets[j]! : null;
  };
  const full = search(needle);
  if (full !== null) return { at: full, how: "full" };
  const words = needle.split(" ");
  const pieces = needle.split(/\.{3,}|…/).map((p) => p.trim()).filter((p) => p.length >= MIN_PIECE).sort((a, b) => b.length - a.length);
  if (words.length >= 8) pieces.push(words.slice(0, 6).join(" "), words.slice(-6).join(" "));
  if (needle.length > 24) pieces.push(needle.slice(0, 24));
  for (const part of pieces) {
    const at = search(part);
    if (at !== null) return { at, how: "partial" };
  }
  return null;
}
