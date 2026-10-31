<script lang="ts">
  import { api, type FontInfo } from "../lib/api.ts";
  import { ANTHROPIC_SANS, cleanFamily, fontAvailable, setTextFont, textFontPref, type TextFont } from "../lib/prefs.ts";
  import { attempt, toast } from "../lib/state.svelte.ts";
  import Segmented from "./Segmented.svelte";

  type Mode = "satoshi" | "anthropic" | "custom";

  const saved = textFontPref();
  let font = $state<TextFont>(saved);
  let mode = $state<Mode>(saved.kind === "installed" || saved.kind === "upload" ? "custom" : saved.kind);
  let family = $state(saved.kind === "installed" ? saved.family : "");
  let upload = $state<FontInfo | null>(null);
  let busy = $state(false);
  let picker = $state<HTMLInputElement>();

  $effect(() => { attempt(() => api.fontInfo()).then((info) => (upload = info ?? null)); });

  const anthropicInstalled = $derived(mode === "anthropic" && fontAvailable(ANTHROPIC_SANS));
  const familyInstalled = $derived(font.kind === "installed" && fontAvailable(font.family));

  function apply(next: TextFont) {
    font = next;
    setTextFont(next);
  }

  function pickMode(next: Mode) {
    mode = next;
    if (next !== "custom") apply({ kind: next });
    else if (upload && font.kind !== "installed") apply({ kind: "upload", name: upload.name, version: upload.updatedAt });
    else if (cleanFamily(family)) apply({ kind: "installed", family: cleanFamily(family) });
  }

  function useInstalled(e: SubmitEvent) {
    e.preventDefault();
    const name = cleanFamily(family);
    if (name) apply({ kind: "installed", family: name });
  }

  async function chooseFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return toast("Font files can be up to 8 MB.", "error");
    busy = true;
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const info = await attempt(() => api.uploadFont(file.name, data));
    busy = false;
    if (!info) return;
    upload = info;
    apply({ kind: "upload", name: info.name, version: info.updatedAt });
  }

  async function removeUpload() {
    if (!(await attempt(() => api.removeFont()))) return;
    upload = null;
    if (font.kind !== "upload") return;
    if (cleanFamily(family)) apply({ kind: "installed", family: cleanFamily(family) });
    else pickMode("satoshi");
  }
</script>

<div class="srow srow--stack">
  <div class="head">
    <div><strong>Text font</strong><span class="caption muted">Used everywhere Satoshi is: interface, lessons and generated visuals. Headlines and code keep their faces.</span></div>
    <Segmented label="Text font" value={mode} onchange={pickMode}
      options={[{ value: "satoshi", label: "Satoshi" }, { value: "anthropic", label: "Anthropic Sans" }, { value: "custom", label: "Custom" }]} />
  </div>

  {#if mode === "anthropic"}
    <p class="caption" class:muted={anthropicInstalled} class:warn={!anthropicInstalled}>
      {anthropicInstalled ? "Using Anthropic Sans installed on this computer." : "Anthropic Sans isn't installed on this computer, so Satoshi is shown until it is. Distil never downloads it."}
    </p>
  {:else if mode === "custom"}
    <div class="custom">
      <form class="field" onsubmit={useInstalled}>
        <span class="field__label">Installed font</span>
        <span class="row">
          <input class="input" bind:value={family} placeholder="Inter, Segoe UI, Atkinson Hyperlegible…" maxlength="80" aria-label="Installed font name" spellcheck="false" />
          <button type="submit" class="btn btn--secondary btn--sm" disabled={!cleanFamily(family)}>Use</button>
        </span>
        {#if font.kind === "installed"}
          <span class="caption" class:muted={familyInstalled} class:warn={!familyInstalled}>
            {familyInstalled ? `Using ${font.family}.` : `${font.family} isn't installed here; Satoshi is shown instead.`}</span>
        {/if}
      </form>
      <div class="field">
        <span class="field__label">Or a font file</span>
        <span class="row">
          {#if upload}
            <span class="chip" class:chip--accent={font.kind === "upload"}>{upload.name}</span>
            {#if font.kind !== "upload"}<button type="button" class="btn btn--secondary btn--sm" onclick={() => apply({ kind: "upload", name: upload!.name, version: upload!.updatedAt })}>Use</button>{/if}
            <button type="button" class="btn btn--ghost btn--sm" onclick={removeUpload}>Remove</button>
          {/if}
          <button type="button" class="btn btn--ghost btn--sm" disabled={busy} onclick={() => picker?.click()}>{busy ? "Uploading…" : upload ? "Replace" : "Upload .woff2, .woff, .ttf or .otf"}</button>
          <input bind:this={picker} type="file" accept=".woff2,.woff,.ttf,.otf" hidden onchange={chooseFile} />
        </span>
        <span class="caption faint">Kept in your data folder. Make sure its licence allows personal use.</span>
      </div>
    </div>
  {/if}

  <p class="sample" aria-hidden="true">Everything in your syllabus, distilled — 0123456789 · ∂f/∂x</p>
</div>

<style>
  .head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--s-3); }
  .head > div:first-child { display: grid; }
  .custom { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--s-4); }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
  .row .input { flex: 1; min-width: 160px; }
  .warn { color: var(--warning); }
  .sample { font-size: var(--t-body-lg); padding: var(--s-3) var(--s-4); background: var(--surface-sunken); border-radius: var(--r-sm); }
</style>
