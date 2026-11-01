// SVG sanitiser (F-753). Precise figures may only use a restricted profile: shapes, paths and text with
// classes from a fixed set. Everything else is removed: scripts, styles, event handlers, links, foreign
// content, and any attribute or value outside the allow-list. Stray colours become the nearest token
// class, so a model's "#e33" turns into `accent` and still follows the theme. Pure, for browser and server.

export const SVG_CLASSES = ["ink", "muted", "accent", "fill-1", "fill-2", "fill-3", "fill-4", "fill-5", "fill-6", "label", "grid"] as const;

const ELEMENTS = new Set(["svg", "g", "defs", "marker", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "title", "desc"]);
const VOID_OK = new Set([...ELEMENTS].filter((e) => !["svg", "g", "defs", "marker", "text", "tspan", "title", "desc"].includes(e)));

const NUM = /^-?(\d+\.?\d*|\.\d+)(e-?\d+)?(%|px)?$/i;
const ATTRS: Record<string, RegExp> = {
  x: NUM, y: NUM, x1: NUM, y1: NUM, x2: NUM, y2: NUM, cx: NUM, cy: NUM, r: NUM, rx: NUM, ry: NUM, width: NUM, height: NUM,
  dx: NUM, dy: NUM, markerwidth: NUM, markerheight: NUM, refx: NUM, refy: NUM,
  d: /^[MmLlHhVvCcSsQqTtAaZz\d\s,.eE+-]*$/,
  points: /^[\d\s,.eE+-]*$/,
  transform: /^(\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\([\d\s,.eE+-]*\)\s*,?)+$/,
  viewbox: /^\s*-?[\d.]+([\s,]+-?[\d.]+){3}\s*$/,
  "text-anchor": /^(start|middle|end)$/,
  "dominant-baseline": /^(auto|middle|central|hanging|alphabetic|ideographic|mathematical|text-top|text-bottom)$/,
  orient: /^(auto|auto-start-reverse|-?[\d.]+)$/,
  markerunits: /^(strokeWidth|userSpaceOnUse)$/,
  preserveaspectratio: /^[\w\s]+$/,
  id: /^[A-Za-z][\w-]{0,40}$/,
  "marker-start": /^url\(#[A-Za-z][\w-]*\)$/, "marker-mid": /^url\(#[A-Za-z][\w-]*\)$/, "marker-end": /^url\(#[A-Za-z][\w-]*\)$/,
  role: /^(img|presentation|group)$/,
  "aria-label": /^[^<>]{0,200}$/,
};
const CASED: Record<string, string> = { viewbox: "viewBox", markerwidth: "markerWidth", markerheight: "markerHeight", refx: "refX", refy: "refY", markerunits: "markerUnits", preserveaspectratio: "preserveAspectRatio" };

// Reference values (Copper, light) used only to decide which token a literal colour was closest to.
const TOKEN_COLOURS: [string, [number, number, number]][] = [
  ["ink", [0x15, 0x13, 0x0f]], ["muted", [0x57, 0x52, 0x4a]], ["accent", [0xa8, 0x46, 0x1a]],
  ["fill-1", [0x2a, 0x27, 0x23]], ["fill-3", [0x4f, 0x6e, 0x4b]], ["fill-4", [0x4a, 0x5f, 0x6b]], ["fill-5", [0x8a, 0x6a, 0x1e]], ["fill-6", [0x7e, 0x4e, 0x40]],
];
const NAMED: Record<string, string> = {
  black: "000", white: "fff", red: "f00", green: "080", blue: "00f", gray: "888", grey: "888", orange: "f80", yellow: "ff0",
  purple: "808", brown: "a52", teal: "088", navy: "008", maroon: "800", olive: "880", pink: "f8c", cyan: "0ff", magenta: "f0f", lime: "0f0",
};

function parseColour(value: string): [number, number, number] | null {
  const v = value.trim().toLowerCase();
  const hex = (NAMED[v] ?? v.replace(/^#/, "")).match(/^([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/)?.[1];
  if (hex && (NAMED[v] || v.startsWith("#"))) {
    const full = hex.length <= 4 ? [...hex.slice(0, 3)].map((c) => c + c).join("") : hex.slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

// The token class for a literal colour; null for near-white, which is the paper the figure sits on.
export function nearestToken(value: string, forText: boolean): string | null {
  const rgb = parseColour(value);
  if (!rgb) return null;
  const light = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  if (light > 0.85) return null;
  const candidates = forText ? TOKEN_COLOURS.slice(0, 3) : TOKEN_COLOURS;
  let best = candidates[0]!;
  let bestDistance = Infinity;
  for (const c of candidates) {
    const d = c[1].reduce((sum, ch, i) => sum + (ch - rgb[i]!) ** 2, 0);
    if (d < bestDistance) { best = c; bestDistance = d; }
  }
  // A saturated red or orange reads as "the important one": that is what the accent is for.
  const saturated = Math.max(...rgb) - Math.min(...rgb) > 120;
  if (saturated && rgb[0] > rgb[2] && rgb[0] >= rgb[1]) return "accent";
  return best[0];
}

const escapeText = (text: string) => text.replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export type SanitizedSvg = { svg: string; removed: string[] };

const MAX_BYTES = 100_000;
const MAX_ELEMENTS = 2000;

export function sanitizeSvg(source: string): SanitizedSvg {
  if (source.length > MAX_BYTES) throw new Error("The figure is too large (100 kB max).");
  const removed = new Set<string>();
  const src = source.replace(/<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/gi, (m) => {
    if (!m.startsWith("<!--")) removed.add(m.startsWith("<?") ? "processing instruction" : m.startsWith("<!D") ? "doctype" : "CDATA");
    return "";
  });
  const open = /<\s*([A-Za-z][\w:.-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)\s*>/y;
  const close = /<\s*\/\s*([A-Za-z][\w:.-]*)\s*>/y;
  const attr = /([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
  const out: string[] = [];
  const stack: string[] = [];
  let skipping = 0; // depth inside a removed element, whose content goes with it
  let elements = 0;
  let sawRoot = false;
  let pos = 0;

  while (pos < src.length) {
    const lt = src.indexOf("<", pos);
    const text = src.slice(pos, lt === -1 ? src.length : lt);
    if (text && !skipping && stack.some((t) => t === "text" || t === "tspan" || t === "title" || t === "desc")) out.push(escapeText(text));
    if (lt === -1) break;
    pos = lt;
    close.lastIndex = pos;
    const c = close.exec(src);
    if (c) {
      pos = close.lastIndex;
      const name = c[1]!.toLowerCase();
      if (skipping) { if (stack.at(-1) === `!${name}`) { stack.pop(); skipping--; } continue; }
      if (stack.at(-1) === name) { stack.pop(); out.push(`</${name}>`); }
      continue;
    }
    open.lastIndex = pos;
    const o = open.exec(src);
    if (!o) { pos += 1; if (!skipping && stack.some((t) => t === "text" || t === "tspan")) out.push("&lt;"); continue; }
    pos = open.lastIndex;
    const name = o[1]!.toLowerCase();
    const selfClosing = o[3] === "/";
    if (skipping || !ELEMENTS.has(name) || (name === "svg" && sawRoot) || (name !== "svg" && !sawRoot)) {
      if (!skipping && name !== "svg") removed.add(`<${name}>`);
      if (selfClosing) continue;
      // Script and style bodies are raw text: skip straight to their end tag.
      if (name === "script" || name === "style") {
        const end = src.toLowerCase().indexOf(`</${name}`, pos);
        pos = end === -1 ? src.length : src.indexOf(">", end) + 1 || src.length;
        continue;
      }
      stack.push(`!${name}`);
      skipping++;
      continue;
    }
    if (++elements > MAX_ELEMENTS) throw new Error("The figure has too many elements (2000 max).");
    if (name === "svg") sawRoot = true;

    const kept: string[] = [];
    const classes = new Set<string>();
    const isText = name === "text" || name === "tspan";
    for (const a of o[2]!.matchAll(attr)) {
      const key = a[1]!.toLowerCase();
      const value = (a[2] ?? "").replace(/^["']|["']$/g, "");
      if (key === "class") {
        for (const cls of value.split(/\s+/)) {
          if ((SVG_CLASSES as readonly string[]).includes(cls)) classes.add(cls);
          else if (cls) removed.add(`class "${cls}"`);
        }
      } else if (key === "fill" || key === "stroke") {
        if (value === "none") kept.push(`${key}="none"`);
        else {
          const token = nearestToken(value, isText || key === "stroke");
          if (token) classes.add(token);
          removed.add(`${key}="${value}"`);
        }
      } else if (key === "xmlns" || key === "width" && name === "svg" || key === "height" && name === "svg") {
        continue;
      } else if (ATTRS[key]?.test(value)) {
        kept.push(`${CASED[key] ?? key}="${escapeAttr(value)}"`);
      } else {
        removed.add(key.startsWith("on") ? "event handler" : key === "style" ? "style" : key.includes("href") ? "link" : `${key}=`);
      }
    }
    if (name === "svg") {
      const viewBox = kept.find((k) => k.startsWith("viewBox="));
      if (!viewBox) {
        const size = (k: string) => o[2]!.match(new RegExp(`\\s${k}\\s*=\\s*["']?([\\d.]+)`, "i"))?.[1];
        const [w, h] = [size("width"), size("height")];
        if (!w || !h) throw new Error("The figure needs a viewBox (or a width and height).");
        kept.push(`viewBox="0 0 ${w} ${h}"`);
      }
      kept.unshift('xmlns="http://www.w3.org/2000/svg"');
    }
    if (classes.size) kept.push(`class="${[...classes].join(" ")}"`);
    const tag = `<${name}${kept.length ? " " + kept.join(" ") : ""}`;
    if (selfClosing && VOID_OK.has(name)) out.push(`${tag}/>`);
    else if (selfClosing) out.push(`${tag}></${name}>`);
    else { out.push(`${tag}>`); stack.push(name); }
  }
  if (!sawRoot) throw new Error("The figure has no <svg> element.");
  for (const name of stack.reverse()) if (!name.startsWith("!")) out.push(`</${name}>`);
  return { svg: out.join(""), removed: [...removed] };
}
