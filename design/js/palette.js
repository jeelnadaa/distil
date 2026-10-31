// Palettes offered for review; token values live in css/palettes.css.
export const PALETTES = [
  {
    "id": "copper",
    "name": "Copper",
    "note": "Warm paper and ink, one copper accent. The current default.",
    "light": "#A8461A",
    "dark": "#E07A45",
    "swatches": {
      "light": [
        "#F5F2EB",
        "#FBFAF6",
        "#15130F",
        "#57524A",
        "#A8461A"
      ],
      "dark": [
        "#11100E",
        "#1A1815",
        "#F1EDE4",
        "#B5AEA2",
        "#E07A45"
      ]
    }
  },
  {
    "id": "verdigris",
    "name": "Verdigris",
    "note": "Cool stone paper with deep teal, the patina copper stills take on with age.",
    "light": "#1C6B62",
    "dark": "#5CC2B2",
    "swatches": {
      "light": [
        "#F1F3F0",
        "#FAFBF9",
        "#111614",
        "#4E5753",
        "#1C6B62"
      ],
      "dark": [
        "#0E1211",
        "#161B19",
        "#E9EFEC",
        "#A9B4AF",
        "#5CC2B2"
      ]
    }
  },
  {
    "id": "oxblood",
    "name": "Oxblood",
    "note": "Parchment and deep wine. Bookish and serious, like a leather-bound text.",
    "light": "#862B3A",
    "dark": "#E8899A",
    "swatches": {
      "light": [
        "#F6F1EA",
        "#FCF9F4",
        "#1A1212",
        "#5A4F4C",
        "#862B3A"
      ],
      "dark": [
        "#120E0E",
        "#1B1616",
        "#F2EAE6",
        "#B9ADA8",
        "#E8899A"
      ]
    }
  },
  {
    "id": "cobalt",
    "name": "Cobalt",
    "note": "Crisp lab-glass white with cobalt ink. Precise and academic; flat colour, never a gradient.",
    "light": "#2A47C9",
    "dark": "#8FA3FF",
    "swatches": {
      "light": [
        "#F3F4F6",
        "#FBFBFC",
        "#11131A",
        "#4E5260",
        "#2A47C9"
      ],
      "dark": [
        "#0E0F13",
        "#16181D",
        "#ECEEF4",
        "#ABB0BE",
        "#8FA3FF"
      ]
    }
  },
  {
    "id": "citron",
    "name": "Citron",
    "note": "Neutral graphite with a sharp citron accent. The boldest, most modern option, best in dark.",
    "light": "#566600",
    "dark": "#D2E35A",
    "swatches": {
      "light": [
        "#F2F2EF",
        "#FAFAF8",
        "#121311",
        "#50524C",
        "#566600"
      ],
      "dark": [
        "#0F100E",
        "#171815",
        "#EDEEE8",
        "#AEB0A8",
        "#D2E35A"
      ]
    }
  }
];

const KEY = "distil-palette";

export function initPalette() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* storage unavailable: default palette */ }
  if (PALETTES.some((p) => p.id === saved)) document.documentElement.dataset.palette = saved;
}

export function setPalette(id) {
  document.documentElement.dataset.palette = id;
  try { localStorage.setItem(KEY, id); } catch { /* preference lasts for this page only */ }
  document.dispatchEvent(new Event("distil:theme"));
}

// Floating review control: one swatch per palette. Design preview only, not part of the product UI.
export function mountPaletteSwitcher() {
  const current = document.documentElement.dataset.palette ?? "copper";
  const bar = document.createElement("div");
  bar.className = "pal-switch";
  bar.setAttribute("role", "radiogroup");
  bar.setAttribute("aria-label", "Colour palette (design review)");
  bar.innerHTML = `<a class="pal-switch__label caption" href="palettes.html">Palette</a>` + PALETTES.map((p) =>
    `<button role="radio" aria-checked="${p.id === current}" data-palette-id="${p.id}" title="${p.name}" style="--sw-l:${p.light};--sw-d:${p.dark}"><span class="sr-only">${p.name}</span></button>`).join("");
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-palette-id]");
    if (!btn) return;
    setPalette(btn.dataset.paletteId);
    bar.querySelectorAll("[data-palette-id]").forEach((b) => b.setAttribute("aria-checked", b === btn));
  });
  document.body.append(bar);
}
