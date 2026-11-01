<script lang="ts">
  import type { Answer, CheckView, Confidence } from "../lib/api.ts";
  import { renderInline } from "../lib/markdown.ts";
  import Icon from "./Icon.svelte";

  // A check question (F-604) with optional confidence and thinking (F-605), "I don't know" (F-606) and
  // keyboard answering (F-616): 1–6 picks an option, j/k move a step in an ordering, Ctrl+Enter submits.
  // A teaching check starts folded so the learner reads the step first (F-609); a probe starts open.
  let { check, busy = false, probe = false, onanswer }: {
    check: CheckView; busy?: boolean; probe?: boolean; onanswer: (answer: Omit<Answer, "checkId">) => void;
  } = $props();

  const q = $derived(check.question);
  const result = $derived(check.result);
  let unfolded = $state(false);
  const open = $derived(!result && (probe || unfolded));

  let picked = $state<number | null>(null);
  let text = $state("");
  // Ordering: positions in the shown list, in the learner's order.
  let order = $state<number[]>([]);
  let moving = $state<number | null>(null);
  let confidence = $state<Confidence | null>(null);
  let thinking = $state("");
  let showThinking = $state(false);
  let card = $state<HTMLElement>();

  $effect(() => { if (q.type === "order" && order.length !== q.steps.length) order = q.steps.map((_, i) => i); });

  const ready = $derived(q.type === "mcq" ? picked !== null : q.type === "order" ? true : text.trim().length > 0);

  function submit(dontKnow = false) {
    if (busy || (!dontKnow && !ready)) return;
    const value = dontKnow ? null : q.type === "mcq" ? picked : q.type === "order" ? order : text.trim();
    onanswer({ value, confidence: dontKnow ? null : confidence, thinking: showThinking ? thinking : "" });
  }

  function move(at: number, by: number) {
    const to = at + by;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    [next[at], next[to]] = [next[to]!, next[at]!];
    order = next;
    moving = to;
  }

  function onkeydown(e: KeyboardEvent) {
    const typing = (e.target as HTMLElement).matches("input, textarea");
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); return; }
    if (typing) return;
    if (q.type === "mcq" && /^[1-6]$/.test(e.key) && Number(e.key) <= q.options.length) { picked = Number(e.key) - 1; e.preventDefault(); }
    else if (q.type === "mcq" && e.key === "Enter" && picked !== null) { e.preventDefault(); submit(); }
    else if (q.type === "order" && moving !== null && (e.key === "j" || e.key === "k")) { move(moving, e.key === "j" ? 1 : -1); e.preventDefault(); }
  }

  $effect(() => { if (open && probe) card?.focus(); });

  // The teacher cites passages as [n] in its explanation; in the card they would point nowhere.
  const uncited = (text: string) => text.replace(/\s*\[\d{1,2}(?:\s*,\s*\d{1,2})*\]/g, "");
  const VERDICT = { right: ["Right", "success"], partly: ["Partly right", "warning"], wrong: ["Not quite", "danger"], unknown: ["You didn't know yet", "accent"] } as const;
  const CONFIDENCE: { value: Confidence; label: string }[] = [{ value: "guess", label: "Guess" }, { value: "unsure", label: "Unsure" }, { value: "sure", label: "Sure" }];
  const shownAnswer = $derived.by(() => {
    if (!result || result.value === null) return null;
    if (q.type === "mcq") return q.options[Number(result.value)] ?? null;
    if (q.type === "order" && Array.isArray(result.value)) return result.value.map((p) => q.steps[p]).join(" → ");
    return String(result.value);
  });
</script>

<!-- Keys answer the question while it has focus (F-616); every control in it is also a button or field. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="check" class:is-answered={!!result} class:is-open={open} bind:this={card} tabindex="-1" {onkeydown} aria-label="Check your understanding">
  {#if !result && !open}
    <button type="button" class="check__fold" onclick={() => { unfolded = true; queueMicrotask(() => card?.focus()); }}>
      <Icon name="target" size="sm" /><span>Check your understanding</span><span class="spacer"></span><Icon name="chevron-right" size="sm" />
    </button>
  {:else}
    <header class="check__head">
      <p class="eyebrow">{probe ? "Where to start" : "Check"}</p>
      {#if result}<span class="chip chip--{VERDICT[result.verdict][1]}">{VERDICT[result.verdict][0]}</span>{/if}
    </header>
    <p class="check__prompt">{@html renderInline(q.prompt)}</p>

    {#if q.type === "mcq"}
      <div class="options" role="radiogroup" aria-label="Options">
        {#each q.options as option, i (i)}
          {@const mine = result ? result.value === i : picked === i}
          {@const right = result && result.answer === option}
          <button type="button" role="radio" aria-checked={mine} class="option" class:is-picked={mine} class:is-right={right} class:is-wrong={result && mine && !right}
            disabled={!!result || busy} onclick={() => (picked = i)}>
            <span class="kbd">{i + 1}</span><span class="option__text">{@html renderInline(option)}</span>
            {#if right}<Icon name="check" size="sm" />{:else if result && mine}<Icon name="x" size="sm" />{/if}
          </button>
        {/each}
      </div>
    {:else if q.type === "order" && !result}
      <ol class="order">
        {#each order as pos, at (pos)}
          <li class:is-moving={moving === at}>
            <span class="mono faint">{at + 1}</span><span class="order__text">{@html renderInline(q.steps[pos]!)}</span>
            <button type="button" class="btn btn--ghost btn--icon btn--sm" aria-label="Move up" disabled={at === 0 || busy} onclick={() => move(at, -1)}><Icon name="chevron-right" size="sm" /></button>
            <button type="button" class="btn btn--ghost btn--icon btn--sm down" aria-label="Move down" disabled={at === order.length - 1 || busy} onclick={() => move(at, 1)}><Icon name="chevron-right" size="sm" /></button>
          </li>
        {/each}
      </ol>
    {:else if !result}
      {#if q.type === "explain"}
        <textarea class="input field" rows="4" bind:value={text} disabled={busy} placeholder="Explain it in your own words…" aria-label="Your explanation"></textarea>
      {:else}
        <div class="answer-row">
          <input class="input field" bind:value={text} disabled={busy} inputmode={q.type === "numeric" ? "decimal" : "text"}
            placeholder={q.type === "numeric" ? "Your answer" : "A few words or a sentence"} aria-label="Your answer"
            onkeydown={(e) => { if (e.key === "Enter" && !e.ctrlKey) { e.preventDefault(); submit(); } }} />
          {#if q.type === "numeric" && q.unit}<span class="muted">{q.unit}</span>{/if}
        </div>
      {/if}
    {/if}

    {#if result}
      <div class="outcome">
        {#if shownAnswer !== null && q.type !== "mcq"}<p class="body-sm"><span class="muted">You:</span> {shownAnswer}</p>{/if}
        {#if result.thinking}<p class="body-sm muted thinking">“{result.thinking}”</p>{/if}
        {#if result.feedback}<p class="body-sm">{uncited(result.feedback)}</p>{/if}
        {#if result.verdict !== "right" || q.type !== "mcq"}<p class="body-sm"><span class="muted">Answer:</span> {@html renderInline(result.answer)}</p>{/if}
        {#if result.why}<p class="body-sm muted">{@html renderInline(uncited(result.why))}</p>{/if}
      </div>
    {:else}
      {#if showThinking}
        <textarea class="input field" rows="2" bind:value={thinking} disabled={busy} placeholder="Reason it out: what do you think, and why?" aria-label="Your thinking"></textarea>
      {/if}
      <footer class="check__foot">
        <div class="confidence" role="group" aria-label="How sure are you? (optional)">
          {#each CONFIDENCE as c (c.value)}
            <button type="button" class="conf" class:is-on={confidence === c.value} aria-pressed={confidence === c.value} disabled={busy}
              onclick={() => (confidence = confidence === c.value ? null : c.value)}>{c.label}</button>
          {/each}
        </div>
        {#if !showThinking}<button type="button" class="btn btn--ghost btn--sm" disabled={busy} onclick={() => (showThinking = true)}>Add thinking</button>{/if}
        <span class="spacer"></span>
        <button type="button" class="btn btn--ghost btn--sm" disabled={busy} onclick={() => submit(true)}>I don't know</button>
        <button type="button" class="btn btn--primary btn--sm" disabled={busy || !ready} data-tip="Ctrl + Enter" onclick={() => submit()}>Check answer</button>
      </footer>
    {/if}
  {/if}
</section>

<style>
  .check { border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface); display: grid; gap: var(--s-3); padding: var(--s-4); outline: none; max-width: 72ch; }
  .check:not(.is-open):not(.is-answered) { padding: 0; }
  .check.is-answered { background: var(--surface-sunken); }
  .check__fold { display: flex; align-items: center; gap: var(--s-2); padding: var(--s-3) var(--s-4); font-weight: 500; color: var(--accent); border-radius: var(--r-md); }
  .check__fold:hover { background: var(--surface-sunken); }
  .check__head { display: flex; align-items: center; gap: var(--s-3); }
  .check__prompt { font-size: var(--t-body); line-height: 25px; font-weight: 500; }
  .options { display: grid; gap: var(--s-2); }
  .option { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-2) var(--s-3); border: 1px solid var(--border-control); border-radius: var(--r-sm); text-align: left; transition: border-color 120ms var(--ease-out), background 120ms var(--ease-out); }
  .option:not(:disabled):hover { border-color: var(--accent); }
  .option.is-picked { border-color: var(--accent); background: var(--accent-wash); }
  .option.is-right { border-color: var(--success); background: var(--success-wash); color: var(--text); }
  .option.is-wrong { border-color: var(--danger); background: var(--danger-wash); }
  .option:disabled { cursor: default; }
  .option__text { flex: 1; min-width: 0; }
  .order { list-style: none; display: grid; gap: var(--s-2); padding: 0; }
  .order li { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-1) var(--s-1) var(--s-1) var(--s-3); border: 1px solid var(--border-control); border-radius: var(--r-sm); }
  .order li.is-moving { border-color: var(--accent); }
  .order__text { flex: 1; min-width: 0; }
  .order :global(.btn .icon) { transform: rotate(-90deg); }
  .order .down :global(.icon) { transform: rotate(90deg); }
  .field { width: 100%; }
  textarea.field { resize: vertical; min-height: 0; padding: var(--s-2) var(--s-3); line-height: 22px; }
  .answer-row { display: flex; align-items: center; gap: var(--s-2); }
  .check__foot { display: flex; align-items: center; gap: var(--s-2); flex-wrap: wrap; }
  .spacer { flex: 1; }
  .confidence { display: inline-flex; border: 1px solid var(--border-control); border-radius: var(--r-sm); overflow: hidden; }
  .conf { padding: 3px 10px; font-size: var(--t-caption); color: var(--text-muted); }
  .conf + .conf { border-left: 1px solid var(--border-control); }
  .conf.is-on { background: var(--accent-wash); color: var(--accent); }
  .outcome { display: grid; gap: var(--s-2); }
  .thinking { font-style: italic; }
</style>
