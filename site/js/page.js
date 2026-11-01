// Shared chrome for pages other than the landing page: brand, icons and theme.
import { initTheme, toggleTheme, currentTheme } from "./motion.js";
import { injectIcons, icon } from "./icons.js";
import { lockupHTML, wordmarkHTML } from "./brand.js";

initTheme();
injectIcons();
document.querySelector('[data-slot="lockup"]').innerHTML = lockupHTML({ size: 26 });
document.querySelector('[data-slot="lockup-small"]').innerHTML = wordmarkHTML();

const button = document.querySelector("[data-theme-toggle]");
const paint = () => { button.innerHTML = icon(currentTheme() === "dark" ? "sun" : "moon", "icon icon--sm"); };
paint();
button.addEventListener("click", () => { toggleTheme(); paint(); });
