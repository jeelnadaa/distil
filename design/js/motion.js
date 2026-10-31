// Distil motion runtime: spring tokens, a small spring solver, scroll reveals,
// theme and motion preferences. Shared by the landing page and app screens.

export const SPRINGS = {
  snappy: { stiffness: 520, damping: 38, mass: 1 },
  smooth: { stiffness: 260, damping: 30, mass: 1 },
  gentle: { stiffness: 140, damping: 22, mass: 1 },
  settle: { stiffness: 180, damping: 14, mass: 1 },
};

const reduceQuery = matchMedia("(prefers-reduced-motion: reduce)");

export function prefersReducedMotion() {
  const forced = document.documentElement.dataset.motion;
  if (forced === "reduce") return true;
  if (forced === "full") return false;
  return reduceQuery.matches;
}

// Animates `from` → `to` with a damped spring; calls onUpdate(value) every frame.
// Returns a stop function. Under reduced motion it jumps to the end value.
export function spring(from, to, onUpdate, { stiffness, damping, mass } = SPRINGS.smooth, onDone) {
  if (prefersReducedMotion()) {
    onUpdate(to);
    onDone?.();
    return () => {};
  }
  let x = from;
  let v = 0;
  let last = performance.now();
  let raf = requestAnimationFrame(function step(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    const force = -stiffness * (x - to) - damping * v;
    v += (force / mass) * dt;
    x += v * dt;
    const settled = Math.abs(v) < 0.01 && Math.abs(x - to) < 0.001 * Math.max(1, Math.abs(to - from));
    if (settled) {
      onUpdate(to);
      onDone?.();
      return;
    }
    onUpdate(x);
    raf = requestAnimationFrame(step);
  });
  return () => cancelAnimationFrame(raf);
}

// Condense and reveal elements as they enter the viewport.
export function observeReveals(root = document) {
  const targets = root.querySelectorAll("[data-condense], [data-reveal]");
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        el.classList.add(el.hasAttribute("data-condense") ? "is-condensed" : "is-revealed");
        io.unobserve(el);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.1 },
  );
  targets.forEach((el) => io.observe(el));
}

// Assigns --i to children so CSS can stagger them (capped at 8, per DESIGN.md §6.2).
export function stagger(parent) {
  [...parent.children].forEach((child, i) => child.style.setProperty("--i", Math.min(i, 8)));
}

function readPref(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writePref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable: preference lasts for this page only */ }
}

// Theme preference: "dark" (first-run default, owner decision), "light" or "system".
export function themePref() {
  const saved = readPref("distil-theme");
  return saved === "light" || saved === "system" ? saved : "dark";
}

export function setThemePref(value) {
  if (value === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = value;
  writePref("distil-theme", value);
}

export function initTheme() {
  const pref = themePref();
  if (pref !== "system") document.documentElement.dataset.theme = pref;
  const savedMotion = readPref("distil-motion");
  if (savedMotion === "reduce" || savedMotion === "full") document.documentElement.dataset.motion = savedMotion;
}

export function currentTheme() {
  const set = document.documentElement.dataset.theme;
  if (set) return set;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  writePref("distil-theme", next);
  return next;
}

export function setMotionPref(value) {
  if (value === "system") delete document.documentElement.dataset.motion;
  else document.documentElement.dataset.motion = value;
  writePref("distil-motion", value);
}

// Segmented controls: moves the thumb under the pressed button with a spring.
export function initSegmented(root = document) {
  root.querySelectorAll(".segmented").forEach((seg) => {
    const thumb = seg.querySelector(".segmented__thumb") ?? seg.insertAdjacentElement("afterbegin", Object.assign(document.createElement("span"), { className: "segmented__thumb" }));
    const buttons = [...seg.querySelectorAll("button")];
    const place = (btn) => {
      thumb.style.width = `${btn.offsetWidth}px`;
      thumb.style.transform = `translateX(${btn.offsetLeft}px)`;
    };
    buttons.forEach((btn) =>
      btn.addEventListener("click", () => {
        buttons.forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
        place(btn);
        seg.dispatchEvent(new CustomEvent("change", { detail: btn.dataset.value ?? btn.textContent.trim() }));
      }),
    );
    // Read the pressed state on the next frame so page scripts can set it after init.
    requestAnimationFrame(() => place(buttons.find((b) => b.getAttribute("aria-pressed") === "true") ?? buttons[0]));
  });
}

// Counts a number element up to its target, in mono tabular figures.
export function countUp(el, to, { duration = 1200, format = (n) => Math.round(n).toLocaleString() } = {}) {
  if (prefersReducedMotion()) { el.textContent = format(to); return; }
  const start = performance.now();
  const from = Number(el.dataset.from ?? 0);
  requestAnimationFrame(function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 4);
    el.textContent = format(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(tick);
  });
}
