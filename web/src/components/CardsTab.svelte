<script lang="ts">
  import { api, type Card, type CardKind, type Job } from "../lib/api.ts";
  import { renderInline } from "../lib/markdown.ts";
  import { attempt, toast } from "../lib/state.svelte.ts";
  import Dialog from "./Dialog.svelte";
  import Icon from "./Icon.svelte";
  import Menu, { type MenuItem } from "./Menu.svelte";
  import Select from "./Select.svelte";

  // A folder's flashcards (F-901, F-903, F-904): written for each finished lesson, added by hand, or imported
  // from Anki; reviewed from the Review screen.
  let { folderId, jobs, onchange }: { folderId: string; jobs: Job[]; onchange: () => void } = $props();

  const KINDS: { value: CardKind; label: string; hint: string }[] = [
    { value: "basic", label: "Question and answer", hint: "A question on the front, its answer on the back." },
    { value: "reverse", label: "Both ways", hint: "A term and its meaning, asked in either direction." },
    { value: "cloze", label: "Fill the gap", hint: "Hide words with {{c1::hidden words}}. The back can add context." },
    { value: "formula", label: "Formula", hint: "What the formula gives on the front, the formula in $…$ on the back." },
  ];
  const ORIGIN: Record<Card["origin"], string> = { taught: "From a lesson", missed: "From practice", manual: "Added by you", import: "Imported" };
  const PAGE = 100;

  let cards = $state<Card[]>([]);
  let loaded = $state(false);
  let query = $state("");
  let shown = $state(PAGE);
  let editing = $state<{ id: string | null; kind: CardKind; front: string; back: string } | null>(null);
  let file = $state<HTMLInputElement>();

  const load = async () => {
    const r = await attempt(() => api.cards(folderId));
    if (r) cards = r;
    loaded = true;
  };
  $effect(() => { void folderId; void load(); });

  // Reload once a card-writing job in this folder finishes.
  const writing = $derived(jobs.some((j) => j.kind === "cards" && (j.status === "queued" || j.status === "running")));
  let wasWriting = false;
  $effect(() => {
    if (writing) wasWriting = true;
    else if (wasWriting) { wasWriting = false; void load(); }
  });

  const now = Date.now();
  const due = $derived(cards.filter((c) => c.state.phase !== "new" && c.dueAt !== null && c.dueAt <= now).length);
  const fresh = $derived(cards.filter((c) => c.state.phase === "new").length);
  const visible = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return q ? cards.filter((c) => `${c.front} ${c.back} ${c.itemTitle ?? ""}`.toLowerCase().includes(q)) : cards;
  });
  $effect(() => { void query; shown = PAGE; });

  async function generate() {
    const r = await attempt(() => api.generateCards(folderId));
    if (!r) return;
    if (!r.job) toast("Every taught item already has a card.");
    onchange();
  }
  async function save() {
    const d = editing!;
    const ok = await attempt(() => (d.id ? api.updateCard(d.id, { kind: d.kind, front: d.front, back: d.back }) : api.addCard(folderId, { kind: d.kind, front: d.front, back: d.back })));
    if (!ok) return;
    editing = null;
    void load();
  }
  async function importFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = "";
    if (!f) return;
    const r = await attempt(async () => api.importCards(folderId, await f.text()));
    if (r) { toast(`Imported ${r.imported} ${r.imported === 1 ? "card" : "cards"}.`); void load(); }
  }

  const when = (c: Card) => {
    if (c.state.phase === "new" || c.dueAt === null) return "New";
    const days = Math.round((c.dueAt - now) / 86_400_000);
    return days <= 0 ? "Due" : days === 1 ? "Tomorrow" : `In ${days} days`;
  };
  const kindLabel = (k: CardKind) => KINDS.find((x) => x.value === k)!.label;
  const actions = (c: Card): MenuItem[] => [
    { label: "Edit", icon: "pencil", run: () => (editing = { id: c.id, kind: c.kind, front: c.front, back: c.back }) },
    { label: "Delete", icon: "trash", danger: true, run: () => attempt(() => api.deleteCard(c.id)).then(load) },
  ];
</script>

<section class="cards">
  <div class="cards__head">
    <div class="cards__counts">
      <span class="display-md">{cards.length}</span>
      <span class="body-sm muted">{cards.length === 1 ? "card" : "cards"} · {due} due · {fresh} new</span>
    </div>
    <div class="cards__actions">
      <a class="btn btn--accent btn--sm" class:is-disabled={!cards.length} href="#/review/{folderId}"><Icon name="play" size="sm" />Review</a>
      <button type="button" class="btn btn--secondary btn--sm" disabled={writing} onclick={generate}><Icon name="wand" size="sm" />{writing ? "Writing cards…" : "Write cards for taught items"}</button>
      <button type="button" class="btn btn--ghost btn--sm" onclick={() => (editing = { id: null, kind: "basic", front: "", back: "" })}><Icon name="plus" size="sm" />Add card</button>
      <Menu label="Import or export" items={[
        { label: "Import from Anki (.txt)", icon: "upload", run: () => file?.click() },
        ...(cards.length ? [{ label: "Export for Anki", icon: "download", run: () => { location.href = api.cardsExportUrl(folderId); } }] : []),
      ]} />
      <input bind:this={file} type="file" accept=".txt,.tsv,.csv,text/plain,text/tab-separated-values" hidden onchange={importFile} />
    </div>
  </div>

  {#if loaded && !cards.length}
    <div class="ws__empty">
      <Icon name="cards" />
      <p>Cards are written for what each finished lesson taught, so reviews keep it from fading. You can add your own or import an Anki deck.</p>
    </div>
  {:else if cards.length}
    <input class="input cards__filter" type="search" placeholder="Filter {cards.length} cards…" aria-label="Filter cards" bind:value={query} />
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Card</th><th class="cards__item">Item</th><th>Next</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {#each visible.slice(0, shown) as c (c.id)}
            <tr>
              <td>
                <div class="cards__front">{@html renderInline(c.front)}</div>
                <div class="caption muted cards__back">{@html renderInline(c.back)}</div>
                <span class="caption faint">{kindLabel(c.kind)} · {ORIGIN[c.origin]}</span>
              </td>
              <td class="cards__item caption muted">{c.itemTitle ?? "—"}</td>
              <td class="next nowrap" class:due={when(c) === "Due"}>{when(c)}</td>
              <td class="num"><Menu label="Actions for this card" items={actions(c)} /></td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if shown < visible.length}
        <div class="cards__more"><button type="button" class="btn btn--ghost btn--sm" onclick={() => (shown += PAGE)}>Show more ({visible.length - shown} left)</button></div>
      {/if}
    </div>
  {/if}
</section>

<Dialog bind:open={() => !!editing, (v) => { if (!v) editing = null; }} eyebrow="Flashcard" title={editing?.id ? "Edit card" : "Add a card"}>
  {#if editing}
    <form id="card-form" class="card-form" onsubmit={(e) => { e.preventDefault(); save(); }}>
      <div class="field"><span class="field__label">Kind</span>
        <Select label="Kind" value={editing.kind} onchange={(v) => (editing!.kind = v as CardKind)} options={KINDS} />
        <span class="caption faint">{KINDS.find((k) => k.value === editing!.kind)!.hint}</span>
      </div>
      <label class="field"><span class="field__label">Front <span class="field__hint">· Markdown and $maths$</span></span><textarea class="textarea" rows="3" bind:value={editing.front} maxlength="2000" required></textarea></label>
      <label class="field"><span class="field__label">Back</span><textarea class="textarea" rows="3" bind:value={editing.back} maxlength="4000" required></textarea></label>
    </form>
  {/if}
  {#snippet footer()}
    <button type="button" class="btn btn--ghost" onclick={() => (editing = null)}>Cancel</button>
    <button type="submit" form="card-form" class="btn btn--primary" disabled={!editing?.front.trim() || !editing?.back.trim()}>{editing?.id ? "Save" : "Add"}</button>
  {/snippet}
</Dialog>

<style>
  .cards { display: grid; gap: var(--s-4); margin-top: var(--s-5); }
  .cards__head { display: flex; flex-wrap: wrap; gap: var(--s-4); align-items: end; justify-content: space-between; }
  .cards__counts { display: flex; align-items: baseline; gap: var(--s-2); }
  .cards__actions { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; }
  .cards__filter { max-width: 320px; }
  .cards__front { font-weight: 500; overflow-wrap: anywhere; }
  .cards__back { overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .nowrap { white-space: nowrap; }
  .next { font: 500 12px var(--font-mono); color: var(--text-muted); }
  .next.due { color: var(--accent); }
  .is-disabled { pointer-events: none; opacity: .5; }
  .cards__more { display: flex; justify-content: center; padding: var(--s-4); }
  .card-form { display: grid; gap: var(--s-4); }
  @media (max-width: 640px) { .cards__item { display: none; } }
</style>
