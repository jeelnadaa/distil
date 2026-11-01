<script lang="ts">
  import dagre from "@dagrejs/dagre";
  import type { FlowShape, FlowSpec, MapSpec } from "../../../../server/visuals/grammar/flow.ts";
  import type { Mark } from "../../../../server/visuals/grammar/common.ts";
  import { renderInline } from "../../lib/markdown.ts";
  import { onThemeChange } from "../../lib/visuals.ts";
  import Icon from "../Icon.svelte";

  // `flow` (F-701) and `map` (F-707): the model gives nodes and edges; dagre lays them out in layers and the
  // labels are measured in the current text font, so a font change lays the diagram out again (F-756).
  // Drag to pan, Ctrl + wheel or the buttons to zoom.
  let { spec }: { spec: FlowSpec | MapSpec } = $props();

  type Node = { id: string; label: string; shape: FlowShape; mark: Mark };
  type Placed = Node & { x: number; y: number; w: number; h: number; bw: number; bh: number };
  type Edge = { from: string; to: string; label?: string; mark: Mark; d: string; lx: number; ly: number; lw: number; lh: number };

  const nodes = $derived<Node[]>(spec.kind === "flow" ? spec.nodes : spec.nodes.map((n) => ({ ...n, shape: "box" as const })));
  const uid = `flow-${Math.random().toString(36).slice(2, 8)}`;
  let measure = $state<HTMLElement>();
  let layout = $state<{ nodes: Placed[]; edges: Edge[]; width: number; height: number } | null>(null);
  let tick = $state(0);
  let view = $state({ x: 0, y: 0, scale: 1 });
  let box = $state<HTMLElement>();

  $effect(() => onThemeChange(() => tick++));
  // Fonts load after first paint; lay out again once they have.
  $effect(() => { void document.fonts?.ready.then(() => tick++); });

  // The point where the line from `from` to the centre of a diamond meets its edge.
  function onDiamond(from: { x: number; y: number }, n: Placed) {
    const dx = from.x - n.x, dy = from.y - n.y;
    const s = 1 / (Math.abs(dx) / (n.bw / 2) + Math.abs(dy) / (n.bh / 2) || 1);
    return { x: n.x + dx * s, y: n.y + dy * s };
  }

  // A smooth path through dagre's bend points.
  function path(points: { x: number; y: number }[]) {
    if (points.length < 3) return `M${points[0]!.x},${points[0]!.y} L${points.at(-1)!.x},${points.at(-1)!.y}`;
    let d = `M${points[0]!.x},${points[0]!.y}`;
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i]!, q = points[i + 1]!;
      const mid = i === points.length - 2 ? q : { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      d += ` Q${p.x},${p.y} ${mid.x},${mid.y}`;
    }
    return d;
  }

  $effect(() => {
    void tick;
    if (!measure) return;
    // Rounded up: a box a fraction too narrow wraps its label onto a line that doesn't fit.
    const sizes = [...measure.children].map((el) => { const r = el.getBoundingClientRect(); return { w: Math.ceil(r.width) + 1, h: Math.ceil(r.height) }; });
    const g = new dagre.graphlib.Graph({ multigraph: true });
    g.setGraph({ rankdir: spec.kind === "flow" ? spec.dir : "TB", nodesep: 28, ranksep: 44, edgesep: 12, marginx: 4, marginy: 4 });
    nodes.forEach((n, i) => {
      const { w, h } = sizes[i]!;
      // A diamond big enough to hold its label box: |x|/a + |y|/b ≤ 1 at the box's corners.
      const [bw, bh] = n.shape === "decision" ? [w / 0.6, h * 2.5] : [w, h];
      g.setNode(n.id, { width: bw, height: bh });
    });
    spec.edges.forEach((e, i) => {
      const size = e.label ? sizes[nodes.length + i]! : { w: 0, h: 0 };
      g.setEdge(e.from, e.to, { width: size.w, height: size.h, labelpos: "c" }, String(i));
    });
    dagre.layout(g);
    const placed = new Map<string, Placed>();
    nodes.forEach((n, i) => {
      const at = g.node(n.id);
      placed.set(n.id, { ...n, x: at.x, y: at.y, w: sizes[i]!.w, h: sizes[i]!.h, bw: at.width, bh: at.height });
    });
    const edges = spec.edges.map((e, i): Edge => {
      const at = g.edge({ v: e.from, w: e.to, name: String(i) });
      const points = [...at.points];
      const from = placed.get(e.from)!, to = placed.get(e.to)!;
      if (from.shape === "decision") points[0] = onDiamond(points[1] ?? to, from);
      if (to.shape === "decision") points[points.length - 1] = onDiamond(points.at(-2) ?? from, to);
      const size = e.label ? sizes[nodes.length + i]! : { w: 0, h: 0 };
      return { ...e, d: path(points), lx: at.x ?? 0, ly: at.y ?? 0, lw: size.w, lh: size.h };
    });
    const graph = g.graph();
    layout = { nodes: [...placed.values()], edges, width: Math.ceil(graph.width ?? 0), height: Math.ceil(graph.height ?? 0) };
  });

  const tone = (m: Mark) => (m.emphasis ? "is-accent" : m.tone ? `is-${m.tone}` : m.muted ? "is-muted" : "");

  // Pan and zoom.
  let drag = $state<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const zoom = (by: number) => (view = { ...view, scale: Math.min(3, Math.max(0.4, view.scale * by)) });
  const reset = () => (view = { x: 0, y: 0, scale: 1 });
  function onwheel(e: WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }
  function onpointerdown(e: PointerEvent) {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onpointermove(e: PointerEvent) {
    if (drag) view = { ...view, x: drag.vx + e.clientX - drag.x, y: drag.vy + e.clientY - drag.y };
  }
  const moved = $derived(view.x !== 0 || view.y !== 0 || view.scale !== 1);
</script>

<div class="flow">
  <!-- Off-screen: every label set in the current font, measured for the layout. -->
  <div class="flow__measure" bind:this={measure} aria-hidden="true">
    {#each nodes as n (n.id)}<div class="flow__label">{@html renderInline(n.label)}</div>{/each}
    {#each spec.edges as e, i (i)}<div class="flow__edge-label">{@html renderInline(e.label ?? "")}</div>{/each}
  </div>

  {#if layout}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="flow__canvas" bind:this={box} class:is-dragging={drag} {onwheel} {onpointerdown} {onpointermove} onpointerup={() => (drag = null)} onpointercancel={() => (drag = null)}>
      <svg viewBox="0 0 {layout.width} {layout.height}" width={layout.width} height={layout.height} role="img"
        aria-label={layout.nodes.map((n) => n.label).join(", ")}
        style:transform="translate({view.x}px, {view.y}px) scale({view.scale})">
        <defs>
          {#each ["ink", "muted"] as t (t)}
            <marker id="{uid}-{t}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M1,1 L9,5 L1,9" class="flow__head flow__head--{t}" />
            </marker>
          {/each}
        </defs>
        {#each layout.edges as e, i (i)}
          {@const kind = e.mark.muted ? "muted" : "ink"}
          <path d={e.d} class="flow__edge" class:is-muted={e.mark.muted} marker-end="url(#{uid}-{kind})" />
        {/each}
        {#each layout.edges as e, i (i)}
          {#if e.label}
            <foreignObject x={e.lx - e.lw / 2} y={e.ly - e.lh / 2} width={e.lw} height={e.lh}>
              <div class="flow__edge-label">{@html renderInline(e.label)}</div>
            </foreignObject>
          {/if}
        {/each}
        {#each layout.nodes as n (n.id)}
          <g class="flow__node {tone(n.mark)}">
            {#if n.shape === "decision"}
              <polygon points="{n.x},{n.y - n.bh / 2} {n.x + n.bw / 2},{n.y} {n.x},{n.y + n.bh / 2} {n.x - n.bw / 2},{n.y}" />
            {:else}
              <rect x={n.x - n.bw / 2} y={n.y - n.bh / 2} width={n.bw} height={n.bh} rx={n.shape === "round" ? n.bh / 2 : 6} />
            {/if}
            <foreignObject x={n.x - n.w / 2} y={n.y - n.h / 2} width={n.w} height={n.h}>
              <div class="flow__label">{@html renderInline(n.label)}</div>
            </foreignObject>
          </g>
        {/each}
      </svg>
    </div>
    <div class="flow__zoom">
      <button type="button" class="btn btn--ghost btn--icon btn--sm" aria-label="Zoom in" onclick={() => zoom(1.25)}><Icon name="plus" size="sm" /></button>
      <button type="button" class="btn btn--ghost btn--icon btn--sm" aria-label="Zoom out" onclick={() => zoom(0.8)}><span class="minus" aria-hidden="true"></span></button>
      {#if moved}<button type="button" class="btn btn--ghost btn--sm" onclick={reset}>Fit</button>{/if}
    </div>
  {/if}
</div>

<style>
  .flow { position: relative; }
  .flow__measure { position: absolute; visibility: hidden; pointer-events: none; left: -9999px; top: 0; display: grid; justify-items: start; }
  .flow__label { display: inline-block; max-width: 200px; padding: 8px 14px; font-size: var(--t-body-sm); line-height: 20px; text-align: center; color: var(--text); overflow-wrap: break-word; }
  .flow__edge-label { display: inline-block; max-width: 160px; padding: 1px 6px; font-size: var(--t-caption); line-height: 16px; color: var(--text-muted); background: var(--surface); border-radius: var(--r-xs); text-align: center; }
  .flow__canvas { overflow: hidden; padding: var(--s-5) var(--s-4); display: flex; justify-content: center; cursor: grab; touch-action: none; min-height: 120px; }
  .flow__canvas.is-dragging { cursor: grabbing; }
  .flow__canvas svg { max-width: 100%; height: auto; overflow: visible; transform-origin: center top; }
  .flow__edge { fill: none; stroke: var(--text-muted); stroke-width: 1.5; }
  .flow__edge.is-muted { stroke: var(--text-faint); stroke-dasharray: 4 4; }
  .flow__head { fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .flow__head--ink { stroke: var(--text-muted); }
  .flow__head--muted { stroke: var(--text-faint); }
  .flow__node rect, .flow__node polygon { fill: var(--surface-sunken); stroke: var(--text-muted); stroke-width: 1.5; stroke-linejoin: round; }
  .flow__node.is-accent rect, .flow__node.is-accent polygon { fill: var(--accent-wash); stroke: var(--accent); }
  .flow__node.is-good rect, .flow__node.is-good polygon { fill: var(--success-wash); stroke: var(--success); }
  .flow__node.is-warn rect, .flow__node.is-warn polygon { fill: var(--warning-wash); stroke: var(--warning); }
  .flow__node.is-bad rect, .flow__node.is-bad polygon { fill: var(--danger-wash); stroke: var(--danger); }
  .flow__node.is-muted rect, .flow__node.is-muted polygon { fill: none; stroke: var(--border-control); }
  .flow__node.is-muted .flow__label { color: var(--text-muted); }
  .flow__node.is-accent .flow__label { font-weight: 600; }
  .flow__zoom { position: absolute; right: var(--s-2); bottom: var(--s-2); display: flex; gap: 2px; opacity: .7; }
  .flow__zoom:hover, .flow__zoom:focus-within { opacity: 1; }
  .minus { width: 10px; height: 1.5px; background: currentColor; border-radius: 1px; }
</style>
