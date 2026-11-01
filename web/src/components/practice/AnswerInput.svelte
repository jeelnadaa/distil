<script lang="ts">
  import type { AnswerValue, QuestionView } from "../../lib/api.ts";
  import { renderInline } from "../../lib/markdown.ts";
  import { toast } from "../../lib/state.svelte.ts";
  import Icon from "../Icon.svelte";

  // The answer area for one question (F-806): choices, a number, an ordering, or written working that
  // can be typed, photographed from paper, or both. `answer` is the learner's current answer.
  let { question: q, answer = $bindable(), disabled = false, onchange }: {
    question: QuestionView; answer: AnswerValue; disabled?: boolean; onchange?: () => void;
  } = $props();

  const written = $derived(q.type === "short" || q.type === "problem");
  let moving = $state<number | null>(null);
  let file = $state<HTMLInputElement>();
  // Ordering: positions in the shown list, in the learner's order.
  const order = $derived(Array.isArray(answer.value) && answer.value.length === q.steps?.length ? answer.value : (q.steps ?? []).map((_, i) => i));

  const set = (patch: Partial<AnswerValue>) => { answer = { ...answer, ...patch }; onchange?.(); };

  function move(at: number, by: number) {
    const to = at + by;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    [next[at], next[to]] = [next[to]!, next[at]!];
    moving = to;
    set({ value: next });
  }

  // A phone photo is several megabytes; 1600 px on the long side keeps handwriting legible and the upload small.
  const MAX_SIDE = 1600;
  async function addPhoto(picked: File | undefined) {
    if (!picked) return;
    if (!/^image\//.test(picked.type)) { toast("Pick a photo (JPEG, PNG or WebP).", "error"); return; }
    try {
      const bitmap = await createImageBitmap(picked);
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      set({ photo: canvas.toDataURL("image/jpeg", 0.85) });
    } catch {
      toast("That photo couldn't be read.", "error");
    } finally {
      if (file) file.value = "";
    }
  }
</script>

{#if q.type === "mcq" && q.options}
  <div class="options" role="radiogroup" aria-label="Options">
    {#each q.options as option, i (i)}
      <button type="button" role="radio" aria-checked={answer.value === i} class="option" class:is-picked={answer.value === i} {disabled} onclick={() => set({ value: i })}>
        <span class="kbd">{String.fromCharCode(65 + i)}</span><span class="option__text">{@html renderInline(option)}</span>
      </button>
    {/each}
  </div>
{:else if q.type === "order" && q.steps}
  <ol class="order">
    {#each order as pos, at (pos)}
      <li class:is-moving={moving === at}>
        <span class="mono faint">{at + 1}</span><span class="order__text">{@html renderInline(q.steps[pos]!)}</span>
        <button type="button" class="btn btn--ghost btn--icon btn--sm up" aria-label="Move up" disabled={disabled || at === 0} onclick={() => move(at, -1)}><Icon name="chevron-right" size="sm" /></button>
        <button type="button" class="btn btn--ghost btn--icon btn--sm down" aria-label="Move down" disabled={disabled || at === order.length - 1} onclick={() => move(at, 1)}><Icon name="chevron-right" size="sm" /></button>
      </li>
    {/each}
  </ol>
{:else if q.type === "numeric"}
  <div class="row">
    <input class="input num-input" inputmode="decimal" value={answer.value ?? ""} {disabled} placeholder="Your answer" aria-label="Your answer"
      oninput={(e) => set({ value: e.currentTarget.value })} />
    {#if q.unit}<span class="muted">{q.unit}</span>{/if}
  </div>
{:else if written}
  <textarea class="textarea box" rows={q.type === "problem" ? 8 : 3} value={typeof answer.value === "string" ? answer.value : ""} {disabled}
    placeholder={q.type === "problem" ? "Show your working. Maths like x^2 or sqrt(2)/2 is fine." : "A sentence or two."} aria-label="Your answer"
    oninput={(e) => set({ value: e.currentTarget.value })}></textarea>
  <div class="photo">
    {#if answer.photo}
      <figure class="photo__shot"><img src={answer.photo} alt="Your handwritten working" /></figure>
      {#if !disabled}<button type="button" class="btn btn--ghost btn--sm" onclick={() => set({ photo: null })}><Icon name="trash" size="sm" />Remove photo</button>{/if}
    {:else if !disabled}
      <button type="button" class="btn btn--ghost btn--sm" onclick={() => file?.click()} data-tip="Write on paper, then add a photo: it's marked with what you type"><Icon name="image" size="sm" />Photo of handwriting</button>
      <input bind:this={file} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onchange={(e) => addPhoto(e.currentTarget.files?.[0])} />
    {/if}
  </div>
{/if}

<style>
  .options { display: grid; gap: var(--s-2); }
  .option { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-2) var(--s-3); border: 1px solid var(--border-control); border-radius: var(--r-sm); text-align: left; transition: border-color 120ms var(--ease-out), background 120ms var(--ease-out); }
  .option:not(:disabled):hover { border-color: var(--accent); }
  .option.is-picked { border-color: var(--accent); background: var(--accent-wash); }
  .option:disabled { cursor: default; }
  .option__text { flex: 1; min-width: 0; }
  .order { list-style: none; display: grid; gap: var(--s-2); padding: 0; margin: 0; }
  .order li { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-1) var(--s-1) var(--s-1) var(--s-3); border: 1px solid var(--border-control); border-radius: var(--r-sm); }
  .order li.is-moving { border-color: var(--accent); }
  .order__text { flex: 1; min-width: 0; }
  .order .up :global(.icon) { transform: rotate(-90deg); }
  .order .down :global(.icon) { transform: rotate(90deg); }
  .row { display: flex; align-items: center; gap: var(--s-2); }
  .num-input { width: 14em; max-width: 100%; }
  .box { width: 100%; resize: vertical; line-height: 22px; font-family: var(--font-text); }
  .photo { display: flex; align-items: flex-end; gap: var(--s-3); flex-wrap: wrap; }
  .photo__shot { margin: 0; border: 1px solid var(--border); border-radius: var(--r-sm); overflow: hidden; background: var(--surface-sunken); }
  .photo__shot img { display: block; max-width: min(360px, 100%); max-height: 260px; object-fit: contain; }
</style>
