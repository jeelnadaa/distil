<script lang="ts">
  import dagre from "@dagrejs/dagre";
  import type { GraphView, MasteryLevel } from "../lib/api.ts";
  import { go } from "../lib/state.svelte.ts";
  import Icon from "./Icon.svelte";

  // The knowledge graph (F-921): ledger items as nodes coloured by mastery, an arrow from each item to what
  // it builds on (dashed where it only supports it). Laid out with dagre; drag to pan, Ctrl + wheel or the
  // buttons to zoom. A node opens the material where its item was found.
  let { graph, percent }: { graph: GraphView; percent: (n: { mastery: number; level: MasteryLevel }) => string } = $props();

  const W = 168, H = 52;
  type Placed = GraphView["nodes"][number] & { x: number; y: number };

  const layout = $derived.by(() => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "BT", nodesep: 20, ranksep: 46, marginx: 8, marginy: 8 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of graph.nodes) g.setNode(n.id, { width: W, height: H });
    for (const e of graph.edges) g.setEdge(e.from, e.to);
    dagre.layout(g);
    const nodes: Placed[] = graph.nodes.map((n) => ({ ...n, x: g.node(n.id).x, y: g.node(n.id).y }));
    const edges = graph.edges.map((e) => {
      const pts: { x: number; y: number }[] = g.edge({ v: e.from, w: e.to }).points;
      return { ...e, d: `M${pts.map((p) => `${p.x},${p.y}`).join(" L")}` };
    });
    return { nodes, edges, width: Math.ceil(g.graph().width ?? 0), height: Math.ceil(g.graph().height ?? 0) };
  });

  let view = $state({ x: 0, y: 0, scale: 1 });
  // A big graph starts scaled to the width, but never so small its labels can't be read; the rest pans.
  let width = $state(0);
  const fit = $derived(width && layout.width ? Math.max(0.7, Math.min(1, (width - 32) / layout.width)) : 1);
  const scale = $derived(fit * view.scale);
  const height = $derived(Math.min(560, layout.height * fit + 40));
  let drag = $state<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const zoom = (by: number) => (view = { ...view, scale: Math.min(2.5, Math.max(0.1, view.scale * by)) });
  // The whole graph in view, however small that makes it.
  const whole = () => {
    const all = Math.min(1, (width - 32) / layout.width, (560 - 40) / layout.height);
    view = { x: 0, y: 0, scale: all / fit };
  };
  function onwheel(e: WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }
  function onpointerdown(e: PointerEvent) {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  }
  function onpointermove(e: PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.moved = true;
    view = { ...view, x: drag.vx + dx, y: drag.vy + dy };
  }
  // A click (not the end of a drag) on a node opens its source.
  function open(n: Placed) {
    if (n.source) go(`#/material/${n.source.materialId}/${n.source.loc}/${n.id}`);
  }
  const clip = (s: string, max = 44) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
</script>

<div class="kg">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="kg__canvas" class:is-dragging={drag?.moved} bind:clientWidth={width} style:height="{height}px" {onwheel} {onpointerdown} {onpointermove}
    onpointerup={() => setTimeout(() => (drag = null))} onpointercancel={() => (drag = null)}>
    <svg viewBox="0 0 {layout.width} {layout.height}" width={layout.width} height={layout.height} role="group" aria-label="Knowledge graph"
      style:transform="translate({view.x}px, {view.y}px) scale({scale})">
      <defs>
        <marker id="kg-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M1,1 L9,5 L1,9" class="kg__head" />
        </marker>
      </defs>
      {#each layout.edges as e (`${e.from}>${e.to}`)}
        <path d={e.d} class="kg__edge" class:is-supports={e.kind === "supports"} marker-end="url(#kg-head)" />
      {/each}
      {#each layout.nodes as n (n.id)}
        <a href={n.source ? `#/material/${n.source.materialId}/${n.source.loc}/${n.id}` : undefined}
          class="kg__node is-{n.level}" aria-label="{n.title}: {percent(n)}"
          onclick={(e) => { e.preventDefault(); if (!drag?.moved) open(n); }}>
          <title>{n.title} · {percent(n)}{n.lesson ? ` · ${graph.lessons[n.lesson]}` : ""}</title>
          <rect x={n.x - W / 2} y={n.y - H / 2} width={W} height={H} rx="8" />
          <rect class="kg__fill" x={n.x - W / 2} y={n.y + H / 2 - 4} width={W * n.mastery} height="4" rx="2" />
          <foreignObject x={n.x - W / 2} y={n.y - H / 2} width={W} height={H - 4}>
            <div class="kg__label">{clip(n.title)}</div>
          </foreignObject>
        </a>
      {/each}
    </svg>
  </div>
  <div class="kg__zoom">
    <button type="button" class="btn btn--ghost btn--icon btn--sm" aria-label="Zoom in" onclick={() => zoom(1.25)}><Icon name="plus" size="sm" /></button>
    <button type="button" class="btn btn--ghost btn--icon btn--sm" aria-label="Zoom out" onclick={() => zoom(0.8)}><span class="minus" aria-hidden="true"></span></button>
    <button type="button" class="btn btn--ghost btn--sm" onclick={whole}>Whole graph</button>
  </div>
</div>

<style>
  .kg { position: relative; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface-sunken); }
  .kg__canvas { overflow: hidden; padding: var(--s-5) var(--s-4); display: flex; justify-content: center; cursor: grab; touch-action: none; min-height: 160px; }
  .kg__canvas.is-dragging { cursor: grabbing; }
  .kg__canvas svg { flex: none; max-width: none; overflow: visible; transform-origin: center top; }
  .kg__edge { fill: none; stroke: var(--text-faint); stroke-width: 1.4; }
  .kg__edge.is-supports { stroke-dasharray: 4 4; }
  .kg__head { fill: none; stroke: var(--text-faint); stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .kg__node { cursor: pointer; }
  .kg__node rect:first-of-type { fill: var(--surface); stroke: var(--border-control); stroke-width: 1.2; }
  .kg__node:hover rect:first-of-type, .kg__node:focus-visible rect:first-of-type { stroke: var(--accent); stroke-width: 2; }
  .kg__node.is-shaky rect:first-of-type { fill: var(--warning-wash); stroke: var(--warning); }
  .kg__node.is-solid rect:first-of-type { fill: var(--accent-wash); stroke: var(--accent); }
  .kg__node.is-mastered rect:first-of-type { fill: var(--success-wash); stroke: var(--success); }
  .kg__fill { fill: var(--accent); }
  .kg__node.is-shaky .kg__fill { fill: var(--warning); }
  .kg__node.is-mastered .kg__fill { fill: var(--success); }
  .kg__label { height: 100%; display: flex; align-items: center; justify-content: center; text-align: center; padding: 4px 10px; font-size: 12px; line-height: 15px; color: var(--text); overflow: hidden; }
  .kg__zoom { position: absolute; right: var(--s-2); bottom: var(--s-2); display: flex; gap: 2px; opacity: .75; }
  .kg__zoom:hover, .kg__zoom:focus-within { opacity: 1; }
  .minus { width: 10px; height: 1.5px; background: currentColor; border-radius: 1px; }
</style>
