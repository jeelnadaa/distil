<script lang="ts">
  import type { Mark } from "../../../../server/visuals/grammar/common.ts";
  import type { CompareSpec } from "../../../../server/visuals/grammar/text.ts";
  import { renderInline } from "../../lib/markdown.ts";

  // `compare` (F-705): an "X vs Y" table; cells carry tones, and one cell or column can be the accent.
  let { spec }: { spec: CompareSpec } = $props();
  const tone = (m: Mark) => (m.emphasis ? "is-accent" : m.tone ? `is-${m.tone}` : m.muted ? "is-muted" : "");
</script>

<div class="compare">
  <table>
    <thead>
      <tr><th scope="col"></th>{#each spec.columns as c, i (i)}<th scope="col" class={tone(c.mark)}>{@html renderInline(c.label)}</th>{/each}</tr>
    </thead>
    <tbody>
      {#each spec.rows as r, i (i)}
        <tr>
          <th scope="row">{@html renderInline(r.label)}</th>
          {#each r.cells as cell, j (j)}<td class={tone(cell.mark)}>{#if cell.mark.tone}<span class="dot" aria-hidden="true"></span>{/if}{@html renderInline(cell.text)}</td>{/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .compare { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: var(--t-body-sm); }
  th, td { text-align: left; vertical-align: top; padding: var(--s-2) var(--s-4); border-bottom: 1px solid var(--border); }
  tr:last-child > * { border-bottom: 0; }
  thead th { font-weight: 600; background: var(--surface-sunken); }
  tbody th { font-weight: 500; color: var(--text-muted); white-space: nowrap; }
  .is-accent { background: var(--accent-wash); color: var(--text); font-weight: 600; }
  thead th.is-accent { color: var(--accent); }
  .is-muted { color: var(--text-muted); }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: var(--s-2); vertical-align: 1px; }
  .is-good .dot { background: var(--success); }
  .is-warn .dot { background: var(--warning); }
  .is-bad .dot { background: var(--danger); }
</style>
