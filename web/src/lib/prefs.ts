// Appearance preferences, stored per browser (DESIGN.md §4.4, §4.5, §6.4).
// Dark is the first-run default (owner decision); palettes swap paper, ink and accent together.

export const PALETTES = [
  {
    id: "copper",
    name: "Copper",
    light: "#A8461A",
    dark: "#E07A45",
    swatches: {
      light: [
        "#F5F2EB",
        "#FBFAF6",
        "#15130F",
        "#57524A",
        "#A8461A"
      ],
      dark: [
        "#11100E",
        "#1A1815",
        "#F1EDE4",
        "#B5AEA2",
        "#E07A45"
      ]
    }
  },
  {
    id: "verdigris",
    name: "Verdigris",
    light: "#1C6B62",
    dark: "#5CC2B2",
    swatches: {
      light: [
        "#F1F3F0",
        "#FAFBF9",
        "#111614",
        "#4E5753",
        "#1C6B62"
      ],
      dark: [
        "#0E1211",
        "#161B19",
        "#E9EFEC",
        "#A9B4AF",
        "#5CC2B2"
      ]
    }
  },
  {
    id: "oxblood",
    name: "Oxblood",
    light: "#862B3A",
    dark: "#E8899A",
    swatches: {
      light: [
        "#F6F1EA",
        "#FCF9F4",
        "#1A1212",
        "#5A4F4C",
        "#862B3A"
      ],
      dark: [
        "#120E0E",
        "#1B1616",
        "#F2EAE6",
        "#B9ADA8",
        "#E8899A"
      ]
    }
  },
  {
    id: "cobalt",
    name: "Cobalt",
    light: "#2A47C9",
    dark: "#8FA3FF",
    swatches: {
      light: [
        "#F3F4F6",
        "#FBFBFC",
        "#11131A",
        "#4E5260",
        "#2A47C9"
      ],
      dark: [
        "#0E0F13",
        "#16181D",
        "#ECEEF4",
        "#ABB0BE",
        "#8FA3FF"
      ]
    }
  },
  {
    id: "citron",
    name: "Citron",
    light: "#566600",
    dark: "#D2E35A",
    swatches: {
      light: [
        "#F2F2EF",
        "#FAFAF8",
        "#121311",
        "#50524C",
        "#566600"
      ],
      dark: [
        "#0F100E",
        "#171815",
        "#EDEEE8",
        "#AEB0A8",
        "#D2E35A"
      ]
    }
  }
] as const;

export type Theme = "dark" | "light" | "system";
export type Motion = "system" | "full" | "reduce";
export type PaletteId = (typeof PALETTES)[number]["id"];

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* lasts for this page only */ } };
const root = () => document.documentElement;

export const themePref = (): Theme => {
  const saved = read("distil-theme");
  return saved === "light" || saved === "system" ? saved : "dark";
};
export const palettePref = (): PaletteId => {
  const saved = read("distil-palette");
  return PALETTES.find((p) => p.id === saved)?.id ?? "copper";
};
export const motionPref = (): Motion => {
  const saved = read("distil-motion");
  return saved === "full" || saved === "reduce" ? saved : "system";
};

// Scrolls started by the app glide only when motion isn't reduced (the setting, else the system's).
export const glide = (): ScrollBehavior => {
  const m = motionPref();
  return m === "reduce" || (m === "system" && matchMedia("(prefers-reduced-motion: reduce)").matches) ? "auto" : "smooth";
};

export function setTheme(value: Theme) {
  if (value === "system") delete root().dataset.theme;
  else root().dataset.theme = value;
  write("distil-theme", value);
}
export function setPalette(value: PaletteId) {
  root().dataset.palette = value;
  write("distil-palette", value);
}
export function setMotion(value: Motion) {
  if (value === "system") delete root().dataset.motion;
  else root().dataset.motion = value;
  write("distil-motion", value);
}

/* ---------- Text font (F-1309, DESIGN.md §3) ----------
 * Swaps the face behind --font-text, which every Satoshi use reads. Display serif and mono stay.
 * Installed fonts are used by family name and never bundled; a saved font file is served from the data folder. */
export type TextFont =
  | { kind: "satoshi" }
  | { kind: "anthropic" }
  | { kind: "saved"; id: string; family?: string } // family: an installed font; none: an uploaded file
  // Before saved fonts: one typed family or one uploaded file.
  | { kind: "installed"; family: string }
  | { kind: "upload"; name: string; version: number };

// Anthropic Sans installs as two optical sizes; text sizes use "Text", and older builds use the plain name.
export const ANTHROPIC_SANS = ["Anthropic Sans Text", "Anthropic Sans", "Anthropic Sans Display"];
const FALLBACK = `"Satoshi", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
const savedFamily = (id: string) => `Distil Font ${id.slice(0, 8)}`;

// Family names go into CSS strings, so only plain name characters are kept.
export const cleanFamily = (name: string) => name.replace(/[^\p{L}\p{N} _.-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 80);

export function fontStack(font: TextFont): string {
  const families = font.kind === "anthropic" ? ANTHROPIC_SANS
    : font.kind === "installed" ? [cleanFamily(font.family)]
    : font.kind === "saved" ? [font.family ? cleanFamily(font.family) : savedFamily(font.id)]
    : [];
  return [...families.filter(Boolean).map((f) => `"${f}"`), FALLBACK].join(", ");
}

export const textFontPref = (): TextFont => {
  try {
    const saved = JSON.parse(read("distil-font") ?? "null") as TextFont | null;
    if (saved?.kind === "anthropic" || saved?.kind === "satoshi") return saved;
    if (saved?.kind === "saved" && typeof saved.id === "string" && /^[\w-]{8,64}$/.test(saved.id)) return saved;
    if (saved?.kind === "installed" && typeof saved.family === "string" && cleanFamily(saved.family)) return saved;
    if (saved?.kind === "upload" && typeof saved.name === "string" && typeof saved.version === "number") return saved;
  } catch { /* fall through to the default */ }
  return { kind: "satoshi" };
};

export function setTextFont(font: TextFont) {
  let face = document.getElementById("distil-text-font");
  if (font.kind === "saved" && !font.family) {
    face ??= document.head.appendChild(Object.assign(document.createElement("style"), { id: "distil-text-font" }));
    face.textContent = `@font-face { font-family: "${savedFamily(font.id)}"; src: url("/api/fonts/${encodeURIComponent(font.id)}/file"); font-weight: 100 900; font-display: swap; }`;
  } else {
    face?.remove();
  }
  if (font.kind === "satoshi" || font.kind === "upload") root().style.removeProperty("--font-text");
  else root().style.setProperty("--font-text", fontStack(font));
  write("distil-font", JSON.stringify(font));
}

// True when the browser can draw the family: text set in it measures differently from the generic fallbacks.
export function fontAvailable(family: string): boolean {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx || !cleanFamily(family)) return false;
  const sample = "mmmmmmmmmmlli1WQ@#&";
  return ["monospace", "serif", "sans-serif"].some((generic) => {
    ctx.font = `72px ${generic}`;
    const base = ctx.measureText(sample).width;
    ctx.font = `72px "${cleanFamily(family)}", ${generic}`;
    return ctx.measureText(sample).width !== base;
  });
}

export const resolvedTheme = (): "dark" | "light" =>
  root().dataset.theme === "light" || (!root().dataset.theme && !matchMedia("(prefers-color-scheme: dark)").matches) ? "light" : "dark";

export function applyPrefs() {
  setTheme(themePref());
  setPalette(palettePref());
  setMotion(motionPref());
  setTextFont(textFontPref());
}
