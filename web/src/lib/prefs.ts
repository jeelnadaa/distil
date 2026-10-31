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

export const resolvedTheme = (): "dark" | "light" =>
  root().dataset.theme === "light" || (!root().dataset.theme && !matchMedia("(prefers-color-scheme: dark)").matches) ? "light" : "dark";

export function applyPrefs() {
  setTheme(themePref());
  setPalette(palettePref());
  setMotion(motionPref());
}
