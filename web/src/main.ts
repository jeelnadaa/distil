import "katex/dist/katex.min.css";
import "./styles/tokens.css";
import "./styles/palettes.css";
import "./styles/base.css";
import "./styles/brand.css";
import "./styles/shell.css";
import "./styles/content.css";
import "./styles/workspace.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { injectIcons } from "./lib/icons.ts";
import { applyPrefs } from "./lib/prefs.ts";

applyPrefs();
injectIcons();
mount(App, { target: document.getElementById("app")! });
