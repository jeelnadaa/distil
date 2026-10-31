<script lang="ts">
  import { tick } from "svelte";
  import { api, type ModelRef, type Provider, type Settings } from "../lib/api.ts";
  import { motionPref, palettePref, PALETTES, setMotion, setPalette, setTheme, themePref, type Motion, type PaletteId, type Theme } from "../lib/prefs.ts";
  import { app, attempt, loadModels, nav, refreshProviders, refreshSettings, toast } from "../lib/state.svelte.ts";
  import Dialog from "./Dialog.svelte";
  import Icon from "./Icon.svelte";
  import ModelSelect from "./ModelSelect.svelte";
  import Segmented from "./Segmented.svelte";
  import TextFontSetting from "./TextFontSetting.svelte";

  let { section }: { section?: string } = $props();

  const SECTIONS = [
    { id: "providers", label: "Providers", icon: "key" },
    { id: "models", label: "Models", icon: "layers" },
    { id: "limits", label: "Limits", icon: "chart" },
    { id: "appearance", label: "Appearance", icon: "type" },
    { id: "data", label: "Data", icon: "database" },
  ];

  // Jump straight to a deep-linked section on open; glide between sections afterwards.
  let opened = false;
  $effect(() => {
    const target = section;
    const behavior: ScrollBehavior = opened ? "smooth" : "instant";
    opened = true;
    tick().then(() => target && document.getElementById(target)?.scrollIntoView({ block: "start", behavior }));
  });

  const settings = $derived(app.settings);
  const configured = $derived(app.providers.filter((p) => p.configured));
  let usage = $state<{ today: number; month: number } | null>(null);
  $effect(() => { attempt(() => api.usage()).then((u) => (usage = u ?? null)); });

  const fmt = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

  async function save(patch: Partial<Settings>) {
    const next = await attempt(() => api.updateSettings(patch));
    if (next) app.settings = next;
    return next;
  }

  /* ---------- Providers ---------- */
  let keyDialog = $state({ open: false, provider: null as Provider | null, key: "", busy: false, error: "" });
  let endpointDialog = $state({ open: false, name: "", baseUrl: "", key: "", busy: false, error: "" });

  const openKey = (provider: Provider) => { keyDialog = { open: true, provider, key: "", busy: false, error: "" }; };

  async function saveKey(e: SubmitEvent) {
    e.preventDefault();
    if (!keyDialog.provider) return;
    keyDialog.busy = true;
    keyDialog.error = "";
    try {
      const { models } = await api.setKey(keyDialog.provider.id, keyDialog.key);
      const name = keyDialog.provider.name;
      keyDialog.open = false;
      await refreshProviders();
      await loadModels(true);
      toast(`${name} connected · ${models} models available.${settings?.models.strong ? "" : " Now pick your models."}`);
    } catch (err) {
      keyDialog.error = err instanceof Error ? err.message : String(err);
    } finally {
      keyDialog.busy = false;
    }
  }

  async function removeKey(provider: Provider) {
    if (!(await attempt(() => api.removeKey(provider.id)))) return;
    await refreshProviders();
    delete app.models[provider.id];
    toast(`Removed the ${provider.name} key.`);
  }

  async function addEndpoint(e: SubmitEvent) {
    e.preventDefault();
    if (!settings) return;
    endpointDialog.busy = true;
    endpointDialog.error = "";
    const slug = endpointDialog.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "endpoint";
    let id = `custom-${slug}`;
    for (let n = 2; app.providers.some((p) => p.id === id); n++) id = `custom-${slug}-${n}`;
    try {
      app.settings = await api.updateSettings({
        customEndpoints: [...settings.customEndpoints, { id, name: endpointDialog.name.trim(), baseUrl: endpointDialog.baseUrl.trim() }],
      });
      if (endpointDialog.key.trim()) await api.setKey(id, endpointDialog.key);
      endpointDialog.open = false;
      await refreshProviders();
      await loadModels(true);
      toast(`${endpointDialog.name} added.`);
    } catch (err) {
      endpointDialog.error = err instanceof Error ? err.message : String(err);
    } finally {
      endpointDialog.busy = false;
    }
  }

  async function removeEndpoint(provider: Provider) {
    if (!settings) return;
    if (provider.keyPreview) await attempt(() => api.removeKey(provider.id));
    const unset = (ref: ModelRef | null) => (ref?.provider === provider.id ? null : ref);
    await save({
      customEndpoints: settings.customEndpoints.filter((c) => c.id !== provider.id),
      models: { strong: unset(settings.models.strong), cheap: unset(settings.models.cheap) },
    });
    await refreshProviders();
    delete app.models[provider.id];
  }

  /* ---------- Limits ---------- */
  // Accepts "200000", "200k" or "1.5m"; blank means no cap.
  const parseTokens = (raw: string): number | null | undefined => {
    const m = raw.trim().toLowerCase().replace(/[,_\s]/g, "").match(/^(\d+(?:\.\d+)?)([km]?)$/);
    if (!raw.trim()) return null;
    if (!m) return undefined;
    const n = Math.round(Number(m[1]) * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1));
    return n > 0 ? n : undefined;
  };
  const showTokens = (n: number | null | undefined) => (n ? fmt.format(n).toLowerCase() : "");

  async function setCap(provider: string | null, period: "daily" | "monthly", e: Event) {
    if (!settings) return;
    const input = e.currentTarget as HTMLInputElement;
    const value = parseTokens(input.value);
    if (value === undefined) {
      toast("Use a number like 200000, 200k or 1.5m, or leave it blank for no cap.", "error");
      input.value = showTokens(provider ? settings.caps.perProvider[provider]?.[period] : settings.caps.global[period]);
      return;
    }
    const caps = structuredClone($state.snapshot(settings.caps));
    if (provider) caps.perProvider[provider] = { daily: null, monthly: null, ...caps.perProvider[provider], [period]: value };
    else caps.global[period] = value;
    const next = await save({ caps });
    if (next) input.value = showTokens(value);
  }

  /* ---------- Appearance ---------- */
  let theme = $state<Theme>(themePref());
  let palette = $state<PaletteId>(palettePref());
  let motion = $state<Motion>(motionPref());
</script>

<header class="topbar">
  <button type="button" class="btn btn--ghost btn--icon btn--sm topbar__menu" aria-label="Open menu" onclick={() => (nav.sidebarOpen = true)}><Icon name="sidebar" size="sm" /></button>
  <nav class="topbar__crumb"><strong>Settings</strong></nav>
</header>

<div class="scroll">
  <div class="page page--wide settings">
    <nav class="settings__nav" aria-label="Settings sections">
      {#each SECTIONS as s (s.id)}
        <a href="#/settings/{s.id}" aria-current={(section ?? "providers") === s.id}><Icon name={s.icon} size="sm" />{s.label}</a>
      {/each}
    </nav>

    {#if settings}
      <div class="settings__body">
        <section id="providers" class="sset">
          <header><h2 class="display-md">Providers</h2><p class="muted">Bring your own key. Keys stay in your data folder and are only sent to their own provider.</p></header>
          <ul class="prov">
            {#each app.providers as p (p.id)}
              <li>
                <div class="prov__name"><strong>{p.name}</strong>
                  <span class="caption muted">{#if p.custom}{p.baseUrl}{:else if p.keyUrl}<a href={p.keyUrl} target="_blank" rel="noopener noreferrer">Get a key</a>{/if}</span></div>
                <span class="chip" class:chip--success={p.configured}>{p.configured ? "Connected" : "Not set"}</span>
                <span class="mono faint prov__key">{p.keyPreview ?? ""}</span>
                <span class="prov__actions">
                  {#if p.custom}
                    <button type="button" class="btn btn--ghost btn--sm" onclick={() => openKey(p)}>{p.keyPreview ? "Replace key" : "Add key"}</button>
                    <button type="button" class="btn btn--ghost btn--sm" onclick={() => removeEndpoint(p)}>Remove</button>
                  {:else if p.configured}
                    <button type="button" class="btn btn--ghost btn--sm" onclick={() => openKey(p)}>Replace</button>
                    <button type="button" class="btn btn--ghost btn--sm" onclick={() => removeKey(p)}>Remove</button>
                  {:else}
                    <button type="button" class="btn btn--secondary btn--sm" onclick={() => openKey(p)}>Add key</button>
                  {/if}
                </span>
              </li>
            {/each}
          </ul>
          <div class="add-endpoint"><button type="button" class="btn btn--ghost btn--sm" onclick={() => (endpointDialog = { open: true, name: "", baseUrl: "", key: "", busy: false, error: "" })}>
            <Icon name="plus" size="sm" />Add a custom endpoint</button>
            <span class="caption faint">Ollama, LM Studio or any OpenAI-compatible server</span></div>
        </section>

        <section id="models" class="sset">
          <header><h2 class="display-md">Models</h2><p class="muted">Two slots cover every job. Each chat can also pick its own model from the composer.</p></header>
          {#if configured.length}
            <div class="slots">
              <div class="field"><span class="field__label">Strong <span class="faint caption">chat and teaching</span></span>
                <ModelSelect value={settings.models.strong} label="Strong model" onchange={(ref) => save({ models: { ...settings.models, strong: ref } })} /></div>
              <div class="field"><span class="field__label">Cheap <span class="faint caption">naming chats and small jobs</span></span>
                <ModelSelect value={settings.models.cheap} label="Cheap model" placeholder="Same as strong" onchange={(ref) => save({ models: { ...settings.models, cheap: ref } })} /></div>
            </div>
            <div><button type="button" class="btn btn--ghost btn--sm" onclick={() => loadModels(true)}><Icon name="refresh" size="sm" />Refresh model lists</button></div>
          {:else}
            <p class="body-sm muted">Add a provider key above to see its models.</p>
          {/if}
        </section>

        <section id="limits" class="sset">
          <header><h2 class="display-md">Limits</h2><p class="muted">Token caps. Distil warns at the threshold and stops before sending once a cap is reached. Leave blank for no cap.</p></header>
          <div class="srow"><div><strong>Warn at</strong></div>
            <Segmented label="Warning threshold" value={String(settings.caps.warnAt)} options={[{ value: "0.7", label: "70 %" }, { value: "0.8", label: "80 %" }, { value: "0.9", label: "90 %" }]}
              onchange={(v) => save({ caps: { ...$state.snapshot(settings.caps), warnAt: Number(v) } })} /></div>
          <div class="caps">
            <span></span><span class="eyebrow">Daily</span><span class="eyebrow">Monthly</span>
            <strong>All providers</strong>
            {#each ["daily", "monthly"] as const as period (period)}
              <label class="cap"><input class="input mono" placeholder="No cap" value={showTokens(settings.caps.global[period])} onchange={(e) => setCap(null, period, e)} aria-label="All providers, {period} cap" />
                {#if usage}<span class="caption faint">{fmt.format(period === "daily" ? usage.today : usage.month)} used</span>{/if}</label>
            {/each}
            {#each configured as p (p.id)}
              <span>{p.name}</span>
              {#each ["daily", "monthly"] as const as period (period)}
                <input class="input mono" placeholder="No cap" value={showTokens(settings.caps.perProvider[p.id]?.[period])} onchange={(e) => setCap(p.id, period, e)} aria-label="{p.name}, {period} cap" />
              {/each}
            {/each}
          </div>
        </section>

        <section id="appearance" class="sset">
          <header><h2 class="display-md">Appearance</h2></header>
          <div class="srow"><div><strong>Theme</strong></div>
            <Segmented label="Theme" value={theme} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }, { value: "system", label: "System" }]}
              onchange={(v) => { theme = v; setTheme(v); }} /></div>
          <div class="srow srow--stack"><div><strong>Palette</strong><span class="caption muted">Paper, ink and accent change together, in light and dark</span></div>
            <div class="palette-pick" role="radiogroup" aria-label="Palette">
              {#each PALETTES as p (p.id)}
                <button type="button" role="radio" aria-checked={palette === p.id} onclick={() => { palette = p.id; setPalette(p.id); }}>
                  <span class="palette-pick__chip">
                    {#each ["light", "dark"] as const as t (t)}
                      <span style:background={p.swatches[t][0]}><i style:background={p.swatches[t][2]}></i><b style:background={p[t]}></b></span>
                    {/each}
                  </span>
                  <span class="palette-pick__name">{p.name}{#if p.id === "copper"}<span class="caption faint">Default</span>{/if}</span>
                </button>
              {/each}
            </div></div>
          <TextFontSetting />
          <div class="srow"><div><strong>Motion</strong><span class="caption muted">Reduced replaces movement with quick fades</span></div>
            <Segmented label="Motion" value={motion} options={[{ value: "system", label: "System" }, { value: "full", label: "Full" }, { value: "reduce", label: "Reduced" }]}
              onchange={(v) => { motion = v; setMotion(v); }} /></div>
        </section>

        <section id="data" class="sset">
          <header><h2 class="display-md">Data</h2></header>
          <div class="srow"><div><strong>Data folder</strong><span class="caption muted mono">{settings.dataDir}</span></div></div>
          <p class="caption faint">Everything Distil knows lives here: chats, settings, usage and keys. Copy the folder while Distil is closed to back it up. Set <span class="mono">DISTIL_DATA_DIR</span> to use another location.</p>
        </section>
      </div>
    {/if}
  </div>
</div>

<Dialog bind:open={keyDialog.open} eyebrow="Provider" title={keyDialog.provider ? `${keyDialog.provider.name} key` : "Key"}>
  <form id="key-form" onsubmit={saveKey}>
    <label class="field"><span class="field__label">API key</span>
      <input class="input mono" type="password" autocomplete="off" spellcheck="false" bind:value={keyDialog.key} placeholder={keyDialog.provider?.keyHint} required={keyDialog.provider?.keyRequired} />
      <span class="field__hint">Checked with the provider before saving. Only ever sent to {keyDialog.provider ? new URL(keyDialog.provider.baseUrl).host : "the provider"}.</span></label>
    {#if keyDialog.error}<p class="body-sm error" role="alert">{keyDialog.error}</p>{/if}
  </form>
  {#snippet footer()}
    <button type="button" class="btn btn--ghost" onclick={() => (keyDialog.open = false)}>Cancel</button>
    <button type="submit" form="key-form" class="btn btn--primary" disabled={keyDialog.busy}>{keyDialog.busy ? "Checking…" : "Test and save"}</button>
  {/snippet}
</Dialog>

<Dialog bind:open={endpointDialog.open} eyebrow="Provider" title="Add an endpoint">
  <form id="endpoint-form" class="form" onsubmit={addEndpoint}>
    <label class="field"><span class="field__label">Name</span><input class="input" bind:value={endpointDialog.name} placeholder="Ollama" maxlength="60" required /></label>
    <label class="field"><span class="field__label">Base URL</span><input class="input mono" type="url" bind:value={endpointDialog.baseUrl} placeholder="http://localhost:11434/v1" required />
      <span class="field__hint">Any server that speaks the OpenAI Chat Completions API.</span></label>
    <label class="field"><span class="field__label">API key <span class="faint caption">optional</span></span><input class="input mono" type="password" autocomplete="off" bind:value={endpointDialog.key} /></label>
    {#if endpointDialog.error}<p class="body-sm error" role="alert">{endpointDialog.error}</p>{/if}
  </form>
  {#snippet footer()}
    <button type="button" class="btn btn--ghost" onclick={() => (endpointDialog.open = false)}>Cancel</button>
    <button type="submit" form="endpoint-form" class="btn btn--primary" disabled={endpointDialog.busy}>Add</button>
  {/snippet}
</Dialog>

<style>
  .add-endpoint { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
  .prov__actions { display: flex; gap: var(--s-1); justify-content: flex-end; }
  .prov__name a { color: var(--accent); }
  .caps { display: grid; grid-template-columns: minmax(0, 1fr) 160px 160px; gap: var(--s-2) var(--s-4); align-items: center; }
  .caps > span:not(.eyebrow), .caps > strong { font-size: var(--t-body-sm); }
  .cap { display: grid; gap: 2px; }
  .form { display: grid; gap: var(--s-4); }
  .error { color: var(--danger); }
  @container (max-width: 520px) {
    .caps { grid-template-columns: minmax(0, 1fr) 1fr 1fr; gap: var(--s-2); }
  }
</style>
