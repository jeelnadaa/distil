<script lang="ts">
  import { untrack } from "svelte";
  import { api, type Item, type LessonDetail } from "../lib/api.ts";
  import { attempt } from "../lib/state.svelte.ts";
  import Dialog from "./Dialog.svelte";
  import Icon from "./Icon.svelte";

  // A lesson chat's progress: a ring button in the top bar, and a dialog with the lesson's items.
  // tick: bumped by the chat whenever a reply moved an item, to reload and pulse the ring.
  let { lessonId, tick = 0 }: { lessonId: string; tick?: number } = $props();

  let lesson = $state<LessonDetail | null>(null);
  let open = $state(false);
  let pulse = $state(false);

  async function load(id: string) {
    const detail = await api.lesson(id).catch(() => null);
    if (id === lessonId) lesson = detail;
  }
  $effect(() => { const id = lessonId; untrack(() => load(id)); });
  $effect(() => {
    if (!tick) return;
    untrack(() => load(lessonId).then(() => { pulse = true; setTimeout(() => (pulse = false), 900); }));
  });

  type ItemState = "checked" | "taught" | "todo";
  const stateOf = (item: Item): ItemState =>
    item.status === "checked" || item.status === "mastered" || item.mark === "known" ? "checked"
      : item.status === "taught" ? "taught" : "todo";
  const LABEL: Record<ItemState, string> = { checked: "Understood", taught: "Taught", todo: "Not yet" };

  const total = $derived(lesson?.items.length ?? 0);
  const checked = $derived(lesson?.items.filter((i) => stateOf(i) === "checked").length ?? 0);
  const taught = $derived(lesson?.items.filter((i) => stateOf(i) !== "todo").length ?? 0);

  // The ring: understood items in full copper, taught ones in a lighter band behind them.
  const R = 9, C = 2 * Math.PI * R;
  const arc = (n: number) => `${total ? (n / total) * C : 0} ${C}`;

  async function finish() {
    if (lesson && (await attempt(() => api.updateLesson(lesson!.lesson.id, { status: "done" })))) await load(lessonId);
  }
</script>

{#if lesson}
  <button type="button" class="lesson-btn" class:is-pulse={pulse} onclick={() => (open = true)}
    aria-label="Lesson progress: {taught} of {total} items taught, {checked} understood" data-tip="Lesson progress">
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <circle class="ring__track" cx="11" cy="11" r={R} />
      <circle class="ring__taught" cx="11" cy="11" r={R} stroke-dasharray={arc(taught)} />
      <circle class="ring__checked" cx="11" cy="11" r={R} stroke-dasharray={arc(checked)} />
    </svg>
    <span class="lesson-btn__label">Lesson {lesson.index}</span>
    <span class="mono lesson-btn__count">{taught}/{total}</span>
  </button>

  <Dialog bind:open eyebrow="Unit {lesson.unitNo} · Lesson {lesson.index} of {lesson.total}" title={lesson.lesson.title}>
    <p class="body-sm muted lp__unit">{lesson.unit.title}</p>

    <div class="lp__stats">
      <div><span class="display-md">{taught}<small>/{total}</small></span><span class="eyebrow">Taught</span></div>
      <div><span class="display-md">{checked}<small>/{total}</small></span><span class="eyebrow">Understood</span></div>
      <div><span class="display-md">{lesson.unitLessons.done}<small>/{lesson.unitLessons.total}</small></span><span class="eyebrow">Unit lessons done</span></div>
    </div>

    <div class="lp__bar" role="img" aria-label="{checked} understood, {taught - checked} taught, {total - taught} not yet">
      {#each lesson.items as item (item.id)}<i class="is-{stateOf(item)}"></i>{/each}
    </div>

    <ol class="lp__items">
      {#each lesson.items as item, i (item.id)}
        {@const s = stateOf(item)}
        <li class="is-{s}">
          <span class="mono faint lp__no">{String(i + 1).padStart(2, "0")}</span>
          <span class="lp__text"><strong>{item.title}</strong><span class="caption faint">{item.type}</span></span>
          <span class="status status--{s === 'todo' ? 'pending' : s}"><i></i>{LABEL[s]}</span>
        </li>
      {/each}
    </ol>
    <p class="caption faint">Updates after each reply: an item is taught once it's explained, and understood once you answer a question on it correctly yourself.</p>

    {#snippet footer()}
      <a class="btn btn--ghost" href="#/folder/{lesson!.folderId}/plan" onclick={() => (open = false)}>Open plan</a>
      <span class="spacer"></span>
      {#if lesson!.lesson.status === "done"}
        <span class="status status--done"><i></i>Lesson done</span>
      {:else}
        <button type="button" class="btn btn--primary" onclick={finish}><Icon name="check" size="sm" />Mark lesson done</button>
      {/if}
    {/snippet}
  </Dialog>
{/if}

<style>
  .lesson-btn {
    display: inline-flex; align-items: center; gap: var(--s-2); height: 32px; padding: 0 var(--s-3) 0 6px;
    border: 1px solid var(--border); border-radius: var(--r-full); color: var(--text); font-size: var(--t-body-sm);
    transition: border-color var(--dur-fast, .15s), background var(--dur-fast, .15s);
  }
  .lesson-btn:hover { border-color: var(--border-control); background: var(--surface-sunken); }
  .lesson-btn svg { transform: rotate(-90deg); flex: none; }
  .lesson-btn circle { fill: none; stroke-width: 3; stroke-linecap: round; transition: stroke-dasharray .6s var(--ease-out, ease); }
  .ring__track { stroke: var(--border); }
  .ring__taught { stroke: color-mix(in oklab, var(--accent) 40%, transparent); }
  .ring__checked { stroke: var(--accent); }
  .lesson-btn__count { color: var(--text-muted); font-size: 11.5px; }
  .is-pulse { animation: lp-pulse .9s var(--ease-out, ease); }
  @keyframes lp-pulse { 0% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--accent) 55%, transparent); } 100% { box-shadow: 0 0 0 10px transparent; } }
  @media (max-width: 640px) { .lesson-btn__label { display: none; } }

  .lp__unit { margin-top: calc(-1 * var(--s-2)); }
  .lp__stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s-3); }
  .lp__stats > div { display: grid; gap: 2px; padding: var(--s-3) var(--s-4); border: 1px solid var(--border); border-radius: var(--r-md); }
  .lp__stats small { font-size: .5em; color: var(--text-faint); margin-left: 2px; }
  .lp__bar { display: flex; gap: 3px; }
  .lp__bar i { flex: 1; height: 6px; border-radius: 3px; background: var(--surface-sunken); border: 1px solid var(--border); }
  .lp__bar .is-taught { background: color-mix(in oklab, var(--accent) 40%, transparent); border-color: color-mix(in oklab, var(--accent) 60%, transparent); }
  .lp__bar .is-checked { background: var(--accent); border-color: var(--accent); }
  .lp__items { display: grid; list-style: none; padding: 0; margin: 0; border-top: 1px solid var(--border); }
  .lp__items li { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--s-3); padding: var(--s-3) 0; border-bottom: 1px solid var(--border); }
  .lp__items li.is-todo .lp__text strong { color: var(--text-muted); font-weight: 500; }
  .lp__text { display: grid; min-width: 0; }
  .lp__text strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lp__no { font-size: 11px; }
  @media (max-width: 640px) { .lp__stats { grid-template-columns: 1fr 1fr; } .lp__stats > div:last-child { grid-column: span 2; } }
</style>
