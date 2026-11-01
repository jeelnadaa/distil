<script lang="ts">
  import { api, type AnswerValue, type Chat, type PaperView } from "../../lib/api.ts";
  import { attempt, refreshLibrary } from "../../lib/state.svelte.ts";
  import Icon from "../Icon.svelte";
  import ExamSurface from "./ExamSurface.svelte";
  import QuestionCard from "./QuestionCard.svelte";
  import Report from "./Report.svelte";

  // A practice set or mock exam chat (Phase 6): the paper being written, its start page, the practice run
  // or the exam surface, marking, then the report. Writing and exam marking are jobs, so this polls while
  // they run.
  let { chat }: { chat: Chat } = $props();

  let view = $state<PaperView | null>(null);
  let failed = $state("");
  let busy = $state<string | null>(null);

  const load = async () => {
    try { view = await api.paper(chat.id); failed = ""; } catch (err) { failed = err instanceof Error ? err.message : String(err); }
  };
  $effect(() => { void chat.id; view = null; void load(); });

  const status = $derived(view?.paper.status);
  const working = $derived(status === "writing" || status === "grading");
  $effect(() => {
    if (!working) return;
    const timer = setInterval(load, 1500);
    return () => clearInterval(timer);
  });
  // A finished paper changes the library's order (it was just touched).
  $effect(() => { if (status === "done") void attempt(refreshLibrary); });

  const paper = $derived(view?.paper);
  const exam = $derived(paper?.kind === "exam");
  const marks = $derived(view?.questions.reduce((s, q) => s + q.marks, 0) ?? 0);
  // Practice shows every finished question and the first open one.
  const shown = $derived.by(() => {
    if (!view) return [];
    const open = view.questions.findIndex((q) => !q.result);
    return open === -1 ? view.questions : view.questions.slice(0, open + 1);
  });
  const allDone = $derived(!!view && view.questions.every((q) => q.result));
  const started = Date.now();

  async function act(id: string, fn: () => Promise<PaperView>) {
    busy = id;
    try { const next = await attempt(fn); if (next) view = next; } finally { busy = null; }
  }
  const check = (id: string, answer: AnswerValue, timeMs: number) => act(id, () => api.answerQuestion(chat.id, id, answer, timeMs));
  const finish = () => act("submit", () => api.submitPaper(chat.id, (paper?.elapsedMs ?? 0) + Date.now() - started));
</script>

{#if view?.paper.status === "taking" && exam}
  <ExamSurface {view} onview={(v) => (view = v)} />
{:else}
  <div class="scroll">
    <div class="page paper">
      {#if failed && !view}
        <div class="paper__state"><p class="body">{failed}</p><button type="button" class="btn btn--secondary btn--sm" onclick={load}>Try again</button></div>
      {:else if !view || !paper}
        <div class="paper__state" aria-busy="true"><span class="drop drop--pulse" aria-hidden="true"></span></div>
      {:else if status === "writing" || status === "grading"}
        <div class="paper__state" aria-live="polite">
          <span class="drop drop--pulse" aria-hidden="true"></span>
          <p class="eyebrow">{exam ? "Mock exam" : "Practice"} · {paper.config.label}</p>
          <h1 class="display-md">{status === "writing" ? (exam ? "Setting your exam…" : "Writing your questions…") : "Marking your answers…"}</h1>
          <p class="body muted">{status === "writing" ? "Each question is written with its worked solution and mark scheme first, from your material. This takes a minute or two." : "Each answer is marked against its mark scheme, handwriting included."}</p>
          {#if view.job?.status === "error"}
            <p class="body-sm danger">{view.job.error}</p>
            <button type="button" class="btn btn--secondary btn--sm" onclick={() => act("retry", () => api.retryPaper(chat.id))}><Icon name="refresh" size="sm" />Try again</button>
          {:else if status === "grading" && view.job && view.job.total}
            <p class="mono caption faint">{view.job.done} of {view.job.total} marked</p>
          {/if}
        </div>
      {:else if status === "failed"}
        <div class="paper__state">
          <p class="eyebrow">{exam ? "Mock exam" : "Practice"}</p>
          <h1 class="heading-lg">This paper couldn't be written</h1>
          <p class="body-sm muted">{paper.error}</p>
          <button type="button" class="btn btn--primary btn--sm" disabled={busy === "retry"} onclick={() => act("retry", () => api.retryPaper(chat.id))}><Icon name="refresh" size="sm" />Try again</button>
        </div>
      {:else if status === "ready"}
        <header class="paper__start">
          <p class="eyebrow">{exam ? "Mock exam" : "Practice set"} · {paper.config.label}</p>
          <h1 class="display-lg">{paper.title}</h1>
          {#if paper.instructions}<p class="body-lg muted">{paper.instructions}</p>{/if}
          <dl class="paper__facts">
            <div><dt class="eyebrow">Questions</dt><dd class="num">{view.questions.length}</dd></div>
            <div><dt class="eyebrow">Marks</dt><dd class="num">{marks}</dd></div>
            {#if exam}<div><dt class="eyebrow">Time</dt><dd class="num">{paper.config.minutes} min</dd></div>{/if}
          </dl>
          <p class="body-sm muted">{exam
            ? "One attempt, no hints. The timer starts when you begin and pauses if you leave. Type your answers, or add a photo of handwritten working."
            : "Your first answer to each question counts. After that you can take a hint and try again, or see the worked solution."}</p>
          <div><button type="button" class="btn btn--accent btn--lg" disabled={busy === "start"} onclick={() => act("start", () => api.startPaper(chat.id))}><Icon name="play" size="sm" />{exam ? "Start the exam" : "Start practising"}</button></div>
        </header>
      {:else if status === "taking"}
        <header class="paper__head">
          <p class="eyebrow">Practice · {paper.config.label}</p>
          <h1 class="heading-lg">{paper.title}</h1>
          <p class="caption faint mono">{view.questions.filter((q) => q.result).length} of {view.questions.length} done</p>
        </header>
        <div class="paper__questions">
          {#each shown as q (q.id)}
            <QuestionCard question={q} number={q.ord + 1} busy={busy === q.id}
              oncheck={(a, t) => check(q.id, a, t)} onhint={() => act(q.id, () => api.hint(chat.id, q.id))} onreveal={() => act(q.id, () => api.reveal(chat.id, q.id))} />
          {/each}
        </div>
        <footer class="paper__foot">
          {#if allDone}
            <button type="button" class="btn btn--accent btn--lg" disabled={busy === "submit"} onclick={finish}>{busy === "submit" ? "Writing your report…" : "See your results"}</button>
          {:else}
            <button type="button" class="btn btn--ghost btn--sm" disabled={!!busy} onclick={finish} data-tip="Questions you haven't answered are left out of the results">Finish early</button>
          {/if}
        </footer>
      {:else if status === "done" && paper.report}
        <Report {view} />
      {/if}
    </div>
  </div>
{/if}

<style>
  .paper { max-width: 760px; padding-bottom: var(--s-9); }
  .paper__state { display: grid; justify-items: center; text-align: center; gap: var(--s-3); padding: var(--s-9) var(--s-4); }
  .paper__state p, .paper__state h1 { margin: 0; }
  .paper__state .body { max-width: 52ch; }
  .danger { color: var(--danger); }
  .paper__start { display: grid; gap: var(--s-4); padding-top: var(--s-7); }
  .paper__start > * { margin: 0; }
  .paper__facts { display: flex; gap: var(--s-7); margin: var(--s-2) 0; }
  .paper__facts div { display: grid; gap: 2px; }
  .paper__facts dd { margin: 0; font-size: var(--t-heading-lg, 24px); font-family: var(--font-mono); }
  .paper__head { display: grid; gap: var(--s-1); padding: var(--s-6) 0 var(--s-5); }
  .paper__head > * { margin: 0; }
  .paper__questions { display: grid; gap: var(--s-4); }
  .paper__foot { display: flex; justify-content: flex-end; padding-top: var(--s-5); }
</style>
