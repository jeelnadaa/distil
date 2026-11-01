<script lang="ts">
  import type { StepsSpec } from "../../../../server/visuals/grammar/text.ts";
  import { renderInline } from "../../lib/markdown.ts";

  // `steps` (F-704): a derivation or worked example revealed one justified line at a time.
  let { spec }: { spec: StepsSpec } = $props();

  let shown = $state(1);
  const all = $derived(shown >= spec.steps.length);
</script>

<div class="steps">
  <ol>
    {#each spec.steps.slice(0, shown) as step, i (i)}
      <li class:is-accent={step.mark.emphasis} class:is-muted={step.mark.muted}>
        <span class="n mono">{i + 1}</span>
        <div class="line">{@html renderInline(`$\\displaystyle ${step.tex}$`)}</div>
        {#if step.why}<p class="why body-sm">{@html renderInline(step.why)}</p>{/if}
      </li>
    {/each}
  </ol>
  <footer>
    <span class="mono muted caption">{shown} / {spec.steps.length}</span>
    <span class="spacer"></span>
    {#if !all}
      <button type="button" class="btn btn--ghost btn--sm" onclick={() => (shown = spec.steps.length)}>Show all</button>
      <button type="button" class="btn btn--secondary btn--sm" onclick={() => shown++}>Next step</button>
    {:else if spec.steps.length > 1}
      <button type="button" class="btn btn--ghost btn--sm" onclick={() => (shown = 1)}>From the start</button>
    {/if}
  </footer>
</div>

<style>
  .steps { padding: var(--s-3) var(--s-4); display: grid; gap: var(--s-3); }
  ol { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
  li { display: grid; grid-template-columns: 24px 1fr; column-gap: var(--s-3); align-items: baseline; padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); animation: step-in var(--dur-base, 200ms) var(--ease-out) both; }
  li.is-accent { background: var(--accent-wash); }
  li.is-muted { opacity: .7; }
  .n { color: var(--text-faint); font-size: var(--t-caption); }
  .line { overflow-x: auto; overflow-y: hidden; }
  .why { grid-column: 2; color: var(--text-muted); margin-top: 2px; }
  footer { display: flex; align-items: center; gap: var(--s-2); }
  .spacer { flex: 1; }
  @keyframes step-in { from { opacity: 0; transform: translateY(3px); } }
  @media (prefers-reduced-motion: reduce) { li { animation: none; } }
</style>
