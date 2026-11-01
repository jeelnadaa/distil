<script lang="ts">
  import { untrack } from "svelte";
  import { compile } from "../../../../server/visuals/grammar/expr.ts";
  import type { PlotSpec } from "../../../../server/visuals/grammar/plot.ts";
  import { fmt, linear, seriesColor, ticks } from "./scale.ts";

  // `plot` (F-702): functions of x with sliders for their parameters, derivatives, shaded areas and points.
  // Hover reads the curves' values at a point.
  let { spec: given }: { spec: PlotSpec } = $props();
  // Read once: a changed block is a new widget (Markdown keys it by its source).
  const spec = untrack(() => given);

  const W = 640, H = 340, M = { l: 48, r: 16, t: 16, b: 36 };
  const SAMPLES = 480;
  let values = $state<Record<string, number>>(Object.fromEntries(spec.sliders.map((s) => [s.name, s.value])));
  let hoverX = $state<number | null>(null);
  const clip = `plot-${Math.random().toString(36).slice(2, 8)}`;

  const names = spec.sliders.map((s) => s.name);
  const fns = Object.fromEntries(spec.curves.filter((c) => !c.derivativeOf).map((c) => [c.name, compile(c.expr, ["x", ...names])]));
  const [x0, x1] = spec.x;
  const h = (x1 - x0) / 1e4;
  const evaluate = (name: string, x: number, env: Record<string, number>) => {
    const curve = spec.curves.find((c) => c.name === name)!;
    if (curve.derivativeOf) {
      const f = fns[curve.derivativeOf]!;
      return (f({ ...env, x: x + h }) - f({ ...env, x: x - h })) / (2 * h);
    }
    return fns[name]!({ ...env, x });
  };

  // The y range: given, or fitted once to cover every slider setting (each slider at its start and both ends,
  // ignoring asymptotes), so it holds still while sliders move and nothing slides out of view.
  const yRange: [number, number] = spec.y ?? (() => {
    const settings = spec.sliders.slice(0, 4).reduce<Record<string, number>[]>(
      (all, s) => all.flatMap((env) => [s.min, s.value, s.max].map((v) => ({ ...env, [s.name]: v }))), [{ ...values }]);
    let lo = Infinity, hi = -Infinity;
    for (const env of settings) {
      const ys = spec.curves.flatMap((c) => Array.from({ length: 160 }, (_, i) => evaluate(c.name, x0 + ((x1 - x0) * i) / 159, env)))
        .filter(Number.isFinite).sort((a, b) => a - b);
      if (!ys.length) continue;
      lo = Math.min(lo, ys[Math.floor(ys.length * 0.02)]!);
      hi = Math.max(hi, ys[Math.ceil(ys.length * 0.98) - 1]!);
    }
    for (const p of spec.points) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [-1, 1];
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.08;
    return [lo - pad, hi + pad];
  })();

  const sx = linear(x0, x1, M.l, W - M.r);
  const sy = linear(yRange[0], yRange[1], H - M.b, M.t);
  const xTicks = ticks(x0, x1, 8);
  const yTicks = ticks(yRange[0], yRange[1], 6);
  const zeroY = yRange[0] <= 0 && yRange[1] >= 0 ? sy(0) : null;
  const zeroX = x0 <= 0 && x1 >= 0 ? sx(0) : null;
  const span = yRange[1] - yRange[0];

  // A curve as a path, broken where it leaves the plot by far or isn't defined.
  function curvePath(name: string, env: Record<string, number>) {
    let d = "", pen = false;
    for (let i = 0; i <= SAMPLES; i++) {
      const x = x0 + ((x1 - x0) * i) / SAMPLES;
      const y = evaluate(name, x, env);
      if (!Number.isFinite(y) || y < yRange[0] - span * 2 || y > yRange[1] + span * 2) { pen = false; continue; }
      d += `${pen ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`;
      pen = true;
    }
    return d;
  }
  function areaPath(area: PlotSpec["areas"][number], env: Record<string, number>) {
    const from = Math.max(area.from, x0), to = Math.min(area.to, x1);
    const base = sy(Math.min(Math.max(0, yRange[0]), yRange[1]));
    let d = `M${sx(from)},${base}`;
    for (let i = 0; i <= 120; i++) {
      const x = from + ((to - from) * i) / 120;
      const y = Math.min(Math.max(evaluate(area.of, x, env), yRange[0]), yRange[1]);
      d += `L${sx(x).toFixed(1)},${sy(Number.isFinite(y) ? y : 0).toFixed(1)}`;
    }
    return `${d}L${sx(to)},${base}Z`;
  }

  const curves = $derived(spec.curves.map((c, i) => ({ ...c, d: curvePath(c.name, values), color: seriesColor(c.mark, i) })));
  const areas = $derived(spec.areas.map((a) => ({ d: areaPath(a, values), color: curves.find((c) => c.name === a.of)!.color })));
  const readout = $derived(hoverX === null ? null : curves.map((c) => ({ name: c.name, color: c.color, y: evaluate(c.name, hoverX!, values) })));

  // Expressions as people write them: Greek names as letters, * as a centred dot.
  const GREEK: Record<string, string> = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", theta: "θ", lambda: "λ", mu: "μ", sigma: "σ", omega: "ω", phi: "φ", rho: "ρ", tau: "τ", pi: "π" };
  const pretty = (expr: string) => expr.replace(/\b[a-z]+\b/g, (w) => GREEK[w] ?? w).replace(/\s*\*\s*/g, "·");

  function onmove(e: PointerEvent) {
    const svg = e.currentTarget as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    hoverX = px < M.l || px > W - M.r ? null : x0 + ((px - M.l) / (W - M.l - M.r)) * (x1 - x0);
  }
</script>

<div class="plot">
  <svg viewBox="0 0 {W} {H}" role="img" aria-label="Plot of {spec.curves.map((c) => `${c.name}(x)`).join(', ')}" onpointermove={onmove} onpointerleave={() => (hoverX = null)}>
    {#each yTicks as t (t)}<line class="grid" x1={M.l} x2={W - M.r} y1={sy(t)} y2={sy(t)} /><text class="tick" x={M.l - 6} y={sy(t)} text-anchor="end" dominant-baseline="middle">{fmt(t)}</text>{/each}
    {#each xTicks as t (t)}<line class="grid" x1={sx(t)} x2={sx(t)} y1={M.t} y2={H - M.b} /><text class="tick" x={sx(t)} y={H - M.b + 16} text-anchor="middle">{fmt(t)}</text>{/each}
    {#if zeroY !== null}<line class="axis" x1={M.l} x2={W - M.r} y1={zeroY} y2={zeroY} />{/if}
    {#if zeroX !== null}<line class="axis" x1={zeroX} x2={zeroX} y1={M.t} y2={H - M.b} />{/if}
    <clipPath id="{clip}"><rect x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} /></clipPath>
    <g clip-path="url(#{clip})">
      {#each areas as a, i (i)}<path d={a.d} class="area" style:fill={a.color} />{/each}
      {#each curves as c (c.name)}<path d={c.d} class="curve" class:is-accent={c.mark.emphasis} class:is-derived={c.derivativeOf} style:stroke={c.color} />{/each}
      {#each spec.points as p, i (i)}
        <circle cx={sx(p.x)} cy={sy(p.y)} r={p.mark.emphasis ? 5 : 4} class="point" style:fill={seriesColor(p.mark, 0)} />
        {#if p.label}<text class="point-label" x={sx(p.x) + 8} y={sy(p.y) - 8}>{p.label}</text>{/if}
      {/each}
    </g>
    {#if hoverX !== null}<line class="cursor" x1={sx(hoverX)} x2={sx(hoverX)} y1={M.t} y2={H - M.b} />{/if}
    {#if spec.xLabel}<text class="axis-label" x={W - M.r} y={H - 4} text-anchor="end">{spec.xLabel}</text>{/if}
    {#if spec.yLabel}<text class="axis-label" x={M.l} y={M.t - 4}>{spec.yLabel}</text>{/if}
  </svg>

  <div class="plot__legend body-sm" aria-live="polite">
    {#each curves as c, i (c.name)}
      <span class="key"><span class="swatch" class:is-derived={c.derivativeOf} style:background={c.derivativeOf ? null : c.color} style:border-color={c.color}></span>
        <span class="mono">{c.derivativeOf ? `${c.derivativeOf}′(x)` : `${c.name}(x)`}</span>
        {#if readout}<span class="mono muted">= {Number.isFinite(readout[i]!.y) ? fmt(readout[i]!.y) : "—"}</span>
        {:else if !c.derivativeOf}<span class="mono muted expr">= {pretty(c.expr)}</span>{/if}
      </span>
    {/each}
    {#if readout}<span class="mono muted">at x = {fmt(hoverX!)}</span>{/if}
  </div>

  {#if spec.sliders.length}
    <div class="plot__sliders">
      {#each spec.sliders as s (s.name)}
        <label class="slider">
          <span class="mono">{pretty(s.name)}</span>
          <input type="range" min={s.min} max={s.max} step={s.step} bind:value={values[s.name]} aria-label={s.name} />
          <output class="mono">{fmt(values[s.name]!)}</output>
        </label>
      {/each}
    </div>
  {/if}
</div>

<style>
  .plot { padding: var(--s-3) var(--s-4) var(--s-4); display: grid; gap: var(--s-3); }
  svg { width: 100%; height: auto; display: block; touch-action: pan-y; }
  .grid { stroke: var(--border); stroke-width: 1; }
  .axis { stroke: var(--text-faint); stroke-width: 1; }
  .tick, .axis-label, .point-label { fill: var(--text-muted); font-size: 12px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  .axis-label { font-family: var(--font-text); }
  .point-label { fill: var(--text); font-family: var(--font-text); }
  .curve { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .curve.is-accent { stroke-width: 2.75; }
  .curve.is-derived { stroke-dasharray: 6 4; }
  .area { opacity: .16; }
  .point { stroke: var(--surface); stroke-width: 2; }
  .cursor { stroke: var(--text-muted); stroke-width: 1; stroke-dasharray: 3 3; }
  .plot__legend { display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-4); align-items: center; min-height: 24px; }
  .key { display: inline-flex; align-items: center; gap: var(--s-2); }
  .expr { overflow-wrap: anywhere; }
  .swatch { width: 14px; height: 3px; border-radius: 2px; }
  .swatch.is-derived { height: 0; border-top: 2px dashed; }
  .plot__sliders { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--s-2) var(--s-5); }
  .slider { display: grid; grid-template-columns: auto 1fr 4.5em; align-items: center; gap: var(--s-3); font-size: var(--t-body-sm); }
  .slider input { width: 100%; accent-color: var(--accent); }
  .slider output { text-align: right; color: var(--text-muted); }
</style>
