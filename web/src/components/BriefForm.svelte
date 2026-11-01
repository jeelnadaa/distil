<script lang="ts">
  import { api, type Brief, type Compiled, type PlanKind } from "../lib/api.ts";
  import { attempt } from "../lib/state.svelte.ts";
  import Icon from "./Icon.svelte";
  import Segmented from "./Segmented.svelte";

  // The study brief (F-101…F-104): every field shows a default; "Fill in for me" asks the cheap model to infer
  // them from a sentence, with up to three questions it couldn't answer, shown as chips.
  // unanswered: questions still open, so the caller can offer "Just go".
  let { folderId, brief = $bindable(), kind = $bindable(), unanswered = $bindable(0) }: {
    folderId: string; brief: Brief; kind: PlanKind; unanswered?: number;
  } = $props();

  const DEPTHS = [
    { value: "survey", label: "Survey", tip: "The main ideas, quickly" },
    { value: "standard", label: "Standard", tip: "A solid understanding" },
    { value: "exam_ready", label: "Exam-ready", tip: "Everything, with practice on what is examined" },
    { value: "mastery", label: "Mastery", tip: "Deep understanding and edge cases" },
  ] as const;
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  let request = $state("");
  let compiling = $state(false);
  let questions = $state<Compiled["questions"]>([]);
  let answered = $state<Record<string, number>>({});

  async function compile() {
    compiling = true;
    const result = await attempt(() => api.compileBrief(folderId, request));
    compiling = false;
    if (!result) return;
    brief = result.brief;
    kind = result.kind;
    questions = result.questions;
    answered = {};
  }
  function answer(q: Compiled["questions"][number], i: number) {
    answered[q.field] = i;
    brief = { ...brief, [q.field]: q.options[i]!.value };
  }
  const toggleDay = (d: number) => (brief.daysOff = brief.daysOff.includes(d) ? brief.daysOff.filter((x) => x !== d) : [...brief.daysOff, d].sort());

  $effect(() => { unanswered = questions.filter((q) => answered[q.field] === undefined).length; });
</script>

<div class="brief-form">
  <form class="brief-ask" onsubmit={(e) => { e.preventDefault(); compile(); }}>
    <input class="input" bind:value={request} maxlength="2000" aria-label="What you need"
      placeholder="Describe what you need, e.g. Pass the midterm on 20 November, 2 hours a day" />
    <button type="submit" class="btn btn--secondary" disabled={compiling}><Icon name="wand" size="sm" />{compiling ? "Reading…" : "Fill in for me"}</button>
  </form>

  {#each questions as q (q.field)}
    <div class="qchips">
      <span class="body-sm">{q.question}</span>
      {#each q.options as option, i (i)}
        <button type="button" class="btn btn--secondary btn--sm" aria-pressed={answered[q.field] === i} onclick={() => answer(q, i)}>{option.label}</button>
      {/each}
    </div>
  {/each}

  <label class="field"><span class="field__label">Goal</span><input class="input" bind:value={brief.goal} maxlength="300" required /></label>
  <div class="brief-form__row">
    <label class="field"><span class="field__label">Exam or deadline <span class="field__hint">· optional</span></span>
      <input class="input" type="date" value={brief.deadline ?? ""} onchange={(e) => (brief.deadline = e.currentTarget.value || null)} /></label>
    <label class="field"><span class="field__label">Hours per day <span class="field__hint">· optional</span></span>
      <input class="input" type="number" min="0.5" max="24" step="0.5" value={brief.hoursPerDay ?? ""}
        onchange={(e) => (brief.hoursPerDay = Number(e.currentTarget.value) > 0 ? Math.min(24, Number(e.currentTarget.value)) : null)} /></label>
  </div>
  <div class="field"><span class="field__label">Depth</span>
    <Segmented label="Depth" value={brief.depth} onchange={(v) => (brief.depth = v)} options={[...DEPTHS]} />
  </div>
  <div class="field"><span class="field__label">Days off</span>
    <div class="qchips">
      {#each DAYS as day, d (d)}<button type="button" class="btn btn--secondary btn--sm" aria-pressed={brief.daysOff.includes(d)} onclick={() => toggleDay(d)}>{day}</button>{/each}
    </div>
  </div>
  <label class="field"><span class="field__label">Scope <span class="field__hint">· what's in, what's out</span></span><input class="input" bind:value={brief.scope} maxlength="600" /></label>
  <label class="field"><span class="field__label">What you already know</span><textarea class="textarea" rows="2" bind:value={brief.level} maxlength="300"></textarea></label>
  <div class="field"><span class="field__label">Plan</span>
    <Segmented label="Plan kind" value={kind} onchange={(v) => (kind = v)} options={[
      { value: "course", label: "Learn the material", tip: "Lessons cover every item in the ledger" },
      { value: "skill", label: "Build a skill", tip: "Adds hands-on projects; works without material" },
    ]} />
  </div>
</div>

<style>
  .brief-ask { display: flex; gap: var(--s-2); }
  .brief-ask .input { flex: 1; min-width: 0; }
  @media (max-width: 640px) { .brief-ask { flex-direction: column; } }
</style>
