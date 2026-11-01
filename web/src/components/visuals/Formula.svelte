<script lang="ts">
  import { untrack } from "svelte";
  import { compile } from "../../../../server/visuals/grammar/expr.ts";
  import type { FormulaSpec } from "../../../../server/visuals/grammar/text.ts";
  import { renderInline } from "../../lib/markdown.ts";
  import { fmt } from "./scale.ts";

  // `formula` (F-710): the formula with every symbol's meaning and unit; hovering a symbol's row marks it,
  // and the inputs plug numbers in to compute the one derived symbol.
  let { spec: given }: { spec: FormulaSpec } = $props();
  // Read once: a changed block is a new widget (Markdown keys it by its source).
  const spec = untrack(() => given);

  let values = $state<Record<string, number>>(Object.fromEntries(spec.symbols.filter((s) => s.value !== undefined).map((s) => [s.name, s.value!])));
  let hover = $state<string | null>(null);
  const target = spec.symbols.find((s) => s.compute);
  const fn = target ? compile(target.compute!, Object.keys(values)) : null;
  const result = $derived(fn ? fn(values) : null);

  // Models often spell Greek letters out ("mu", "sigma"); in maths they should read as μ and σ.
  const GREEK = /(?<![\\A-Za-z])(alpha|beta|gamma|delta|epsilon|theta|lambda|mu|nu|pi|rho|sigma|tau|phi|omega|Delta|Sigma|Omega)(?![A-Za-z])/g;
  const tex = (src: string) => src.replace(GREEK, "\\$1{}");
  // A unit of "none", "-" or "1" means the quantity has none.
  const unitOf = (unit: string | undefined) => (unit && !/^(none|-|1|n\/a)$/i.test(unit) ? unit : "");
</script>

<div class="formula">
  <div class="formula__tex">{@html renderInline(`$\\displaystyle ${tex(spec.tex)}$`)}</div>
  <table>
    <tbody>
      {#each spec.symbols as s (s.name)}
        <tr class:is-hover={hover === s.name} class:is-target={s.compute} onpointerenter={() => (hover = s.name)} onpointerleave={() => (hover = null)}>
          <th scope="row">{@html renderInline(`$${tex(s.tex)}$`)}</th>
          <td class="meaning">{@html renderInline(s.meaning)}</td>
          <td class="value">
            {#if s.compute}
              <output class="mono" aria-live="polite">{result !== null && Number.isFinite(result) ? fmt(result) : "—"}</output>
            {:else if s.value !== undefined}
              <input type="number" step="any" class="mono" bind:value={values[s.name]} aria-label="{s.meaning} ({s.name})" />
            {/if}
          </td>
          <td class="unit muted">{#if unitOf(s.unit)}{@html renderInline(/[\^_]/.test(s.unit!) ? `$\\mathrm{${s.unit}}$` : s.unit!)}{/if}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .formula { padding: var(--s-4); display: grid; gap: var(--s-4); }
  .formula__tex { text-align: center; font-size: 1.15em; overflow-x: auto; overflow-y: hidden; padding: var(--s-2) 0; }
  table { width: 100%; border-collapse: collapse; font-size: var(--t-body-sm); }
  th, td { padding: var(--s-1) var(--s-2); border-bottom: 1px solid var(--border); text-align: left; vertical-align: middle; }
  tr:last-child > * { border-bottom: 0; }
  tr.is-hover { background: var(--surface-sunken); }
  tr.is-target { background: var(--accent-wash); }
  th { width: 3.5em; font-weight: 400; }
  .value { width: 8em; }
  .value input { width: 100%; height: 30px; padding: 0 var(--s-2); border: 1px solid var(--border-control); border-radius: var(--r-sm); background: var(--surface); color: var(--text); font-size: var(--t-body-sm); }
  .value input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .value output { font-weight: 600; color: var(--accent); padding-left: var(--s-2); }
  .unit { width: 5em; white-space: nowrap; }
</style>
