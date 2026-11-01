<script lang="ts">
  import dagre from "@dagrejs/dagre";
  import { untrack } from "svelte";
  import type { GraphView } from "../lib/api.ts";
  import Icon from "./Icon.svelte";

  // The knowledge graph (F-921, F-924): ledger items as nodes coloured by mastery, an arrow from each item to
  // what it builds on (dashed where it only supports it). Dagre lays it out first; nodes can then be dragged,
  // and where they were put is kept in this browser per unit. Drag the background to pan, Ctrl + wheel or the
  // buttons to zoom. Selecting a node (click, or Enter) reports it through `selected`.
  let { graph, label, layoutKey, highlight = new Set(), selected = $bindable(null), fill = false }: {
    graph: GraphView; label: (n: GraphView["nodes"][number]) => string; layoutKey: string;
    highlight?: Set<string>; selected?: string | null; fill?: boolean;
  } = $props();

  const W = 168, H = 52, PAD = 24;
  type Point = { x: number; y: number };

  // Dagre's layout, before anything was moved.
  const base = $derived.by(() => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "BT", nodesep: 24, ranksep: 56 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of graph.nodes) g.setNode(n.id, { width: W, height: H });
    for (const e of graph.edges) g.setEdge(e.from, e.to);
    dagre.layout(g);
    return new Map(graph.nodes.map((n) => [n.id, { x: g.node(n.id).x, y: g.node(n.id).y }]));
  });

  // Positions the learner gave nodes, saved per unit.
  const read = (key: string): Record<string, Point> => {
    try { return JSON.parse(localStorage.getItem(key) ?? "{}"); } catch { return {}; }
  };
  let moved = $state<Record<string, Point>>(untrack(() => read(layoutKey)));
  $effect(() => { moved = read(layoutKey); });
  const save = () => {
    try { localStorage.setItem(layoutKey, JSON.stringify(moved)); } catch { /* private window: positions last until reload */ }
  };
  const resetLayout = () => {
    moved = {};
    try { localStorage.removeItem(layoutKey); } catch { /* nothing saved */ }
  };
  const hasMoved = $derived(graph.nodes.some((n) => moved[n.id]));

  const nodes = $derived(graph.nodes.map((n) => ({ ...n, ...(moved[n.id] ?? base.get(n.id)!) })));
  const at = $derived(new Map(nodes.map((n) => [n.id, n])));
  // Bounds of every node, so a node dragged outside the first layout stays on the canvas.
  const box = $derived.by(() => {
    if (!nodes.length) return { x: 0, y: 0, w: W, h: H };
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
    const x = Math.min(...xs) - W / 2 - PAD, y = Math.min(...ys) - H / 2 - PAD;
    return { x, y, w: Math.max(...xs) + W / 2 + PAD - x, h: Math.max(...ys) + H / 2 + PAD - y };
  });

  // An edge runs centre to centre, cut where it leaves each box.
  const exit = (from: Point, to: Point) => {
    const dx = to.x - from.x, dy = to.y - from.y;
    const t = Math.min(dx ? (W / 2 + 2) / Math.abs(dx) : Infinity, dy ? (H / 2 + 2) / Math.abs(dy) : Infinity);
    return { x: from.x + dx * t, y: from.y + dy * t };
  };
  const edges = $derived(graph.edges.flatMap((e) => {
    const a = at.get(e.from), b = at.get(e.to);
    if (!a || !b) return [];
    const p = exit(a, b), q = exit(b, a);
    return [{ ...e, d: `M${p.x},${p.y} L${q.x},${q.y}` }];
  }));
  const near = $derived(selected ? new Set(graph.edges.flatMap((e) => (e.from === selected ? [e.to] : e.to === selected ? [e.from] : []))) : null);

  // Pan and zoom. A big graph starts at the width but never so small its labels can't be read.
  let view = $state({ x: 0, y: 0, scale: 1 });
  let width = $state(0);
  let height = $state(0);
  const fit = $derived(width && box.w ? Math.max(0.7, Math.min(1, (width - 32) / box.w)) : 1);
  const scale = $derived(fit * view.scale);
  const zoom = (by: number) => (view = { ...view, scale: Math.min(2.5, Math.max(0.1, view.scale * by)) });
  const whole = () => {
    const room = fill && height ? height - 48 : 520;
    view = { x: 0, y: 0, scale: Math.min(1, (width - 32) / box.w, room / box.h) / fit };
  };
  function onwheel(e: WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }

  // One gesture at a time: dragging a node, or panning the canvas. Under 4 px it's a click.
  type Drag = { x: number; y: number; moved: boolean } & ({ kind: "pan"; vx: number; vy: number } | { kind: "node"; id: string; nx: number; ny: number });
  let drag = $state<Drag | null>(null);
  function start(e: PointerEvent, id?: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = id ? at.get(id) : null;
    drag = p ? { kind: "node", id: p.id, nx: p.x, ny: p.y, x: e.clientX, y: e.clientY, moved: false }
      : { kind: "pan", vx: view.x, vy: view.y, x: e.clientX, y: e.clientY, moved: false };
  }
  function onpointermove(e: PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    if (drag.kind === "pan") view = { ...view, x: drag.vx + dx, y: drag.vy + dy };
    else moved = { ...moved, [drag.id]: { x: drag.nx + dx / scale, y: drag.ny + dy / scale } };
  }
  function end() {
    if (drag?.kind === "node") {
      if (drag.moved) save();
      else selected = selected === drag.id ? null : drag.id;
    } else if (drag && !drag.moved) {
      selected = null;
    }
    drag = null;
  }
  const clip = (s: string, max = 44) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
</script>

<div class="kg" class:kg--fill={fill}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="kg__canvas" class:is-panning={drag?.kind === "pan" && drag.moved} bind:clientWidth={width} bind:clientHeight={height}
    style:height={fill ? undefined : `${Math.min(560, box.h * fit + 40)}px`}
    {onwheel} onpointerdown={(e) => start(e)} {onpointermove} onpointerup={end} onpointercancel={() => (drag = null)}>
    <svg viewBox="{box.x} {box.y} {box.w} {box.h}" width={box.w} height={box.h} role="group" aria-label="Knowledge graph"
      style:transform="translate({view.x}px, {view.y}px) scale({scale})">
      <defs>
        {#each ["ink", "accent"] as t (t)}
          <marker id="kg-head-{t}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M1,1 L9,5 L1,9" class="kg__head kg__head--{t}" />
          </marker>
        {/each}
      </defs>
      {#each edges as e (`${e.from}>${e.to}`)}
        {@const lit = !!selected && (e.from === selected || e.to === selected)}
        <path d={e.d} class="kg__edge" class:is-supports={e.kind === "supports"} class:is-lit={lit} class:is-dim={!!selected && !lit}
          marker-end="url(#kg-head-{lit ? 'accent' : 'ink'})" />
      {/each}
      {#each nodes as n (n.id)}
        <g class="kg__node is-{n.level}" class:is-current={highlight.has(n.id)} class:is-selected={selected === n.id}
          class:is-dim={!!selected && selected !== n.id && !near?.has(n.id)} class:is-dragging={drag?.kind === "node" && drag.id === n.id && drag.moved}
          role="button" tabindex="0" aria-pressed={selected === n.id} aria-label="{n.title}: {label(n)}"
          onpointerdown={(e) => start(e, n.id)}
          onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selected = selected === n.id ? null : n.id; } }}>
          <title>{n.title} · {label(n)}{n.lesson ? ` · ${graph.lessons[n.lesson]}` : ""}</title>
          <rect class="kg__box" x={n.x - W / 2} y={n.y - H / 2} width={W} height={H} rx="8" />
          <rect class="kg__fill" x={n.x - W / 2 + 6} y={n.y + H / 2 - 6} width={(W - 12) * n.mastery} height="3" rx="1.5" />
          <foreignObject x={n.x - W / 2} y={n.y - H / 2} width={W} height={H - 4}>
            <div class="kg__label">{clip(n.title)}</div>
          </foreignObject>
        </g>
      {/each}
    </svg>
  </div>
  <div class="kg__tools">
    <button type="button" class="btn btn--ghost btn--icon btn--sm" aria-label="Zoom in" onclick={() => zoom(1.25)}><Icon name="plus" size="sm" /></button>
    <button type="button" class="btn btn--ghost btn--icon btn--sm" aria-label="Zoom out" onclick={() => zoom(0.8)}><span class="minus" aria-hidden="true"></span></button>
    <button type="button" class="btn btn--ghost btn--sm" onclick={whole}>Whole graph</button>
    {#if hasMoved}<button type="button" class="btn btn--ghost btn--sm" onclick={resetLayout}>Reset layout</button>{/if}
  </div>
</div>

<style>
  .kg { position: relative; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface-sunken); min-width: 0; }
  .kg--fill { height: 100%; }
  .kg__canvas { overflow: hidden; padding: var(--s-5) var(--s-4); display: flex; justify-content: center; align-items: flex-start; cursor: grab; touch-action: none; min-height: 160px; user-select: none; }
  .kg--fill .kg__canvas { height: 100%; }
  .kg__canvas.is-panning { cursor: grabbing; }
  .kg__canvas svg { flex: none; max-width: none; overflow: visible; transform-origin: center top; }
  .kg__edge { fill: none; stroke: var(--text-faint); stroke-width: 1.4; transition: opacity 120ms; }
  .kg__edge.is-supports { stroke-dasharray: 4 4; }
  .kg__edge.is-lit { stroke: var(--accent); stroke-width: 2; }
  .kg__edge.is-dim { opacity: .25; }
  .kg__head { fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .kg__head--ink { stroke: var(--text-faint); }
  .kg__head--accent { stroke: var(--accent); }
  .kg__node { cursor: pointer; outline: none; transition: opacity 120ms; }
  .kg__node.is-dragging { cursor: grabbing; }
  .kg__node.is-dim { opacity: .35; }
  .kg__box { fill: var(--surface); stroke: var(--border-control); stroke-width: 1.2; }
  .kg__node.is-shaky .kg__box { fill: var(--warning-wash); stroke: var(--warning); }
  .kg__node.is-solid .kg__box { fill: var(--accent-wash); stroke: var(--accent); }
  .kg__node.is-mastered .kg__box { fill: var(--success-wash); stroke: var(--success); }
  .kg__node.is-current .kg__box { stroke: var(--text); stroke-width: 2.5; }
  .kg__node:hover .kg__box, .kg__node:focus-visible .kg__box { stroke: var(--accent); stroke-width: 2; }
  .kg__node.is-selected .kg__box { stroke: var(--accent); stroke-width: 3; }
  .kg__fill { fill: var(--accent); }
  .kg__node.is-shaky .kg__fill { fill: var(--warning); }
  .kg__node.is-mastered .kg__fill { fill: var(--success); }
  .kg__label { height: 100%; display: flex; align-items: center; justify-content: center; text-align: center; padding: 4px 10px; font-size: 12px; line-height: 15px; color: var(--text); overflow: hidden; pointer-events: none; }
  .kg__node.is-current .kg__label { font-weight: 600; }
  .kg__tools { position: absolute; right: var(--s-2); bottom: var(--s-2); display: flex; gap: 2px; background: color-mix(in oklab, var(--surface-sunken) 85%, transparent); border-radius: var(--r-sm); opacity: .8; }
  .kg__tools:hover, .kg__tools:focus-within { opacity: 1; }
  .minus { width: 10px; height: 1.5px; background: currentColor; border-radius: 1px; }
</style>
