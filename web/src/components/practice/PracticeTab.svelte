<script lang="ts">
  import { api, type PaperSummary, type PlanView } from "../../lib/api.ts";
  import { attempt } from "../../lib/state.svelte.ts";
  import Icon from "../Icon.svelte";
  import NewPaperDialog from "./NewPaperDialog.svelte";

  // A folder's practice sets and mock exams (F-801, F-803): what was taken and how it went, and the two
  // ways to start a new one.
  let { folderId, plan, items }: { folderId: string; plan: PlanView | null; items: number } = $props();

  let papers = $state<PaperSummary[]>([]);
  let weak = $state(0);
  let loaded = $state(false);
  let dialog = $state<"practice" | "exam" | null>(null);

  const load = async () => {
    const r = await attempt(() => api.papers(folderId));
    if (r) { papers = r.papers; weak = r.weak; }
    loaded = true;
  };
  $effect(() => { void folderId; void load(); });
  const busy = $derived(papers.some((p) => p.status === "writing" || p.status === "grading"));
  $effect(() => {
    if (!busy) return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  });

  const STATUS: Record<PaperSummary["status"], string> = {
    writing: "Being written…", ready: "Ready to start", taking: "In progress", grading: "Being marked…", done: "", failed: "Couldn't be written",
  };
  const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
</script>

<section class="practice">
  <div class="practice__start">
    <button type="button" class="panel practice__new" disabled={!items} onclick={() => (dialog = "practice")}>
      <Icon name="target" />
      <span class="heading-sm">Practice set</span>
      <span class="body-sm muted">Questions rising in difficulty, marked as you go. Hints after your first try.</span>
    </button>
    <button type="button" class="panel practice__new" disabled={!items} onclick={() => (dialog = "exam")}>
      <Icon name="clock" />
      <span class="heading-sm">Mock exam</span>
      <span class="body-sm muted">Timed, one attempt, no hints, marked against a mark scheme. Handwriting welcome.</span>
    </button>
  </div>
  {#if !items}<p class="body-sm muted">Distil some material first: questions are written from the ledger.</p>{/if}

  {#if loaded && papers.length}
    <table class="table">
      <thead><tr><th>Paper</th><th>Date</th><th class="num">Score</th></tr></thead>
      <tbody>
        {#each papers as p (p.chatId)}
          <tr>
            <td>
              <a class="practice__link" href="#/chat/{p.chatId}"><Icon name={p.kind === "exam" ? "clock" : "target"} size="sm" />{p.title}</a>
              {#if STATUS[p.status]}<span class="caption faint">· {STATUS[p.status]}</span>{/if}
            </td>
            <td class="mono faint">{day.format(p.createdAt)}</td>
            <td class="num">{p.score !== null && p.marks ? `${fmt(p.score)} / ${p.marks}` : "—"}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else if loaded}
    <p class="body-sm muted">No practice yet. Start with a short set after a lesson, or a mock exam when the exam is close.</p>
  {/if}
</section>

{#if dialog}
  <NewPaperDialog {folderId} kind={dialog} {plan} {weak} onclose={() => (dialog = null)} />
{/if}

<style>
  .practice { display: grid; gap: var(--s-5); margin-top: var(--s-5); }
  .practice__start { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--s-4); }
  .practice__new { display: grid; gap: var(--s-2); justify-items: start; text-align: left; padding: var(--s-5); cursor: pointer; transition: border-color 120ms var(--ease-out); }
  .practice__new:not(:disabled):hover { border-color: var(--accent); }
  .practice__new:disabled { opacity: .5; cursor: default; }
  .practice__new :global(.icon) { color: var(--accent); }
  .practice__link { display: inline-flex; align-items: center; gap: var(--s-2); color: var(--text); font-weight: 500; text-decoration: none; }
  .practice__link:hover { color: var(--accent); }
  .practice__link :global(.icon) { color: var(--text-faint); }
</style>
