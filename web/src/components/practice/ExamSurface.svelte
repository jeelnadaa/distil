<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { api, type AnswerValue, type PaperView } from "../../lib/api.ts";
  import { renderMarkdown } from "../../lib/markdown.ts";
  import { attempt, go } from "../../lib/state.svelte.ts";
  import Dialog from "../Dialog.svelte";
  import Icon from "../Icon.svelte";
  import AnswerInput from "./AnswerInput.svelte";

  // The exam surface (F-804, DESIGN.md F6): full screen, a question index by section, one question at a
  // time, a mono timer that submits at zero, and no hints. Answers and time are saved as the learner goes;
  // leaving pauses the clock.
  let { view, onview }: { view: PaperView; onview: (v: PaperView) => void } = $props();

  const paper = untrack(() => view.paper);
  const questions = untrack(() => view.questions);
  const chatId = paper.chatId;
  const limitMs = (paper.config.minutes ?? 0) * 60_000;

  let answers = $state<AnswerValue[]>(questions.map((q) => q.answer ?? { value: null, photo: null }));
  const spent = questions.map((q) => q.timeMs);
  let flagged = $state<boolean[]>(questions.map(() => false));
  let at = $state(Math.max(0, questions.findIndex((q) => !q.answer)));
  let elapsed = $state(paper.elapsedMs);
  let leaving = $state(false);
  let confirming = $state(false);
  let submitting = $state(false);

  // The clock runs from the saved elapsed time; the current question collects its own time too.
  let tickFrom = Date.now();
  let questionFrom = Date.now();
  const tick = () => {
    const t = Date.now();
    elapsed += t - tickFrom;
    tickFrom = t;
    if (limitMs && elapsed >= limitMs && !submitting) void submit();
  };
  const timer = setInterval(tick, 500);

  const remaining = $derived(limitMs ? Math.max(0, limitMs - elapsed) : elapsed);
  const clock = $derived.by(() => {
    const s = Math.floor(remaining / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}`;
  });
  const low = $derived(limitMs > 0 && remaining < Math.min(5 * 60_000, limitMs * 0.1));
  const answered = (a: AnswerValue) => (a.value !== null && a.value !== "") || !!a.photo;
  const done = $derived(answers.filter(answered).length);
  const sections = $derived.by(() => {
    const out: { name: string; marks: number; indexes: number[] }[] = [];
    questions.forEach((q, i) => {
      const last = out.at(-1);
      if (last && last.name === q.section) { last.indexes.push(i); last.marks += q.marks; }
      else out.push({ name: q.section, marks: q.marks, indexes: [i] });
    });
    return out;
  });
  const q = $derived(questions[at]!);

  // Saves the current question's answer and time; called on change (debounced), on switching and leaving.
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function save(index = at) {
    clearTimeout(saveTimer);
    const t = Date.now();
    if (index === at) { spent[index]! += t - questionFrom; questionFrom = t; }
    tick();
    return attempt(() => api.saveProgress(chatId, { questionId: questions[index]!.id, answer: $state.snapshot(answers[index]!), timeMs: spent[index]!, elapsedMs: Math.round(elapsed) }));
  }
  const changed = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => save(), 800); };
  const autosave = setInterval(() => void save(), 15_000);

  function goTo(i: number) {
    if (i === at || i < 0 || i >= questions.length) return;
    void save(at);
    at = i;
    questionFrom = Date.now();
  }

  async function submit() {
    if (submitting) return;
    submitting = true;
    confirming = false;
    await save();
    const next = await attempt(() => api.submitPaper(chatId, Math.round(elapsed)));
    if (next) onview(next);
    else submitting = false;
  }

  async function leave() {
    await save();
    go(`#/folder/${paper.folderId}/practice`);
  }

  onDestroy(() => { clearInterval(timer); clearInterval(autosave); clearTimeout(saveTimer); if (!submitting) void save(); });

  function onkeydown(e: KeyboardEvent) {
    if ((e.target as HTMLElement).matches("input, textarea")) return;
    if (e.key === "ArrowRight" || e.key === "j") { e.preventDefault(); goTo(at + 1); }
    if (e.key === "ArrowLeft" || e.key === "k") { e.preventDefault(); goTo(at - 1); }
  }
</script>

<svelte:window {onkeydown} />

<div class="exam-surface" role="region" aria-label="Mock exam">
  <header class="exam-top">
    <button type="button" class="btn btn--ghost btn--sm" onclick={() => (leaving = true)}><Icon name="x" size="sm" />Exit</button>
    <div class="exam-top__title"><span class="eyebrow">{paper.title} · {questions.length} questions · exam mode</span></div>
    <div class="exam-top__right">
      <span class="exam-timer mono" class:is-low={low} role="timer" aria-live="off" data-tip={limitMs ? "Time left" : "Time taken"}>{clock}</span>
      <button type="button" class="btn btn--primary btn--sm" disabled={submitting} onclick={() => (confirming = true)}>{submitting ? "Submitting…" : "Submit paper"}</button>
    </div>
  </header>
  <div class="exam-progress" aria-hidden="true"><span style:--p={done / questions.length}></span></div>

  <main class="exam">
    <nav class="exam-index" aria-label="Questions">
      {#each sections as s, si (si)}
        {#if s.name || sections.length > 1}<span class="eyebrow">{s.name || "Questions"} · {s.marks} marks</span>{/if}
        {#each s.indexes as i (i)}
          <button type="button" class:is-done={answered(answers[i]!)} class:is-flag={flagged[i]} aria-current={i === at ? "true" : undefined}
            aria-label="Question {i + 1}{answered(answers[i]!) ? ', answered' : ''}{flagged[i] ? ', flagged' : ''}" onclick={() => goTo(i)}>{i + 1}</button>
        {/each}
      {/each}
    </nav>

    <article class="exam-paper">
      {#if at === 0 && paper.instructions}<p class="exam-instructions body-sm muted">{paper.instructions}</p>{/if}
      {#key at}
        <section class="exam-q" aria-label="Question {at + 1}">
          <header>
            <span class="eyebrow">Question {at + 1} · {q.marks} {q.marks === 1 ? "mark" : "marks"}</span>
            <button type="button" class="btn btn--ghost btn--sm" aria-pressed={flagged[at]} onclick={() => (flagged[at] = !flagged[at])}><Icon name="target" size="sm" />{flagged[at] ? "Flagged" : "Flag"}</button>
          </header>
          <div class="exam-q__prompt">{@html renderMarkdown(q.prompt)}</div>
          <div class="answer">
            <AnswerInput question={q} bind:answer={answers[at]!} disabled={submitting} onchange={changed} />
          </div>
          <footer class="exam-q__foot">
            <button type="button" class="btn btn--ghost btn--sm" disabled={at === 0} onclick={() => goTo(at - 1)}>Previous</button>
            <span class="caption faint">Saved as you go · hints are off in exam mode</span>
            {#if at < questions.length - 1}
              <button type="button" class="btn btn--secondary btn--sm" onclick={() => goTo(at + 1)}>Next<Icon name="arrow-right" size="sm" /></button>
            {:else}
              <button type="button" class="btn btn--primary btn--sm" disabled={submitting} onclick={() => (confirming = true)}>Submit paper</button>
            {/if}
          </footer>
        </section>
      {/key}
    </article>
  </main>
</div>

<Dialog bind:open={leaving} eyebrow="Exam in progress" title="Leave the exam?">
  <p class="body-sm muted">Your answers are saved and the timer pauses. Come back to it from the sidebar or the folder's Practice tab.</p>
  {#snippet footer()}
    <button type="button" class="btn btn--ghost" onclick={() => (leaving = false)}>Keep going</button>
    <button type="button" class="btn btn--primary" onclick={leave}>Pause and leave</button>
  {/snippet}
</Dialog>

<Dialog bind:open={confirming} eyebrow="Submit paper" title={done < questions.length ? `${questions.length - done} unanswered` : "Hand it in?"}>
  <p class="body-sm muted">{done < questions.length ? "Unanswered questions score nothing. " : ""}Once submitted, the paper is marked and you can't change your answers.</p>
  {#snippet footer()}
    <button type="button" class="btn btn--ghost" onclick={() => (confirming = false)}>Keep going</button>
    <button type="button" class="btn btn--primary" onclick={submit}>Submit</button>
  {/snippet}
</Dialog>

<style>
  .exam-surface { position: fixed; inset: 0; z-index: 30; overflow: auto; background: var(--bg); animation: fade-in var(--dur-slow, 320ms) var(--ease-out, ease-out); }
  .exam-top { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: var(--s-4); height: 60px; padding: 0 var(--s-5); background: var(--bg); }
  .exam-top__title { flex: 1; min-width: 0; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .exam-top__right { display: flex; align-items: center; gap: var(--s-4); }
  .exam-timer { font-size: 22px; letter-spacing: .02em; font-variant-numeric: tabular-nums; }
  .exam-timer.is-low { color: var(--warning); }
  .exam-progress { position: sticky; top: 60px; z-index: 2; height: 2px; background: var(--border); }
  .exam-progress span { display: block; height: 100%; width: 100%; transform-origin: left; transform: scaleX(var(--p)); background: var(--text); transition: transform var(--dur-base, 200ms) var(--ease-out, ease-out); }
  .exam { display: grid; grid-template-columns: 184px minmax(0, 760px); justify-content: center; gap: var(--s-8); padding: var(--s-8) var(--s-5) var(--s-9); }
  .exam-index { position: sticky; top: 100px; align-self: start; display: grid; grid-template-columns: repeat(4, 36px); gap: var(--s-2); }
  .exam-index .eyebrow { grid-column: 1 / -1; margin-top: var(--s-3); }
  .exam-index .eyebrow:first-child { margin-top: 0; }
  .exam-index button { display: grid; place-items: center; height: 36px; border-radius: var(--r-sm); border: 1px solid var(--border); font: 500 13px var(--font-mono); color: var(--text-muted); }
  .exam-index button:hover { border-color: var(--text-muted); }
  .exam-index button.is-done { background: var(--surface-sunken); border-color: transparent; color: var(--text); }
  .exam-index button[aria-current="true"] { border-color: var(--text); color: var(--text); box-shadow: inset 0 0 0 1px var(--text); }
  .exam-index button.is-flag { border-color: var(--warning); color: var(--warning); }
  .exam-paper { display: grid; gap: var(--s-5); min-width: 0; }
  .exam-instructions { margin: 0; padding-bottom: var(--s-4); border-bottom: 1px solid var(--border); }
  .exam-q { display: grid; gap: var(--s-5); animation: fade-in var(--dur-base, 200ms) var(--ease-out, ease-out); }
  .exam-q header { display: flex; justify-content: space-between; align-items: center; }
  .exam-q__prompt { font-size: var(--t-body-lg); line-height: 30px; }
  .exam-q__prompt :global(p) { margin: 0 0 var(--s-3); }
  .exam-q__prompt :global(p:last-child) { margin-bottom: 0; }
  .answer { display: grid; gap: var(--s-3); }
  .exam-q__foot { display: flex; align-items: center; gap: var(--s-3); justify-content: space-between; padding-top: var(--s-4); border-top: 1px solid var(--border); }
  @media (max-width: 760px) {
    .exam { grid-template-columns: minmax(0, 1fr); gap: var(--s-5); padding: var(--s-5) var(--s-4) var(--s-8); }
    .exam-index { position: static; grid-template-columns: repeat(auto-fill, 36px); }
    .exam-top__title { display: none; }
    .exam-q__foot .caption { display: none; }
  }
  @media (prefers-reduced-motion: reduce) { .exam-surface, .exam-q { animation: none; } }
</style>
