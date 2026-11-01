<script lang="ts">
  import ActivityDock from "./ActivityDock.svelte";
  import SoundButton from "./SoundButton.svelte";
  import { api, type Dial, type FolderMaterial, type Item, type Job, type Material, type PlanView } from "../lib/api.ts";
  import { attempt, folderPath, type FolderTab, go, library, nav, refreshLibrary } from "../lib/state.svelte.ts";
  import DialSelect, { inheritedDial } from "./DialSelect.svelte";
  import DistilDialog from "./DistilDialog.svelte";
  import Icon from "./Icon.svelte";
  import CoverageBars from "./CoverageBars.svelte";
  import LedgerTab from "./LedgerTab.svelte";
  import MaterialsTab from "./MaterialsTab.svelte";
  import PlanTab from "./PlanTab.svelte";
  import PracticeTab from "./practice/PracticeTab.svelte";

  let { id, tab }: { id: string; tab: FolderTab } = $props();

  const folder = $derived(library.folders.find((f) => f.id === id));
  const path = $derived(folderPath(id).slice(0, -1));
  // This folder and every folder under it: the ledger and extraction cover the whole subtree.
  const subtree = $derived.by(() => {
    const ids = new Set([id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const f of library.folders) if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) { ids.add(f.id); grew = true; }
    }
    return ids;
  });

  let materials = $state<FolderMaterial[]>([]);
  let items = $state<Item[]>([]);
  let jobs = $state<Job[]>([]);
  let plan = $state<PlanView | null>(null);
  let loaded = $state(false);
  let distil = $state<{ mode: "extract" | "reaudit"; material?: Material } | null>(null);

  const mine = $derived(jobs.filter((j) => j.folderId && subtree.has(j.folderId)));
  const active = $derived(mine.filter((j) => j.status === "queued" || j.status === "running"));
  const current = $derived(active.find((j) => j.status === "running") ?? active[0]);
  const own = $derived(materials.filter((m) => !m.inherited));
  const undistilled = $derived(own.filter((m) => m.status === "ready" && m.distilled < m.chunks));
  const counted = $derived(items.filter((i) => !i.mark));
  const latest = $derived([...items].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4));

  // Items are the heavy part (a textbook has 1000+); they're replaced only when they actually changed,
  // so an unchanged ledger isn't re-rendered on every poll.
  let itemsJson = "";
  const setItems = (next: Item[]) => {
    const json = JSON.stringify(next);
    if (json !== itemsJson) { itemsJson = json; items = next; }
  };
  async function refresh() {
    const result = await attempt(() => Promise.all([api.materials(id), api.items(id), api.jobs(), api.plan(id)]));
    if (!result) return;
    [materials, , jobs, plan] = result;
    setItems(result[1]);
    loaded = true;
  }
  // While busy: jobs and materials every 1.5 s, items every 6 s.
  let ticks = 0;
  async function poll() {
    const withItems = ++ticks % 4 === 0;
    const result = await attempt(() => Promise.all([api.materials(id), api.jobs(), withItems ? api.items(id) : Promise.resolve(null), withItems ? api.plan(id) : Promise.resolve(null)]));
    if (!result) return;
    [materials, jobs] = result;
    if (result[2]) setItems(result[2]);
    if (result[3]) plan = result[3];
  }

  // Poll while work is running in this folder; settle with one last refresh when it stops.
  $effect(() => {
    void refresh();
  });
  const busy = $derived(active.length > 0);
  let wasBusy = false;
  $effect(() => {
    if (busy) {
      wasBusy = true;
      const timer = setInterval(poll, 1500);
      return () => clearInterval(timer);
    }
    if (wasBusy) {
      wasBusy = false;
      void refresh();
    }
  });

  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  const summary = $derived([
    `${own.length} ${own.length === 1 ? "file" : "files"}`,
    `${items.length} ${items.length === 1 ? "item" : "items"}`,
    ...(materials.length > own.length ? [`${materials.length - own.length} from parent folders`] : []),
  ].join(" · "));

  // The folder's interactivity dial (F-741), which its chats and subfolders follow unless they set their own.
  async function setDial(dial: Dial | null) {
    if (await attempt(() => api.updateFolder(id, { dial }))) await refreshLibrary();
  }
</script>

<header class="topbar">
  <button type="button" class="btn btn--ghost btn--icon btn--sm topbar__menu" aria-label="Open menu" onclick={() => (nav.sidebarOpen = true)}><Icon name="sidebar" size="sm" /></button>
  <nav class="topbar__crumb" aria-label="Location">
    {#each path as f (f.id)}<a class="hide-sm crumb" href="#/folder/{f.id}">{f.name}</a><Icon name="chevron-right" size="sm" />{/each}
    <strong>{folder?.name ?? "Folder"}</strong>
  </nav>
  <span class="topbar__spacer"></span>
  {#if undistilled.length && !active.some((j) => j.kind === "extract")}
    <button type="button" class="btn btn--accent btn--sm" onclick={() => (distil = { mode: "extract" })}><Icon name="wand" size="sm" />Distil</button>
  {/if}
  <SoundButton />
  <ActivityDock />
</header>

<div class="scroll">
  <div class="page page--wide">
    {#if !folder}
      <div class="ws__empty"><p>This folder no longer exists.</p><button type="button" class="btn btn--secondary btn--sm" onclick={() => go("#/")}>Go home</button></div>
    {:else}
      <header class="ws__head">
        <h1 class="display-lg">{folder.name}</h1>
        <div class="ws__meta">
          <p class="muted">{summary}</p>
          <DialSelect value={folder.dial} inherited={inheritedDial(folder.parentId)} label="Visuals in this folder's chats" onchange={setDial} />
        </div>
      </header>

      <nav class="subtabs" aria-label="Workspace">
        <a href="#/folder/{id}/materials" aria-current={tab === "materials" ? "page" : undefined}>Materials</a>
        <a href="#/folder/{id}/ledger" aria-current={tab === "ledger" ? "page" : undefined}>Ledger</a>
        <a href="#/folder/{id}/plan" aria-current={tab === "plan" ? "page" : undefined}>Plan</a>
        <a href="#/folder/{id}/practice" aria-current={tab === "practice" ? "page" : undefined}>Practice</a>
      </nav>

      {#if current || (items.length && plan)}
        <div class="ws__top">
          {#if items.length && plan}
            <section class="panel ws__panel" aria-label="Coverage">
              <div class="ws__panel-head">
                <span class="eyebrow">Coverage · {counted.length} items</span>
                <button type="button" class="btn btn--ghost btn--sm" disabled={!!active.length} onclick={() => (distil = { mode: "reaudit" })}><Icon name="refresh" size="sm" />What did we miss?</button>
              </div>
              <CoverageBars {...plan.coverage} />
              {#if !plan.plan}<p class="caption faint">Each item gets a place in a lesson once you <a href="#/folder/{id}/plan">build the plan</a>.</p>{/if}
            </section>
          {/if}
          {#if current}
            <section class="panel ws__panel" aria-live="polite">
              <div class="ws__panel-head">
                <span class="eyebrow">{current.label}</span>
                <button type="button" class="btn btn--ghost btn--sm" onclick={() => attempt(() => api.abortJob(current!.id)).then(refresh)}><Icon name="stop" size="sm" />Stop</button>
              </div>
              {#if current.kind === "extract"}
                <div class="mini-still" aria-hidden="true">
                  <div class="mini-still__raw"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
                  <div class="mini-still__filter"></div>
                  <ul class="mini-still__out">
                    {#each latest as item (item.id)}<li><span class="chip">{item.type}</span><span class="mini-still__title">{item.title}</span></li>{/each}
                  </ul>
                </div>
              {/if}
              <div class="ws__bar"><span style:width="{pct(current.done, current.total)}%"></span></div>
              <p class="mono caption"><span class="faint">{pct(current.done, current.total)}% · {items.length} items</span>{#if active.length > 1}<span class="faint"> · {active.length - 1} more queued</span>{/if}</p>
            </section>
          {/if}
        </div>
      {/if}

      {#if loaded}
        {#if tab === "materials"}
          <MaterialsTab folderId={id} {materials} {jobs} onchange={refresh} ondistil={(m) => (distil = { mode: "extract", material: m })} />
        {:else if tab === "practice"}
          <PracticeTab folderId={id} {plan} items={counted.length} />
        {:else if tab === "plan"}
          {#if plan}<PlanTab folderId={id} folderName={folder.name} view={plan} {items} onview={(v) => (plan = v)} onchange={refresh} />{/if}
        {:else}
          <LedgerTab folderId={id} {items} gaps={plan ? { unmapped: plan.plan ? plan.coverage.unmapped : [], untaught: plan.coverage.untaught } : null} {materials} distilling={active.some((j) => j.kind === "extract")} onchange={refresh} ondistil={() => (distil = { mode: "extract" })} canDistil={undistilled.length > 0} />
        {/if}
      {/if}
    {/if}
  </div>
</div>

{#if distil}
  <DistilDialog folderId={id} mode={distil.mode} material={distil.material} onclose={() => (distil = null)} onstarted={refresh} />
{/if}

<style>
  .crumb { color: inherit; text-decoration: none; white-space: nowrap; }
  .crumb:hover { color: var(--text); }
</style>
