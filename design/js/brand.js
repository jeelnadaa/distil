// Distil brand marks (approved 2026-10-31: the Condense mark).
// Mark: three strokes narrowing to a single drop — a syllabus condensing to its essence.
// Wordmark: "distil" in Instrument Serif; the two i-dots are accent drops.

// Draws on a 32-unit grid; `ink` for the strokes, `accent` for the drop.
const body = (ink, accent) => `
  <rect class="mk-bar mk-bar--1" x="4" y="4.5" width="24" height="3" rx="1.5" fill="${ink}"/>
  <rect class="mk-bar mk-bar--2" x="8.5" y="11" width="15" height="3" rx="1.5" fill="${ink}"/>
  <rect class="mk-bar mk-bar--3" x="13" y="17.5" width="6" height="3" rx="1.5" fill="${ink}"/>
  <path class="mk-drop" d="M16 21.5C16 21.5 12.8 23.42 12.8 26.3A3.2 3.2 0 0 0 19.2 26.3C19.2 23.42 16 21.5 16 21.5Z" fill="${accent}"/>`;

export const markSVG = ({ size = 28, animated = false, label = "Distil", mono = false } = {}) => `
<svg class="mark${animated ? " mark--animate" : ""}" width="${size}" height="${size}" viewBox="0 0 32 32" role="img"${label ? ` aria-label="${label}"` : ` aria-hidden="true"`}>
  ${body("currentColor", mono ? "currentColor" : "var(--accent)")}
</svg>`;

// App-icon tile: the mark knocked out of an ink square. Fixed colours, so it reads the same on any theme.
export const iconTileSVG = ({ size = 64 } = {}) => `
<svg class="mark-tile" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">
  <rect width="32" height="32" rx="7.5" fill="#15130F"/>
  <g transform="translate(5.6 5.6) scale(.65)">${body("#F5F2EB", "#E07A45")}</g>
</svg>`;

export const wordmarkHTML = (cls = "") =>
  `<span class="wordmark ${cls}" aria-label="Distil"><span aria-hidden="true">d<span class="wordmark__i">ı</span>st<span class="wordmark__i">ı</span>l</span></span>`;

export const lockupHTML = ({ size = 26, animated = false } = {}) =>
  `<span class="lockup">${markSVG({ size, animated, label: "" })}${wordmarkHTML()}</span>`;
