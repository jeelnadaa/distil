import { estimateTokens } from "../usage.ts";
import type { Block, LocUnit } from "./parse.ts";

// Structure-aware chunking (F-206): blocks are packed into chunks small enough for one careful
// extraction call, preferring to break at major headings, and every chunk keeps its source range
// and the heading path above it so items can point back to "unit2.pdf · p.14".

export type Anchor = { unit: LocUnit; from: number; to: number };
// headings: the heading path in force where the chunk starts, including a heading it opens with.
export type Chunk = { anchor: Anchor; headings: string[]; text: string; tokens: number };

export const CHUNK_TOKENS = 1200;

export function chunkBlocks(unit: LocUnit, blocks: Block[], maxTokens = CHUNK_TOKENS): Chunk[] {
  const chunks: Chunk[] = [];
  const path: string[] = [];
  let parts: string[] = [];
  let tokens = 0;
  let from = 0;
  let to = 0;
  let headings: string[] = [];

  const flush = () => {
    const text = parts.join("\n\n").trim();
    if (text) chunks.push({ anchor: { unit, from, to }, headings, text, tokens: estimateTokens(text) });
    parts = [];
    tokens = 0;
  };
  const add = (text: string, loc: number) => {
    const size = estimateTokens(text);
    if (parts.length && tokens + size > maxTokens) flush();
    if (!parts.length) {
      from = loc;
      headings = [...path];
    }
    parts.push(text);
    tokens += size;
    to = loc;
  };

  for (const block of blocks) {
    if (block.heading) {
      // A top-level heading starts a new chunk once the current one has some substance.
      if (block.heading <= 2 && tokens >= maxTokens / 4) flush();
      path.length = Math.min(path.length, block.heading - 1);
      path[block.heading - 1] = block.text;
      for (let i = 0; i < path.length; i++) path[i] ??= "";
      add(`${"#".repeat(block.heading)} ${block.text}`, block.loc);
      continue;
    }
    for (const piece of split(block.text, maxTokens)) add(piece, block.loc);
  }
  flush();
  return chunks.map((c) => ({ ...c, headings: c.headings.filter(Boolean) }));
}

// Splits an oversized block at paragraph, then sentence, then hard boundaries.
function split(text: string, maxTokens: number): string[] {
  if (estimateTokens(text) <= maxTokens) return [text];
  const paragraphs = text.split(/\n{2,}/);
  const sep = paragraphs.length > 1 ? "\n\n" : " ";
  const units = paragraphs.length > 1 ? paragraphs : text.split(/(?<=[.!?])\s+/);
  if (units.length === 1) {
    const size = maxTokens * 4;
    return Array.from({ length: Math.ceil(text.length / size) }, (_, i) => text.slice(i * size, (i + 1) * size));
  }
  const out: string[] = [];
  let current = "";
  for (const unit of units) {
    const next = current ? `${current}${sep}${unit}` : unit;
    if (current && estimateTokens(next) > maxTokens) {
      out.push(...split(current, maxTokens));
      current = unit;
    } else {
      current = next;
    }
  }
  if (current) out.push(...split(current, maxTokens));
  return out;
}
