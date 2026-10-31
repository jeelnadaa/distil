import { SPRINGS, spring, observeReveals, prefersReducedMotion, initTheme, toggleTheme, currentTheme, initSegmented, countUp } from "./motion.js";
import { injectIcons, icon } from "./icons.js";
import { initPalette, mountPaletteSwitcher } from "./palette.js";
import { markSVG, lockupHTML, wordmarkHTML } from "./brand.js";

initTheme();
initPalette();
mountPaletteSwitcher();
injectIcons();

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Seeded PRNG so decorative data is identical on every load.
function rng(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

/* ---------- Brand slots & theme ---------- */
$('[data-slot="lockup"]').innerHTML = lockupHTML({ size: 26 });
$('[data-slot="lockup-small"]').innerHTML = wordmarkHTML();
$('[data-slot="mark-animated"]').innerHTML = markSVG({ size: 72, animated: true, label: "Distil" });

const themeBtn = $("[data-theme-toggle]");
const paintThemeIcon = () => { themeBtn.innerHTML = icon(currentTheme() === "dark" ? "sun" : "moon", "icon icon--sm"); };
paintThemeIcon();
themeBtn.addEventListener("click", () => {
  toggleTheme();
  paintThemeIcon();
  document.dispatchEvent(new Event("distil:theme"));
});

/* ---------- Nav ---------- */
const nav = $("[data-nav]");
const onScrollNav = () => nav.classList.toggle("is-scrolled", scrollY > 8);
addEventListener("scroll", onScrollNav, { passive: true });
onScrollNav();

observeReveals();
initSegmented();

/* ---------- The Still (hero) ---------- */
const ITEMS = [
  { t: "Fourier series", chip: "Concept", a: "p.2", k: "term" },
  { t: "x(t) = Σ cₙ e^{jnω₀t}", label: "Synthesis equation", chip: "Formula", a: "p.3", k: "math" },
  { t: "Periodic signal", chip: "Definition", a: "p.5", k: "term" },
  { t: "Dirichlet conditions", chip: "Theorem", a: "p.9", k: "term" },
  { t: "cₙ = 1/T ∫ x(t) e^{−jnω₀t} dt", label: "Analysis equation", chip: "Formula", a: "p.10", k: "math" },
  { t: "Square wave example", chip: "Example", a: "p.11", k: "plain" },
  { t: "Gibbs phenomenon", chip: "Concept", a: "p.13", k: "term" },
  { t: "Parseval's theorem", chip: "Theorem", a: "p.14", k: "term" },
  { t: "P = Σ |cₙ|²", label: "Average power", chip: "Formula", a: "p.14", k: "math" },
  { t: "Even / odd symmetry", chip: "Concept", a: "p.16", k: "plain" },
  { t: "Finding cₙ step by step", chip: "Procedure", a: "p.17", k: "plain" },
  { t: "Line spectrum", chip: "Diagram", a: "p.19", k: "term" },
  { t: "ω₀ = 2π / T", label: "Fundamental frequency", chip: "Formula", a: "p.3", k: "math" },
  { t: "Half-wave symmetry", chip: "Concept", a: "p.20", k: "plain" },
];
const NOISE = ["therefore", "see Fig. 2.4", "recall that", "as shown", "Lecture 6", "(cont.)", "note:", "i.e.", "page 12 of 40", "it follows", "Ex. 2.3", "hence", "© Dept. of EE"];

const still = $("[data-still]");
const field = $("[data-field]", still);
const filter = $("[data-filter]", still);
const rows = $("[data-rows]", still);
const countEl = $("[data-count]", still);
const barEl = $("[data-bar]", still);
const doneEl = $("[data-done]", still);
const runBtn = $("[data-run]", still);
$("[data-total]", still).textContent = ITEMS.length;

let frags = [];
let pointer = { x: -999, y: -999 };
let running = false;
let interacted = false;

function buildFragments() {
  field.querySelectorAll(".frag").forEach((el) => el.remove());
  const r = rng(7);
  const w = field.clientWidth;
  const h = field.clientHeight;
  const all = [
    ...ITEMS.map((item, i) => ({ ...item, item: true, i })),
    ...NOISE.map((t) => ({ t, k: "noise", item: false })),
  ];
  // Shuffle, then lay out two per row (left/right lanes) so fragments never pile up.
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  const rowCount = Math.ceil(all.length / 2);
  const top = 52;
  const step = (h - top - 110) / rowCount;
  frags = all.map((d, i) => {
    const el = document.createElement("span");
    el.className = `frag${d.k === "math" ? " frag--math" : d.k === "term" ? " frag--term" : ""}`;
    el.textContent = d.t;
    field.append(el);
    const fw = el.offsetWidth;
    const lane = i % 2;
    const laneStart = lane ? w * 0.42 : 16;
    const laneRoom = Math.max(0, (lane ? w - 16 : w * 0.62) - laneStart - fw);
    return {
      ...d,
      el,
      w: fw,
      x: Math.min(laneStart + r() * laneRoom, w - fw - 12),
      y: top + Math.floor(i / 2) * step + lane * step * 0.5,
      phase: r() * Math.PI * 2,
      amp: 3 + r() * 6,
      speed: 0.25 + r() * 0.35,
      travel: null,
      gone: false,
    };
  });
}

field.addEventListener("pointermove", (e) => {
  const b = field.getBoundingClientRect();
  pointer = { x: e.clientX - b.left, y: e.clientY - b.top };
  interacted = true;
});
field.addEventListener("pointerleave", () => { pointer = { x: -999, y: -999 }; });

function frame(now) {
  const t = now / 1000;
  const still = prefersReducedMotion();
  for (const f of frags) {
    if (f.gone) continue;
    let x = f.x + (still ? 0 : Math.sin(t * f.speed + f.phase) * f.amp);
    let y = f.y + (still ? 0 : Math.cos(t * f.speed * 0.8 + f.phase) * f.amp * 0.6);
    const cx = x + f.w / 2;
    const d = Math.hypot(cx - pointer.x, y - pointer.y);
    let focus = clamp(1 - d / 150);
    let scale = 1;
    let opacity;
    if (f.travel) {
      const p = f.travel.p;
      const { sx, sy, tx, ty } = f.travel;
      const mx = (sx + tx) / 2;
      const my = Math.min(sy, ty) - 30;
      x = (1 - p) * (1 - p) * sx + 2 * (1 - p) * p * mx + p * p * tx - f.w / 2 * p;
      y = (1 - p) * (1 - p) * sy + 2 * (1 - p) * p * my + p * p * ty;
      focus = Math.max(focus, clamp(p * 2));
      scale = 1 - p * 0.55;
      opacity = 1 - clamp((p - 0.82) / 0.18);
    } else if (f.evaporate != null) {
      focus = 0;
      opacity = (1 - f.evaporate) * 0.4;
      y -= f.evaporate * 24;
    } else {
      opacity = (f.item ? 0.42 : 0.26) + 0.58 * focus;
    }
    const blur = (1 - focus) * (f.item ? 2.2 : 3.2);
    const spacing = (1 - focus) * 0.08;
    f.el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    f.el.style.opacity = opacity;
    f.el.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "none";
    f.el.style.letterSpacing = `${spacing.toFixed(3)}em`;
    f.el.style.color = focus > 0.6 && f.item ? "var(--text)" : "";
  }
  requestAnimationFrame(frame);
}

function filterTarget() {
  const fb = filter.getBoundingClientRect();
  const b = field.getBoundingClientRect();
  const horizontal = fb.width > fb.height;
  return { horizontal, x: horizontal ? b.width / 2 : fb.left - b.left, y: horizontal ? fb.top - b.top : null, h: b.height };
}

function addRow(item) {
  const li = document.createElement("li");
  li.innerHTML = `<span class="chip">${item.chip}</span><span>${item.label ?? item.t}</span><span class="anchor">${item.a}</span>`;
  rows.prepend(li);
}

async function run() {
  if (running) return;
  running = true;
  interacted = true;
  still.classList.add("is-running");
  doneEl.classList.remove("is-on");
  runBtn.disabled = true;
  rows.innerHTML = "";
  countEl.textContent = "0";
  barEl.style.width = "0%";
  if (frags.some((f) => f.gone || f.travel || f.evaporate != null)) buildFragments();

  const target = filterTarget();
  const reduce = prefersReducedMotion();
  const noise = frags.filter((f) => !f.item);
  noise.forEach((f, i) => {
    setTimeout(() => {
      if (reduce) { f.gone = true; f.el.style.opacity = 0; return; }
      f.evaporate = 0;
      spring(0, 1, (v) => { f.evaporate = v; }, SPRINGS.gentle, () => { f.gone = true; f.el.style.opacity = 0; });
    }, i * 90);
  });

  const items = frags.filter((f) => f.item);
  let done = 0;
  for (const [i, f] of items.entries()) {
    await new Promise((r) => setTimeout(r, reduce ? 60 : 210));
    const sx = f.x + f.w / 2;
    const sy = f.y;
    const tx = target.x;
    const ty = target.horizontal ? target.y : clamp(sy, 40, target.h - 40);
    filter.style.setProperty(target.horizontal ? "--fx" : "--fy", target.horizontal ? `${(tx / field.clientWidth) * 100}%` : `${ty}px`);
    const land = () => {
      f.gone = true;
      f.el.style.opacity = 0;
      addRow(f);
      done += 1;
      countEl.textContent = done;
      barEl.style.width = `${(done / items.length) * 100}%`;
      if (done === items.length) finish();
    };
    if (reduce) { land(); continue; }
    f.travel = { p: 0, sx, sy, tx, ty };
    spring(0, 1, (v) => { f.travel.p = v; }, { stiffness: 90, damping: 18, mass: 1 }, land);
    if (i === items.length - 1) break;
  }
}

function finish() {
  setTimeout(() => {
    doneEl.classList.add("is-on");
    still.classList.remove("is-running");
    still.classList.add("has-run");
    runBtn.disabled = false;
    runBtn.querySelector("span").textContent = "Run again";
    runBtn.querySelector("use").setAttribute("href", "#i-refresh");
    running = false;
  }, 260);
}

runBtn.addEventListener("click", run);
document.fonts.ready.then(() => {
  buildFragments();
  requestAnimationFrame(frame);
  setTimeout(() => { if (!interacted && still.getBoundingClientRect().top < innerHeight) run(); }, 2200);
});
let resizeTimer;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (!running) buildFragments(); }, 200);
});

/* ---------- Brief compiler demo ---------- */
const briefDemo = $("[data-brief-demo]");
const typed = $("[data-typed]", briefDemo);
const PROMPT = "make study plan for unit 3 pls exam thursday";
new IntersectionObserver(([entry], io) => {
  if (!entry.isIntersecting) return;
  io.disconnect();
  const fields = $$(".brief__field", briefDemo);
  const showFields = () => fields.forEach((el, i) => setTimeout(() => el.classList.add("is-in"), i * 140));
  if (prefersReducedMotion()) { typed.textContent = PROMPT; showFields(); return; }
  let n = 0;
  const tick = () => {
    typed.textContent = PROMPT.slice(0, ++n);
    if (n < PROMPT.length) setTimeout(tick, 34 + Math.random() * 50);
    else setTimeout(showFields, 350);
  };
  tick();
}, { threshold: 0.4 }).observe(briefDemo);

/* ---------- Scroll progress helper ---------- */
function sectionProgress(el) {
  const b = el.getBoundingClientRect();
  const span = b.height - innerHeight;
  return span <= 0 ? 1 : clamp(-b.top / span);
}
const isStatic = () => prefersReducedMotion() || matchMedia("(max-width: 900px)").matches;

/* ---------- How it works ---------- */
const how = $("[data-how]");
const steps = $$("[data-step]", how);
const scenes = $$("[data-scene]", how);
const howBar = $("[data-how-progress]", how);
const heat = $("[data-heat]", how);
const heatVals = (() => { const r = rng(11); return Array.from({ length: 40 }, () => r()); })();
heat.innerHTML = heatVals.map(() => "<i></i>").join("");

function renderHow(step, local) {
  steps.forEach((s, i) => s.classList.toggle("is-active", isStatic() || i === step));
  scenes.forEach((s, i) => s.classList.toggle("is-active", i === step));
  const scene = scenes[step];
  if (step === 0) {
    scene.style.setProperty("--ex", local.toFixed(3));
    $$(".items li", scene).forEach((li, i) => li.classList.toggle("is-in", local > 0.12 + i * 0.15));
  } else if (step === 1) {
    scene.style.setProperty("--draw", clamp(local * 1.6 - 0.2).toFixed(3));
    $$(".dag__nodes g", scene).forEach((g, i) => g.style.setProperty("--node", local > i * 0.12 ? 1 : 0));
  } else if (step === 2) {
    scene.toggleAttribute("data-picked", local > 0.45);
  } else {
    scene.style.setProperty("--flip", clamp((local - 0.15) * 2.4).toFixed(3));
    const fill = clamp(local * 1.4);
    $$("i", heat).forEach((cell, i) => cell.style.setProperty("--m", (heatVals[i] * fill).toFixed(3)));
  }
}

let howCycle;
function updateHow() {
  if (isStatic()) {
    if (!howCycle) {
      let s = 0;
      renderHow(0, 1);
      howCycle = setInterval(() => { s = (s + 1) % 4; renderHow(s, 1); }, 3600);
    }
    howBar.style.setProperty("--p", 1);
    return;
  }
  if (howCycle) { clearInterval(howCycle); howCycle = null; }
  const p = sectionProgress(how);
  const step = Math.min(3, Math.floor(p * 4));
  const local = clamp(p * 4 - step);
  howBar.style.setProperty("--p", p.toFixed(3));
  renderHow(step, local);
}

/* ---------- Coverage scrub ---------- */
const cov = $("[data-cov]");
const covFills = $$("[data-cov-fill]", cov);
const covNums = $$("[data-cov-num]", cov);
const covBars = $("[data-cov-bars]", cov);
const covDrop = $("[data-cov-drop]", cov);
function updateCoverage() {
  const p = isStatic() ? 1 : sectionProgress(cov);
  const vals = [clamp(p / 0.3), clamp((p - 0.15) / 0.38), clamp((p - 0.3) / 0.42)];
  vals.forEach((v, i) => {
    covFills[i].style.setProperty("--v", v.toFixed(3));
    covNums[i].textContent = `${Math.round(v * 100)}%`;
  });
  const merge = isStatic() ? 1 : clamp((p - 0.76) / 0.12);
  $$(".cov-bar", covBars).forEach((b) => b.style.setProperty("--merge", merge.toFixed(3)));
  covDrop.classList.toggle("is-on", merge >= 1);
}

let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { updateHow(); updateCoverage(); ticking = false; });
}
addEventListener("scroll", onScroll, { passive: true });
addEventListener("resize", onScroll);
onScroll();

/* ---------- Fourier widget ---------- */
const canvas = $("[data-fourier]");
const ctx = canvas.getContext("2d");
const slider = $("[data-harmonics]");
const sliderOut = $("[data-harmonics-out]");
const showComponents = $("[data-components]");
let harmonics = Number(slider.value);
let stopSpring = () => {};

function drawFourier() {
  const dpr = devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const ink = cssVar("--text");
  const faint = cssVar("--border");
  const accent = cssVar("--accent");
  const muted = cssVar("--text-faint");
  const mid = h / 2;
  const amp = h * 0.32;
  const periods = 2;
  const X = (i) => (i / w) * periods * 2 * Math.PI;

  ctx.strokeStyle = faint;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();

  // Target square wave
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = muted;
  ctx.beginPath();
  for (let i = 0; i <= w; i++) {
    const y = mid - Math.sign(Math.sin(X(i))) * amp;
    i ? ctx.lineTo(i, y) : ctx.moveTo(i, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  const full = Math.floor(harmonics);
  const frac = harmonics - full;
  const terms = [];
  for (let k = 0; k < full; k++) terms.push({ n: 2 * k + 1, weight: 1 });
  if (frac > 0.001) terms.push({ n: 2 * full + 1, weight: frac });

  if (showComponents.checked) {
    ctx.strokeStyle = faint;
    ctx.globalAlpha = 0.9;
    terms.slice(0, 8).forEach(({ n, weight }) => {
      ctx.beginPath();
      for (let i = 0; i <= w; i++) {
        const y = mid - (4 / Math.PI) * (Math.sin(n * X(i)) / n) * amp * weight;
        i ? ctx.lineTo(i, y) : ctx.moveTo(i, y);
      }
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i <= w; i++) {
    let s = 0;
    for (const { n, weight } of terms) s += (Math.sin(n * X(i)) / n) * weight;
    const y = mid - (4 / Math.PI) * s * amp;
    i ? ctx.lineTo(i, y) : ctx.moveTo(i, y);
  }
  ctx.stroke();

  ctx.fillStyle = ink;
  ctx.font = `500 11px ${cssVar("--font-mono")}`;
  ctx.fillText(`N = ${Math.round(harmonics)} odd harmonics`, 12, 20);
}

function setSliderFill() {
  const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
  slider.style.setProperty("--fill", `${pct}%`);
}
slider.addEventListener("input", () => {
  sliderOut.textContent = slider.value;
  setSliderFill();
  stopSpring();
  stopSpring = spring(harmonics, Number(slider.value), (v) => { harmonics = v; drawFourier(); }, SPRINGS.snappy);
});
showComponents.addEventListener("change", drawFourier);
document.addEventListener("distil:theme", drawFourier);
addEventListener("resize", drawFourier);
setSliderFill();
document.fonts.ready.then(drawFourier);

const DIAL_NOTES = {
  text: "Text and maths only. Distil offers a visual, but never builds one unasked.",
  balanced: "Visuals only when a concept is dynamic, spatial or a process.",
  visual: "A diagram, plot or small app for nearly every step.",
};
$("[data-dial]").addEventListener("change", (e) => { $("[data-dial-note]").textContent = DIAL_NOTES[e.detail]; });

/* ---------- Retention panel ---------- */
const mastery = $("[data-mastery]");
const mr = rng(3);
mastery.innerHTML = Array.from({ length: 96 }, (_, i) => {
  const col = i % 16;
  const m = clamp(1.05 - col / 16 + (mr() - 0.5) * 0.5, 0.04, 1);
  return `<i style="--m:${m.toFixed(2)};--d:${i}"></i>`;
}).join("");
new IntersectionObserver(([entry], io) => {
  if (!entry.isIntersecting) return;
  io.disconnect();
  mastery.classList.add("is-in");
  $$("[data-count-to]").forEach((el) => countUp(el, Number(el.dataset.countTo)));
}, { threshold: 0.3 }).observe(mastery);

/* ---------- Usage chart ---------- */
const chart = $("[data-usage-chart]");
(function buildChart() {
  const r = rng(19);
  const days = 14;
  const W = 420, H = 180, padB = 20, top = 10;
  const cap = 220;
  const scale = (H - padB - top) / 260;
  const bw = (W / days) * 0.56;
  let bars = "";
  for (let d = 0; d < days; d++) {
    // Totals stay under the daily cap: a hard stop means a bar can never cross the line.
    const input = 40 + r() * 70;
    const output = 15 + r() * 40;
    const cached = 10 + r() * 30;
    const x = (W / days) * d + (W / days - bw) / 2;
    let y = H - padB;
    for (const [v, c] of [[input, "var(--viz-1)"], [output, "var(--viz-2)"], [cached, "var(--viz-3)"]]) {
      const hgt = v * scale;
      y -= hgt;
      bars += `<rect class="bar" style="--d:${d}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${(hgt - 1).toFixed(1)}" rx="1.5" fill="${c}"/>`;
    }
    if (d % 3 === 0) bars += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${17 + d} Oct</text>`;
  }
  const capY = H - padB - cap * scale;
  chart.innerHTML = `${bars}<line x1="0" x2="${W}" y1="${capY}" y2="${capY}" stroke="var(--text-faint)" stroke-dasharray="4 4"/><text x="${W}" y="${capY - 6}" text-anchor="end">cap 220k/day</text>`;
  new IntersectionObserver(([entry], io) => { if (entry.isIntersecting) { chart.classList.add("is-in"); io.disconnect(); } }, { threshold: 0.3 }).observe(chart);
})();
