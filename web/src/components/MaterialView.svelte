<script lang="ts">
  import ActivityDock from "./ActivityDock.svelte";
  import SoundButton from "./SoundButton.svelte";
  import { tick } from "svelte";
  import { api, type Item, type Material, type StoredChunk } from "../lib/api.ts";
  import { renderMarkdown } from "../lib/markdown.ts";
  import { attempt, folderPath, go, nav } from "../lib/state.svelte.ts";
  import { findRange, locLabel, sections } from "../lib/viewer.ts";
  import Icon from "./Icon.svelte";
  import PdfPages from "./PdfPages.svelte";
  import Segmented from "./Segmented.svelte";

  // Material viewer (F-210): the extracted text of any file, opened at a cited page/slide/line with the
  // quote highlighted, plus the original for PDFs. Ledger anchors link here.
  let { id, loc, item }: { id: string; loc: number | null; item: string | null } = $props();

  let material = $state<Material | null>(null);
  let chunks = $state<StoredChunk[]>([]);
  let items = $state<Item[]>([]);
  let view = $state<"text" | "original">("text");
  let body = $state<HTMLElement>();

  const path = $derived(material ? folderPath(material.folderId) : []);
  const parts = $derived(sections(chunks));
  // Items found in this file, in reading order, each with its anchor here.
  const found = $derived(items
    .map((i) => ({ item: i, source: i.sources.find((s) => s.materialId === id)! }))
    .filter((x) => x.source)
    .sort((a, b) => a.source.loc - b.source.loc));
  const current = $derived(found.find((x) => x.item.id === item));

  $effect(() => {
    attempt(() => api.material(id)).then(async (data) => {
      if (!data) return;
      material = data.material;
      chunks = data.chunks;
      items = (await attempt(() => api.items(data.material.folderId))) ?? [];
    });
  });

  // Jump to the cited location and highlight the quote (CSS Custom Highlight API; no DOM changes).
  $effect(() => {
    const target = loc;
    const quote = current?.source.quote ?? "";
    if (!body || !parts.length || view !== "text") return;
    void tick().then(() => {
      const section = target === null ? null : body!.querySelector<HTMLElement>(`[data-loc="${target}"]`);
      section?.scrollIntoView({ block: "start" });
      if (!("highlights" in CSS)) return;
      const range = section && quote ? findRange(section, quote) : null;
      if (range) {
        CSS.highlights.set("distil-quote", new Highlight(range));
        // Sections above render lazily (content-visibility) and change height as they appear, so settle.
        const el = range.startContainer.parentElement;
        const settle = (n: number) => { el?.scrollIntoView({ block: "center" }); if (n) requestAnimationFrame(() => settle(n - 1)); };
        settle(12);
      } else CSS.highlights.delete("distil-quote");
    });
    return () => { if ("highlights" in CSS) CSS.highlights.delete("distil-quote"); };
  });
</script>

<header class="topbar">
  <button type="button" class="btn btn--ghost btn--icon btn--sm topbar__menu" aria-label="Open menu" onclick={() => (nav.sidebarOpen = true)}><Icon name="sidebar" size="sm" /></button>
  <nav class="topbar__crumb" aria-label="Location">
    {#each path as f (f.id)}<a class="hide-sm crumb" href="#/folder/{f.id}/ledger">{f.name}</a><Icon name="chevron-right" size="sm" />{/each}
    <strong>{material?.name ?? "Material"}</strong>
  </nav>
  <span class="topbar__spacer"></span>
  {#if material?.kind === "pdf"}
    <Segmented label="View" value={view} onchange={(v) => (view = v)} options={[{ value: "text", label: "Text", tip: "The text Distil read from the file" }, { value: "original", label: "Original", tip: "The file as it was uploaded" }]} />
  {/if}
  {#if material}
    <a class="btn btn--ghost btn--icon btn--sm" href="/api/materials/{id}/file" download={material.name} aria-label="Download the original" data-tip="Download the original"><Icon name="download" size="sm" /></a>
  {/if}
  <SoundButton />
  <ActivityDock />
</header>

{#if material?.kind === "image"}
  <div class="scroll"><div class="vw vw--image"><img src="/api/materials/{id}/file" alt={material.name} /></div></div>
{:else if material && view === "original"}
  <div class="scroll"><PdfPages url="/api/materials/{id}/file" page={loc ?? 1} /></div>
{:else}
  <div class="scroll">
    <div class="vw">
      <article class="vw__body" bind:this={body}>
        {#if material && material.status !== "ready"}
          <p class="ws__empty">{material.status === "error" ? `This file couldn't be read: ${material.error}` : "Still reading this file…"}</p>
        {/if}
        {#each parts as part (part.loc)}
          <section class="vw__sec" data-loc={part.loc} class:is-target={part.loc === loc}>
            <span class="vw__loc mono">{locLabel(material?.unit ?? null, part.loc)}</span>
            <div class="md">{@html renderMarkdown(part.text)}</div>
          </section>
        {/each}
      </article>

      {#if found.length}
        <aside class="vw__rail" aria-label="Items from this file">
          <p class="eyebrow">{found.length} items in this file</p>
          <ul>
            {#each found as { item: i, source } (i.id)}
              <li>
                <a href="#/material/{id}/{source.loc}/{i.id}" class:is-current={i.id === item} aria-current={i.id === item ? "true" : undefined}>
                  <span class="mono faint">{locLabel(material?.unit ?? null, source.loc)}</span>
                  <span class="vw__title" class:is-marked={!!i.mark}>{i.title}</span>
                </a>
              </li>
            {/each}
          </ul>
          {#if material}<button type="button" class="btn btn--ghost btn--sm" onclick={() => go(`#/folder/${material!.folderId}/ledger`)}>Open the ledger</button>{/if}
        </aside>
      {/if}
    </div>
  </div>
{/if}

<style>
  .crumb { color: inherit; text-decoration: none; white-space: nowrap; }
  .crumb:hover { color: var(--text); }
  .vw { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: var(--s-8); width: min(1120px, 100% - 2 * var(--s-6)); margin-inline: auto; padding-block: var(--s-7) var(--s-9); }
  .vw__body { min-width: 0; max-width: 72ch; }
  .vw--image { grid-template-columns: minmax(0, 1fr); justify-items: center; }
  .vw--image img { max-width: 100%; height: auto; border-radius: var(--r-sm); box-shadow: 0 0 0 1px var(--border); }
  .vw__sec { position: relative; padding: var(--s-4) 0 var(--s-4) var(--s-4); border-left: 2px solid var(--border); scroll-margin-top: var(--s-6); content-visibility: auto; contain-intrinsic-size: auto 400px; }
  .vw__sec.is-target { border-left-color: var(--accent); }
  .vw__loc { display: block; margin-bottom: var(--s-2); font-size: 11px; letter-spacing: .06em; color: var(--text-faint); }
  .vw__sec.is-target .vw__loc { color: var(--accent); }
  .vw__rail { position: sticky; top: var(--s-6); align-self: start; display: grid; gap: var(--s-3); max-height: calc(100dvh - 120px); overflow: auto; }
  .vw__rail ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px; }
  .vw__rail a { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: var(--s-2); padding: 6px var(--s-2); border-radius: var(--r-sm); font-size: var(--t-body-sm); color: var(--text-muted); text-decoration: none; }
  .vw__rail a:hover { background: var(--surface-sunken); color: var(--text); }
  .vw__rail a.is-current { background: var(--surface); color: var(--text); box-shadow: 0 0 0 1px var(--border); }
  .vw__rail .mono { font-size: 11px; padding-top: 2px; }
  .vw__title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .vw__title.is-marked { text-decoration: line-through; }
  :global(::highlight(distil-quote)) { background-color: color-mix(in oklab, var(--accent) 30%, transparent); color: var(--text); }
  @media (max-width: 900px) {
    .vw { grid-template-columns: minmax(0, 1fr); }
    .vw__rail { display: none; }
  }
</style>
