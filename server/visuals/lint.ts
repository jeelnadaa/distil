// Design lint for mini-apps (F-755): the kit styles everything, so hard-coded colours, fonts, external
// stylesheets and scripts, and APIs the sandbox blocks are errors. Each message is short and says what to
// use instead, because the fix call carries only these messages and the code. Pure, for browser and server.

const COLOUR_PROPS = /(?:^|[\s;{"'])(color|background(?:-color)?|fill|stroke|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?|box-shadow|text-shadow|caret-color|accent-color)\s*:\s*([^;}"'\n]+)/gi;
const ALLOWED_VALUE = /^(var\(--[\w-]+\)|currentcolor|transparent|inherit|none|0|initial|unset)$/i;
const COLOUR_LITERAL = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|\b(?:rgba?|hsla?|oklch|hwb|lab|lch)\(/i;
const STRING_COLOUR = /["'`]\s*(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?)\([^)]*\))\s*["'`]/i;
const NAMED_COLOUR = /\b(black|white|red|green|blue|gray|grey|orange|yellow|purple|pink|brown|navy|teal|cyan|magenta|lime|maroon|olive|silver|gold|crimson|coral|salmon|tomato|violet|indigo)\b/i;

type Rule = { test: RegExp; message: string };
const RULES: Rule[] = [
  { test: /<link\b/i, message: "Remove <link>: the kit already provides the styles and nothing external can load." },
  { test: /<script\b[^>]*\bsrc\s*=/i, message: "Remove <script src>: nothing external can load; write the code inline." },
  { test: /<(iframe|object|embed)\b/i, message: "Remove nested frames and embeds." },
  { test: /@import\b|@font-face\b/i, message: "Remove @import and @font-face: fonts and styles come from the kit." },
  { test: /font-family\s*:|(?:^|[\s;{"'])font\s*:/i, message: "Remove font-family/font: text uses the kit's font. Use the kit's type classes." },
  { test: /\.font\s*=\s*["'`](?![^"'`]*\bvar\()/, message: "Set canvas fonts with distil.font(size), not a literal font." },
  { test: /(fillStyle|strokeStyle|shadowColor)\s*=\s*["'`]/, message: "Set canvas colours with distil.color('ink' | 'muted' | 'accent' | 'viz-1'…'viz-6'), not a literal." },
  { test: /!important/i, message: "Remove !important: don't fight the kit's styles." },
  { test: /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(|new\s+(XMLHttpRequest|WebSocket|EventSource)\b/, message: "Remove network calls: mini-apps run offline with no network access." },
  { test: /\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/, message: "Remove storage (localStorage, cookies): the sandbox has none. Keep state in variables." },
  { test: /\b(window\.parent|window\.top|parent\.postMessage|top\.location)\b/, message: "Don't reach outside the mini-app (parent, top)." },
  { test: /\b(alert|confirm|prompt)\s*\(/, message: "Replace alert/confirm/prompt with a .readout or a button: dialogs are blocked." },
];

export function lintMiniApp(html: string): string[] {
  const errors: string[] = [];
  const lines = html.split("\n");
  const at = (index: number) => html.slice(0, index).split("\n").length;
  for (const rule of RULES) {
    const m = rule.test.exec(html);
    if (m) errors.push(`Line ${at(m.index)}: ${rule.message}`);
  }
  // Colour declarations in <style>, style="" and element.style must use the kit's tokens.
  for (const m of html.matchAll(COLOUR_PROPS)) {
    const value = m[2]!.trim();
    if (ALLOWED_VALUE.test(value) || /^var\(--[\w-]+\)/.test(value)) continue;
    if (COLOUR_LITERAL.test(value) || NAMED_COLOUR.test(value)) {
      errors.push(`Line ${at(m.index!)}: "${m[1]}: ${value.slice(0, 30)}" hard-codes a colour. Use var(--text), var(--text-muted), var(--accent), var(--viz-1)…var(--viz-6) or a kit class.`);
    }
  }
  // Any other colour literal: in JS strings or SVG/HTML colour attributes.
  lines.forEach((line, i) => {
    const attribute = [...line.matchAll(/\b(?:fill|stroke|color)\s*=\s*["']([^"']+)["']/gi)].find((m) => !ALLOWED_VALUE.test(m[1]!) && !m[1]!.startsWith("var(--"));
    const literal = line.match(STRING_COLOUR)?.[0] ?? attribute?.[0];
    if (literal && !errors.some((e) => e.startsWith(`Line ${i + 1}:`))) {
      errors.push(`Line ${i + 1}: ${literal.slice(0, 30)} hard-codes a colour. Use distil.color(…) in scripts or a kit class in markup.`);
    }
  });
  return errors.slice(0, 20);
}
