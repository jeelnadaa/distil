// Material viewer helpers: turn stored chunks back into one section per page/slide/line, and find a
// cited quote in the rendered text so it can be highlighted without touching the DOM.
import type { StoredChunk } from "./api.ts";

export type Section = { loc: number; text: string };

export function sections(chunks: Pick<StoredChunk, "text" | "marks" | "from">[]): Section[] {
  const out: Section[] = [];
  for (const chunk of chunks) {
    const marks = chunk.marks.length ? chunk.marks : [[0, chunk.from] as [number, number]];
    marks.forEach(([at, loc], i) => {
      const text = chunk.text.slice(at, marks[i + 1]?.[0] ?? chunk.text.length).trim();
      if (!text) return;
      const last = out.at(-1);
      if (last?.loc === loc) last.text += `\n\n${text}`;
      else out.push({ loc, text });
    });
  }
  return out;
}

// A Range over the first place `quote` appears under root, ignoring case and whitespace differences.
export function findRange(root: Node, quote: string): Range | null {
  const needle = quote.toLowerCase().replace(/\s+/g, " ").trim();
  if (!needle) return null;
  let text = "";
  const map: { node: Text; offset: number }[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    // KaTeX keeps a hidden MathML copy of each formula; searching it would match twice.
    if (node.parentElement?.closest(".katex-mathml")) continue;
    for (let i = 0; i < node.data.length; i++) {
      const ch = node.data[i]!;
      if (/\s/.test(ch)) {
        if (!text || text.endsWith(" ")) continue;
        text += " ";
      } else text += ch.toLowerCase();
      map.push({ node, offset: i });
    }
  }
  let start = text.indexOf(needle);
  let length = needle.length;
  if (start === -1 && needle.length > 24) {
    start = text.indexOf(needle.slice(0, 24));
    length = 24;
  }
  if (start === -1) return null;
  const from = map[start]!;
  const to = map[start + length - 1]!;
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset + 1);
  return range;
}

const UNIT: Record<string, string> = { page: "p.", slide: "slide ", para: "¶", line: "line " };
// How a location is cited everywhere: "p.14", "slide 6", "line 12".
export const locLabel = (unit: string | null, loc: number) => `${UNIT[unit ?? ""] ?? "#"}${loc}`;
