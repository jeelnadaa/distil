<script lang="ts">
  import { untrack } from "svelte";
  import { api, type EmbeddingsView, type Provider, type Settings } from "../lib/api.ts";
  import { activity, jobPct } from "../lib/activity.svelte.ts";
  import { attempt } from "../lib/state.svelte.ts";
  import Dialog from "./Dialog.svelte";
  import Icon from "./Icon.svelte";
  import Segmented from "./Segmented.svelte";
  import Select, { type SelectOption } from "./Select.svelte";

  // Search by meaning (F-1005): off, an embedding model from a provider key, or a model on this computer
  // that downloads only after the learner agrees to its size. Keyword search is always on.
  let { settings, providers, save }: {
    settings: Settings; providers: Provider[]; save: (patch: Partial<Settings>) => Promise<unknown>;
  } = $props();

  type Size = EmbeddingsView["local"][number]["size"];
  let view = $state<EmbeddingsView | null>(null);
  let models = $state<SelectOption[]>([]);
  let consent = $state<{ open: boolean; size: Size | null; bytes: number | null; error: string }>({ open: false, size: null, bytes: null, error: "" });

  const mode = $derived(settings.embeddings.mode);
  const load = () => attempt(api.embeddings).then((v) => { if (v) view = v; });
  $effect(() => { untrack(load); });

  // A finished download or indexing run shows up here without a reload.
  const busy = $derived(activity.jobs.filter((j) => (j.kind === "embed" || j.kind === "embed-model") && (j.status === "queued" || j.status === "running")));
  let wasBusy = false;
  $effect(() => {
    const now = busy.length > 0;
    if (wasBusy && !now) untrack(load);
    wasBusy = now;
  });
  // A model's download job while it runs (progress in megabytes), and the indexing job.
  const downloadOf = (size: Size) => busy.find((j) => j.kind === "embed-model" && j.params.size === size) ?? null;
  const downloading = (size: Size) => downloadOf(size) !== null;
  const indexing = $derived(busy.find((j) => j.kind === "embed" && j.status === "running") ?? null);
  const runsOn = (m: EmbeddingsView["local"][number]) =>
    m.device === "gpu" ? "Runs on the graphics card" : m.device === "cpu" ? "Runs on the processor" : view?.gpu ? "Uses the graphics card" : "Runs on the processor";

  // The tab shown; the setting itself changes only once a model is picked (or Off is chosen).
  let choice = $state(untrack(() => settings.embeddings.mode));
  function setMode(next: string) {
    choice = next as typeof choice;
    if (next === "off") void save({ embeddings: { mode: "off" } });
    if (next === "provider" && !models.length) void loadModels();
  }
  if (untrack(() => choice) === "provider") void loadModels();

  // Embedding models from every provider with a key.
  async function loadModels() {
    const lists = await Promise.all(providers.map(async (p) =>
      ((await api.embeddingModels(p.id).catch(() => [])) ?? []).map((m) => ({ value: `${p.id}|${m.id}`, label: m.name, group: p.name }))));
    models = lists.flat();
  }
  const providerValue = $derived(settings.embeddings.mode === "provider" ? `${settings.embeddings.provider}|${settings.embeddings.id}` : "");
  const pickProvider = (v: string) => {
    const [provider, id] = v.split("|") as [string, string];
    return save({ embeddings: { mode: "provider", provider, id } });
  };

  async function useLocal(size: Size) {
    if (view?.local.find((m) => m.size === size)?.installed) return save({ embeddings: { mode: "local", size } });
    consent = { open: true, size, bytes: null, error: "" };
    const res = await api.localModelSize(size).catch((err: Error) => { consent.error = err.message; return null; });
    if (res) consent.bytes = res.bytes;
  }
  async function download() {
    const size = consent.size!;
    consent.open = false;
    if (await attempt(() => api.downloadLocalModel(size))) {
      await save({ embeddings: { mode: "local", size } });
    }
  }
  async function remove(size: Size) {
    if (await attempt(() => api.removeLocalModel(size))) {
      const next = await attempt(api.settings);
      if (next) settings.embeddings = next.embeddings;
      await load();
    }
  }
  const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1e6))} MB`;
</script>

<div class="emb">
  <div class="emb__head">
    <span class="field__label">Search by meaning</span>
    <span class="caption faint">Finds what your files say about a topic even when they use other words. Keyword search is always on.</span>
  </div>
  <Segmented label="Search by meaning" value={choice} onchange={setMode} options={[
    { value: "off", label: "Off", tip: "Keyword search only" },
    { value: "provider", label: "Provider", tip: "An embedding model from one of your keys; counts toward its quota" },
    { value: "local", label: "On this computer", tip: "Free after a one-time download" },
  ]} />

  {#if choice === "provider"}
    {#if models.length}
      <Select value={providerValue} options={models} onchange={pickProvider} label="Embedding model" placeholder="Choose an embedding model" />
    {:else}
      <p class="caption faint">None of your providers offers embedding models, or they're still loading. Gemini and OpenAI keys do.</p>
    {/if}
  {:else if choice === "local" && view}
    <div class="emb__local" role="radiogroup" aria-label="Local model">
      {#each view.local as m (m.size)}
        {@const picked = settings.embeddings.mode === "local" && settings.embeddings.size === m.size}
        <div class="emb__model" class:is-picked={picked}>
          <button type="button" class="emb__pick" role="radio" aria-checked={picked} disabled={downloading(m.size)} onclick={() => useLocal(m.size)}>
            <strong>{m.label}</strong><span class="caption muted">{m.note}</span>
            {#if downloadOf(m.size)}
              {@const job = downloadOf(m.size)!}
              <span class="caption faint">{job.total > 1 ? `Downloading ${job.done} of ${job.total} MB · ${jobPct(job)} %` : "Starting the download…"}</span>
              <span class="emb__bar" role="progressbar" aria-label="Download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={jobPct(job)}><span style:width="{jobPct(job)}%"></span></span>
            {:else}
              <span class="caption faint">{m.installed ? `Downloaded · ${runsOn(m).toLowerCase()}` : "Not downloaded"}</span>
            {/if}
          </button>
          {#if m.installed && !downloading(m.size)}
            <button type="button" class="btn btn--ghost btn--sm" onclick={() => remove(m.size)} aria-label="Remove the {m.label} model">Remove</button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if mode !== "off" && view?.index}
    <div class="emb__index caption muted">
      <span>{indexing && indexing.total ? `Indexing ${indexing.done} of ${indexing.total} sections` : `${view.index.done} of ${view.index.total} sections indexed`}</span>
      {#if view.index.done < view.index.total && !busy.length}
        <button type="button" class="btn btn--ghost btn--sm" onclick={() => attempt(api.indexNow).then(() => setTimeout(load, 1500))}><Icon name="refresh" size="sm" />Index now</button>
      {/if}
    </div>
  {/if}
</div>

<Dialog bind:open={consent.open} eyebrow="Search by meaning" title="Download a search model?">
  {#if consent.size}
    {@const m = view?.local.find((x) => x.size === consent.size)}
    <p class="body-sm">The <strong>{m?.label}</strong> model ({m?.note}) runs on this computer, so searching costs nothing and nothing leaves your machine.{#if view?.gpu} It uses your graphics card, and the processor if the graphics card can't run it.{/if}</p>
    <p class="body-sm muted">
      {#if consent.error}{consent.error}{:else if consent.bytes === null}Checking the download size…{:else}It downloads <strong>{mb(consent.bytes)}</strong> from Hugging Face into your data folder, once. You can remove it here any time.{/if}
    </p>
  {/if}
  {#snippet footer()}
    <button type="button" class="btn btn--ghost" onclick={() => (consent.open = false)}>Cancel</button>
    <button type="button" class="btn btn--primary" disabled={consent.bytes === null} onclick={download}>Download {consent.bytes !== null ? mb(consent.bytes) : ""}</button>
  {/snippet}
</Dialog>

<style>
  .emb { display: grid; gap: var(--s-3); padding-top: var(--s-4); border-top: 1px solid var(--border); }
  .emb__head { display: grid; gap: 2px; }
  .emb__local { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--s-2); }
  .emb__model { display: flex; align-items: flex-start; gap: var(--s-1); border: 1px solid var(--border); border-radius: var(--r-sm); padding: var(--s-1); }
  .emb__model.is-picked { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .emb__pick { flex: 1; display: grid; gap: 2px; text-align: left; padding: var(--s-2); border-radius: var(--r-xs); min-width: 0; }
  .emb__pick:hover:not(:disabled) { background: var(--surface-sunken); }
  .emb__bar { display: block; height: 4px; border-radius: var(--r-full); background: var(--surface-sunken); overflow: hidden; margin-top: var(--s-1); }
  .emb__bar > span { display: block; height: 100%; background: var(--accent); transition: width 300ms var(--ease-out); }
  .emb__index { display: flex; align-items: center; gap: var(--s-3); }
</style>
