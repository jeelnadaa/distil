// Visuals in replies (plan.md §7.5): a reply is split into Markdown and widget segments, so streamed text
// re-renders without re-mounting a widget above it; and sandboxed frames get the current theme.
import { fencedBlocks } from "../../../server/visuals/blocks.ts";
import { isGrammar } from "../../../server/visuals/grammar/index.ts";
import { KIT_VARS } from "../../../server/visuals/kit.ts";

// built: the block's place among the reply's app and figure blocks, which is how the server names it.
export type Segment =
  | { kind: "md"; text: string }
  | { kind: "widget"; lang: string; source: string; closed: boolean; built: number | null };

const isWidget = (lang: string, info: string) => isGrammar(lang) || ((lang === "js" || lang === "javascript") && /\brun\b/.test(info));

export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  let built = 0;
  for (const b of fencedBlocks(text)) {
    if (!isWidget(b.lang, b.info)) continue;
    if (b.start > at) out.push({ kind: "md", text: text.slice(at, b.start) });
    const isBuilt = b.lang === "app" || b.lang === "figure";
    out.push({ kind: "widget", lang: b.lang === "javascript" ? "js" : b.lang, source: b.source, closed: b.closed, built: isBuilt && b.closed ? built : null });
    if (isBuilt && b.closed) built++;
    at = b.end;
  }
  if (at < text.length) out.push({ kind: "md", text: text.slice(at) });
  return out;
}

/* ---------- Theme for sandboxed frames (F-754, F-756) ---------- */

const fontData = new Map<string, Promise<string | null>>();
const asDataUrl = (url: string) => {
  let found = fontData.get(url);
  if (!found) {
    found = fetch(url).then((r) => (r.ok ? r.blob() : null)).then((blob) => blob && new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    })).catch(() => null);
    fontData.set(url, found);
  }
  return found;
};

// The faces behind the text and mono fonts, inlined: a sandboxed frame can't load files from the app.
async function fontFaces(families: string): Promise<string> {
  const wanted = (family: string) => families.includes(`"${family}"`) || families.includes(family);
  const rules: CSSFontFaceRule[] = [];
  for (const sheet of document.styleSheets) {
    let list: CSSRuleList;
    try { list = sheet.cssRules; } catch { continue; }
    for (const rule of list) if (rule instanceof CSSFontFaceRule && wanted(rule.style.getPropertyValue("font-family").replace(/["']/g, ""))) rules.push(rule);
  }
  const faces = await Promise.all(rules.map(async (rule) => {
    const src = rule.style.getPropertyValue("src");
    const url = src.match(/url\(["']?([^"')]+)["']?\)/)?.[1];
    const data = url ? await asDataUrl(new URL(url, location.href).href) : null;
    if (!data) return "";
    const keep = ["font-family", "font-weight", "font-style"].map((p) => `${p}: ${rule.style.getPropertyValue(p)};`).join(" ");
    return `@font-face { ${keep} src: url("${data}"); font-display: block; }`;
  }));
  return faces.join("\n");
}

// The current theme as CSS for a sandboxed frame: the kit's tokens and the fonts they name.
export async function themeCss(): Promise<string> {
  const style = getComputedStyle(document.documentElement);
  const vars = KIT_VARS.map((name) => `${name}: ${style.getPropertyValue(name).trim()};`).join(" ");
  const scheme = style.colorScheme || "light dark";
  return `:root { ${vars} color-scheme: ${scheme}; }\n${await fontFaces(`${style.getPropertyValue("--font-text")}, ${style.getPropertyValue("--font-mono")}`)}`;
}

// Calls back after the theme, palette or text font changes.
export function onThemeChange(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-palette", "style"] });
  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", callback);
  return () => { observer.disconnect(); media.removeEventListener("change", callback); };
}
