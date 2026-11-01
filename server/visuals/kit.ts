// The Distil kit (F-754): what every sandboxed mini-app is built with. The host fills in the current theme's
// tokens and fonts and sends new ones when the theme, palette or text font changes (F-756), so a mini-app
// never carries its own colours or fonts. Pure: the builder's prompt and the browser's frame share it.

// The tokens a mini-app can use, copied from the host page's computed style.
export const KIT_VARS = [
  "--bg", "--surface", "--surface-sunken", "--border", "--border-control", "--text", "--text-muted", "--text-faint",
  "--primary", "--on-primary", "--accent", "--accent-wash", "--on-accent", "--success", "--success-wash", "--warning",
  "--warning-wash", "--danger", "--danger-wash", "--viz-1", "--viz-2", "--viz-3", "--viz-4", "--viz-5", "--viz-6",
  "--font-text", "--font-mono", "--r-xs", "--r-sm", "--r-md", "--s-1", "--s-2", "--s-3", "--s-4", "--s-5", "--s-6",
  "--t-heading-sm", "--t-body", "--t-body-sm", "--t-caption", "--t-eyebrow", "--t-mono",
] as const;

const BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html { color-scheme: light dark; }
body { margin: 0; padding: var(--s-4); background: var(--surface); color: var(--text); font-family: var(--font-text); font-size: var(--t-body-sm); line-height: 1.5; -webkit-font-smoothing: antialiased; }
h1, h2, h3 { font-size: var(--t-heading-sm); font-weight: 600; margin: 0 0 var(--s-2); }
p { margin: 0 0 var(--s-2); }
.muted { color: var(--text-muted); }
.caption { font-size: var(--t-caption); color: var(--text-muted); }
.eyebrow { font-size: var(--t-eyebrow); letter-spacing: .08em; text-transform: uppercase; color: var(--text-muted); font-weight: 600; }
.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.row { display: flex; align-items: center; gap: var(--s-3); flex-wrap: wrap; }
.stack { display: grid; gap: var(--s-3); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--s-3); }
.card { background: var(--surface-sunken); border: 1px solid var(--border); border-radius: var(--r-md); padding: var(--s-3); }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--s-2); height: 32px; padding: 0 var(--s-3); border-radius: var(--r-sm); border: 1px solid var(--border-control); background: var(--surface); color: var(--text); font: 600 13px var(--font-text); cursor: pointer; }
.btn:hover { border-color: var(--text-muted); }
.btn:active { transform: scale(.98); }
.btn:disabled { opacity: .5; cursor: default; }
.btn.primary { background: var(--primary); color: var(--on-primary); border-color: transparent; }
.btn.accent { background: var(--accent); color: var(--on-accent); border-color: transparent; }
.btn:focus-visible, .slider input:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.slider { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--s-3); font-size: var(--t-body-sm); }
.slider input[type=range] { width: 100%; accent-color: var(--accent); }
.slider output, .readout { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.readout { display: inline-flex; gap: var(--s-2); align-items: baseline; padding: var(--s-1) var(--s-2); border-radius: var(--r-sm); background: var(--surface-sunken); }
.readout b { font-weight: 600; color: var(--text); }
.plot, canvas, svg { display: block; max-width: 100%; }
.plot { width: 100%; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--surface); }
.steps { display: flex; gap: var(--s-2); align-items: center; }
input[type=number], input[type=text], select { height: 32px; padding: 0 var(--s-2); border: 1px solid var(--border-control); border-radius: var(--r-sm); background: var(--surface); color: var(--text); font: inherit; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: var(--s-1) var(--s-2); border-bottom: 1px solid var(--border); }
.accent { color: var(--accent); }
.good { color: var(--success); } .warn { color: var(--warning); } .bad { color: var(--danger); }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;

// Runs before the mini-app's own code: the distil helpers, and reports of errors and height to the host.
const KIT_SCRIPT = `(() => {
  const post = (msg) => parent.postMessage(Object.assign({ distil: true }, msg), "*");
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const NAMES = { ink: "--text", text: "--text", muted: "--text-muted", faint: "--text-faint", accent: "--accent", "accent-wash": "--accent-wash",
    surface: "--surface", sunken: "--surface-sunken", border: "--border", grid: "--border", good: "--success", warn: "--warning", bad: "--danger",
    "viz-1": "--viz-1", "viz-2": "--viz-2", "viz-3": "--viz-3", "viz-4": "--viz-4", "viz-5": "--viz-5", "viz-6": "--viz-6" };
  const listeners = [];
  window.distil = {
    color: (name) => css(NAMES[name] || "--text"),
    font: (size, weight) => (weight || 400) + " " + (size || 14) + "px " + css("--font-text"),
    mono: (size) => (size || 13) + "px " + css("--font-mono"),
    onTheme: (fn) => { listeners.push(fn); },
    // Sizes a canvas for the screen and calls draw(ctx, width, height) in CSS pixels, again on every resize
    // and theme change. Returns a function that redraws on demand.
    fit: (canvas, draw) => {
      const ctx = canvas.getContext("2d");
      const paint = () => {
        const box = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
        const w = Math.max(1, Math.round(box.width)), h = Math.max(1, Math.round(box.height));
        if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        draw(ctx, w, h);
      };
      new ResizeObserver(paint).observe(canvas);
      listeners.push(paint);
      paint();
      return paint;
    },
  };
  const report = (message) => post({ type: "error", message: String(message).slice(0, 500) });
  addEventListener("error", (e) => report(e.message + (e.lineno ? " (line " + e.lineno + ")" : "")));
  addEventListener("unhandledrejection", (e) => report(e.reason && e.reason.message ? e.reason.message : e.reason));
  const original = console.error;
  console.error = (...args) => { report(args.map(String).join(" ")); original.apply(console, args); };
  addEventListener("message", (e) => {
    if (e.source !== parent || !e.data || e.data.distil !== "theme") return;
    document.getElementById("kit-theme").textContent = e.data.css;
    for (const fn of listeners) { try { fn(); } catch (err) { report(err && err.message ? err.message : err); } }
  });
  let last = 0;
  // The body, not the document: a document is never shorter than its frame, so it could only ever grow.
  const size = () => { const h = Math.ceil(document.body.getBoundingClientRect().height); if (h !== last) { last = h; post({ type: "height", height: h }); } };
  addEventListener("load", () => { size(); new ResizeObserver(size).observe(document.body); post({ type: "ready" }); });
})();`;

// Only inline code runs; nothing can load from or talk to the network, and fonts arrive as data URLs.
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

// themeCss: ":root { --text: …; … }" plus any @font-face rules, from themeStyle() in the browser.
export function kitDocument(body: string, themeCss: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1"><style id="kit-theme">${themeCss}</style><style>${BASE_CSS}</style>
<script>${KIT_SCRIPT}</script></head><body>${body}</body></html>`;
}

// What the builder model is told about the kit (F-754). Short: it is sent with every build.
export const KIT_GUIDE = `The page already has the Distil kit; use it instead of styling things yourself.
Classes: .row .stack .grid (layout), .card, .btn (.btn.primary, .btn.accent for the one key action), .slider (a label, an <input type=range>, an <output>), .readout (<span class="readout">v = <b>3.2</b> m/s</span>), .plot (a <canvas> or <svg>), .steps (step controls), .eyebrow .caption .muted .mono, .accent .good .warn .bad (text tones).
CSS variables: --text --text-muted --text-faint --accent --accent-wash --surface --surface-sunken --border --success --warning --danger --viz-1 … --viz-6, spacing --s-1 … --s-6, radii --r-sm --r-md.
In scripts: distil.color("ink" | "muted" | "accent" | "grid" | "good" | "warn" | "bad" | "viz-1" … "viz-6") returns the current colour for canvas drawing, distil.font(size, weight) and distil.mono(size) return canvas fonts, and distil.onTheme(redraw) re-runs your drawing when the learner changes theme. Read colours at draw time, never once at start.
For a canvas, give it a CSS height and draw with const redraw = distil.fit(canvas, (ctx, w, h) => { … }): it sizes the canvas for the screen, redraws on resize and theme change, and redraw() repaints after your state changes.`;
