<script lang="ts">
  import { api, type Estimate, type Strategy } from "../lib/api.ts";
  import { app, attempt, toast } from "../lib/state.svelte.ts";
  import Dialog from "./Dialog.svelte";
  import Segmented from "./Segmented.svelte";

  // Cost pre-flight (F-208): nothing that spends tokens starts before the learner sees the estimate.
  let { folderId, mode, onclose, onstarted }: {
    folderId: string; mode: "extract" | "reaudit"; onclose: () => void; onstarted: () => void;
  } = $props();

  let open = $state(true);
  let strategy = $state<Strategy>("balanced");
  let estimate = $state<Estimate | null>(null);
  let starting = $state(false);

  const fmt = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
  const strong = $derived(app.settings?.models.strong);
  const cheap = $derived(app.settings?.models.cheap ?? strong);
  const reaudit = $derived(mode === "reaudit");

  $effect(() => {
    const s = strategy;
    estimate = null;
    attempt(() => api.estimate(folderId, s, reaudit)).then((e) => { if (e && s === strategy) estimate = e; });
  });
  $effect(() => { if (!open) onclose(); });

  async function start() {
    starting = true;
    const jobs = await attempt(() => (reaudit ? api.reaudit(folderId, strategy) : api.extract(folderId, strategy)));
    starting = false;
    if (!jobs) return;
    toast(jobs.length ? `${reaudit ? "Re-auditing" : "Distilling"} ${jobs.length} ${jobs.length === 1 ? "file" : "files"}. You can keep studying.` : "Nothing left to distil.");
    onstarted();
    open = false;
  }
</script>

<Dialog bind:open eyebrow={reaudit ? "What did we miss?" : "Distil"} title={reaudit ? "Re-read everything for missed items" : "Distil materials into the ledger"} wide>
  {#if !strong}
    <p class="body-sm">Pick a model in <a href="#/settings/models">Settings › Models</a> first.</p>
  {:else}
    <Segmented label="Strategy" value={strategy} onchange={(v) => (strategy = v)} options={[
      { value: "balanced", label: "Balanced" },
      { value: "thorough", label: "Thorough" },
    ]} />
    <p class="body-sm muted">
      {#if reaudit}
        The strong model re-reads every part against what's already in the ledger and adds what was missed, then merges duplicates.
      {:else if strategy === "balanced"}
        <strong>{cheap?.id}</strong> lists every learnable item, then <strong>{strong.id}</strong> audits each part for anything missed and merges duplicates.
      {:else}
        <strong>{strong.id}</strong> does every step. Slower and costlier; use it for dense or high-stakes material.
      {/if}
    </p>
    <div class="pf-total">
      {#if estimate}
        <span class="body-sm muted">{estimate.materials} {estimate.materials === 1 ? "file" : "files"} · {estimate.chunks} parts</span>
        <span class="mono">
          <span class="num">~{fmt.format(estimate.total).toLowerCase()} tokens</span>
          {#if estimate.cheap.input + estimate.cheap.output > 0}
            <span class="faint"> · {fmt.format(estimate.strong.input + estimate.strong.output).toLowerCase()} strong, {fmt.format(estimate.cheap.input + estimate.cheap.output).toLowerCase()} cheap</span>
          {/if}
        </span>
      {:else}
        <span class="body-sm faint">Estimating…</span>
      {/if}
    </div>
    <p class="caption faint">An upper-end estimate. Caps are checked before every call, and the job runs in the background: stop it any time and it resumes where it left off.</p>
  {/if}
  {#snippet footer()}
    <button type="button" class="btn btn--ghost" onclick={() => (open = false)}>Cancel</button>
    <button type="button" class="btn btn--accent" disabled={!strong || !estimate || !estimate.chunks || starting} onclick={start}>{reaudit ? "Re-audit" : "Distil it"}</button>
  {/snippet}
</Dialog>
