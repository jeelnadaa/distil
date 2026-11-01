<script lang="ts" module>
  import { api, type Visual } from "../../lib/api.ts";

  // One request per reply while its visuals mount together, however many it has; a later mount asks again.
  const loading = new Map<string, Promise<Visual[]>>();
  const versionsOf = (messageId: string) => {
    let found = loading.get(messageId);
    if (!found) {
      found = api.visuals(messageId).finally(() => loading.delete(messageId));
      loading.set(messageId, found);
    }
    return found;
  };
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import type { BriefSpec } from "../../../../server/visuals/grammar/text.ts";
  import { sanitizeSvg } from "../../../../server/visuals/sanitize.ts";
  import Select from "../Select.svelte";
  import Sandbox, { type SandboxMessage } from "./Sandbox.svelte";

  // A mini-app (F-721) or figure (F-725) built from the block's brief on first view. A mini-app runs hidden
  // first (F-722): errors it throws go back for a fix before it's shown. Rebuild adds a version (F-723).
  let { spec: given, messageId, block }: { spec: BriefSpec; messageId: string; block: number } = $props();
  // Read once: a changed block is a new widget (Markdown keys it by its source).
  const spec = untrack(() => given);

  const TEST_MS = 1500;
  const FIXES = 2;
  let versions = $state<Visual[]>([]);
  let at = $state(0);
  let phase = $state<"loading" | "building" | "testing" | "ready" | "failed">("loading");
  let failure = $state("");
  let errors = $state<string[]>([]);
  let fixes = $state(0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const current = $derived(versions[at]);
  const isApp = spec.kind === "app";

  async function build(rebuild: boolean) {
    phase = "building";
    try {
      const v = await api.buildVisual(messageId, block, rebuild);
      versions = [...versions.filter((x) => x.id !== v.id), v].sort((a, b) => a.version - b.version);
      at = versions.findIndex((x) => x.id === v.id);
      begin();
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
      phase = "failed";
    }
  }

  // A mini-app is tested before it's shown; a figure needs no run.
  function begin() {
    fixes = 0;
    errors = [];
    phase = isApp ? "testing" : "ready";
    if (isApp) { clearTimeout(timer); timer = setTimeout(settle, 6000); }
  }

  async function settle() {
    clearTimeout(timer);
    if (phase !== "testing") return;
    if (errors.length && fixes < FIXES && current) {
      fixes++;
      const seen = [...new Set(errors)].slice(0, 10);
      errors = [];
      try {
        const fixed = await api.fixVisual(current.id, seen);
        versions = versions.map((v) => (v.id === fixed.id ? fixed : v));
        timer = setTimeout(settle, 6000);
        return;
      } catch { /* shown as it is, with its errors */ errors = seen; }
    }
    phase = "ready";
  }

  function onmessage(m: SandboxMessage) {
    if (m.type === "error") errors = [...errors, m.message];
    if (m.type === "ready" && phase === "testing") { clearTimeout(timer); timer = setTimeout(settle, TEST_MS); }
  }

  $effect(() => {
    versionsOf(messageId).then((all) => {
      versions = all.filter((v) => v.block === block);
      at = versions.length - 1;
      if (versions.length) begin();
      else void build(false);
    }).catch((err) => { failure = err.message; phase = "failed"; });
    return () => clearTimeout(timer);
  });

  const svg = $derived.by(() => {
    if (isApp || !current) return "";
    try { return sanitizeSvg(current.content).svg; } catch { return ""; }
  });
</script>

<div class="built">
  {#if phase === "loading" || phase === "building" || (phase === "testing" && !current)}
    <div class="built__wait" aria-live="polite">
      <span class="drop drop--pulse" aria-hidden="true"></span>
      <p class="body-sm">{phase === "building" ? (isApp ? "Building the simulation and testing it…" : "Drawing the figure…") : "Loading…"}</p>
      {#if phase === "building"}<p class="caption muted">This usually takes under a minute.</p>{/if}
    </div>
  {:else if phase === "failed"}
    <div class="built__wait">
      <p class="body-sm">Couldn't build this: {failure}</p>
      <button type="button" class="btn btn--secondary btn--sm" onclick={() => build(versions.length > 0)}>Try again</button>
    </div>
  {:else if current}
    {#if isApp}
      {#if phase === "testing"}
        <div class="built__wait" aria-live="polite"><span class="drop drop--pulse" aria-hidden="true"></span><p class="body-sm">{fixes ? "Fixing an error it hit…" : "Testing it…"}</p></div>
      {/if}
      {#key current.content}
        <Sandbox body={current.content} title={spec.title ?? "Simulation"} hidden={phase === "testing"} {onmessage} />
      {/key}
    {:else if svg}
      <div class="figure">{@html svg}</div>
    {:else}
      <div class="built__wait"><p class="body-sm">This figure couldn't be shown.</p></div>
    {/if}
    <footer class="built__bar">
      {#if errors.length && phase === "ready"}<span class="chip chip--warning" data-tip={errors[0]}>Ran with errors</span>{/if}
      <span class="spacer"></span>
      {#if versions.length > 1}
        <Select compact label="Version" value={String(at)} options={versions.map((v, i) => ({ value: String(i), label: `v${v.version}` }))} onchange={(v) => { at = Number(v); begin(); }} />
      {/if}
      <button type="button" class="btn btn--ghost btn--sm" disabled={phase === "testing"} onclick={() => build(true)}>Rebuild</button>
    </footer>
  {/if}
</div>

<style>
  .built { position: relative; display: grid; grid-template-columns: minmax(0, 1fr); }
  .built__wait { display: grid; justify-items: center; align-content: center; gap: var(--s-2); min-height: 180px; padding: var(--s-5); text-align: center; background: var(--surface-sunken); }
  .built__wait p { margin: 0; }
  .built__bar { display: flex; align-items: center; gap: var(--s-2); padding: var(--s-1) var(--s-2) var(--s-1) var(--s-4); border-top: 1px solid var(--border); }
  .spacer { flex: 1; }
  /* Figures: the sanitiser's classes, drawn with tokens (F-725, DESIGN.md §8.1). */
  .figure { padding: var(--s-4); display: flex; justify-content: center; }
  .figure :global(svg) { width: 100%; max-width: 720px; height: auto; overflow: visible; }
  .figure :global(:is(path, rect, circle, ellipse, line, polyline, polygon)) { fill: none; stroke: var(--text); stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
  .figure :global(text) { fill: var(--text); stroke: none; font-family: var(--font-text); font-size: 14px; }
  .figure :global(marker :is(path, polygon)) { fill: var(--text); stroke: none; }
  .figure :global(.label) { fill: var(--text-muted); font-size: 12px; }
  .figure :global(.muted) { stroke: var(--text-muted); }
  .figure :global(text.muted) { fill: var(--text-muted); }
  .figure :global(.accent) { stroke: var(--accent); }
  .figure :global(text.accent) { fill: var(--accent); font-weight: 600; }
  .figure :global(.grid) { stroke: var(--border); stroke-width: 1; }
  .figure :global(.fill-1) { fill: color-mix(in oklab, var(--viz-1) 18%, transparent); }
  .figure :global(.fill-2) { fill: color-mix(in oklab, var(--viz-2) 18%, transparent); }
  .figure :global(.fill-3) { fill: color-mix(in oklab, var(--viz-3) 22%, transparent); }
  .figure :global(.fill-4) { fill: color-mix(in oklab, var(--viz-4) 22%, transparent); }
  .figure :global(.fill-5) { fill: color-mix(in oklab, var(--viz-5) 22%, transparent); }
  .figure :global(.fill-6) { fill: color-mix(in oklab, var(--viz-6) 22%, transparent); }
  .figure :global(.ink) { stroke: var(--text); }
  .figure :global(text.ink) { fill: var(--text); }
  .figure :global(.accent.fill-1), .figure :global(.accent:is(rect, circle, ellipse, polygon)) { fill: var(--accent-wash); }
</style>
