<script lang="ts">
  import type { TimelineSpec } from "../../../../server/visuals/grammar/text.ts";
  import { renderInline } from "../../lib/markdown.ts";

  // `timeline` (F-706): dated events on a vertical rule; the emphasised event is the accent.
  let { spec }: { spec: TimelineSpec } = $props();
</script>

<ol class="timeline">
  {#each spec.events as e, i (i)}
    <li class:is-accent={e.mark.emphasis} class:is-muted={e.mark.muted}>
      <span class="when mono">{e.when}</span>
      <span class="dot" aria-hidden="true"></span>
      <div class="what">
        <p class="title">{@html renderInline(e.what)}</p>
        {#if e.detail}<p class="detail body-sm">{@html renderInline(e.detail)}</p>{/if}
      </div>
    </li>
  {/each}
</ol>

<style>
  .timeline { list-style: none; margin: 0; padding: var(--s-4); display: grid; }
  /* The date column is fixed so the rule lines up under every dot. */
  li { --when: 72px; display: grid; grid-template-columns: var(--when) 16px 1fr; column-gap: var(--s-3); position: relative; padding-bottom: var(--s-4); }
  li:last-child { padding-bottom: 0; }
  li::before { content: ""; position: absolute; top: 16px; bottom: -6px; left: calc(var(--when) + var(--s-3) + 7.25px); width: 1.5px; background: var(--border-control); }
  li:last-child::before { display: none; }
  .when { font-size: var(--t-caption); color: var(--text-muted); text-align: right; padding-top: 3px; overflow-wrap: anywhere; }
  .dot { grid-column: 2; justify-self: center; margin-top: 6px; width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid var(--text-muted); background: var(--surface); position: relative; z-index: 1; }
  .is-accent .dot { border-color: var(--accent); background: var(--accent); }
  .is-accent .title { color: var(--accent); font-weight: 600; }
  .is-muted { opacity: .7; }
  .title { margin: 0; font-weight: 500; }
  .detail { margin: 2px 0 0; color: var(--text-muted); }
</style>
