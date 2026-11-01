<script lang="ts">
  import { untrack } from "svelte";
  import type { AnswerValue, QuestionView } from "../../lib/api.ts";
  import { renderInline, renderMarkdown } from "../../lib/markdown.ts";
  import Icon from "../Icon.svelte";
  import AnswerInput from "./AnswerInput.svelte";

  // One practice question (F-804) or one question in a finished paper's review (F-806). While open, the
  // first answer is marked on its own; after that the learner can take up to two hints, try again, or see
  // the solution. Once finished it shows the marks, what met the rubric, and the worked solution.
  let { question: q, number, busy = false, oncheck, onhint, onreveal }: {
    question: QuestionView; number: number; busy?: boolean;
    oncheck?: (answer: AnswerValue, timeMs: number) => void; onhint?: () => void; onreveal?: () => void;
  } = $props();

  let answer = $state<AnswerValue>(untrack(() => q.answer ?? { value: null, photo: null }));
  let since = Date.now();
  const last = $derived(q.attempts.at(-1));
  const open = $derived(!q.result);
  const ready = $derived(answer.value !== null && answer.value !== "" || !!answer.photo);

  const LEVEL: Record<string, string> = { worked: "Worked example", completion: "Completion", direct: "Direct", composition: "Composition", open: "Open problem" };
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const tone = (score: number, marks: number) => (score >= marks ? "success" : score > 0 ? "warning" : "danger");

  function check() {
    if (!ready || busy) return;
    oncheck?.(answer, Date.now() - since);
    since = Date.now();
  }

  const yours = $derived.by(() => {
    const v = q.answer?.value;
    if (v === null || v === undefined || v === "") return null;
    if (q.type === "mcq") return q.options?.[Number(v)] ?? null;
    if (q.type === "order" && Array.isArray(v)) return v.map((p) => q.steps?.[p]).join(" → ");
    return String(v);
  });
</script>

<section class="q" class:is-done={!open} aria-label="Question {number}">
  <header class="q__head">
    <span class="eyebrow">Question {number} · {q.marks} {q.marks === 1 ? "mark" : "marks"}</span>
    <span class="chip">{LEVEL[q.level] ?? q.level}</span>
    <span class="spacer"></span>
    {#if q.result}<span class="chip chip--{tone(q.result.score, q.result.marks)} num">{fmt(q.result.score)} / {q.result.marks}</span>{/if}
  </header>
  <div class="q__prompt prose">{@html renderMarkdown(q.prompt)}</div>

  {#if open}
    <AnswerInput question={q} bind:answer disabled={busy} />
    {#if last}
      <div class="q__try" aria-live="polite">
        <span class="chip chip--{tone(last.grade.score, last.grade.marks)} num">{fmt(last.grade.score)} / {last.grade.marks}</span>
        {#if last.grade.feedback}<p class="body-sm">{@html renderInline(last.grade.feedback)}</p>{:else}<p class="body-sm">Not quite. {q.attempts.length === 1 ? "That first try is what counts; you can still work it out." : ""}</p>{/if}
      </div>
    {/if}
    {#each q.hintsShown as hint, i (i)}
      <p class="q__hint body-sm"><span class="eyebrow">Hint {i + 1}</span>{@html renderInline(hint)}</p>
    {/each}
    <footer class="q__foot">
      {#if last}
        <button type="button" class="btn btn--ghost btn--sm" disabled={busy} onclick={onreveal}>Show solution</button>
        {#if q.hintsLeft > 0}<button type="button" class="btn btn--ghost btn--sm" disabled={busy} onclick={onhint}><Icon name="target" size="sm" />Hint · {q.hintsLeft} left</button>{/if}
      {/if}
      <span class="spacer"></span>
      <button type="button" class="btn btn--primary btn--sm" disabled={busy || !ready} onclick={check}>{busy ? "Marking…" : last ? "Try again" : "Check answer"}</button>
    </footer>
  {:else}
    <div class="q__review">
      {#if yours !== null || q.answer?.photo}
        <div class="q__yours">
          <span class="eyebrow">Your answer</span>
          {#if yours !== null}<p class="body-sm pre">{yours}</p>{/if}
          {#if q.answer?.photo}<img class="q__photo" src={q.answer.photo} alt="Your handwritten working" />{/if}
        </div>
      {:else}
        <p class="body-sm muted">Not answered.</p>
      {/if}
      {#if q.result?.feedback}<p class="body-sm">{@html renderInline(q.result.feedback)}</p>{/if}
      {#if q.correct}<p class="body-sm"><span class="muted">Answer:</span> {@html renderInline(q.correct)}</p>{/if}
      {#if q.rubric}
        <ul class="rubric" aria-label="Mark scheme">
          {#each q.rubric as r, i (i)}
            {@const met = q.result?.met[i]}
            <li class:is-met={met}><Icon name={met ? "check" : "x"} size="sm" /><span>{@html renderInline(r.point)}</span><span class="num faint">[{r.marks}]</span></li>
          {/each}
        </ul>
      {/if}
      {#if q.solution}
        <details class="q__solution">
          <summary>Worked solution</summary>
          <div class="prose">{@html renderMarkdown(q.solution)}</div>
        </details>
      {/if}
    </div>
  {/if}
</section>

<style>
  .q { display: grid; gap: var(--s-4); padding: var(--s-5); border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface); }
  .q.is-done { background: var(--surface); }
  .q__head { display: flex; align-items: center; gap: var(--s-2); flex-wrap: wrap; }
  .spacer { flex: 1; }
  .q__prompt { font-size: var(--t-body); }
  .q__prompt :global(p:last-child) { margin-bottom: 0; }
  .q__try { display: flex; align-items: baseline; gap: var(--s-3); padding: var(--s-3); border-radius: var(--r-sm); background: var(--surface-sunken); }
  .q__try p { margin: 0; flex: 1; }
  .q__hint { display: grid; gap: 2px; margin: 0; padding: var(--s-2) var(--s-3); border-left: 2px solid var(--accent); background: var(--accent-wash); border-radius: 0 var(--r-sm) var(--r-sm) 0; }
  .q__foot { display: flex; align-items: center; gap: var(--s-2); flex-wrap: wrap; }
  .q__review { display: grid; gap: var(--s-3); }
  .q__review p { margin: 0; }
  .q__yours { display: grid; gap: var(--s-1); }
  .pre { white-space: pre-wrap; }
  .q__photo { max-width: min(360px, 100%); max-height: 260px; object-fit: contain; border: 1px solid var(--border); border-radius: var(--r-sm); }
  .rubric { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-1); font-size: var(--t-body-sm); }
  .rubric li { display: grid; grid-template-columns: auto 1fr auto; gap: var(--s-2); align-items: baseline; color: var(--text-muted); }
  .rubric li :global(.icon) { color: var(--danger); align-self: center; }
  .rubric li.is-met { color: var(--text); }
  .rubric li.is-met :global(.icon) { color: var(--success); }
  .q__solution summary { cursor: pointer; font-weight: 600; font-size: var(--t-body-sm); color: var(--accent); }
  .q__solution .prose { margin-top: var(--s-2); padding: var(--s-3) var(--s-4); background: var(--surface-sunken); border-radius: var(--r-sm); }
</style>
