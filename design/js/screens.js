// Interactions for the app screen mock-ups, keyed by <body data-page>.
import { countUp, prefersReducedMotion, setMotionPref } from "./motion.js";
import { PALETTES, setPalette } from "./palette.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const page = document.body.dataset.page;
const typing = (e) => e.target.closest("input, textarea, select, [contenteditable]");

const screens = {
  teach() {
    // Step-through derivation
    const box = $("[data-derivation]");
    const lines = $$(".derivation li", box);
    const count = $("[data-deriv-count]", box);
    const next = $("[data-deriv-next]", box);
    let shown = 0;
    const render = () => {
      lines.forEach((li, i) => {
        li.classList.toggle("is-shown", i < shown);
        li.classList.toggle("is-latest", i === shown - 1);
      });
      count.textContent = `Line ${shown} of ${lines.length}`;
      next.disabled = shown >= lines.length;
    };
    next.addEventListener("click", () => { shown = Math.min(lines.length, shown + 1); render(); });
    $("[data-deriv-reset]", box).addEventListener("click", () => { shown = 1; render(); });
    shown = 1;
    render();

    // Check card
    const card = $("[data-check]");
    const opts = $$("[data-opt]", card);
    const submit = $("[data-submit]", card);
    let picked = null;
    const pick = (btn) => {
      if (card.classList.contains("is-answered")) return;
      picked = btn;
      opts.forEach((o) => o.setAttribute("aria-pressed", String(o === btn)));
      submit.disabled = false;
    };
    opts.forEach((o) => o.addEventListener("click", () => pick(o)));
    submit.addEventListener("click", () => {
      if (!picked) return;
      card.classList.add("is-answered");
      const right = picked.hasAttribute("data-correct");
      picked.classList.add(right ? "is-correct" : "is-wrong");
      if (!right) $("[data-correct]", card).classList.add("is-correct");
      card.classList.toggle("is-clarified", right);
      $(right ? "[data-verdict-ok]" : "[data-verdict-repair]", card).classList.add("is-on");
      submit.textContent = right ? "Continue" : "Show repair";
    });
    document.addEventListener("keydown", (e) => {
      if (typing(e)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= opts.length) pick(opts[n - 1]);
      if (e.key === "Enter" && picked) submit.click();
    });
  },

  workspace() {
    const out = $("[data-mini-out]");
    const pages = $("[data-mini-count]");
    const items = $("[data-mini-items]");
    const FEED = [["Formula", "Laplace transform"], ["Definition", "Region of convergence"], ["Theorem", "Final value theorem"], ["Procedure", "Partial fractions"], ["Example", "RC circuit response"], ["Concept", "Poles and zeros"], ["Formula", "Initial value theorem"]];
    let i = 0;
    const tick = () => {
      const [chip, name] = FEED[i % FEED.length];
      const li = document.createElement("li");
      li.innerHTML = `<span class="chip">${chip}</span>${name}`;
      out.prepend(li);
      while (out.children.length > 4) out.lastElementChild.remove();
      pages.textContent = Math.min(120, 34 + i * 3);
      items.textContent = 18 + i;
      i += 1;
    };
    tick(); tick(); tick();
    if (!prefersReducedMotion()) setInterval(tick, 1800);
  },

  plan() {
    $("[data-plan-view]").addEventListener("change", (e) => {
      $$("[data-plan-panel]").forEach((p) => { p.hidden = p.dataset.planPanel !== e.detail; });
    });
  },

  exam() {
    const timer = $("[data-timer]");
    let secs = 58 * 60 + 42;
    setInterval(() => {
      secs = Math.max(0, secs - 1);
      timer.textContent = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
      timer.classList.toggle("is-low", secs < 300);
    }, 1000);
    $("[data-exam-submit]").addEventListener("click", () => {
      const report = $("[data-report]");
      report.hidden = false;
      countUp($("[data-score]", report), 41, { duration: 1400 });
    });
  },

  review() {
    const CARDS = [
      ["Parseval's theorem for a periodic signal", "P = (1/T) ∫<sub>T</sub> |x(t)|² dt = Σ |c<sub>n</sub>|²"],
      ["Fundamental angular frequency", "ω₀ = 2π / T"],
      ["Analysis equation", "c<sub>n</sub> = (1/T) ∫<sub>T</sub> x(t) e<sup>−jnω₀t</sup> dt"],
      ["Convolution of x(t) and h(t)", "y(t) = ∫ x(τ) h(t − τ) dτ"],
    ];
    const total = 18;
    let done = 0;
    const review = $("[data-review]");
    const card = $("[data-card]");
    const left = $("[data-left]");
    const bar = $("[data-review-progress]");
    const reveal = () => { if (!review.classList.contains("is-revealed")) { review.classList.add("is-revealed"); card.classList.add("is-flipped"); } };
    const grade = () => {
      if (!review.classList.contains("is-revealed")) return;
      done += 1;
      left.textContent = total - done;
      bar.style.setProperty("--p", done / total);
      if (done >= 4) { review.hidden = true; $("[data-review-done]").hidden = false; return; }
      card.classList.add("is-leaving");
      setTimeout(() => {
        const [q, a] = CARDS[done % CARDS.length];
        $("[data-q]").innerHTML = q;
        $("[data-a]").innerHTML = a;
        card.classList.remove("is-flipped", "is-leaving");
        review.classList.remove("is-revealed");
      }, prefersReducedMotion() ? 0 : 260);
    };
    $("[data-reveal-card]").addEventListener("click", reveal);
    card.addEventListener("click", reveal);
    $$("[data-grade]").forEach((b) => b.addEventListener("click", grade));
    document.addEventListener("keydown", (e) => {
      if (typing(e)) return;
      if (e.key === " ") { e.preventDefault(); reveal(); }
      if (["1", "2", "3", "4"].includes(e.key)) grade();
    });
  },

  usage() {
    const svg = $("[data-bigchart]");
    const tip = $("[data-tip]");
    const W = 900, H = 260, padB = 24, top = 12;
    const days = 14;
    const cap = 220;
    const scale = (H - padB - top) / 240;
    const series = ["--viz-1", "--viz-2", "--viz-3", "--viz-4", "--viz-5"];
    let seed = 5;
    const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const data = Array.from({ length: days }, (_, d) => {
      const v = [45 + r() * 60, 12 + r() * 30, 8 + r() * 25, 4 + r() * 14, 6 + r() * 20];
      const sum = v.reduce((a, b) => a + b, 0);
      const fit = d === 13 ? 171 / sum : Math.min(1, 205 / sum);
      return v.map((x) => x * fit);
    });
    const colW = W / days;
    const bw = colW * 0.58;
    let g = "";
    data.forEach((vals, d) => {
      const x = colW * d + (colW - bw) / 2;
      let y = H - padB;
      let rects = "";
      vals.forEach((v, k) => {
        const h = v * scale;
        y -= h;
        rects += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h - 1.5).toFixed(1)}" rx="1.5" fill="var(${series[k]})" style="--d:${d}"/>`;
      });
      const total = vals.reduce((a, b) => a + b, 0);
      g += `<g class="col" data-d="${d}" data-total="${Math.round(total)}" data-in="${Math.round(vals[0])}" data-out="${Math.round(vals[1])}"><rect class="hit" x="${(colW * d).toFixed(1)}" y="0" width="${colW.toFixed(1)}" height="${H}"/>${rects}</g>`;
      if (d % 2 === 0) g += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${18 + d} Oct</text>`;
    });
    const capY = H - padB - cap * scale;
    svg.innerHTML = `${g}<line x1="0" x2="${W}" y1="${capY}" y2="${capY}" stroke="var(--text-faint)" stroke-dasharray="4 4"/><text x="${W}" y="${capY - 6}" text-anchor="end">daily cap 220k</text>`;
    svg.addEventListener("pointermove", (e) => {
      const col = e.target.closest(".col");
      if (!col) { tip.hidden = true; return; }
      const box = svg.parentElement.getBoundingClientRect();
      tip.hidden = false;
      tip.innerHTML = `${18 + Number(col.dataset.d)} Oct · ${col.dataset.total}k<br><span style="opacity:.7">in ${col.dataset.in}k · out ${col.dataset.out}k</span>`;
      tip.style.left = `${Math.min(e.clientX - box.left + 12, box.width - 160)}px`;
      tip.style.top = `${e.clientY - box.top - 52}px`;
    });
    svg.addEventListener("pointerleave", () => { tip.hidden = true; });

    const mini = $("[data-minichart]");
    mini.innerHTML = data.map((vals, d) => {
      const total = d === 13 ? 220 : vals.reduce((a, b) => a + b, 0);
      const h = total * 0.5;
      return `<rect x="${(colW * d + (colW - bw) / 2).toFixed(1)}" y="${(130 - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${d === 13 ? "var(--danger)" : "var(--viz-1)"}"/>`;
    }).join("") + `<line x1="0" x2="900" y1="20" y2="20" stroke="var(--text-faint)" stroke-dasharray="4 4"/>`;
  },

  settings() {
    const sw = $("[data-google-switch]");
    sw.addEventListener("change", () => {
      if (!sw.checked) return;
      sw.checked = false;
      $("#dlg-google").hidden = false;
    });
    const ack = $("[data-risk-ack]");
    const go = $("[data-risk-go]");
    ack.addEventListener("change", () => { go.disabled = !ack.checked; });
    go.addEventListener("click", () => { sw.checked = true; $("#dlg-google").hidden = true; });
    const confirmInput = $("[data-confirm-input]");
    confirmInput.addEventListener("input", () => { $("[data-confirm-go]").disabled = confirmInput.value.trim() !== "delete"; });

    $("[data-theme-seg]").addEventListener("change", (e) => {
      const v = e.detail;
      if (v === "system") { delete document.documentElement.dataset.theme; try { localStorage.removeItem("distil-theme"); } catch { /* ignore */ } }
      else { document.documentElement.dataset.theme = v; try { localStorage.setItem("distil-theme", v); } catch { /* ignore */ } }
    });
    $("[data-motion-seg]").addEventListener("change", (e) => setMotionPref(e.detail));

    const pick = $("[data-palette-pick]");
    const active = document.documentElement.dataset.palette ?? "copper";
    pick.innerHTML = PALETTES.map((p) => `
      <button role="radio" aria-checked="${p.id === active}" data-palette-id="${p.id}">
        <span class="palette-pick__chip">${["light", "dark"].map((t) => `<span style="background:${p.swatches[t][0]}"><i style="background:${p.swatches[t][2]}"></i><b style="background:${p[t]}"></b></span>`).join("")}</span>
        <span class="palette-pick__name">${p.name}${p.id === "copper" ? ` <span class="caption faint">Default</span>` : ""}</span>
      </button>`).join("");
    pick.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-palette-id]");
      if (!btn) return;
      setPalette(btn.dataset.paletteId);
      $$("[data-palette-id]", pick).forEach((b) => b.setAttribute("aria-checked", String(b === btn)));
    });

    const links = $$(".settings__nav a");
    links.forEach((a) => a.addEventListener("click", () => links.forEach((l) => l.setAttribute("aria-current", String(l === a)))));
  },

  modals() {
    const ob = $("[data-onboard]");
    const panes = $$("[data-ob-step]", ob);
    const bars = $$(".onboard__steps span", ob);
    const nextBtn = $("[data-ob-next]", ob);
    let step = 0;
    const show = () => {
      panes.forEach((p, i) => p.classList.toggle("is-on", i === step));
      bars.forEach((b, i) => b.classList.toggle("is-on", i <= step));
      nextBtn.textContent = step === panes.length - 1 ? "Create subject" : "Continue";
      $("[data-ob-back]", ob).style.visibility = step ? "visible" : "hidden";
    };
    nextBtn.addEventListener("click", () => {
      if (step === panes.length - 1) { ob.closest(".dialog-root").hidden = true; step = 0; show(); return; }
      step += 1; show();
    });
    $("[data-ob-back]", ob).addEventListener("click", () => { step = Math.max(0, step - 1); show(); });
    show();
  },
};

screens[page]?.();
