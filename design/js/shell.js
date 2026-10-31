// App shell for the design mock-ups: sidebar, top bar, theme, dialogs and toasts.
// Each page declares <body data-page="…" data-title="…" data-crumb="…"> and provides its own <main>.

import { initTheme, toggleTheme, currentTheme, observeReveals, initSegmented } from "./motion.js";
import { injectIcons, icon } from "./icons.js";
import { lockupHTML, markSVG } from "./brand.js";

initTheme();
injectIcons();

const page = document.body.dataset.page;

const LIBRARY = [
  {
    name: "Semester 5", open: true, children: [
      {
        name: "Digital Signal Processing", open: true, active: page === "workspace" || page === "plan", children: [
          { name: "Unit 2 · Fourier", open: true, children: [], chats: [
            { name: "Fourier series: Teaching", mode: "teach", active: page === "teach", live: true },
            { name: "Gibbs phenomenon, quick Qs", mode: "ask" },
          ] },
          { name: "Unit 3 · Laplace", children: [], chats: [] },
        ], chats: [
          { name: "Mock exam #1 · Units 1–2", mode: "practice", active: page === "exam" },
        ],
      },
      { name: "Operating Systems", children: [], chats: [] },
    ], chats: [],
  },
  { name: "Learn Rust", children: [], chats: [{ name: "Ownership & borrowing", mode: "teach" }] },
];

const MODE_ICON = { teach: "book", ask: "chat", practice: "target", plan: "list" };

function treeHTML(nodes, depth = 0) {
  return nodes.map((n) => `
    <li class="tree__folder${n.open ? " is-open" : ""}" style="--depth:${depth}">
      <button class="tree__row${n.active ? " is-active" : ""}" aria-expanded="${Boolean(n.open)}">
        ${icon("chevron-right", "icon icon--sm tree__chev")}${icon(n.open ? "folder-open" : "folder", "icon icon--sm")}
        <span class="tree__label">${n.name}</span>
      </button>
      <ul class="tree__children">
        ${treeHTML(n.children ?? [], depth + 1)}
        ${(n.chats ?? []).map((c) => `
          <li style="--depth:${depth + 1}">
            <a class="tree__row tree__chat${c.active ? " is-active" : ""}" href="${c.mode === "practice" ? "app-exam.html" : "app-teach.html"}">
              ${icon(MODE_ICON[c.mode], "icon icon--sm")}<span class="tree__label">${c.name}</span>${c.live ? '<span class="drop drop--pulse" title="Background job running"></span>' : ""}
            </a>
          </li>`).join("")}
      </ul>
    </li>`).join("");
}

const NAV = [
  { id: "today", label: "Today", icon: "today", href: "app-today.html" },
  { id: "review", label: "Review", icon: "cards", href: "app-review.html", badge: "18" },
  { id: "usage", label: "Usage", icon: "chart", href: "app-usage.html" },
];

const sidebar = document.querySelector("[data-sidebar]");
if (sidebar) {
  sidebar.innerHTML = `
    <div class="sb__top">
      <a class="sb__brand" href="index.html">${lockupHTML({ size: 22 })}</a>
      <button class="btn btn--ghost btn--icon btn--sm" data-collapse-sidebar aria-label="Collapse sidebar">${icon("sidebar", "icon icon--sm")}</button>
    </div>
    <button class="sb__search" data-open-search>${icon("search", "icon icon--sm")}<span>Search</span><span class="kbd">Ctrl K</span></button>
    <nav class="sb__nav" aria-label="Main">
      ${NAV.map((n) => `<a class="sb__link${page === n.id ? " is-active" : ""}" href="${n.href}">${icon(n.icon, "icon icon--sm")}<span>${n.label}</span>${n.badge ? `<span class="sb__badge num">${n.badge}</span>` : ""}</a>`).join("")}
    </nav>
    <div class="sb__section">
      <span class="eyebrow">Library</span>
      <button class="btn btn--ghost btn--icon btn--sm" data-dialog-open="new-folder" aria-label="New folder">${icon("plus", "icon icon--sm")}</button>
    </div>
    <ul class="tree" role="tree">${treeHTML(LIBRARY)}</ul>
    <div class="sb__dock" aria-live="polite">
      <div class="job">
        ${markSVG({ size: 16, animated: true, label: "" })}
        <div class="job__text"><span class="body-sm">Extracting unit3.pdf</span><span class="caption faint num">34 / 120 pages</span></div>
        <button class="btn btn--ghost btn--icon btn--sm" aria-label="Abort job">${icon("x", "icon icon--sm")}</button>
      </div>
    </div>
    <div class="sb__foot">
      <a class="sb__link${page === "settings" ? " is-active" : ""}" href="app-settings.html">${icon("gear", "icon icon--sm")}<span>Settings</span></a>
      <button class="btn btn--ghost btn--icon btn--sm" data-theme-toggle aria-label="Toggle theme"></button>
    </div>`;

  sidebar.querySelectorAll(".tree__folder > .tree__row").forEach((row) =>
    row.addEventListener("click", () => {
      const li = row.parentElement;
      const open = li.classList.toggle("is-open");
      row.setAttribute("aria-expanded", String(open));
      row.querySelector("use:not(.tree__chev use)")?.setAttribute("href", open ? "#i-folder-open" : "#i-folder");
    }),
  );
}

// Theme toggles anywhere on the page
const paintTheme = () => document.querySelectorAll("[data-theme-toggle]").forEach((b) => { b.innerHTML = icon(currentTheme() === "dark" ? "sun" : "moon", "icon icon--sm"); });
paintTheme();
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-theme-toggle]")) { toggleTheme(); paintTheme(); document.dispatchEvent(new Event("distil:theme")); }
  if (e.target.closest("[data-collapse-sidebar]")) document.body.classList.toggle("sb-collapsed");
  if (e.target.closest("[data-toggle-context]")) document.body.classList.toggle("ctx-collapsed");
  if (e.target.closest("[data-open-menu]")) document.body.classList.toggle("sb-open");
});

/* ---------- Dialogs ---------- */
let lastFocus = null;
export function openDialog(id) {
  const root = document.getElementById(`dlg-${id}`);
  // Shared overlays (palette, new folder) live in the gallery page in these mock-ups.
  if (!root) { location.href = `modals.html#${id}`; return; }
  lastFocus = document.activeElement;
  root.hidden = false;
  root.querySelector("[autofocus], .dialog input, .dialog button:not(.dialog__close)")?.focus();
}
export function closeDialog(root) {
  root.hidden = true;
  lastFocus?.focus?.();
}
document.addEventListener("click", (e) => {
  const opener = e.target.closest("[data-dialog-open]");
  if (opener) { openDialog(opener.dataset.dialogOpen); return; }
  const root = e.target.closest(".dialog-root");
  if (root && (e.target.closest("[data-dialog-close]") || e.target.classList.contains("dialog-scrim"))) closeDialog(root);
});
// Esc always closes the topmost element (DESIGN.md §8).
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openDialog("palette"); return; }
  if (e.key !== "Escape") return;
  const open = [...document.querySelectorAll(".dialog-root:not([hidden])")].pop();
  if (open) { closeDialog(open); return; }
  document.body.classList.remove("sb-open");
});

/* ---------- Toasts ---------- */
export function toast(message, action) {
  let stack = document.querySelector(".toast-stack");
  if (!stack) { stack = Object.assign(document.createElement("div"), { className: "toast-stack" }); stack.setAttribute("role", "status"); document.body.append(stack); }
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span style="flex:1">${message}</span>${action ? `<button class="btn btn--ghost btn--sm">${action}</button>` : ""}<button class="btn btn--ghost btn--icon btn--sm" aria-label="Dismiss">${icon("x", "icon icon--sm")}</button>`;
  el.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => el.remove()));
  stack.append(el);
  while (stack.children.length > 2) stack.firstElementChild.remove();
  setTimeout(() => el.remove(), 5000);
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-toast]");
  if (t) toast(t.dataset.toast, t.dataset.toastAction);
});

document.addEventListener("click", (e) => { if (e.target.closest("[data-open-search]")) openDialog("palette"); });
const hashDialog = location.hash.slice(1);
if (hashDialog && document.getElementById(`dlg-${hashDialog}`)) openDialog(hashDialog);

observeReveals();
initSegmented();
