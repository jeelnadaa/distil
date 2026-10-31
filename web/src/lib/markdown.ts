// Markdown, maths and code for model replies. Raw HTML is disabled, so model output can't inject markup.
import hljs from "highlight.js/lib/common";
import katex from "katex";
import MarkdownIt, { type StateBlock, type StateInline } from "markdown-it";

const tex = (source: string, displayMode: boolean) =>
  katex.renderToString(source, { displayMode, throwOnError: false, strict: "ignore", trust: false, output: "htmlAndMathml" });

// Inline maths: $…$ (not "$5 and $6": the opening $ must be followed by non-space) and \(…\).
function mathInline(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  let open: string, close: string;
  if (src.startsWith("\\(", start)) [open, close] = ["\\(", "\\)"];
  else if (src[start] === "$" && src[start + 1] !== "$" && src[start + 1] !== " " && src[start + 1] !== undefined) [open, close] = ["$", "$"];
  else return false;
  let end = start + open.length;
  for (;;) {
    end = src.indexOf(close, end);
    if (end === -1) return false;
    if (src[end - 1] !== "\\" && (close !== "$" || (src[end - 1] !== " " && !/\d/.test(src[end + 1] ?? "")))) break;
    end += 1;
  }
  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.content = src.slice(start + open.length, end);
  }
  state.pos = end + close.length;
  return true;
}

// Display maths on their own lines: $$…$$ or \[…\], possibly spanning lines.
function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const lineText = (n: number) => state.src.slice(state.bMarks[n]! + state.tShift[n]!, state.eMarks[n]);
  const first = lineText(startLine);
  const pair = first.startsWith("$$") ? ["$$", "$$"] : first.startsWith("\\[") ? ["\\[", "\\]"] : null;
  if (!pair) return false;
  const [open, close] = pair as [string, string];
  if (silent) return true;
  let body = first.slice(open.length);
  let line = startLine;
  let closed = body.trimEnd().endsWith(close);
  while (!closed && ++line < endLine) {
    const text = lineText(line);
    body += "\n" + text;
    closed = text.trimEnd().endsWith(close);
  }
  if (!closed) return false;
  body = body.trimEnd().slice(0, -close.length);
  state.line = line + 1;
  const token = state.push("math_block", "math", 0);
  token.block = true;
  token.content = body.trim();
  token.map = [startLine, state.line];
  return true;
}

const md: ReturnType<typeof MarkdownIt> = MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight(code, lang) {
    const language = lang && hljs.getLanguage(lang) ? lang : null;
    const html = language ? hljs.highlight(code, { language, ignoreIllegals: true }).value : md.utils.escapeHtml(code);
    return `<pre class="code"><span class="code__lang">${md.utils.escapeHtml(lang || "text")}</span><code class="hljs">${html}</code></pre>`;
  },
});

md.inline.ruler.before("escape", "math_inline", mathInline);
md.block.ruler.after("blockquote", "math_block", mathBlock, { alt: ["paragraph", "reference", "blockquote", "list"] });
md.renderer.rules.math_inline = (tokens, i) => tex(tokens[i]!.content, false);
md.renderer.rules.math_block = (tokens, i) => `<div class="math-block">${tex(tokens[i]!.content, true)}</div>`;

// Links open outside the app and never get access to it.
const defaultLink = md.renderer.rules.link_open ?? ((tokens, i, options, _env, self) => self.renderToken(tokens, i, options));
md.renderer.rules.link_open = (tokens, i, options, env, self) => {
  tokens[i]!.attrSet("target", "_blank");
  tokens[i]!.attrSet("rel", "noopener noreferrer");
  return defaultLink(tokens, i, options, env, self);
};

export const renderMarkdown = (source: string) => md.render(source);
// For one-line fields such as ledger statements: inline Markdown and maths, no block elements.
// Ledger statements repeat across polls and re-renders; typesetting their maths again is the costly part.
const inlineCache = new Map<string, string>();
export const renderInline = (source: string) => {
  let html = inlineCache.get(source);
  if (html === undefined) {
    if (inlineCache.size > 5000) inlineCache.clear();
    html = md.renderInline(source);
    inlineCache.set(source, html);
  }
  return html;
};
