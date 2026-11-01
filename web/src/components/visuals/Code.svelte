<script lang="ts">
  import { untrack } from "svelte";
  import Icon from "../Icon.svelte";
  import Sandbox from "./Sandbox.svelte";

  // ```js run (F-709): an editable example that runs in the sandbox; console.log and errors print below it.
  let { source }: { source: string } = $props();

  // The learner edits a copy; Reset goes back to the reply's version.
  let code = $state(untrack(() => source));
  let run = $state(0);
  let ran = $state("");

  const program = (src: string, n: number) => `<pre id="out" class="mono" style="margin:0;white-space:pre-wrap;font-size:13px"></pre>
<script>
const out = document.getElementById("out");
const show = (cls, args) => { const line = document.createElement("div"); if (cls) line.className = cls; line.textContent = args.map((a) => typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()).join(" "); out.append(line); };
console.log = (...a) => show("", a); console.info = console.log; console.warn = (...a) => show("warn", a);
addEventListener("error", (e) => show("bad", [e.message]));
addEventListener("load", () => { if (!out.childElementCount) show("muted", ["(no output)"]); });
<\/script>
<script>/* run ${n} */
${src.replace(/<\/script/gi, "<\\/script")}
<\/script>`;

  function start() {
    run++;
    ran = program(code, run);
  }
  const edited = $derived(code !== source);
</script>

<div class="code">
  <textarea class="mono" bind:value={code} spellcheck="false" rows={Math.min(18, code.split("\n").length + 1)} aria-label="JavaScript"
    onkeydown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); start(); } }}></textarea>
  <footer>
    <button type="button" class="btn btn--secondary btn--sm" data-tip="Ctrl + Enter" onclick={start}><Icon name="play" size="sm" />Run</button>
    {#if edited}<button type="button" class="btn btn--ghost btn--sm" onclick={() => (code = source)}>Reset</button>{/if}
    <span class="spacer"></span><span class="caption muted">Runs in a sandbox, offline</span>
  </footer>
  {#if ran}
    <div class="out"><Sandbox body={ran} title="Program output" maxHeight={360} /></div>
  {/if}
</div>

<style>
  .code { display: grid; grid-template-columns: minmax(0, 1fr); }
  textarea { width: 100%; border: 0; resize: vertical; padding: var(--s-3) var(--s-4); background: var(--surface-sunken); color: var(--text); font-size: 13px; line-height: 20px; tab-size: 2; }
  textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  footer { display: flex; align-items: center; gap: var(--s-2); padding: var(--s-2) var(--s-3); border-top: 1px solid var(--border); }
  .spacer { flex: 1; }
  .out { border-top: 1px solid var(--border); }
</style>
