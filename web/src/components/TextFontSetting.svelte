<script lang="ts">
  import { api, type SavedFont } from "../lib/api.ts";
  import { ANTHROPIC_SANS, cleanFamily, fontAvailable, setTextFont, textFontPref, type TextFont } from "../lib/prefs.ts";
  import { attempt, toast } from "../lib/state.svelte.ts";
  import Dialog from "./Dialog.svelte";
  import Icon from "./Icon.svelte";
  import Segmented from "./Segmented.svelte";

  // Satoshi and Anthropic Sans are built in; every font the learner adds is saved under a name and
  // becomes a pill of its own, so it never has to be added again.
  let font = $state<TextFont>(textFontPref());
  let saved = $state<SavedFont[]>([]);
  let adding = $state<{ source: "installed" | "file"; family: string; file: File | null; name: string; busy: boolean } | null>(null);
  let renaming = $state<{ font: SavedFont; name: string } | null>(null);
  let picker = $state<HTMLInputElement>();

  const selectedId = $derived(font.kind === "saved" ? font.id : font.kind === "anthropic" || font.kind === "satoshi" ? font.kind : null);
  const current = $derived.by(() => {
    const pick = font;
    return pick.kind === "saved" ? saved.find((f) => f.id === pick.id) : undefined;
  });
  const anthropicFamily = $derived(font.kind === "anthropic" ? ANTHROPIC_SANS.find(fontAvailable) : undefined);

  const toPref = (f: SavedFont): TextFont => (f.kind === "installed" ? { kind: "saved", id: f.id, family: f.family } : { kind: "saved", id: f.id });
  function apply(next: TextFont) {
    font = next;
    setTextFont(next);
  }

  $effect(() => {
    attempt(() => api.fonts()).then(async (list) => {
      if (!list) return;
      saved = list;
      // Fonts chosen before fonts were saved by name: a typed family is saved now; an upload was moved into the list.
      if (font.kind === "installed") {
        const added = await attempt(() => api.addFont({ family: (font as { family: string }).family }));
        if (added) { saved = [...saved, added]; apply(toPref(added)); }
      } else if (font.kind === "upload") {
        const file = list.find((f) => f.kind === "file");
        apply(file ? toPref(file) : { kind: "satoshi" });
      }
    });
  });

  const defaultName = $derived(adding?.source === "installed" ? cleanFamily(adding.family)
    : adding?.file ? cleanFamily(adding.file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ")) : "");
  const canAdd = $derived(!!adding && !adding.busy && (adding.source === "installed" ? !!cleanFamily(adding.family) : !!adding.file));

  function chooseFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file || !adding) return;
    if (file.size > 8 * 1024 * 1024) return toast("Font files can be up to 8 MB.", "error");
    adding.file = file;
  }

  async function add(e: SubmitEvent) {
    e.preventDefault();
    const draft = adding!;
    draft.busy = true;
    const name = draft.name.trim() || undefined;
    const added = await attempt(async () => {
      if (draft.source === "installed") return api.addFont({ family: cleanFamily(draft.family), name });
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(draft.file!);
      });
      return api.addFont({ fileName: draft.file!.name, data, name });
    });
    draft.busy = false;
    if (!added) return;
    saved = [...saved, added];
    adding = null;
    apply(toPref(added));
  }

  async function rename(e: SubmitEvent) {
    e.preventDefault();
    const draft = renaming!;
    const updated = await attempt(() => api.renameFont(draft.font.id, draft.name));
    if (!updated) return;
    saved = saved.map((f) => (f.id === updated.id ? updated : f));
    renaming = null;
  }

  async function remove(target: SavedFont) {
    if (!(await attempt(() => api.removeFont(target.id)))) return;
    saved = saved.filter((f) => f.id !== target.id);
    if (font.kind === "saved" && font.id === target.id) apply({ kind: "satoshi" });
  }
</script>

<div class="srow srow--stack">
  <div class="head">
    <strong>Text font</strong>
    <span class="caption muted">Used everywhere Satoshi is: interface, lessons and generated visuals. Headlines and code keep their faces.</span>
  </div>

  <div class="pills" role="group" aria-label="Text font">
    <button type="button" class="pill" aria-pressed={selectedId === "satoshi"} onclick={() => apply({ kind: "satoshi" })} data-tip="Distil's own face">Satoshi</button>
    <button type="button" class="pill" aria-pressed={selectedId === "anthropic"} onclick={() => apply({ kind: "anthropic" })} data-tip="Uses Anthropic Sans if it's installed on this computer">Anthropic Sans</button>
    {#each saved as f (f.id)}
      <button type="button" class="pill" aria-pressed={selectedId === f.id} onclick={() => apply(toPref(f))}
        data-tip={f.kind === "installed" ? `Installed font: ${f.family}` : "Font file kept in your data folder"}>{f.name}</button>
    {/each}
    <button type="button" class="pill pill--add" onclick={() => (adding = { source: "installed", family: "", file: null, name: "", busy: false })} data-tip="Save another font to pick from"><Icon name="plus" size="sm" />Add font</button>
  </div>

  {#if font.kind === "anthropic"}
    <p class="caption" class:muted={!!anthropicFamily} class:warn={!anthropicFamily}>
      {anthropicFamily ? `Using ${anthropicFamily}, installed on this computer.` : "Anthropic Sans isn't installed on this computer, so Satoshi is shown. Install it, or add its font file with Add font."}
    </p>
  {:else if current}
    <div class="current">
      <span class="caption" class:muted={current.kind === "file" || fontAvailable(current.family)} class:warn={current.kind === "installed" && !fontAvailable(current.family)}>
        {current.kind === "file" ? "Font file kept in your data folder." : fontAvailable(current.family) ? `Installed font: ${current.family}.` : `${current.family} isn't installed here, so Satoshi is shown.`}
      </span>
      <button type="button" class="btn btn--ghost btn--sm" onclick={() => (renaming = { font: current!, name: current!.name })}>Rename</button>
      <button type="button" class="btn btn--ghost btn--sm" onclick={() => remove(current!)}>Remove</button>
    </div>
  {/if}

  <p class="sample" aria-hidden="true">Everything in your syllabus, distilled — 0123456789 · ∂f/∂x</p>
</div>

<Dialog bind:open={() => !!adding, (v) => { if (!v) adding = null; }} eyebrow="Text font" title="Add a font">
  {#if adding}
    <form id="font-form" class="font-form" onsubmit={add}>
      <Segmented label="Where the font is" value={adding.source} onchange={(v) => (adding!.source = v)}
        options={[{ value: "installed", label: "Installed on this computer" }, { value: "file", label: "Font file" }]} />
      {#if adding.source === "installed"}
        <label class="field">
          <span class="field__label">Font name</span>
          <input class="input" bind:value={adding.family} placeholder="Inter, Segoe UI, Atkinson Hyperlegible…" maxlength="80" spellcheck="false" />
          <span class="field__hint">As your computer lists it. Distil never downloads it.</span>
        </label>
      {:else}
        <div class="field">
          <span class="field__label">File</span>
          <span class="row">
            {#if adding.file}<span class="chip">{adding.file.name}</span>{/if}
            <button type="button" class="btn btn--secondary btn--sm" onclick={() => picker?.click()}>{adding.file ? "Choose another" : "Choose .woff2, .woff, .ttf or .otf"}</button>
          </span>
          <span class="field__hint">Kept in your data folder. Make sure its licence allows personal use.</span>
          <input bind:this={picker} type="file" accept=".woff2,.woff,.ttf,.otf" hidden onchange={chooseFile} />
        </div>
      {/if}
      <label class="field">
        <span class="field__label">Name <span class="field__hint">· optional, shown on its button</span></span>
        <input class="input" bind:value={adding.name} placeholder={defaultName || "My font"} maxlength="80" />
      </label>
    </form>
  {/if}
  {#snippet footer()}
    <button type="button" class="btn btn--ghost" onclick={() => (adding = null)}>Cancel</button>
    <button type="submit" form="font-form" class="btn btn--primary" disabled={!canAdd}>{adding?.busy ? "Adding…" : "Add and use"}</button>
  {/snippet}
</Dialog>

<Dialog bind:open={() => !!renaming, (v) => { if (!v) renaming = null; }} eyebrow="Text font" title="Rename font">
  {#if renaming}
    <form id="rename-font" onsubmit={rename}>
      <label class="field"><span class="field__label">Name</span><input class="input" bind:value={renaming.name} maxlength="80" required /></label>
    </form>
  {/if}
  {#snippet footer()}
    <button type="button" class="btn btn--ghost" onclick={() => (renaming = null)}>Cancel</button>
    <button type="submit" form="rename-font" class="btn btn--primary" disabled={!renaming?.name.trim()}>Save</button>
  {/snippet}
</Dialog>

<style>
  .head { display: grid; }
  .pills { display: flex; flex-wrap: wrap; gap: 4px; padding: 3px; background: var(--surface-sunken); border-radius: var(--r-sm); width: fit-content; max-width: 100%; }
  .pill {
    display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 var(--s-3); border-radius: 4px;
    font-size: 13px; font-weight: 550; color: var(--text-muted); transition: color var(--dur-fast) linear, background var(--dur-fast) linear;
  }
  .pill:hover { color: var(--text); }
  .pill[aria-pressed="true"] { color: var(--text); background: var(--surface); box-shadow: 0 1px 2px rgb(0 0 0 / .08), 0 0 0 1px var(--border); }
  .pill--add { color: var(--text-faint); }
  .current { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
  .font-form { display: grid; gap: var(--s-4); }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
  .warn { color: var(--warning); }
  .sample { font-size: var(--t-body-lg); padding: var(--s-3) var(--s-4); background: var(--surface-sunken); border-radius: var(--r-sm); }
</style>
