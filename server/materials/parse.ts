import { strFromU8, unzipSync } from "fflate";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { AppError } from "../errors.ts";

// Turns an added file into an ordered list of blocks, each tied to where it came from (F-206).
// Blocks are either headings (with a level) or text; the chunker packs them later.

export type MaterialKind = "pdf" | "docx" | "pptx" | "markdown" | "text" | "image";
// page and slide are 1-based; para is the paragraph index in a document; line is a line in a text file.
export type LocUnit = "page" | "slide" | "para" | "line";
export type Block = { loc: number; heading?: number; text: string };
// visual: locations whose content is partly drawn rather than written (formulas as vector paths,
// diagrams, photos); extraction sends their page images to the model as well as their text.
export type Parsed = { unit: LocUnit; blocks: Block[]; length: number; visual?: number[] };

// Measured on an OpenStax textbook: plain pages draw under ~50 paths, pages with typeset
// equations or charts 120+. Any embedded picture counts as visual too.
const VISUAL_PATHS = 80;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const IMAGE_MAGIC: [number[], string][] = [
  [[0x89, 0x50, 0x4e, 0x47], "png"], [[0xff, 0xd8, 0xff], "jpeg"], [[0x47, 0x49, 0x46, 0x38], "gif"], [[0x52, 0x49, 0x46, 0x46], "webp"],
];
const starts = (bytes: Uint8Array, magic: number[]) => magic.every((b, i) => bytes[i] === b);

// Decides what a file is from its bytes, using the extension only to tell Markdown from plain text.
export function detectKind(fileName: string, bytes: Uint8Array): MaterialKind {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf";
  if (IMAGE_MAGIC.some(([magic]) => starts(bytes, magic))) return "image";
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    if (ext === "docx") return "docx";
    if (ext === "pptx") return "pptx";
    throw new AppError(415, "unsupported_file", "Zip files other than .docx and .pptx aren't supported yet.");
  }
  if (["doc", "ppt", "xls", "xlsx", "odt", "odp", "rtf", "epub"].includes(ext)) {
    throw new AppError(415, "unsupported_file", `.${ext} files aren't supported yet. Save as PDF, .docx or .pptx and add that.`);
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, 64 * 1024));
  } catch {
    throw new AppError(415, "unsupported_file", "This file isn't a format Distil can read (PDF, Word, PowerPoint, Markdown, text or an image).");
  }
  return ["md", "markdown", "mdx"].includes(ext) ? "markdown" : "text";
}

export async function parseMaterial(kind: MaterialKind, bytes: Uint8Array): Promise<Parsed> {
  switch (kind) {
    case "pdf": return parsePdf(bytes);
    case "docx": return parseDocx(bytes);
    case "pptx": return parsePptx(bytes);
    case "markdown": return parseMarkdown(new TextDecoder().decode(bytes));
    case "text": return parseText(new TextDecoder().decode(bytes));
    case "image":
      if (bytes.length > MAX_IMAGE_BYTES) throw new AppError(413, "image_too_large", "Images can be up to 15 MB. Save it smaller and add it again.");
      // Read entirely by a vision model during extraction; the block gives the chunk something to anchor to.
      return { unit: "page", blocks: [{ loc: 1, text: "(Image: its content is read from the picture.)" }], length: 1, visual: [1] };
  }
}

const tidy = (s: string) => s.replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/* ---------- PDF ---------- */

type TextItem = { str: string; transform: number[]; height: number; hasEOL: boolean };

async function parsePdf(bytes: Uint8Array): Promise<Parsed> {
  // pdf.js takes ownership of the array it is given and refuses Node Buffers, so it gets a plain copy.
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise.catch(async () => {
    await task.destroy();
    throw new AppError(422, "unreadable_pdf", "This PDF couldn't be opened. It may be damaged or password-protected.");
  });
  const blocks: Block[] = [];
  const visual: number[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const items = (await page.getTextContent()).items.flatMap((i) => ("str" in i ? [i as TextItem] : []));
      let paths = 0;
      let pictures = 0;
      for (const fn of (await page.getOperatorList()).fnArray) {
        if (fn === OPS.constructPath) paths++;
        else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) pictures++;
      }
      if (pictures > 0 || paths > VISUAL_PATHS) visual.push(n);
      page.cleanup();
      // Rebuild lines from positioned runs, keeping each line's largest font size.
      const lines: { text: string; size: number }[] = [];
      let current = { text: "", size: 0, y: Number.NaN };
      const flush = () => { if (current.text.trim()) lines.push({ text: current.text.trim(), size: current.size }); };
      for (const item of items) {
        const y = item.transform[5] ?? 0;
        if (!Number.isNaN(current.y) && Math.abs(y - current.y) > Math.max(2, item.height * 0.5)) {
          flush();
          current = { text: "", size: 0, y };
        }
        if (Number.isNaN(current.y)) current.y = y;
        current.text += item.str;
        current.size = Math.max(current.size, item.height);
        if (item.hasEOL) {
          flush();
          current = { text: "", size: 0, y: Number.NaN };
        }
      }
      flush();
      if (!lines.length) {
        // A scanned page or a full-page figure: no text, so the page image is all there is.
        if (visual.at(-1) === n) blocks.push({ loc: n, text: "(This page has no text layer; its content is read from the page image.)" });
        continue;
      }
      // A short line set clearly larger than the page's body text is treated as a heading.
      const body = median(lines.map((l) => l.size));
      let text = "";
      for (const line of lines) {
        const level = line.size >= body * 1.6 ? 1 : line.size >= body * 1.25 ? 2 : 0;
        if (level && line.text.length <= 120 && body > 0) {
          const last = blocks.at(-1);
          // A heading that wraps onto a second line arrives as two lines of the same size: join them.
          if (!text.trim() && last?.heading === level && last.loc === n) last.text += ` ${line.text}`;
          else {
            if (text.trim()) blocks.push({ loc: n, text: tidy(dehyphenate(text)) });
            blocks.push({ loc: n, heading: level, text: line.text });
          }
          text = "";
        } else {
          text += `${line.text}\n`;
        }
      }
      if (text.trim()) blocks.push({ loc: n, text: tidy(dehyphenate(text)) });
    }
    return { unit: "page", blocks, length: doc.numPages, visual };
  } finally {
    await task.destroy();
  }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor((s.length - 1) / 2)] ?? 0) : 0;
};
// "exam-\nple" → "example", but keep real hyphens such as "self-\nevident" only when the next line starts upper-case.
const dehyphenate = (s: string) => s.replace(/(\p{Ll})-\n(\p{Ll})/gu, "$1$2");

/* ---------- Office files (Open XML) ---------- */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeXml = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
  e[0] === "#" ? String.fromCodePoint(Number.parseInt(e[1] === "x" || e[1] === "X" ? e.slice(2) : e.slice(1), e[1] === "x" || e[1] === "X" ? 16 : 10)) : (ENTITIES[e] ?? m));

function unzip(bytes: Uint8Array, what: string) {
  try {
    return unzipSync(bytes);
  } catch {
    throw new AppError(422, "unreadable_file", `This ${what} file couldn't be opened. It may be damaged.`);
  }
}

// Text runs of a Word paragraph, including equation text (<m:t>), tabs and line breaks.
const runText = (xml: string) => decodeXml(
  xml.replace(/<w:tab\/>/g, "\t").replace(/<w:br\/>/g, "\n")
    .match(/<(?:w|m):t(?:\s[^>]*)?>[^<]*<\/(?:w|m):t>|\t|\n/g)?.map((t) => t.replace(/<[^>]+>/g, "")).join("") ?? "",
);

function parseDocx(bytes: Uint8Array): Parsed {
  const files = unzip(bytes, "Word");
  const doc = files["word/document.xml"];
  if (!doc) throw new AppError(422, "unreadable_file", "This Word file has no document body.");
  const xml = strFromU8(doc);
  const blocks: Block[] = [];
  let para = 0;
  for (const [element] of xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[\s>][\s\S]*?<\/w:p>|<w:p\/>/g)) {
    para++;
    if (element.startsWith("<w:tbl>")) {
      // Tables stay tables (F-213): one Markdown row per table row.
      const rows = [...element.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map(([row]) =>
        [...row.matchAll(/<w:tc[\s>][\s\S]*?<\/w:tc>/g)].map(([cell]) => tidy(runText(cell)).replace(/\n/g, " ").replace(/\|/g, "\\|")));
      if (rows.length) {
        const width = Math.max(...rows.map((r) => r.length));
        const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
        blocks.push({ loc: para, text: [line(rows[0]!), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line)].join("\n") });
      }
      continue;
    }
    const text = tidy(runText(element));
    if (!text) continue;
    const style = element.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? "";
    const level = /^Title$/i.test(style) ? 1 : Number(style.match(/^Heading(\d)$/i)?.[1] ?? 0);
    blocks.push(level ? { loc: para, heading: Math.min(level, 6), text } : { loc: para, text });
  }
  return { unit: "para", blocks, length: para };
}

function parsePptx(bytes: Uint8Array): Parsed {
  const files = unzip(bytes, "PowerPoint");
  const slideNo = (name: string) => Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);
  const slides = Object.keys(files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => slideNo(a) - slideNo(b));
  const paragraphs = (xml: string) => [...xml.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)]
    .map(([p]) => tidy(decodeXml((p.match(/<a:t>[^<]*<\/a:t>/g) ?? []).map((t) => t.slice(5, -6)).join(""))))
    .filter(Boolean);
  const blocks: Block[] = [];
  slides.forEach((name, i) => {
    const loc = i + 1;
    const [title, ...rest] = paragraphs(strFromU8(files[name]!));
    if (title) blocks.push({ loc, heading: 1, text: title });
    if (rest.length) blocks.push({ loc, text: rest.join("\n") });
    // Speaker notes often carry the actual explanation; find them through the slide's relationships.
    const rels = files[`ppt/slides/_rels/slide${slideNo(name)}.xml.rels`];
    const target = rels ? strFromU8(rels).match(/Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/)?.[1] : `notesSlide${slideNo(name)}.xml`;
    const notes = target ? files[`ppt/notesSlides/${target}`] : undefined;
    const noteText = notes ? paragraphs(strFromU8(notes)).filter((p) => !/^\d+$/.test(p)).join("\n") : "";
    if (noteText) blocks.push({ loc, text: `Speaker notes: ${noteText}` });
  });
  return { unit: "slide", blocks, length: slides.length };
}

/* ---------- Plain text ---------- */

function parseMarkdown(source: string): Parsed {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let buffer: string[] = [];
  let start = 1;
  let fence = false;
  const flush = (next: number) => {
    const text = buffer.join("\n").trim();
    if (text) blocks.push({ loc: start, text });
    buffer = [];
    start = next;
  };
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const heading = !fence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flush(i + 2);
      blocks.push({ loc: i + 1, heading: heading[1]!.length, text: heading[2]! });
    } else if (!fence && !line.trim()) {
      flush(i + 2); // one block per paragraph, so every item points at its own line
    } else {
      if (!buffer.join("").trim()) start = i + 1;
      buffer.push(line);
    }
  });
  flush(lines.length + 1);
  return { unit: "line", blocks, length: lines.length };
}

function parseText(source: string): Parsed {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let buffer: string[] = [];
  let start = 1;
  lines.forEach((line, i) => {
    if (!line.trim()) {
      if (buffer.length) blocks.push({ loc: start, text: tidy(buffer.join("\n")) });
      buffer = [];
    } else {
      if (!buffer.length) start = i + 1;
      buffer.push(line);
    }
  });
  if (buffer.length) blocks.push({ loc: start, text: tidy(buffer.join("\n")) });
  return { unit: "line", blocks, length: lines.length };
}
