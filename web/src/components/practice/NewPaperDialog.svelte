<script lang="ts">
  import { untrack } from "svelte";
  import type { PlanView, Scope } from "../../lib/api.ts";
  import { newPaper } from "../../lib/state.svelte.ts";
  import Dialog from "../Dialog.svelte";
  import Segmented from "../Segmented.svelte";
  import Select, { type SelectOption } from "../Select.svelte";

  // Configures a practice set or mock exam (F-801, F-803): what it covers, and how long it is.
  let { folderId, kind: initial, plan, weak, onclose }: {
    folderId: string; kind: "practice" | "exam"; plan: PlanView | null; weak: number; onclose: () => void;
  } = $props();

  let open = $state(true);
  let kind = $state(untrack(() => initial));
  let scope = $state("all");
  let count = $state("6");
  let minutes = $state("45");
  let starting = $state(false);
  $effect(() => { if (!open) onclose(); });

  const options = $derived.by((): SelectOption[] => {
    const out: SelectOption[] = [{ value: "all", label: "Everything in this folder" }];
    if (weak) out.push({ value: "weak", label: `Weak items (${weak})` });
    const p = plan?.plan;
    for (const u of p?.units ?? []) {
      out.push({ value: `unit:${u.id}`, label: u.title, group: "Units" });
    }
    for (const l of p?.lessons ?? []) {
      if (l.items.length) out.push({ value: `lesson:${l.id}`, label: l.title, group: "Lessons" });
    }
    return out;
  });
  const toScope = (v: string): Scope => {
    const [k, id] = v.split(":");
    return k === "unit" || k === "lesson" ? { kind: k, id } : { kind: k as "all" | "weak" };
  };

  async function start() {
    starting = true;
    try {
      await newPaper(folderId, { kind, scope: toScope(scope), ...(kind === "exam" ? { minutes: Number(minutes) } : { count: Number(count) }) });
      open = false;
    } finally { starting = false; }
  }
</script>

<Dialog bind:open eyebrow="Practice" title={kind === "exam" ? "New mock exam" : "New practice set"}>
  <div class="form">
    <Segmented label="Kind" value={kind} onchange={(v) => (kind = v)} options={[{ value: "practice", label: "Practice set" }, { value: "exam", label: "Mock exam" }]} />
    <div class="field">
      <span class="field__label">Covers</span>
      <Select label="What it covers" value={scope} {options} onchange={(v) => (scope = v)} />
      {#if !plan?.plan}<span class="field__hint">Build a plan to practise one unit or lesson at a time.</span>{/if}
    </div>
    {#if kind === "exam"}
      <div class="field">
        <span class="field__label">Time</span>
        <Segmented label="Time limit" value={minutes} onchange={(v) => (minutes = v)} options={["15", "30", "45", "60", "90", "120"].map((m) => ({ value: m, label: `${m} min` }))} />
        <span class="field__hint">About one mark a minute, sectioned by unit, in the style of any past papers in the folder.</span>
      </div>
    {:else}
      <div class="field">
        <span class="field__label">Questions</span>
        <Segmented label="Number of questions" value={count} onchange={(v) => (count = v)} options={["4", "6", "8", "10"].map((n) => ({ value: n, label: n }))} />
        <span class="field__hint">From a worked example up to an open problem.</span>
      </div>
    {/if}
  </div>
  {#snippet footer()}
    <button type="button" class="btn btn--ghost" onclick={() => (open = false)}>Cancel</button>
    <button type="button" class="btn btn--primary" disabled={starting} onclick={start}>{starting ? "Starting…" : kind === "exam" ? "Set the exam" : "Write the set"}</button>
  {/snippet}
</Dialog>

<style>
  .form { display: grid; gap: var(--s-4); }
  .form > :global(.segmented) { justify-self: start; }
  .field :global(.segmented) { justify-self: start; }
</style>
