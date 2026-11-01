<script lang="ts">
  import { ITEM_TYPES } from "../../../server/constants.ts";
  import { api, type FolderMaterial, type Item, type ItemMark, type ItemType } from "../lib/api.ts";
  import { renderInline } from "../lib/markdown.ts";
  import { attempt } from "../lib/state.svelte.ts";
  import { locLabel } from "../lib/viewer.ts";
  import Dialog from "./Dialog.svelte";
  import Icon from "./Icon.svelte";
  import Menu, { type MenuItem } from "./Menu.svelte";
  import Segmented from "./Segmented.svelte";
  import Select from "./Select.svelte";

  // gaps: items the plan has no lesson for, and items of started lessons that weren't taught (F-305).
  let { folderId, items, materials, distilling, canDistil, gaps, onchange, ondistil }: {
    folderId: string; items: Item[]; materials: FolderMaterial[]; distilling: boolean; canDistil: boolean;
    gaps: { unmapped: string[]; untaught: string[] } | null; onchange: () => void; ondistil: () => void;
  } = $props();

  type View = "all" | "scope" | "marked" | "gaps";
  const unmapped = $derived(new Set(gaps?.unmapped));
  const untaught = $derived(new Set(gaps?.untaught));
  const gapCount = $derived(unmapped.size + untaught.size);
  const MARKS: Record<ItemMark, string> = { known: "Known", skip: "Skipped", out_of_scope: "Out of scope" };
  const STATUS: Record<string, string> = { pending: "Pending", planned: "Planned", taught: "Taught", checked: "Checked", mastered: "Mastered" };
  const MANUAL = "Added by you";

  let query = $state("");
  let type = $state<ItemType | "">("");
  const typeOptions = ITEM_TYPES.map((t) => ({ value: t, label: t[0]!.toUpperCase() + t.slice(1) }));
  let view = $state<View>("all");
  let editing = $state<{ id: string | null; type: ItemType; title: string; statement: string } | null>(null);

  const visible = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => (!type || i.type === type)
      && (view === "all" || (view === "gaps" ? unmapped.has(i.id) || untaught.has(i.id) : (view === "marked") === !!i.mark))
      && (!q || i.title.toLowerCase().includes(q) || i.statement.toLowerCase().includes(q)));
  });
  // Grouped by the material each item was first found in, in the order the materials were added.
  const groups = $derived.by(() => {
    const order = new Map(materials.map((m, i) => [m.id, i]));
    const map = new Map<string, { name: string; rank: number; items: Item[] }>();
    for (const item of visible) {
      const source = item.sources[0];
      const key = source?.materialId ?? MANUAL;
      const group = map.get(key) ?? { name: source?.materialName ?? MANUAL, rank: source ? (order.get(source.materialId) ?? 1e6) : 2e6, items: [] };
      group.items.push(item);
      map.set(key, group);
    }
    return [...map.values()].sort((a, b) => a.rank - b.rank);
  });

  // Rows are drawn a page at a time; more load as the end of the list scrolls into view.
  const PAGE = 200;
  let shown = $state(PAGE);
  $effect(() => { void query; void type; void view; shown = PAGE; });
  const paged = $derived.by(() => {
    let left = shown;
    const out: { name: string; total: number; items: Item[] }[] = [];
    for (const group of groups) {
      if (left <= 0) break;
      out.push({ name: group.name, total: group.items.length, items: group.items.slice(0, left) });
      left -= group.items.length;
    }
    return out;
  });
  const more = (node: HTMLElement) => {
    const observer = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) shown += PAGE; }, { rootMargin: "600px" });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  };

  // A merged item can be found twice on one page (in two chunks); each page is linked once.
  const anchors = (item: Item) => item.sources.filter((s, i, all) => all.findIndex((o) => o.materialId === s.materialId && o.loc === s.loc) === i);


  async function patch(item: Item, change: Parameters<typeof api.updateItem>[1]) {
    await attempt(() => api.updateItem(item.id, change));
    onchange(); // also after a failure, so a stale list catches up
  }
  async function save() {
    const draft = editing!;
    const done = await attempt(() => (draft.id
      ? api.updateItem(draft.id, { type: draft.type, title: draft.title, statement: draft.statement })
      : api.addItem(folderId, { type: draft.type, title: draft.title, statement: draft.statement })));
    if (!done) return;
    editing = null;
    onchange();
  }
  const actions = (item: Item): MenuItem[] => [
    { label: "Edit", icon: "pencil", run: () => (editing = { id: item.id, type: item.type, title: item.title, statement: item.statement }) },
    ...(item.mark
      ? [{ label: "Bring back into scope", icon: "refresh", run: () => patch(item, { mark: null }) }]
      : [
        { label: "Mark as known", icon: "check", run: () => patch(item, { mark: "known" }) },
        { label: "Skip", icon: "x", run: () => patch(item, { mark: "skip" }) },
        { label: "Out of scope", icon: "x", run: () => patch(item, { mark: "out_of_scope" }) },
      ]),
    { label: "Delete", icon: "trash", danger: true, run: () => attempt(() => api.deleteItem(item.id)).then(onchange) },
  ];
</script>

{#if !items.length}
  <div class="ws__empty">
    <Icon name="list" />
    {#if distilling}
      <p>Distilling. Items appear here as they're found.</p>
    {:else if canDistil}
      <p>Your materials are read and ready. Distil them to build the ledger of everything they teach.</p>
      <button type="button" class="btn btn--accent btn--sm" onclick={ondistil}><Icon name="wand" size="sm" />Distil</button>
    {:else}
      <p>The ledger lists every learnable item in this folder's materials, with where each one appears.</p>
      <a class="btn btn--secondary btn--sm" href="#/folder/{folderId}/materials"><Icon name="upload" size="sm" />Add materials</a>
    {/if}
    <button type="button" class="btn btn--ghost btn--sm" onclick={() => (editing = { id: null, type: "concept", title: "", statement: "" })}><Icon name="plus" size="sm" />Add an item by hand</button>
  </div>
{:else}
  <div class="filters">
    <input class="input" type="search" placeholder="Filter {items.length} items…" aria-label="Filter items" bind:value={query} />
    <Select label="Item type" tip="Show one type of item" value={type} onchange={(v) => (type = v as ItemType | "")}
      options={[{ value: "", label: "All types" }, ...typeOptions]} />
    <Segmented label="Scope" value={view} onchange={(v) => (view = v)} options={[
      { value: "all", label: "All", tip: "Every item" }, { value: "scope", label: "In scope", tip: "Items not marked known, skipped or out of scope" }, { value: "marked", label: "Marked", tip: "Items marked known, skipped or out of scope" },
      ...(gapCount || view === "gaps" ? [{ value: "gaps" as const, label: `Gaps · ${gapCount}`, tip: "Items not in a lesson yet, or not taught in a lesson you started" }] : []),
    ]} />
    <span class="spacer"></span>
    <button type="button" class="btn btn--ghost btn--sm" onclick={() => (editing = { id: null, type: "concept", title: "", statement: "" })}><Icon name="plus" size="sm" />Add item</button>
  </div>

  {#if visible.length}
    <div class="table-wrap">
      <table class="table ledger">
        <thead><tr><th>Type</th><th>Item</th><th>Source</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {#each paged as group (group.name)}
            <tr class="ledger__group"><td colspan="5"><span class="eyebrow">{group.name}</span><span class="caption faint"> · {group.total} {group.total === 1 ? "item" : "items"}</span></td></tr>
            {#each group.items as item (item.id)}
              <tr class:is-marked={!!item.mark}>
                <td><span class="chip">{item.type}</span></td>
                <td>
                  <strong>{item.title}</strong>
                  {#if item.statement}<div class="ledger__statement">{@html renderInline(item.statement)}</div>{/if}
                </td>
                <td class="sources">
                  {#each anchors(item) as s (`${s.materialId}:${s.loc}`)}<a class="anchor" href="#/material/{s.materialId}/{s.loc}/{item.id}" data-tip={s.quote}><span class="anchor__file">{s.materialName}</span>&nbsp;· {locLabel(s.unit, s.loc)}</a>{/each}
                </td>
                <td>
                  <span class="status status--{item.status}"><i></i>{item.mark ? MARKS[item.mark] : STATUS[item.status]}</span>
                  {#if unmapped.has(item.id)}<span class="gap">Not in a lesson</span>{:else if untaught.has(item.id)}<span class="gap">Not taught yet</span>{/if}
                </td>
                <td class="num"><Menu label="Actions for {item.title}" items={actions(item)} /></td>
              </tr>
            {/each}
          {/each}
        </tbody>
      </table>
      {#if shown < visible.length}
        <div class="ledger__more" use:more>
          <span class="caption faint">Showing {shown} of {visible.length}</span>
          <button type="button" class="btn btn--ghost btn--sm" onclick={() => (shown += PAGE)}>Show more</button>
        </div>
      {/if}
    </div>
  {:else}
    <p class="ws__empty">No items match.</p>
  {/if}
{/if}

<Dialog bind:open={() => !!editing, (v) => { if (!v) editing = null; }} eyebrow="Ledger" title={editing?.id ? "Edit item" : "Add an item"}>
  {#if editing}
    <form id="item-form" class="item-form" onsubmit={(e) => { e.preventDefault(); save(); }}>
      <label class="field"><span class="field__label">Title</span><input class="input" bind:value={editing.title} maxlength="200" required /></label>
      <div class="field"><span class="field__label">Type</span>
        <Select label="Type" value={editing.type} onchange={(v) => (editing!.type = v as ItemType)} options={typeOptions} />
      </div>
      <label class="field"><span class="field__label">Statement <span class="field__hint">· Markdown and $maths$</span></span><textarea class="textarea" rows="4" bind:value={editing.statement} maxlength="2000"></textarea></label>
    </form>
  {/if}
  {#snippet footer()}
    <button type="button" class="btn btn--ghost" onclick={() => (editing = null)}>Cancel</button>
    <button type="submit" form="item-form" class="btn btn--primary" disabled={!editing?.title.trim()}>{editing?.id ? "Save" : "Add"}</button>
  {/snippet}
</Dialog>

<style>
  .sources { max-width: 260px; }
  .gap { display: block; margin-top: 4px; font: 500 10.5px var(--font-mono); color: var(--warning); white-space: nowrap; }
  .sources .anchor { display: inline-block; margin: 2px 4px 2px 0; white-space: nowrap; }
  .item-form { display: grid; gap: var(--s-4); }
  .ledger__more { display: flex; gap: var(--s-3); justify-content: center; align-items: center; padding: var(--s-4); }
</style>
