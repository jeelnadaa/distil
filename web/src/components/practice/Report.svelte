<script lang="ts">
  import type { PaperView } from "../../lib/api.ts";
  import { newPaper } from "../../lib/state.svelte.ts";
  import Icon from "../Icon.svelte";
  import QuestionCard from "./QuestionCard.svelte";

  // The report (F-809, DESIGN.md S6): the score in display type, a bar per unit, each question's time,
  // marks and what didn't come to mind, then every question with its marking. "Fix these" practises the
  // weak items.
  let { view }: { view: PaperView } = $props();

  const paper = $derived(view.paper);
  const report = $derived(paper.report!);
  const exam = $derived(paper.kind === "exam");
  const pct = (score: number, marks: number) => (marks ? Math.round((score / marks) * 100) : 0);
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const time = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const byId = $derived(new Map(view.questions.map((q) => [q.id, q])));
  const counted = $derived(report.questions.map((r) => byId.get(r.id)!).filter(Boolean));
  let starting = $state(false);

  async function fix() {
    starting = true;
    try { await newPaper(paper.folderId, { kind: "practice", scope: { kind: "items", items: report.weak } }); } finally { starting = false; }
  }
</script>

<div class="report">
  <p class="eyebrow">{exam ? "Mock exam" : "Practice"} · report</p>
  <h1 class="heading-lg">{paper.title}</h1>
  <div class="report__score">
    <span class="display-xl num-display">{fmt(report.score)}</span><span class="display-md faint">/ {report.marks}</span>
    <span class="report__pct mono muted">{pct(report.score, report.marks)}%</span>
  </div>
  <p class="body-lg muted">{report.summary}{report.cards ? ` ${report.cards} ${report.cards === 1 ? "card was" : "cards were"} added for what didn't come to mind.` : ""}</p>

  {#if report.sections.length}
    <div class="report__units">
      {#each report.sections as s (s.name)}
        <div class="coverage__row"><span class="eyebrow" title={s.name}>{s.name}</span><div class="coverage__track"><div class="coverage__fill" style:--v="{pct(s.score, s.marks)}%"></div></div><span class="num">{pct(s.score, s.marks)}%</span></div>
      {/each}
    </div>
  {/if}

  <table class="table">
    <thead><tr><th>Question</th><th>Time</th><th class="num">Score</th><th>Didn't come to mind</th></tr></thead>
    <tbody>
      {#each report.questions as r (r.id)}
        <tr>
          <td><a href="#q-{r.id}">{r.ord + 1}</a></td>
          <td class="mono">{time(r.timeMs)}</td>
          <td class="num">{fmt(r.score)} / {r.marks}</td>
          <td class:faint={!r.missed.length || r.score >= r.marks}>{r.score >= r.marks || !r.missed.length ? "—" : r.missed.map((id) => view.items[id] ?? "an item since removed").join(", ")}</td>
        </tr>
      {/each}
    </tbody>
  </table>

  <div class="report__actions">
    {#if report.weak.length}
      <button type="button" class="btn btn--accent btn--lg" disabled={starting} onclick={fix}><Icon name="target" size="sm" />Fix these: {report.weak.length} weak {report.weak.length === 1 ? "item" : "items"}</button>
    {/if}
    <a class="btn btn--ghost btn--lg" href="#/folder/{paper.folderId}/practice">Back to practice</a>
  </div>

  <section class="report__review" aria-label="Your answers">
    <h2 class="heading-md">Your answers</h2>
    {#each counted as q (q.id)}
      <div id="q-{q.id}"><QuestionCard question={q} number={q.ord + 1} /></div>
    {/each}
  </section>
</div>

<style>
  .report { display: grid; gap: var(--s-5); }
  .report h1 { margin: 0; }
  .report__score { display: flex; align-items: baseline; gap: var(--s-3); }
  .report__pct { margin-left: var(--s-2); }
  .report__units { display: grid; gap: var(--s-3); max-width: 520px; }
  .report__units :global(.coverage__row) { grid-template-columns: minmax(76px, 160px) 1fr 44px; }
  .report__units .eyebrow { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .report__actions { display: flex; flex-wrap: wrap; gap: var(--s-3); }
  .report__review { display: grid; gap: var(--s-4); margin-top: var(--s-5); }
  .report__review h2 { margin: 0; }
  td a { color: inherit; font-family: var(--font-mono); }
  td.num, td.mono { white-space: nowrap; }
</style>
