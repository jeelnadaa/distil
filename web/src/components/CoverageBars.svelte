<script lang="ts">
  // The three coverage bars (F-307): in-scope items planned, taught and checked, as percentages.
  let { total, planned, taught, checked }: { total: number; planned: number; taught: number; checked: number } = $props();

  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const rows = $derived([["Planned", planned], ["Taught", taught], ["Checked", checked]] as const);
</script>

<div class="coverage">
  {#each rows as [label, n] (label)}
    <div class="coverage__row" data-tip="{n} of {total} items">
      <span class="eyebrow">{label}</span>
      <div class="coverage__track"><div class="coverage__fill" style:--v="{pct(n)}%"></div></div>
      <span class="num">{pct(n)}%</span>
    </div>
  {/each}
</div>
