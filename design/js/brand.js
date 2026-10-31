// Distil brand marks. Three directions are under review (see logo.html); the chosen one is
// remembered in localStorage so every mock-up can preview it in place.
// Wordmark: "distil" in Instrument Serif; the two i-dots are accent drops.

// Teardrop: point at (cx, tipY), round bulb of radius r centred at (cx, cy).
const DROP = (cx, tipY, cy, r) =>
  `M${cx} ${tipY}C${cx} ${tipY} ${cx - r} ${cy - r * 0.9} ${cx - r} ${cy}A${r} ${r} 0 0 0 ${cx + r} ${cy}C${cx + r} ${cy - r * 0.9} ${cx} ${tipY} ${cx} ${tipY}Z`;

// Each body draws on a 32-unit grid with `ink` for the main form and `accent` for the essence.
export const MARKS = {
  condense: {
    name: "Condense",
    idea: "Three strokes narrowing to a single drop: a syllabus condensing to its essence.",
    body: (ink, accent) => `
      <rect class="mk-bar mk-bar--1" x="4" y="4.5" width="24" height="3" rx="1.5" fill="${ink}"/>
      <rect class="mk-bar mk-bar--2" x="8.5" y="11" width="15" height="3" rx="1.5" fill="${ink}"/>
      <rect class="mk-bar mk-bar--3" x="13" y="17.5" width="6" height="3" rx="1.5" fill="${ink}"/>
      <path class="mk-drop" d="${DROP(16, 21.5, 26.3, 3.2)}" fill="${accent}"/>`,
  },
  dropd: {
    name: "Drop-d",
    idea: "A lowercase d whose bowl is a drop, with the essence held in its counter.",
    body: (ink, accent, knockout = false) => `
      <rect class="mk-stem" x="20.5" y="3" width="4.5" height="25.5" rx="2.25" fill="${ink}"/>
      <path class="mk-bowl" d="${DROP(14, 4, 20.5, 8)}${knockout ? `M14 17.1a3.4 3.4 0 1 0 0.001 0Z` : ""}" fill="${ink}" fill-rule="evenodd"/>
      ${knockout ? "" : `<circle class="mk-core" cx="14" cy="20.5" r="3.4" fill="${accent}"/>`}`,
  },
  converge: {
    name: "Converge",
    idea: "Many lines of material converging into one drop: the concentration gradient as a mark.",
    body: (ink, accent) => `
      <g class="mk-lines" stroke="${ink}" stroke-width="2.2" stroke-linecap="round" fill="none">
        ${[[4.5, 12.6], [10.25, 14.3], [16, 16], [21.75, 17.7], [27.5, 19.4]].map(([x1, x2], i) =>
          `<path class="mk-line" style="--n:${i}" d="M${x1} 4L${x2} 18" pathLength="1"/>`).join("")}
      </g>
      <path class="mk-drop" d="${DROP(16, 20, 25.5, 3.4)}" fill="${accent}"/>`,
  },
};

export const MARK_KEY = "distil-mark";

export function currentMark() {
  let id = null;
  try { id = localStorage.getItem(MARK_KEY); } catch { /* storage unavailable: default mark */ }
  return id in MARKS ? id : "condense";
}

export const markSVG = ({ size = 28, animated = false, label = "Distil", mark = currentMark(), mono = false } = {}) => `
<svg class="mark mark--${mark}${animated ? " mark--animate" : ""}" width="${size}" height="${size}" viewBox="0 0 32 32" role="img"${label ? ` aria-label="${label}"` : ` aria-hidden="true"`}>
  ${MARKS[mark].body("currentColor", mono ? "currentColor" : "var(--accent)", mono)}
</svg>`;

// App-icon tile: the mark knocked out of an ink square. Fixed colours, so it reads the same on any theme.
export const iconTileSVG = ({ size = 64, mark = currentMark() } = {}) => `
<svg class="mark-tile" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">
  <rect width="32" height="32" rx="7.5" fill="#15130F"/>
  <g transform="translate(5.6 5.6) scale(.65)">${MARKS[mark].body("#F5F2EB", "#E07A45")}</g>
</svg>`;

export const wordmarkHTML = (cls = "") =>
  `<span class="wordmark ${cls}" aria-label="Distil"><span aria-hidden="true">d<span class="wordmark__i">ı</span>st<span class="wordmark__i">ı</span>l</span></span>`;

export const lockupHTML = ({ size = 26, animated = false, mark } = {}) =>
  `<span class="lockup">${markSVG({ size, animated, label: "", mark })}${wordmarkHTML()}</span>`;
