import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { AppError } from "../errors.ts";
import { MAX_MATERIAL_BYTES } from "./store.ts";

// Web materials (F-203): a link is fetched once and kept as a copy, like a file. A web page becomes
// Markdown of its main article (Readability drops menus, ads and footers), with its maths kept as
// LaTeX; a link straight to a PDF, image or text file is kept as that file.

const TIMEOUT_MS = 30_000;
const USER_AGENT = "Mozilla/5.0 (compatible; Distil/0.1; +local study app)";

export type Fetched = { name: string; bytes: Uint8Array };
export type FetchFn = typeof fetch;

export function parseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new AppError(400, "invalid_url", "That isn't a web address. Paste a full link starting with https://.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new AppError(400, "invalid_url", "Only http and https links can be added.");
  return url;
}

export async function fetchUrl(url: URL, fetchFn: FetchFn = fetch): Promise<Fetched> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.8" },
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new AppError(502, "fetch_failed", timedOut ? "That page took too long to answer." : "That page couldn't be reached. Check the link and your connection.");
  }
  if (!res.ok) throw new AppError(502, "fetch_failed", `That page answered with an error (${res.status}).`);
  const bytes = await readCapped(res);
  const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const last = decodeURIComponent(new URL(res.url || url.href).pathname.split("/").filter(Boolean).pop() ?? "") || url.hostname;

  if (type === "text/html" || type === "application/xhtml+xml" || (!type && /<html[\s>]/i.test(new TextDecoder().decode(bytes.subarray(0, 2048))))) {
    const { title, markdown } = articleMarkdown(new TextDecoder().decode(bytes), res.url || url.href);
    return { name: `${fileSafe(title || url.hostname)}.md`, bytes: new TextEncoder().encode(markdown) };
  }
  // Anything else is stored as the file it is; the usual checks decide whether it can be read.
  return { name: last, bytes };
}

async function readCapped(res: Response): Promise<Uint8Array> {
  if (Number(res.headers.get("content-length") ?? 0) > MAX_MATERIAL_BYTES) throw new AppError(413, "file_too_large", "Files can be up to 200 MB.");
  const parts: Uint8Array[] = [];
  let size = 0;
  const reader = res.body?.getReader();
  for (let part = await reader?.read(); part && !part.done; part = await reader!.read()) {
    size += part.value.length;
    if (size > MAX_MATERIAL_BYTES) {
      await reader!.cancel();
      throw new AppError(413, "file_too_large", "Files can be up to 200 MB.");
    }
    parts.push(part.value);
  }
  return Buffer.concat(parts);
}

const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|\n\r\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 150);

/* ---------- HTML → Markdown ---------- */

// Turns a web page into Markdown of its main article. Exported for tests.
export function articleMarkdown(html: string, url: string): { title: string; markdown: string } {
  const { document } = parseHTML(html);
  keepMath(document);
  // Citation markers ("[1]"), edit links and print-hidden parts are page furniture, not content.
  for (const el of [...document.querySelectorAll('sup.reference, .mw-editsection, .noprint, [role="doc-noteref"]')]) el.remove();
  const article = new Readability(document as unknown as Document, { charThreshold: 200 }).parse();
  if (!article?.content) throw new AppError(422, "no_article", "No article text was found on that page. Save it as a PDF and add that instead.");
  const { document: body } = parseHTML(`<!doctype html><html><body>${article.content}</body></html>`);
  const blocks: string[] = [];
  walk(body.body as unknown as Element, blocks);
  const title = (article.title ?? "").trim();
  const text = blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new AppError(422, "no_article", "No article text was found on that page. Save it as a PDF and add that instead.");
  return { title, markdown: `${title ? `# ${title}\n\n` : ""}Source: <${url}>\n\n${text}\n` };
}

// Pages typeset maths as MathML (Wikipedia, KaTeX, MathJax) whose TeX source sits in an annotation
// or attribute; each formula is swapped for that TeX before Readability, which drops <math>.
function keepMath(document: Document) {
  for (const script of [...document.querySelectorAll('script[type^="math/tex"]')]) {
    const display = /mode=display/.test(script.getAttribute("type") ?? "");
    script.replaceWith(document.createTextNode(display ? `\n$$${script.textContent}$$\n` : `$${script.textContent}$`));
  }
  for (const math of [...document.querySelectorAll("math")]) {
    if (!math.isConnected) continue;
    const tex = (math.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? math.getAttribute("alttext") ?? "").trim()
      .replace(/^\{\\displaystyle\s*([\s\S]*)\}$/, "$1");
    if (!tex) continue;
    const display = math.getAttribute("display") === "block" || !!math.closest(".katex-display, .mwe-math-fallback-image-display");
    const outer = math.closest(".katex-display, .katex, .mwe-math-element, mjx-container") ?? math;
    outer.replaceWith(document.createTextNode(display ? `\n$$${tex}$$\n` : `$${tex}$`));
  }
}

const BLOCK = new Set(["p", "div", "section", "article", "main", "header", "figure", "figcaption", "details", "summary", "dl", "dd", "dt", "center"]);
const SKIP = new Set(["script", "style", "noscript", "svg", "button", "form", "nav", "iframe", "img", "video", "audio", "picture"]);

function walk(el: Element, out: string[]) {
  for (const node of [...el.childNodes]) {
    if (node.nodeType === 3) {
      const text = squash(node.textContent ?? "");
      if (text.trim()) out.push(text.trim());
      continue;
    }
    if (node.nodeType !== 1) continue;
    const child = node as Element;
    const tag = child.tagName.toLowerCase();
    if (SKIP.has(tag)) continue;
    const heading = tag.match(/^h([1-6])$/);
    if (heading) {
      const text = inline(child);
      if (text) out.push(`${"#".repeat(Math.max(2, Number(heading[1])))} ${text}`);
    } else if (tag === "ul" || tag === "ol") {
      out.push(list(child, tag === "ol"));
    } else if (tag === "pre") {
      out.push(`\`\`\`\n${(child.textContent ?? "").replace(/\n+$/, "")}\n\`\`\``);
    } else if (tag === "blockquote") {
      const inner: string[] = [];
      walk(child, inner);
      out.push(inner.join("\n\n").split("\n").map((l) => `> ${l}`).join("\n"));
    } else if (tag === "table") {
      out.push(table(child));
    } else if (tag === "hr") {
      out.push("---");
    } else if (BLOCK.has(tag) && hasBlocks(child)) {
      walk(child, out);
    } else {
      const text = inline(child);
      if (text) out.push(text);
    }
  }
}

const hasBlocks = (el: Element) => [...el.children].some((c) => {
  const tag = c.tagName.toLowerCase();
  return BLOCK.has(tag) || /^(h[1-6]|ul|ol|pre|blockquote|table|hr)$/.test(tag);
});

const squash = (s: string) => s.replace(/[ \t\r\n ]+/g, " ");

// Inline text of an element, keeping code spans, emphasis and line breaks; display maths keeps its own lines.
function inline(el: Element): string {
  let text = "";
  for (const node of [...el.childNodes]) {
    if (node.nodeType === 3) { text += node.textContent?.includes("$$") ? node.textContent : squash(node.textContent ?? ""); continue; }
    if (node.nodeType !== 1) continue;
    const child = node as Element;
    const tag = child.tagName.toLowerCase();
    if (SKIP.has(tag)) continue;
    if (tag === "br") text += "\n";
    else if (tag === "code") text += `\`${child.textContent ?? ""}\``;
    else if (tag === "strong" || tag === "b") text += wrap(inline(child), "**");
    else if (tag === "em" || tag === "i") text += wrap(inline(child), "*");
    else if (tag === "sup") text += `^${inline(child)}`;
    else if (tag === "sub") text += `_${inline(child)}`;
    else text += inline(child);
  }
  return text.replace(/ *\n */g, "\n").replace(/ {2,}/g, " ").trim();
}

const wrap = (s: string, mark: string) => (s.trim() ? `${mark}${s.trim()}${mark}` : "");

function list(el: Element, ordered: boolean, depth = 0): string {
  const lines: string[] = [];
  let n = 1;
  for (const li of [...el.children]) {
    if (li.tagName.toLowerCase() !== "li") continue;
    const nested = [...li.children].filter((c) => /^(ul|ol)$/i.test(c.tagName));
    nested.forEach((c) => c.remove());
    const marker = ordered ? `${n++}.` : "-";
    lines.push(`${"  ".repeat(depth)}${marker} ${inline(li).replace(/\n/g, " ")}`);
    for (const sub of nested) lines.push(list(sub, sub.tagName.toLowerCase() === "ol", depth + 1));
  }
  return lines.join("\n");
}

function table(el: Element): string {
  const rows = [...el.querySelectorAll("tr")].map((tr) => [...tr.children].map((cell) => inline(cell).replace(/\n/g, " ").replace(/\|/g, "\\|")));
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
  return [line(rows[0]!), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n");
}
