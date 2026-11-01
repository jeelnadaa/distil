<script lang="ts">
  import { api, type CardGrade, type Queue, type QueueCard } from "../lib/api.ts";
  import { attempt, library, nav } from "../lib/state.svelte.ts";
  import ActivityDock from "./ActivityDock.svelte";
  import Icon from "./Icon.svelte";
  import Markdown from "./Markdown.svelte";

  // Flashcard review (S7, F-902): one centred card at a time. Space shows the answer, 1–4 grade it, and each
  // grade shows when the card would come back. A card graded into a short learning step comes round again
  // in this session.
  let { folderId }: { folderId?: string } = $props();

  // Cards due back within this long are shown again before the session ends.
  const AGAIN_WITHIN = 20 * 60_000;
  const GRADES: { grade: CardGrade; label: string; tone: string }[] = [
    { grade: 1, label: "Again", tone: "danger" }, { grade: 2, label: "Hard", tone: "warning" },
    { grade: 3, label: "Good", tone: "success" }, { grade: 4, label: "Easy", tone: "accent" },
  ];

  let queue = $state<Queue | null>(null);
  let cards = $state<QueueCard[]>([]);
  let reviewed = $state(0);
  let shown = $state(false);
  let busy = $state(false);
  let explanation = $state<string | null>(null);
  let explaining = $state(false);

  const card = $derived(cards[0] ?? null);
  const folder = $derived(folderId ? library.folders.find((f) => f.id === folderId) : null);
  const total = $derived(reviewed + cards.length);

  async function load() {
    const q = await attempt(() => api.reviewQueue(folderId));
    if (!q) return;
    queue = q;
    cards = q.cards;
    reviewed = 0;
    reset();
  }
  $effect(() => { void folderId; void load(); });

  function reset() {
    shown = false;
    explanation = null;
    explaining = false;
  }

  async function grade(g: CardGrade) {
    if (!card || !shown || busy) return;
    busy = true;
    const done = await attempt(() => api.reviewCard(card.id, g));
    if (done) {
      const [current, ...rest] = cards;
      reviewed++;
      // A short learning step brings the card back later in this session.
      cards = done.dueAt !== null && done.dueAt - Date.now() <= AGAIN_WITHIN ? [...rest, { ...current!, ...done }] : rest;
      reset();
      if (!cards.length) queue = (await attempt(() => api.reviewQueue(folderId))) ?? queue;
    }
    busy = false;
  }

  async function explain() {
    if (!card || explaining) return;
    explaining = true;
    const r = await attempt(() => api.explainCard(card.id));
    explaining = false;
    if (r) explanation = r.text;
  }

  function onkeydown(e: KeyboardEvent) {
    const el = e.target instanceof Element ? e.target : null;
    if (el?.closest("input, textarea, select, [contenteditable], [role=dialog]") || e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.key === " " || e.key === "Enter") && !shown && card) {
      e.preventDefault();
      shown = true;
    } else if (shown && ["1", "2", "3", "4"].includes(e.key)) {
      e.preventDefault();
      void grade(Number(e.key) as CardGrade);
    }
  }

  // "Reverse" cards are asked the other way round on alternate reviews.
  const flipped = $derived(!!card && card.kind === "reverse" && card.state.reps % 2 === 1);
  // Cloze: the front hides each {{cN::…}}, the back shows it marked.
  const cloze = (text: string, reveal: boolean) =>
    text.replace(/\{\{c\d+::(.*?)(?:::(.*?))?\}\}/g, (_, answer: string, hint?: string) => (reveal ? `**${answer}**` : `**[${hint ?? "…"}]**`));
  const front = $derived(!card ? "" : card.kind === "cloze" ? cloze(card.front, false) : flipped ? card.back : card.front);
  const back = $derived(!card ? "" : card.kind === "cloze" ? cloze(card.front, true) + (card.back.trim() && card.back.trim() !== "—" ? `\n\n${card.back}` : "") : flipped ? card.front : card.back);

  function interval(ms: number) {
    const m = ms / 60_000;
    if (m < 60) return `${Math.max(1, Math.round(m))}m`;
    const h = m / 60;
    if (h < 24) return `${Math.round(h)}h`;
    const d = h / 24;
    if (d < 30) return `${Math.round(d)}d`;
    if (d < 365) return `${Math.round(d / 30)}mo`;
    return `${(d / 365).toFixed(1)}y`;
  }
  const when = (t: number) => {
    const days = Math.round((t - Date.now()) / 86_400_000);
    return days <= 0 ? "later today" : days === 1 ? "tomorrow" : `in ${days} days`;
  };
</script>

<svelte:window {onkeydown} />

<header class="topbar">
  <button type="button" class="btn btn--ghost btn--icon btn--sm topbar__menu" aria-label="Open menu" onclick={() => (nav.sidebarOpen = true)}><Icon name="sidebar" size="sm" /></button>
  <nav class="topbar__crumb" aria-label="Location">
    {#if folder}<a class="crumb hide-sm" href="#/folder/{folder.id}/cards">{folder.name}</a><Icon name="chevron-right" size="sm" />{/if}
    <strong>Review</strong>
  </nav>
  <span class="topbar__spacer"></span>
  {#if card}<span class="mono caption faint">{reviewed} / {total}</span>{/if}
  <ActivityDock />
</header>
<div class="review__bar" aria-hidden="true"><span style:width="{total ? (reviewed / total) * 100 : 0}%"></span></div>

<div class="scroll">
  <div class="page review">
    {#if !queue}
      <p class="muted">Loading…</p>
    {:else if card}
      <article class="panel rcard" aria-live="polite">
        <header class="rcard__head">
          <span class="eyebrow">{card.state.phase === "new" ? "New" : card.state.phase === "review" ? "Review" : "Learning"}{folder ? "" : ` · ${card.folderName}`}</span>
          {#if card.itemTitle}<span class="caption faint">{card.itemTitle}</span>{/if}
        </header>
        <div class="rcard__face rcard__front"><Markdown source={front} /></div>
        {#if shown}
          <hr class="rcard__rule" />
          <div class="rcard__face"><Markdown source={back} /></div>
          {#if explanation}
            <div class="rcard__explain"><span class="eyebrow">Why</span><Markdown source={explanation} /></div>
          {/if}
          <footer class="rcard__links">
            {#if !explanation}
              <button type="button" class="btn btn--ghost btn--sm" disabled={explaining} onclick={explain}><Icon name="wand" size="sm" />{explaining ? "Explaining…" : "Explain this"}</button>
            {/if}
            {#if card.source}
              <a class="btn btn--ghost btn--sm" href="#/material/{card.source.materialId}/{card.source.loc}/{card.itemId}"><Icon name="file" size="sm" />Source</a>
            {/if}
          </footer>
        {/if}
      </article>

      {#if shown}
        <div class="grades">
          {#each GRADES as g, i (g.grade)}
            <button type="button" class="btn btn--secondary grade grade--{g.tone}" disabled={busy} onclick={() => grade(g.grade)}>
              <span>{g.label}</span>
              <span class="mono caption faint">{interval(card.preview[i]!)}</span>
              <span class="kbd key">{g.grade}</span>
            </button>
          {/each}
        </div>
      {:else}
        <div class="grades grades--one">
          <button type="button" class="btn btn--accent btn--lg" onclick={() => (shown = true)}>Show answer <span class="kbd key">Space</span></button>
        </div>
      {/if}
    {:else}
      <div class="review__done">
        <Icon name="cards" />
        <h1 class="display-md">{reviewed ? "Done for now." : "Nothing to review."}</h1>
        <p class="muted">
          {#if reviewed}You reviewed {reviewed} {reviewed === 1 ? "card" : "cards"}.{/if}
          {#if queue.nextDue}The next card is due {when(queue.nextDue)}.{:else if !reviewed}Cards are written for each lesson you finish, or you can add your own in a folder's Cards tab.{/if}
        </p>
        <a class="btn btn--secondary" href={folder ? `#/folder/${folder.id}/cards` : "#/today"}>{folder ? "Back to cards" : "Back to Today"}</a>
      </div>
    {/if}
  </div>
</div>

<style>
  .crumb { color: inherit; text-decoration: none; white-space: nowrap; }
  .review__bar { height: 2px; background: var(--border); }
  .review__bar span { display: block; height: 100%; background: var(--accent); transition: width var(--dur-base, 200ms) var(--ease-out); }
  .review { display: grid; gap: var(--s-5); max-width: 680px; }
  .rcard { padding: var(--s-6); display: grid; gap: var(--s-4); min-height: 240px; align-content: start; }
  .rcard__head { display: flex; justify-content: space-between; gap: var(--s-3); flex-wrap: wrap; }
  .rcard__face { font-size: var(--t-body-lg); overflow-wrap: anywhere; }
  .rcard__front { font-size: calc(var(--t-body-lg) * 1.1); }
  .rcard__rule { border: 0; border-top: 1px dashed var(--border); margin: 0; }
  .rcard__explain { background: var(--surface-sunken); border-radius: var(--r-sm); padding: var(--s-4); display: grid; gap: var(--s-2); }
  .rcard__links { display: flex; gap: var(--s-2); flex-wrap: wrap; }
  .grades { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--s-2); }
  .grades--one { grid-template-columns: minmax(0, 1fr); justify-items: center; }
  .grade { display: grid; justify-items: center; gap: 2px; height: auto; padding: var(--s-3) var(--s-2); position: relative; }
  .grade .kbd { position: absolute; top: 6px; right: 6px; }
  .grade--danger:hover { border-color: var(--danger); }
  .grade--warning:hover { border-color: var(--warning); }
  .grade--success:hover { border-color: var(--success); }
  .grade--accent:hover { border-color: var(--accent); }
  @media (hover: none), (max-width: 640px) { .key { display: none; } }
  .review__done { display: grid; justify-items: center; gap: var(--s-3); text-align: center; padding-top: var(--s-8, 64px); }
</style>
