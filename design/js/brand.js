// Distil brand marks (provisional until the logo exploration is approved).
// Mark: three strokes narrowing to a single drop — material condensing to its essence.
// Wordmark: "distil" in Instrument Serif; the two i-dots are copper drops.

export const markSVG = ({ size = 28, animated = false, label = "Distil" } = {}) => `
<svg class="mark${animated ? " mark--animate" : ""}" width="${size}" height="${size}" viewBox="0 0 32 32" role="img" aria-label="${label}">
  <rect class="mark__bar mark__bar--1" x="4" y="5" width="24" height="3" rx="1.5" fill="currentColor"/>
  <rect class="mark__bar mark__bar--2" x="9" y="11.5" width="14" height="3" rx="1.5" fill="currentColor"/>
  <rect class="mark__bar mark__bar--3" x="13.5" y="18" width="5" height="3" rx="1.5" fill="currentColor"/>
  <circle class="mark__drop" cx="16" cy="26.5" r="3" fill="var(--accent)"/>
</svg>`;

export const wordmarkHTML = (cls = "") =>
  `<span class="wordmark ${cls}" aria-label="Distil"><span aria-hidden="true">d<span class="wordmark__i">ı</span>st<span class="wordmark__i">ı</span>l</span></span>`;

export const lockupHTML = ({ size = 26, animated = false } = {}) =>
  `<span class="lockup">${markSVG({ size, animated, label: "" })}${wordmarkHTML()}</span>`;
