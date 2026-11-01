<script lang="ts">
  import { untrack } from "svelte";
  import { api, type GraphView, type MasteryLevel } from "../lib/api.ts";
  import { renderInline } from "../lib/markdown.ts";
  import { app, attempt } from "../lib/state.svelte.ts";
  import Icon from "./Icon.svelte";
  import KnowledgeGraph from "./KnowledgeGraph.svelte";
  import Select from "./Select.svelte";

  // A folder's knowledge graph, one unit at a time (F-921, F-924): pick the unit, map it, open it full screen,
  // and select an item to see what it is, what it builds on and what builds on it. In a lesson it opens full
  // screen on the lesson's unit with the lesson's items outlined (`highlight`); `onclose` ends it there.
  let { folderId, unit: startUnit = null, highlight = [], onclose }: {
    folderId: string; unit?: string | null; highlight?: string[]; onclose?: () => void;
  } = $props();

  const LABEL: Record<MasteryLevel, string> = { new: "Not started", shaky: "Shaky", solid: "Solid", mastered: "Mastered" };

  let graph = $state<GraphView | null>(null);
  let unit = $state<string | null>(untrack(() => startUnit));
  let full = $state(untrack(() => !!onclose));
  let selected = $state<string | null>(null);
  let mapping = $state(false);
  const lit = $derived(new Set(highlight));

  // Mastery as the learner chose to see it (F-914).
  const label = (n: { mastery: number; level: MasteryLevel }) => {
    const show = app.settings?.mastery ?? "both";
    const pct = `${Math.round(n.mastery * 100)}%`;
    return show === "levels" ? LABEL[n.level] : show === "percent" ? pct : `${LABEL[n.level]} · ${pct}`;
  };

  async function load() {
    const g = await attempt(() => api.graph(folderId, unit));
    if (!g) return;
    graph = g;
    // With no unit asked for, start on the first unit with links, or the first unit.
    if (!unit && g.units.length) await pick((g.units.find((u) => u.linked) ?? g.units[0]!).id);
  }
  $effect(() => { void folderId; untrack(() => void load()); });
  async function pick(id: string) {
    unit = id;
    selected = null;
    graph = (await attempt(() => api.graph(folderId, id))) ?? graph;
  }

  // Mapping runs as a job; it is watched here until it ends.
  async function map() {
    const job = await attempt(() => api.buildGraph(folderId, unit));
    if (!job) return;
    mapping = true;
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      const now = (await attempt(api.jobs))?.find((j) => j.id === job.id);
      if (!now || (now.status !== "queued" && now.status !== "running")) break;
    }
    mapping = false;
    await pick(unit!);
  }

  const current = $derived(graph?.units.find((u) => u.id === unit) ?? null);
  const node = $derived(graph?.nodes.find((n) => n.id === selected) ?? null);
  const titleOf = (id: string) => graph?.nodes.find((n) => n.id === id)?.title ?? "";
  const buildsOn = $derived(graph && node ? graph.edges.filter((e) => e.from === node.id) : []);
  const leadsTo = $derived(graph && node ? graph.edges.filter((e) => e.to === node.id) : []);

  function close() {
    if (onclose) onclose();
    else full = false;
  }
  function onkeydown(e: KeyboardEvent) {
    if (e.key !== "Escape" || !full || document.querySelector(".dialog-root, [role=listbox]")) return;
    e.preventDefault();
    if (selected) selected = null;
    else close();
  }
</script>

<svelte:window {onkeydown} />

{#if graph && graph.units.length}
  <section class="gp" class:gp--full={full} aria-label="Knowledge graph">
    <header class="gp__head">
      <span class="eyebrow">Knowledge graph</span>
      <div class="gp__tools">
        <Select label="Unit" compact value={unit ?? ""} onchange={pick} options={graph.units.map((u, i) => ({ value: u.id, label: `${i + 1}. ${u.title}` }))} />
        <button type="button" class="btn btn--ghost btn--sm" disabled={mapping} onclick={map}><Icon name="graph" size="sm" />{mapping ? "Mapping…" : current?.linked ? "Map again" : "Map this unit"}</button>
        {#if full}
          <button type="button" class="btn btn--ghost btn--icon btn--sm" aria-label="Close full screen" data-tip="Close (Esc)" onclick={close}><Icon name="x" size="sm" /></button>
        {:else}
          <button type="button" class="btn btn--ghost btn--icon btn--sm" aria-label="Full screen" data-tip="Full screen" onclick={() => (full = true)}><Icon name="expand" size="sm" /></button>
        {/if}
      </div>
    </header>

    {#if graph.nodes.length}
      <div class="gp__body">
        <KnowledgeGraph {graph} {label} highlight={lit} bind:selected fill={full} layoutKey="distil.graph.{folderId}.{unit ?? 'all'}" />
        {#if node}
          <aside class="panel gp__card" aria-live="polite">
            <header>
              <span class="chip">{node.type}</span>
              <button type="button" class="btn btn--ghost btn--icon btn--sm" aria-label="Close details" onclick={() => (selected = null)}><Icon name="x" size="sm" /></button>
            </header>
            <strong class="heading-sm">{node.title}</strong>
            <span class="caption gp__level is-{node.level}">{label(node)}{node.lesson ? ` · ${graph.lessons[node.lesson]}` : ""}</span>
            {#if node.statement}<p class="body-sm gp__statement">{@html renderInline(node.statement)}</p>{/if}
            {#each [{ title: "Builds on", ids: buildsOn.map((e) => e.to) }, { title: "Leads to", ids: leadsTo.map((e) => e.from) }] as group (group.title)}
              {#if group.ids.length}
                <div class="gp__links">
                  <span class="eyebrow">{group.title}</span>
                  {#each group.ids as id (id)}<button type="button" class="gp__link" onclick={() => (selected = id)}>{titleOf(id)}</button>{/each}
                </div>
              {/if}
            {/each}
            {#if node.source}<a class="btn btn--secondary btn--sm" href="#/material/{node.source.materialId}/{node.source.loc}/{node.id}" onclick={() => onclose?.()}><Icon name="file" size="sm" />Open in material</a>{/if}
          </aside>
        {/if}
      </div>
      <p class="caption faint">
        {current?.linked ? "Arrows point to what an item builds on; dashed ones to what it supports. Drag items to arrange them; select one for details." : "Not mapped yet: map the unit to draw how its items build on each other."}
        {#if lit.size}Outlined: this lesson's items.{/if}
      </p>
    {/if}
  </section>
{:else if graph && onclose}
  <section class="gp gp--full">
    <header class="gp__head"><span class="eyebrow">Knowledge graph</span><button type="button" class="btn btn--ghost btn--icon btn--sm" aria-label="Close" onclick={close}><Icon name="x" size="sm" /></button></header>
    <p class="muted">There's no plan to map yet.</p>
  </section>
{/if}

<style>
  .gp { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-3); }
  .gp--full { position: fixed; inset: 0; z-index: 45; background: var(--bg); padding: var(--s-4) var(--s-5) var(--s-3); grid-template-rows: auto minmax(0, 1fr) auto; }
  .gp__head { display: flex; justify-content: space-between; align-items: center; gap: var(--s-3); flex-wrap: wrap; min-height: 32px; }
  .gp__tools { display: flex; gap: var(--s-2); align-items: center; flex-wrap: wrap; min-width: 0; }
  .gp__body { position: relative; min-height: 0; }
  .gp__card { position: absolute; top: var(--s-3); right: var(--s-3); width: min(320px, calc(100% - 2 * var(--s-3))); max-height: calc(100% - 2 * var(--s-3) - 40px); overflow: auto; padding: var(--s-4); display: grid; gap: var(--s-2); box-shadow: var(--shadow-float); }
  .gp__card header { display: flex; justify-content: space-between; align-items: center; }
  .gp__level { color: var(--text-muted); }
  .gp__level.is-shaky { color: var(--warning); }
  .gp__level.is-solid { color: var(--accent); }
  .gp__level.is-mastered { color: var(--success); }
  .gp__statement { color: var(--text-muted); overflow-wrap: anywhere; margin: 0; }
  .gp__links { display: grid; gap: 2px; justify-items: start; }
  .gp__link { all: unset; cursor: pointer; font-size: var(--t-body-sm); color: var(--text); text-decoration: underline; text-decoration-color: var(--border-control); text-underline-offset: 3px; }
  .gp__link:hover, .gp__link:focus-visible { text-decoration-color: var(--accent); }
  .gp__card .btn { justify-self: start; margin-top: var(--s-1); }
  @media (max-width: 640px) {
    .gp--full { padding: var(--s-3); }
    .gp__card { top: auto; bottom: var(--s-3); max-height: 50%; }
  }
</style>
