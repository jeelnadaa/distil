<script lang="ts">
  import { api, type GraphView, type Job, type MasteryLevel, type ProgressView } from "../lib/api.ts";
  import { app, attempt, newPaper } from "../lib/state.svelte.ts";
  import Icon from "./Icon.svelte";
  import KnowledgeGraph from "./KnowledgeGraph.svelte";
  import Select from "./Select.svelte";

  // A folder's progress (F-911, F-912, F-914, F-921): how many items sit at each mastery level, a heatmap of
  // every lesson by unit, the weak spots to practise, and the knowledge graph of one unit at a time.
  let { folderId, jobs, onchange }: { folderId: string; jobs: Job[]; onchange: () => void } = $props();

  const LEVELS: { level: MasteryLevel; label: string }[] = [
    { level: "mastered", label: "Mastered" }, { level: "solid", label: "Solid" }, { level: "shaky", label: "Shaky" }, { level: "new", label: "Not started" },
  ];
  const LABEL = Object.fromEntries(LEVELS.map((l) => [l.level, l.label])) as Record<MasteryLevel, string>;

  let progress = $state<ProgressView | null>(null);
  let graph = $state<GraphView | null>(null);
  let unit = $state<string | null>(null);
  // Units the heatmap shows before "Show all".
  const UNITS = 12;
  let allUnits = $state(false);

  const show = $derived(app.settings?.mastery ?? "both");
  // Mastery as the learner chose to see it: a level, a percentage, or both.
  const percent = (m: { mastery?: number; value?: number; level: MasteryLevel }) => {
    const pct = `${Math.round((m.mastery ?? m.value ?? 0) * 100)}%`;
    return show === "levels" ? LABEL[m.level] : show === "percent" ? pct : `${LABEL[m.level]} · ${pct}`;
  };
  const levelOf = (v: number): MasteryLevel => (v >= 0.85 ? "mastered" : v >= 0.5 ? "solid" : v > 0 ? "shaky" : "new");

  const load = async () => {
    const r = await attempt(() => Promise.all([api.progress(folderId), api.graph(folderId, unit)]));
    if (!r) return;
    [progress, graph] = r;
    if (!unit && graph.units.length) {
      // Start on the first unit with links, or the first unit.
      unit = (graph.units.find((u) => u.linked) ?? graph.units[0]!).id;
      graph = (await attempt(() => api.graph(folderId, unit))) ?? graph;
    }
  };
  $effect(() => { void folderId; void load(); });
  const pickUnit = async (id: string) => {
    unit = id;
    graph = (await attempt(() => api.graph(folderId, id))) ?? graph;
  };

  const mapping = $derived(jobs.some((j) => j.kind === "graph" && (j.status === "queued" || j.status === "running")));
  let wasMapping = false;
  $effect(() => {
    if (mapping) wasMapping = true;
    else if (wasMapping) { wasMapping = false; void load(); }
  });
  async function map() {
    if (await attempt(() => api.buildGraph(folderId, unit))) onchange();
  }

  const current = $derived(graph?.units.find((u) => u.id === unit) ?? null);
  const studied = $derived(progress ? progress.total - progress.counts.new : 0);
</script>

{#if progress}
  <section class="prog">
    {#if !progress.total}
      <div class="ws__empty"><Icon name="chart" /><p>Progress shows once the folder has a ledger. Distil its materials first.</p></div>
    {:else}
      <div class="prog__levels" role="list">
        {#each LEVELS as l (l.level)}
          <div class="panel prog__level is-{l.level}" role="listitem">
            <span class="eyebrow">{l.label}</span>
            <span class="display-md">{progress.counts[l.level]}</span>
            {#if show !== "levels"}<span class="caption faint">{Math.round((progress.counts[l.level] / progress.total) * 100)}% of {progress.total}</span>{/if}
          </div>
        {/each}
      </div>
      <div class="prog__bar" aria-hidden="true">
        {#each LEVELS as l (l.level)}<span class="is-{l.level}" style:flex-grow={progress.counts[l.level]}></span>{/each}
      </div>
      <p class="caption muted">{studied} of {progress.total} items studied · {progress.cards.total} cards{progress.cards.due ? `, ${progress.cards.due} to review` : ""}
        {#if progress.cards.due}· <a href="#/review/{folderId}">Review now</a>{/if}</p>

      {#if progress.units.length}
        <section class="prog__section">
          <header><span class="eyebrow">By lesson</span><span class="caption faint">Darker is better known</span></header>
          <div class="heat">
            {#each allUnits ? progress.units : progress.units.slice(0, UNITS) as u, i (u.id)}
              <div class="heat__row">
                <span class="caption heat__unit" title={u.title}>{i + 1}. {u.title}</span>
                <div class="heat__cells">
                  {#each u.lessons as l (l.id)}
                    <span class="heat__cell is-{l.taught ? levelOf(l.mastery) : 'new'}" style:--m={l.mastery}
                      data-tip="{l.title} · {l.taught ? percent({ mastery: l.mastery, level: levelOf(l.mastery) }) : 'Not started'} · {l.taught}/{l.items} items studied"></span>
                  {/each}
                </div>
              </div>
            {/each}
            {#if progress.units.length > UNITS}
              <button type="button" class="btn btn--ghost btn--sm heat__more" onclick={() => (allUnits = !allUnits)}>{allUnits ? "Show fewer" : `Show all ${progress.units.length} units`}</button>
            {/if}
          </div>
        </section>
      {/if}

      <section class="prog__section">
        <header>
          <span class="eyebrow">Weak spots</span>
          {#if progress.weak.length}
            <button type="button" class="btn btn--secondary btn--sm" onclick={() => newPaper(folderId, { kind: "practice", scope: { kind: "items", items: progress!.weak.map((w) => w.id) } })}>
              <Icon name="target" size="sm" />Practise these
            </button>
          {/if}
        </header>
        {#if progress.weak.length}
          <ul class="weak">
            {#each progress.weak as w (w.id)}
              <li><span>{w.title}</span><span class="caption faint nowrap">{percent(w)}</span></li>
            {/each}
          </ul>
        {:else}
          <p class="body-sm muted">Nothing shaky. Items you've been taught but haven't shown you know show up here.</p>
        {/if}
      </section>

      {#if graph && graph.units.length}
        <section class="prog__section">
          <header>
            <span class="eyebrow">Knowledge graph</span>
            <div class="prog__graph-tools">
              <Select label="Unit" compact value={unit ?? ""} onchange={pickUnit} options={graph.units.map((u, i) => ({ value: u.id, label: `${i + 1}. ${u.title}` }))} />
              <button type="button" class="btn btn--ghost btn--sm" disabled={mapping} onclick={map}><Icon name="graph" size="sm" />{mapping ? "Mapping…" : current?.linked ? "Map again" : "Map this unit"}</button>
            </div>
          </header>
          {#if graph.nodes.length}
            <KnowledgeGraph {graph} {percent} />
            <p class="caption faint">{current?.linked ? "Arrows point to what an item builds on; dashed ones to what it supports. Select an item to see it in the material." : "Not mapped yet: map the unit to draw how its items build on each other."}</p>
          {/if}
        </section>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .prog { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-5); margin-top: var(--s-5); }
  .prog__levels { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--s-3); }
  .prog__level { padding: var(--s-4); display: grid; gap: var(--s-1); border-top-width: 3px; }
  .prog__level.is-mastered { border-top-color: var(--success); }
  .prog__level.is-solid { border-top-color: var(--accent); }
  .prog__level.is-shaky { border-top-color: var(--warning); }
  .prog__bar { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: var(--border); }
  .prog__bar span { flex-basis: 0; }
  .is-mastered { --tone: var(--success); }
  .is-solid { --tone: var(--accent); }
  .is-shaky { --tone: var(--warning); }
  .is-new { --tone: var(--border); }
  .prog__bar span { background: var(--tone); }
  .prog__section { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-3); }
  .prog__section > header { display: flex; justify-content: space-between; align-items: center; gap: var(--s-3); flex-wrap: wrap; min-height: 32px; }
  .prog__graph-tools { display: flex; gap: var(--s-2); align-items: center; flex-wrap: wrap; }
  .heat { display: grid; gap: 6px; }
  .heat__row { display: grid; grid-template-columns: minmax(0, 220px) minmax(0, 1fr); gap: var(--s-3); align-items: center; }
  .heat__unit { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); }
  .heat__cells { display: flex; flex-wrap: wrap; gap: 4px; }
  .heat__cell { width: 18px; height: 18px; border-radius: 4px; background: color-mix(in oklab, var(--tone) calc(25% + var(--m) * 75%), var(--surface-sunken)); border: 1px solid var(--border); }
  .heat__cell.is-new { background: var(--surface-sunken); }
  .heat__more { justify-self: start; }
  .weak { list-style: none; margin: 0; padding: 0; display: grid; }
  .weak li { display: flex; justify-content: space-between; gap: var(--s-3); padding: 9px 0; border-bottom: 1px solid var(--border); font-size: var(--t-body-sm); }
  .nowrap { white-space: nowrap; }
  @media (max-width: 640px) {
    .prog__levels { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .heat__row { grid-template-columns: minmax(0, 1fr); gap: 4px; }
  }
</style>
