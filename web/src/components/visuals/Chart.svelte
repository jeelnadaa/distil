<script lang="ts">
  import { untrack } from "svelte";
  import type { ChartSpec } from "../../../../server/visuals/grammar/plot.ts";
  import { fmt, linear, seriesColor, ticks } from "./scale.ts";

  // `chart` (F-703): bar (grouped), line and scatter charts from the model's data rows.
  let { spec: given }: { spec: ChartSpec } = $props();
  // Read once: a changed block is a new widget (Markdown keys it by its source).
  const spec = untrack(() => given);

  const W = 640, H = 320, M = { l: 52, r: 16, t: 16, b: 44 };
  const colors = spec.series.map((s, i) => seriesColor(s.mark, i));
  const all = spec.rows.flatMap((r) => r.values).filter((v): v is number => v !== null);
  const scatter = spec.type === "scatter";
  const xs = scatter ? spec.rows.map((r) => Number(r.key)) : [];

  const [lo, hi] = (() => {
    const min = Math.min(...all), max = Math.max(...all);
    const base = spec.type === "bar" ? [Math.min(0, min), Math.max(0, max)] : [min, max];
    const pad = (base[1]! - base[0]!) * 0.08 || 1;
    return [spec.type === "bar" && base[0] === 0 ? 0 : base[0]! - pad, base[1]! + pad];
  })();
  const yTicks = ticks(lo, hi, 5);
  const sy = linear(lo, hi, H - M.b, M.t);
  const band = (W - M.l - M.r) / Math.max(1, spec.rows.length);
  const sx = scatter ? linear(Math.min(...xs), Math.max(...xs), M.l + 8, W - M.r - 8) : (i: number) => M.l + band * (i + 0.5);
  const xTicks = scatter ? ticks(Math.min(...xs), Math.max(...xs), 7) : [];
  // Category labels thin out when they'd collide.
  const every = Math.max(1, Math.ceil(spec.rows.length / 12));
  // About 7 px a character at caption size.
  const room = Math.max(4, Math.floor((band * every) / 7));
  const barW = Math.min(36, (band * 0.72) / spec.series.length);

  const linePath = (s: number) => {
    let d = "", pen = false;
    spec.rows.forEach((r, i) => {
      const v = r.values[s];
      if (v === null || v === undefined) { pen = false; return; }
      d += `${pen ? "L" : "M"}${sx(i)},${sy(v)}`;
      pen = true;
    });
    return d;
  };
</script>

<div class="chart">
  <svg viewBox="0 0 {W} {H}" role="img" aria-label="{spec.type} chart of {spec.series.map((s) => s.name).join(', ')}">
    {#each yTicks as t (t)}<line class="grid" x1={M.l} x2={W - M.r} y1={sy(t)} y2={sy(t)} /><text class="tick" x={M.l - 6} y={sy(t)} text-anchor="end" dominant-baseline="middle">{fmt(t)}</text>{/each}
    {#if scatter}
      {#each xTicks as t (t)}<text class="tick" x={sx(t)} y={H - M.b + 16} text-anchor="middle">{fmt(t)}</text>{/each}
    {:else}
      {#each spec.rows as r, i (i)}{#if i % every === 0}<text class="tick cat" x={sx(i)} y={H - M.b + 16} text-anchor="middle">{r.key.length > room ? `${r.key.slice(0, room - 1)}…` : r.key}<title>{r.key}</title></text>{/if}{/each}
    {/if}
    <line class="axis" x1={M.l} x2={W - M.r} y1={sy(Math.max(lo, Math.min(0, hi)))} y2={sy(Math.max(lo, Math.min(0, hi)))} />

    {#if spec.type === "bar"}
      {#each spec.rows as r, i (i)}
        {#each r.values as v, s (s)}
          {#if v !== null}
            {@const x = sx(i) - (barW * spec.series.length) / 2 + barW * s}
            <rect class="bar" x={x + 1} width={barW - 2} y={Math.min(sy(v), sy(Math.max(lo, 0)))} height={Math.abs(sy(v) - sy(Math.max(lo, 0)))} rx="2" style:fill={colors[s]}><title>{r.key} · {spec.series[s]?.name}: {v}</title></rect>
          {/if}
        {/each}
      {/each}
    {:else if spec.type === "line"}
      {#each spec.series as s, k (k)}
        <path class="line" class:is-accent={s.mark.emphasis} d={linePath(k)} style:stroke={colors[k]} />
        {#each spec.rows as r, i (i)}{#if r.values[k] !== null && r.values[k] !== undefined}<circle class="dot" cx={sx(i)} cy={sy(r.values[k]!)} r="3" style:fill={colors[k]}><title>{r.key} · {s.name}: {r.values[k]}</title></circle>{/if}{/each}
      {/each}
    {:else}
      {#each spec.rows as r, i (i)}
        {#each r.values as v, s (s)}{#if v !== null}<circle class="dot" cx={sx(Number(r.key))} cy={sy(v)} r="4" style:fill={colors[s]}><title>({r.key}, {v})</title></circle>{/if}{/each}
      {/each}
    {/if}
    {#if spec.xLabel}<text class="axis-label" x={W - M.r} y={H - 6} text-anchor="end">{spec.xLabel}</text>{/if}
    {#if spec.yLabel}<text class="axis-label" x={M.l} y={M.t - 4}>{spec.yLabel}</text>{/if}
  </svg>
  {#if spec.series.length > 1}
    <div class="legend body-sm">
      {#each spec.series as s, i (i)}<span class="key"><span class="swatch" style:background={colors[i]}></span>{s.name}</span>{/each}
    </div>
  {/if}
</div>

<style>
  .chart { padding: var(--s-3) var(--s-4) var(--s-4); display: grid; gap: var(--s-2); }
  svg { width: 100%; height: auto; display: block; }
  .grid { stroke: var(--border); stroke-width: 1; }
  .axis { stroke: var(--text-faint); stroke-width: 1; }
  .tick, .axis-label { fill: var(--text-muted); font-size: 12px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  .tick.cat, .axis-label { font-family: var(--font-text); }
  .line { fill: none; stroke-width: 2; stroke-linejoin: round; }
  .line.is-accent { stroke-width: 2.75; }
  .dot { stroke: var(--surface); stroke-width: 1.5; }
  .legend { display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-4); }
  .key { display: inline-flex; align-items: center; gap: var(--s-2); }
  .swatch { width: 10px; height: 10px; border-radius: 2px; }
</style>
