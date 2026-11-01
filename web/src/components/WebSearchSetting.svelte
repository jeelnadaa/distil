<script lang="ts">
  import { api, type SearchProviders } from "../lib/api.ts";
  import { attempt, toast } from "../lib/state.svelte.ts";
  import Segmented from "./Segmented.svelte";

  // Web search for the researcher (F-1209): a Tavily or Brave Search key. Each key is tried with one search
  // before it's kept; only the masked end of a saved key is ever shown.
  let view = $state<SearchProviders | null>(null);
  let adding = $state<string | null>(null);
  let key = $state("");
  let busy = $state(false);

  $effect(() => { attempt(api.searchProviders).then((v) => { if (v) view = v; }); });

  const saved = $derived(view?.providers.filter((p) => p.preview) ?? []);
  async function add(e: SubmitEvent) {
    e.preventDefault();
    if (!adding) return;
    busy = true;
    const next = await attempt(() => api.addSearchKey(adding!, key.trim()));
    busy = false;
    if (!next) return;
    view = next;
    toast(`${next.providers.find((p) => p.id === adding)!.label} connected. The researcher now searches the web.`);
    adding = null;
    key = "";
  }
  async function remove(id: string) {
    const next = await attempt(() => api.removeSearchKey(id));
    if (next) view = next;
  }
  async function use(id: string) {
    const next = await attempt(() => api.setSearchProvider(id === "off" ? null : id));
    if (next) view = next;
  }
</script>

{#if view}
  <div class="srow">
    <div><strong>Search provider</strong><span class="caption muted">For subjects with no material, the researcher writes a syllabus from web sources it cites. Without a key it writes from the model's own knowledge and says so.</span></div>
    {#if saved.length}
      <Segmented label="Search provider" value={view.provider ?? "off"} onchange={use} options={[{ value: "off", label: "Off" }, ...saved.map((p) => ({ value: p.id, label: p.label }))]} />
    {:else}
      <span class="caption faint">No key yet</span>
    {/if}
  </div>
  {#each view.providers as p (p.id)}
    <div class="srow">
      <div><strong>{p.label}</strong>
        <span class="caption muted">{p.id === "tavily" ? "Search made for AI research; a free monthly allowance at tavily.com." : "An independent web index; a free monthly allowance at brave.com/search/api."}</span></div>
      {#if p.preview}
        <span class="ws-key"><span class="mono caption">{p.preview}</span><button type="button" class="btn btn--ghost btn--sm" onclick={() => remove(p.id)}>Remove</button></span>
      {:else if adding === p.id}
        <form class="ws-key" onsubmit={add}>
          <input class="input mono" type="password" autocomplete="off" placeholder="Paste the API key" aria-label="{p.label} API key" bind:value={key} />
          <button type="submit" class="btn btn--primary btn--sm" disabled={busy || key.trim().length < 8}>{busy ? "Checking…" : "Add"}</button>
          <button type="button" class="btn btn--ghost btn--sm" onclick={() => { adding = null; key = ""; }}>Cancel</button>
        </form>
      {:else}
        <button type="button" class="btn btn--secondary btn--sm" onclick={() => { adding = p.id; key = ""; }}>Add key</button>
      {/if}
    </div>
  {/each}
{/if}

<style>
  .ws-key { display: flex; gap: var(--s-2); align-items: center; flex-wrap: wrap; justify-content: flex-end; }
  .ws-key .input { width: min(260px, 100%); }
</style>
