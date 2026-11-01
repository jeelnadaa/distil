// Fenced blocks in a reply, found the same way on the server (repair) and in the browser (rendering), so a
// block's index names the same block in both. Pure.

// info: the rest of the opening line after the language ("run" in ```js run).
export type Block = { lang: string; info: string; source: string; start: number; end: number; closed: boolean };

// ``` or ~~~ fences of three or more, at the start of a line (up to three spaces in), as CommonMark has them.
export function fencedBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const open = /^ {0,3}(`{3,}|~{3,})[ \t]*([\w-]*)([^\n]*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = open.exec(text))) {
    const fence = m[1]!;
    const bodyStart = m.index + m[0].length + 1;
    const close = new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`, "gm");
    close.lastIndex = Math.min(bodyStart, text.length);
    const c = bodyStart <= text.length ? close.exec(text) : null;
    const end = c ? c.index + c[0].length : text.length;
    blocks.push({ lang: m[2]!.toLowerCase(), info: m[3]!.trim(), source: text.slice(Math.min(bodyStart, text.length), c ? c.index : text.length).replace(/\n$/, ""), start: m.index, end, closed: !!c });
    open.lastIndex = end;
  }
  return blocks;
}
