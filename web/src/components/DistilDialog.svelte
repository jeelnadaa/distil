<script lang="ts">
  import { untrack } from "svelte";
  import { api, type DistilScope, type Estimate, type Material, type Strategy } from "../lib/api.ts";
  import { app, attempt, toast } from "../lib/state.svelte.ts";
  import Dialog from "./Dialog.svelte";
  import Segmented from "./Segmented.svelte";

  // Cost pre-flight (F-208): nothing that spends tokens starts before the learner sees the estimate.
  // With a material, only that file is distilled, optionally only a range of its pages/slides/lines.
  let { folderId, mode, material = null, onclose, onstarted }: {
    folderId: string; mode: "extract" | "reaudit"; material?: Material | null; onclose: () => void; onstarted: () => void;
  } = $props();

  const UNITS: Record<string, string> = { page: "Pages", slide: "Slides", para: "Paragraphs", line: "Lines" };
  const last = $derived(material?.length ?? 1);
  let from = $state(1);
  let to = $state(untrack(() => material?.length ?? 1)); // the dialog opens for one material, so this is its start value

  let open = $state(true);
  let strategy = $state<Strategy>("balanced");
  let estimate = $state<Estimate | null>(null);
  let starting = $state(false);

  const fmt = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
  const strong = $derived(app.settings?.models.strong);
  const cheap = $derived(app.settings?.models.cheap ?? strong);
  const reaudit = $derived(mode === "reaudit");

  // A range only narrows the run when it's valid and smaller than the whole file.
  const scope = $derived.by((): DistilScope => {
    const ranged = material && from >= 1 && to >= from && to <= last && (from > 1 || to < last);
    return { strategy, materialId: material?.id, ...(ranged && { from, to }) };
  });
  const rangeValid = $derived(!material || (from >= 1 && to >= from && to <= last));

  $effect(() => {
    const current = scope;
    estimate = null;
    if (!rangeValid) return;
    // Wait for typing in the range fields to settle before asking for a new estimate.
    const timer = setTimeout(() => {
      attempt(() => api.estimate(folderId, current, reaudit)).then((e) => { if (e && current === scope) estimate = e; });
    }, 250);
    return () => clearTimeout(timer);
  });
  $effect(() => { if (!open) onclose(); });

  async function start() {
    starting = true;
    const jobs = await attempt(() => (reaudit ? api.reaudit(folderId, strategy) : api.extract(folderId, scope)));
    starting = false;
    if (!jobs) return;
    toast(jobs.length ? `${reaudit ? "Re-auditing" : "Distilling"} ${jobs.length} ${jobs.length === 1 ? "file" : "files"}. You can keep studying.` : "Nothing left to distil.");
    onstarted();
    open = false;
  }
</script>

<Dialog bind:open eyebrow={reaudit ? "What did we miss?" : "Distil"} title={reaudit ? "Re-read everything for missed items" : material ? `Distil ${material.name}` : "Distil materials into the ledger"} wide>
  {#if !strong}
    <p class="body-sm">Pick a model in <a href="#/settings/models">Settings › Models</a> first.</p>
  {:else}
    <Segmented label="Strategy" value={strategy} onchange={(v) => (strategy = v)} options={[
      { value: "balanced", label: "Balanced" },
      { value: "thorough", label: "Thorough" },
      { value: "economy", label: "Economy" },
    ]} />
    <p class="body-sm muted">
      {#if reaudit}
        <strong>{strategy === "economy" ? (cheap ?? strong).id : strong.id}</strong> re-reads every part against what's already in the ledger and adds what was missed, then merges duplicates.
      {:else if strategy === "balanced"}
        <strong>{cheap?.id}</strong> lists every learnable item, then <strong>{strong.id}</strong> audits each part for anything missed and merges duplicates.
      {:else if strategy === "thorough"}
        <strong>{strong.id}</strong> does every step. Slower and costlier; use it for dense or high-stakes material.
      {:else}
        <strong>{(cheap ?? strong).id}</strong> does every step, audits included. Cheapest, and it fits small free-tier quotas; it may miss a little more than Balanced.
      {/if}
    </p>
    {#if material && last > 1}
      <div class="range">
        <span class="field__label">{UNITS[material.unit ?? ""] ?? "Parts"}</span>
        <input class="input" type="number" min="1" max={last} bind:value={from} aria-label="From" />
        <span class="muted">to</span>
        <input class="input" type="number" min="1" max={last} bind:value={to} aria-label="To" />
        <span class="caption faint">of {last}. Distil the rest any time later.</span>
      </div>
      {#if !rangeValid}<p class="caption error">Pick a range between 1 and {last}.</p>{/if}
    {/if}
    <div class="pf-total">
      {#if estimate}
        <span class="body-sm muted">{estimate.materials} {estimate.materials === 1 ? "file" : "files"} · {estimate.chunks} {estimate.chunks === 1 ? "part" : "parts"}{#if estimate.images}{" · "}{estimate.images} page {estimate.images === 1 ? "image" : "images"}{/if}</span>
        <span class="mono">
          <span class="num">~{fmt.format(estimate.total).toLowerCase()} tokens</span>
          {#if estimate.cheap.input + estimate.cheap.output > 0}
            <span class="faint"> · {fmt.format(estimate.strong.input + estimate.strong.output).toLowerCase()} strong, {fmt.format(estimate.cheap.input + estimate.cheap.output).toLowerCase()} cheap</span>
          {/if}
        </span>
      {:else}
        <span class="body-sm faint">{rangeValid ? "Estimating…" : "—"}</span>
      {/if}
    </div>
    <p class="caption faint">An upper-end estimate. Pages with formulas, figures or scans are also sent as images so nothing drawn is missed. Caps are checked before every call, and the job runs in the background: stop it any time and it resumes where it left off.</p>
  {/if}
  {#snippet footer()}
    <button type="button" class="btn btn--ghost" onclick={() => (open = false)}>Cancel</button>
    <button type="button" class="btn btn--accent" disabled={!strong || !rangeValid || !estimate || !estimate.chunks || starting} onclick={start}>{reaudit ? "Re-audit" : "Distil it"}</button>
  {/snippet}
</Dialog>

<style>
  .range { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
  .range .input { width: 88px; height: 34px; }
  .error { color: var(--danger); }
</style>
