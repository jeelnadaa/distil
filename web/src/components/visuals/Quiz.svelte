<script lang="ts">
  import { untrack } from "svelte";
  import type { Question, QuizSpec } from "../../../../server/visuals/grammar/text.ts";
  import { renderInline } from "../../lib/markdown.ts";
  import Icon from "../Icon.svelte";
  import Select from "../Select.svelte";

  // `quiz` (F-708): quick practice inside a reply, checked on the spot: pick an option, put steps in order,
  // match pairs or fill in blanks. Nothing is recorded; lesson checks are the teacher's.
  let { spec: given }: { spec: QuizSpec } = $props();
  // Read once: a changed block is a new widget (Markdown keys it by its source).
  const spec = untrack(() => given);

  // A stable shuffle per quiz, so options don't jump on re-render.
  const shuffle = <T,>(items: T[], seed: number): T[] => {
    const out = [...items];
    let s = seed;
    for (let i = out.length - 1; i > 0; i--) {
      s = (s * 9301 + 49297) % 233280;
      const j = Math.floor((s / 233280) * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    // A shuffle that left everything in place teaches nothing.
    return out.length > 1 && out.every((x, i) => x === items[i]) ? [...out.slice(1), out[0]!] : out;
  };

  type State = { picked: number | null; order: number[]; matches: string[]; blanks: string[]; checked: boolean };
  const initial = (q: Question, i: number): State => ({
    picked: null,
    order: q.type === "order" ? shuffle(q.items.map((_, k) => k), i + 7) : [],
    matches: q.type === "match" ? q.pairs.map(() => "") : [],
    blanks: q.type === "blank" ? q.answers.map(() => "") : [],
    checked: false,
  });
  let states = $state(spec.questions.map(initial));
  const rights = spec.questions.map((q, i) => (q.type === "match" ? shuffle(q.pairs.map((p) => p[1]), i + 3) : []));

  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.$]/g, "");
  function correct(q: Question, s: State): boolean {
    if (q.type === "choice") return s.picked !== null && q.options[s.picked]!.correct;
    if (q.type === "order") return s.order.every((k, i) => k === i);
    if (q.type === "match") return q.pairs.every((p, i) => s.matches[i] === p[1]);
    return q.answers.every((options, i) => options.some((a) => norm(a) === norm(s.blanks[i] ?? "")));
  }
  const ready = (q: Question, s: State) =>
    q.type === "choice" ? s.picked !== null : q.type === "match" ? s.matches.every(Boolean) : q.type === "blank" ? s.blanks.every((b) => b.trim()) : true;

  function move(s: State, at: number, by: number) {
    const to = at + by;
    if (to < 0 || to >= s.order.length) return;
    [s.order[at], s.order[to]] = [s.order[to]!, s.order[at]!];
  }
  // The prompt split around its [[blanks]].
  const parts = (prompt: string) => prompt.split(/\[\[.+?\]\]/g);
  const score = $derived(states.filter((s, i) => s.checked && correct(spec.questions[i]!, s)).length);
  const checkedCount = $derived(states.filter((s) => s.checked).length);
</script>

<div class="quiz">
  {#each spec.questions as q, i (i)}
    {@const s = states[i]!}
    {@const ok = s.checked && correct(q, s)}
    <section class="q" class:is-right={ok} class:is-wrong={s.checked && !ok}>
      {#if q.type === "blank"}
        <p class="prompt">
          {#each parts(q.prompt) as part, k (k)}{@html renderInline(part)}{#if k < q.answers.length}<input class="blank" bind:value={s.blanks[k]} disabled={s.checked} aria-label="Blank {k + 1}" size={Math.max(6, (q.answers[k]![0] ?? "").length + 2)} />{/if}{/each}
        </p>
      {:else}
        <p class="prompt">{@html renderInline(q.prompt)}</p>
      {/if}

      {#if q.type === "choice"}
        <div class="options">
          {#each q.options as o, k (k)}
            <button type="button" class="option" class:is-picked={s.picked === k} class:is-right={s.checked && o.correct} class:is-wrong={s.checked && s.picked === k && !o.correct}
              disabled={s.checked} onclick={() => (s.picked = k)}><span class="kbd">{k + 1}</span><span>{@html renderInline(o.text)}</span></button>
          {/each}
        </div>
      {:else if q.type === "order"}
        <ol class="order">
          {#each s.order as k, at (k)}
            <li class:is-right={s.checked && k === at} class:is-wrong={s.checked && k !== at}>
              <span class="mono faint">{at + 1}</span><span class="grow">{@html renderInline(q.items[k]!)}</span>
              {#if !s.checked}
                <button type="button" class="btn btn--ghost btn--icon btn--sm up" aria-label="Move up" disabled={at === 0} onclick={() => move(s, at, -1)}><Icon name="chevron-right" size="sm" /></button>
                <button type="button" class="btn btn--ghost btn--icon btn--sm down" aria-label="Move down" disabled={at === s.order.length - 1} onclick={() => move(s, at, 1)}><Icon name="chevron-right" size="sm" /></button>
              {/if}
            </li>
          {/each}
        </ol>
      {:else if q.type === "match"}
        <div class="pairs">
          {#each q.pairs as p, k (k)}
            <span class="left">{@html renderInline(p[0])}</span>
            {#if s.checked}
              <span class:right-text={s.matches[k] === p[1]} class:wrong-text={s.matches[k] !== p[1]}>{s.matches[k]}{#if s.matches[k] !== p[1]} <span class="muted">→ {p[1]}</span>{/if}</span>
            {:else}
              <Select compact label="Match for {p[0]}" value={s.matches[k] ?? ""} placeholder="Choose…" options={rights[i]!.map((r) => ({ value: r, label: r }))} onchange={(v) => (s.matches[k] = v)} />
            {/if}
          {/each}
        </div>
      {/if}

      <footer>
        {#if s.checked}
          <span class="chip chip--{ok ? 'success' : 'danger'}">{ok ? "Right" : "Not quite"}</span>
          {#if !ok && q.type === "blank"}<span class="body-sm muted">Answer: {q.answers.map((a) => a[0]).join(", ")}</span>{/if}
          <span class="spacer"></span>
          <button type="button" class="btn btn--ghost btn--sm" onclick={() => (states[i] = initial(q, i + 1))}>Try again</button>
        {:else}
          <span class="spacer"></span>
          <button type="button" class="btn btn--secondary btn--sm" disabled={!ready(q, s)} onclick={() => (s.checked = true)}>Check</button>
        {/if}
      </footer>
      {#if s.checked && q.why}<p class="why body-sm">{@html renderInline(q.why)}</p>{/if}
    </section>
  {/each}
  {#if spec.questions.length > 1 && checkedCount}
    <p class="score mono caption muted">{score} of {checkedCount} right</p>
  {/if}
</div>

<style>
  .quiz { display: grid; }
  .q { padding: var(--s-4); display: grid; gap: var(--s-3); border-bottom: 1px solid var(--border); }
  .q:last-of-type { border-bottom: 0; }
  .prompt { margin: 0; font-weight: 500; line-height: 1.7; }
  .blank { width: auto; height: 28px; margin: 0 4px; padding: 0 var(--s-2); border: 0; border-bottom: 1.5px solid var(--border-control); background: var(--surface-sunken); border-radius: var(--r-xs) var(--r-xs) 0 0; color: var(--text); font: inherit; }
  .blank:focus { outline: none; border-bottom-color: var(--accent); }
  .is-right .blank { border-bottom-color: var(--success); }
  .is-wrong .blank { border-bottom-color: var(--danger); }
  .options { display: grid; gap: var(--s-2); }
  .option { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-2) var(--s-3); border: 1px solid var(--border-control); border-radius: var(--r-sm); text-align: left; }
  .option:not(:disabled):hover { border-color: var(--accent); }
  .option.is-picked { border-color: var(--accent); background: var(--accent-wash); }
  .option.is-right { border-color: var(--success); background: var(--success-wash); }
  .option.is-wrong { border-color: var(--danger); background: var(--danger-wash); }
  .option:disabled { cursor: default; }
  .order { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
  .order li { display: flex; align-items: center; gap: var(--s-3); min-height: 36px; padding: 2px var(--s-1) 2px var(--s-3); border: 1px solid var(--border-control); border-radius: var(--r-sm); }
  .order li.is-right { border-color: var(--success); }
  .order li.is-wrong { border-color: var(--danger); }
  .grow { flex: 1; min-width: 0; }
  .up :global(.icon) { transform: rotate(-90deg); }
  .down :global(.icon) { transform: rotate(90deg); }
  .pairs { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: var(--s-2) var(--s-4); align-items: center; }
  .right-text { color: var(--success); }
  .wrong-text { color: var(--danger); }
  footer { display: flex; align-items: center; gap: var(--s-3); flex-wrap: wrap; }
  .spacer { flex: 1; }
  .why { margin: 0; color: var(--text-muted); }
  .score { padding: 0 var(--s-4) var(--s-3); margin: 0; }
</style>
