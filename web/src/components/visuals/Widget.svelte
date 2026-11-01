<script lang="ts">
  import { type GrammarLang, parseWidget } from "../../../../server/visuals/grammar/index.ts";
  import Icon from "../Icon.svelte";
  import Chart from "./Chart.svelte";
  import Code from "./Code.svelte";
  import Compare from "./Compare.svelte";
  import Flow from "./Flow.svelte";
  import Formula from "./Formula.svelte";
  import Built from "./Built.svelte";
  import Plot from "./Plot.svelte";
  import Quiz from "./Quiz.svelte";
  import Steps from "./Steps.svelte";
  import Timeline from "./Timeline.svelte";

  // One visual in a reply (DESIGN.md §8 widget frame): an eyebrow title bar with actions, the visual, and a
  // calm fallback when the block can't be drawn (F-758). An unfinished block shows a placeholder while it
  // streams (F-759).
  let { lang, source, closed, streaming = false, messageId = null, built = null, onretry }: {
    lang: string; source: string; closed: boolean; streaming?: boolean; messageId?: string | null; built?: number | null;
    onretry?: () => Promise<void>;
  } = $props();

  const EYEBROW: Record<string, string> = {
    flow: "Diagram", map: "Concept map", plot: "Plot", chart: "Chart", steps: "Worked steps", compare: "Comparison",
    timeline: "Timeline", quiz: "Quiz", formula: "Formula", app: "Simulation", figure: "Figure", js: "Code",
  };

  const parsed = $derived(lang === "js" || !closed ? null : parseWidget(lang as GrammarLang, source));
  const spec = $derived(parsed?.ok ? parsed.spec : null);
  const title = $derived(spec && "title" in spec ? spec.title : undefined);
  let frame = $state<HTMLElement>();
  let retrying = $state(false);

  async function retry() {
    if (!onretry) return;
    retrying = true;
    try { await onretry(); } finally { retrying = false; }
  }

  const fullScreen = () => (document.fullscreenElement ? document.exitFullscreen() : frame?.requestFullscreen());
</script>

<figure class="widget" bind:this={frame} aria-label={title ?? EYEBROW[lang] ?? "Visual"}>
  <header class="widget__bar">
    <span class="eyebrow">{EYEBROW[lang] ?? lang}</span>
    {#if title}<span class="widget__title">{title}</span>{/if}
    <span class="spacer"></span>
    {#if closed && (spec || lang === "js")}
      <button type="button" class="btn btn--ghost btn--icon btn--sm" aria-label="Full screen" data-tip="Full screen" onclick={fullScreen}><Icon name="expand" size="sm" /></button>
    {/if}
  </header>

  {#if !closed}
    <div class="widget__placeholder" aria-live="polite">
      {#if streaming}<span class="drop" aria-hidden="true"></span><span class="muted body-sm">Drawing…</span>
      {:else}<span class="muted body-sm">This visual was cut off before it finished.</span>{/if}
    </div>
  {:else if lang === "js"}
    <Code {source} />
  {:else if !spec}
    <div class="widget__failed">
      <pre class="mono">{source}</pre>
      <div class="widget__failnote">
        <Icon name="warning" size="sm" /><span class="caption muted">Couldn't draw this{parsed && !parsed.ok ? `: ${parsed.error}` : ""}</span>
        <span class="spacer"></span>
        {#if onretry}<button type="button" class="btn btn--ghost btn--sm" disabled={retrying} onclick={retry}>{retrying ? "Retrying…" : "Retry"}</button>{/if}
      </div>
    </div>
  {:else if spec.kind === "flow" || spec.kind === "map"}
    <Flow {spec} />
  {:else if spec.kind === "plot"}
    <Plot {spec} />
  {:else if spec.kind === "chart"}
    <Chart {spec} />
  {:else if spec.kind === "steps"}
    <Steps {spec} />
  {:else if spec.kind === "compare"}
    <Compare {spec} />
  {:else if spec.kind === "timeline"}
    <Timeline {spec} />
  {:else if spec.kind === "quiz"}
    <Quiz {spec} />
  {:else if spec.kind === "formula"}
    <Formula {spec} />
  {:else if (spec.kind === "app" || spec.kind === "figure") && messageId && built !== null}
    <Built {spec} {messageId} block={built} />
  {:else}
    <p class="widget__note muted body-sm">{spec.kind === "app" ? "The simulation is built once the reply is saved." : "The figure is drawn once the reply is saved."}</p>
  {/if}
</figure>

<style>
  .widget { margin: var(--s-5) 0; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface); overflow: hidden; animation: widget-in var(--dur-slow, 320ms) var(--spring-smooth, ease-out) both; }
  .widget:fullscreen { overflow: auto; display: flex; flex-direction: column; border-radius: 0; }
  .widget__bar { display: flex; align-items: center; gap: var(--s-2); min-height: 40px; padding: var(--s-1) var(--s-2) var(--s-1) var(--s-4); border-bottom: 1px solid var(--border); }
  .widget__title { font-size: var(--t-body-sm); font-weight: 600; color: var(--text); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .spacer { flex: 1; }
  .widget__placeholder { display: flex; align-items: center; gap: var(--s-2); min-height: 120px; justify-content: center; background: var(--surface-sunken); }
  .widget__failed { display: grid; grid-template-columns: minmax(0, 1fr); }
  .widget__failed pre { margin: 0; padding: var(--s-3) var(--s-4); font-size: var(--t-caption); white-space: pre-wrap; color: var(--text-muted); background: var(--surface-sunken); max-height: 320px; overflow: auto; }
  .widget__failnote { display: flex; align-items: center; gap: var(--s-2); padding: var(--s-2) var(--s-2) var(--s-2) var(--s-4); color: var(--text-muted); border-top: 1px solid var(--border); }
  .widget__note { padding: var(--s-4); }
  .drop { width: 8px; height: 8px; border-radius: var(--r-full); background: var(--accent); animation: drop 1.2s var(--ease-in-out, ease-in-out) infinite; }
  @keyframes drop { 50% { opacity: .3; transform: scale(.7); } }
  @keyframes widget-in { from { opacity: 0; transform: translateY(4px); } }
  @media (prefers-reduced-motion: reduce) { .widget, .drop { animation: none; } }
  :global([data-motion="reduce"]) .widget, :global([data-motion="reduce"]) .drop { animation: none; }
</style>
