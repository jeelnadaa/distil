<script lang="ts">
  import { untrack } from "svelte";
  import { MAX_PLANS } from "../../../server/constants.ts";
  import { api, localDay, type Brief, type Item, type Lesson, type PlanKind, type PlanView, type SavedPlan } from "../lib/api.ts";
  import { attempt, startLesson, toast } from "../lib/state.svelte.ts";
  import { wheelScroll } from "../lib/wheel.ts";
  import BriefForm from "./BriefForm.svelte";
  import Dialog from "./Dialog.svelte";
  import Icon from "./Icon.svelte";
  import Menu, { type MenuItem } from "./Menu.svelte";
  import PlanMap, { lessonStates } from "./PlanMap.svelte";
  import Segmented from "./Segmented.svelte";
  import Select from "./Select.svelte";

  // The Plan tab (S5, F-501…F-510): the brief card until there is a plan, then the plan as a map or an
  // outline, with the deadline strip above it, filters, and edits that keep prerequisites in order.
  let { folderId, folderName, view, items, onview, onchange }: {
    folderId: string; folderName: string; view: PlanView; items: Item[]; onview: (v: PlanView) => void; onchange: () => void;
  } = $props();

  type Draft = { brief: Brief; kind: PlanKind };
  // A re-plan in progress: reuse a brief or change it, and (with MAX_PLANS saved) the plan it replaces.
  // briefReady: the changed brief is already in the draft, so only the replacement is left to pick.
  type Replan = { how: "same" | "changed"; replace: string | null; briefReady: boolean };

  const AIDS: Record<string, string> = { diagram: "diagram", simulation: "simulation", practice: "practice", example: "worked example" };
  const defaults = (): Brief => ({ goal: `Learn ${folderName}`, scope: "", level: "", depth: "standard", deadline: null, hoursPerDay: null, daysOff: [], assessment: "", language: "English" });

  let mode = $state<"map" | "outline">(innerWidth < 700 ? "outline" : "map");
  let selected = $state<string | null>(null);
  // The brief card starts from the stored brief; later edits go through editBrief().
  let draft = $state<Draft>(untrack(() => ({ brief: view.brief?.brief ?? defaults(), kind: view.brief?.kind ?? "course" })));
  let unanswered = $state(0);
  let editingBrief = $state(false);
  let replanning = $state<Replan | null>(null);
  let managing = $state(false);
  let renaming = $state<{ id: string; title: string } | null>(null);
  let busy = $state(false);
  let query = $state("");
  let unitFilter = $state("");
  let dayFilter = $state("");

  const plan = $derived(view.plan);
  const schedule = $derived(view.schedule);
  const states = $derived(plan ? lessonStates(plan) : new Map());
  const itemById = $derived(new Map(items.map((i) => [i.id, i])));
  const lessonNo = $derived(new Map(plan?.lessons.map((l, i) => [l.id, i + 1]) ?? []));
  const chosen = $derived(plan?.lessons.find((l) => l.id === selected) ?? null);
  const inScope = $derived(items.filter((i) => !i.mark).length);
  const todayKey = localDay();
  const titleOf = $derived(new Map(plan?.lessons.map((l) => [l.id, l.title]) ?? []));
  const full = $derived(view.saved.length >= MAX_PLANS);

  const dayLabel = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
  const longDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const hours = (minutes: number) => (minutes >= 60 ? `${+(minutes / 60).toFixed(1)} h` : `${minutes} min`);
  const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
  const planName = (p: SavedPlan) => `Plan of ${new Date(p.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;

  const summary = $derived(plan ? [
    plural(plan.lessons.length, "lesson"), plural(plan.units.length, "unit"),
    `${view.coverage.planned} of ${view.coverage.total} items planned`,
    ...(schedule ? [`${plural(schedule.days.filter((d) => d.date >= todayKey && d.kind === "study").length, "study day")} left`] : []),
  ].join(" · ") : "");

  /* ---------- Filters: by text (lesson or item titles), unit and scheduled day ---------- */
  const dayOptions = $derived(schedule?.days.filter((d) => d.lessons.length).map((d) => ({
    value: d.date, label: `${d.date === todayKey ? "Today" : dayLabel(d.date)} · ${plural(d.lessons.length, "lesson")}`,
  })) ?? []);
  // Lesson ids that pass the filters, or null when no filter is set.
  const matches = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!plan || (!q && !unitFilter && !dayFilter)) return null;
    const onDay = dayFilter ? new Set(schedule?.days.find((d) => d.date === dayFilter)?.lessons) : null;
    return new Set(plan.lessons.filter((l) => (!unitFilter || l.unitId === unitFilter) && (!onDay || onDay.has(l.id))
      && (!q || l.title.toLowerCase().includes(q) || l.summary.toLowerCase().includes(q) || l.items.some((id) => itemById.get(id)?.title.toLowerCase().includes(q))))
      .map((l) => l.id));
  });
  const clearFilters = () => { query = ""; unitFilter = ""; dayFilter = ""; };

  /* ---------- Brief and re-planning ---------- */
  async function build(replace: string | null, from: { from?: string; brief?: Draft } = {}) {
    busy = true;
    const job = await attempt(() => api.buildPlan(folderId, { replace: replace ?? undefined, ...from }));
    busy = false;
    if (!job) return;
    toast(plan ? "Re-planning. The current plan stays until the new one is complete." : "Planning. Lessons appear when every item has a place.");
    onchange();
  }
  async function firstPlan() {
    busy = true;
    const saved = await attempt(() => api.saveBrief(folderId, draft.brief, draft.kind));
    busy = false;
    if (saved) await build(null);
  }
  function editBrief(from: Draft | null = view.brief) {
    draft = { brief: $state.snapshot(from?.brief) ?? defaults(), kind: from?.kind ?? "course" };
    editingBrief = true;
  }
  async function saveBrief() {
    busy = true;
    const saved = await attempt(() => api.saveBrief(folderId, draft.brief, draft.kind));
    busy = false;
    if (!saved) return;
    editingBrief = false;
    onchange();
  }
  // "Save and re-plan" from the brief editor: the edited brief goes with the build, so the current plan keeps its own.
  async function replanWithDraft() {
    editingBrief = false;
    const r = replanning;
    if (!r && full) { replanning = { how: "changed", replace: oldest(), briefReady: true }; return; }
    replanning = null;
    await build(r?.replace ?? null, { brief: $state.snapshot(draft) });
  }
  const oldest = () => view.saved.findLast((p) => p.status !== "active")?.id ?? null;
  // "Same brief" reuses the replaced plan's brief, or the active plan's when nothing is replaced (owner, 2026-11-01).
  const source = $derived(replanning && view.saved.find((p) => p.id === (replanning!.replace ?? plan?.id)));
  async function confirmReplan() {
    const r = replanning!;
    if (r.how === "changed" && !r.briefReady) return editBrief(source?.brief ?? view.brief);
    replanning = null;
    await build(r.replace, r.briefReady ? { brief: $state.snapshot(draft) } : { from: source?.id });
  }

  async function edit(fn: () => Promise<PlanView>) {
    const next = await attempt(fn);
    if (next) onview(next);
  }

  const actions = (lesson: Lesson): MenuItem[] => {
    const siblings = plan!.lessons.filter((l) => l.unitId === lesson.unitId);
    const at = siblings.indexOf(lesson);
    const next = siblings[at + 1];
    return [
      { label: "Rename", icon: "pencil", run: () => (renaming = { id: lesson.id, title: lesson.title }) },
      ...(at > 0 ? [{ label: "Move earlier", icon: "arrow-up", run: () => edit(() => api.updateLesson(lesson.id, { move: { unitId: lesson.unitId, index: at - 1 } })) }] : []),
      ...(next ? [{ label: "Move later", icon: "chevron-down", run: () => edit(() => api.updateLesson(lesson.id, { move: { unitId: lesson.unitId, index: at + 1 } })) }] : []),
      ...(lesson.items.length > 1 ? [{ label: "Split in two", icon: "layers", run: () => edit(() => api.splitLesson(lesson.id, Math.ceil(lesson.items.length / 2))) }] : []),
      ...(next ? [{ label: "Merge with next", icon: "layers", run: () => edit(() => api.mergeLesson(lesson.id)) }] : []),
      ...(lesson.status !== "done" ? [
        { label: "Mark done", icon: "check", run: () => edit(() => api.updateLesson(lesson.id, { status: "done" })) },
        { label: "I know this already", icon: "check", run: () => edit(() => api.knowLesson(lesson.id)) },
      ] : [{ label: "Mark not done", icon: "refresh", run: () => edit(() => api.updateLesson(lesson.id, { status: "todo" })) }]),
    ];
  };
  const meta = (l: Lesson) => [
    plural(l.items.length, "item"), `${l.minutes} min`,
    ...(l.kind === "project" ? ["project"] : []),
    ...(l.weight > 1 ? [l.weight === 3 ? "often examined" : "examined"] : []),
    ...(l.aids.length ? [`${l.aids.map((a) => AIDS[a]).join(", ")} suggested`] : []),
    ...(l.status === "in_progress" ? ["in progress"] : []),
    ...(l.scheduledFor && l.status !== "done" ? [dayLabel(l.scheduledFor)] : []),
  ].join(" · ");
</script>

{#snippet startButton(lesson: Lesson)}
  {#if lesson.status === "done"}
    <span class="status status--done"><i></i>Done</span>
  {:else}
    {@const now = states.get(lesson.id) === "current"}
    <button type="button" class="btn btn--sm" class:btn--accent={now} class:btn--ghost={!now} onclick={() => startLesson(lesson.id)}>
      {#if now}<Icon name="play" size="sm" />{/if}{lesson.status === "in_progress" ? "Continue" : "Start"}
    </button>
  {/if}
{/snippet}

{#if !plan}
  {#if view.job}
    <div class="ws__empty"><span class="drop drop--lg drop--pulse"></span><p>Building the plan. Lessons appear when every item in the ledger has a place.</p></div>
  {:else}
    <section class="panel brief-card">
      <header class="brief-card__head">
        <p class="eyebrow">Study brief</p>
        <h2 class="heading-lg">What is this plan for?</h2>
        <p class="body-sm muted">Every field has a default. Change what matters, or describe it in a sentence and let Distil fill it in.</p>
      </header>
      <BriefForm {folderId} bind:brief={draft.brief} bind:kind={draft.kind} bind:unanswered />
      <footer class="brief-card__foot">
        <span class="caption faint spacer">
          {#if draft.kind === "course" && !inScope}Distil the materials first: a course plan is built from the ledger.{:else if draft.kind === "course"}{inScope} items will each get a place in a lesson.{:else}A skill plan adds hands-on projects.{/if}
        </span>
        <button type="button" class="btn btn--accent" disabled={busy || !draft.brief.goal.trim() || (draft.kind === "course" && !inScope)} onclick={firstPlan}>
          <Icon name="wand" size="sm" />{unanswered ? "Just go" : "Build plan"}
        </button>
      </footer>
    </section>
  {/if}
{:else}
  <div class="plan__bar">
    <Segmented label="Plan view" value={mode} onchange={(v) => (mode = v)} options={[{ value: "map", label: "Map" }, { value: "outline", label: "Outline" }]} />
    <span class="caption faint">{summary}</span>
    <span class="spacer"></span>
    {#if schedule}
      <Select compact label="Revision days" tip="Days before the exam kept for revision and a mock exam" value={String(plan.schedule.bufferDays)}
        onchange={(v) => edit(() => api.setBufferDays(folderId, Number(v)))}
        options={[0, 1, 2, 3, 4].map((n) => ({ value: String(n), label: n ? `${n} revision ${n === 1 ? "day" : "days"}` : "No revision days" }))} />
    {/if}
    {#if view.saved.length > 1}
      <Select compact label="Saved plans" tip="Switch to another saved plan; its brief comes back with it" value={plan.id}
        onchange={(id) => edit(() => api.activatePlan(folderId, id))}
        options={view.saved.map((p) => ({ value: p.id, label: `${planName(p)} · ${p.lessons} lessons` }))} />
    {/if}
    <button type="button" class="btn btn--secondary btn--sm" onclick={() => editBrief()}><Icon name="sliders" size="sm" />Edit brief</button>
    <Menu label="More plan actions" items={[
      { label: "Re-plan", icon: "refresh", run: () => (replanning = { how: "same", replace: full ? oldest() : null, briefReady: false }) },
      ...(view.saved.length > 1 ? [{ label: "Saved plans", icon: "layers", run: () => (managing = true) }] : []),
      { label: "Export as Markdown", icon: "download", run: () => (location.href = api.exportUrl(folderId, "md")) },
      ...(schedule ? [{ label: "Export to calendar", icon: "download", run: () => (location.href = api.exportUrl(folderId, "ics")) }] : []),
    ]} />
  </div>

  {#if view.job}
    <p class="plan__note caption"><span class="drop drop--pulse"></span>Re-planning. The current plan stays until the new one is complete.</p>
  {:else if view.coverage.unmapped.length}
    <p class="plan__note caption">
      <Icon name="warning" size="sm" />{view.coverage.unmapped.length} {view.coverage.unmapped.length === 1 ? "item isn't" : "items aren't"} in a lesson yet.
      <button type="button" class="btn btn--ghost btn--sm" onclick={() => attempt(() => api.extendPlan(folderId)).then((j) => j && onchange())}>Plan them</button>
    </p>
  {/if}

  {#if schedule}
    <p class="plan__note caption faint">
      Deadline mode · {hours(schedule.settings.hoursPerDay * 60)} a day · exam {longDate(schedule.settings.examDate)}{#if schedule.note} · {schedule.note}{/if}
    </p>
    {#if schedule.examPassed}
      <p class="plan__note caption"><Icon name="warning" size="sm" />The exam date has passed. Set a new one in the brief to schedule what's left.</p>
    {:else if schedule.overloaded}
      <p class="plan__note caption"><Icon name="warning" size="sm" />{hours(schedule.settings.hoursPerDay * 60)} a day isn't enough to finish in time, so study days hold about {hours(schedule.capacity)}.</p>
    {/if}
    <div class="sched" aria-label="Schedule" use:wheelScroll>
      {#each schedule.days as day (day.date)}
        <button type="button" class="sched__day" class:is-past={day.date < todayKey} class:is-today={day.date === todayKey} class:is-exam={day.kind === "exam"}
          class:is-picked={dayFilter === day.date} aria-pressed={dayFilter === day.date} aria-disabled={!day.lessons.length}
          onclick={() => { if (day.lessons.length) dayFilter = dayFilter === day.date ? "" : day.date; }}
          data-tip={day.kind === "exam" ? "Exam" : day.kind === "mock" ? "Mock exam" : day.kind === "revision" ? "Revision" : day.kind === "off" ? "Day off" : day.lessons.map((id) => titleOf.get(id)).join(" · ") || "Free"}>
          <span class="eyebrow">{dayLabel(day.date)}</span>
          {#if day.kind === "exam"}<span class="drop"></span>
          {:else}<i class:is-now={day.date === todayKey} class:is-mock={day.kind === "mock"} class:is-rev={day.kind === "revision"} class:is-off={day.kind === "off" || (day.kind === "study" && !day.minutes)}
            style:--w={day.kind === "study" ? Math.min(3, Math.max(0.3, day.minutes / 60)) : 1.5}></i>{/if}
        </button>
      {/each}
    </div>
  {/if}

  <div class="plan__filters">
    <input class="input" type="search" placeholder="Find a lesson or item…" aria-label="Find a lesson or item" bind:value={query} />
    <Select label="Unit" tip="Show one unit" value={unitFilter} onchange={(v) => (unitFilter = v)}
      options={[{ value: "", label: "All units" }, ...plan.units.map((u, i) => ({ value: u.id, label: `${i + 1} · ${u.title}` }))]} />
    {#if dayOptions.length}
      <Select label="Day" tip="Show one day's lessons" value={dayFilter} onchange={(v) => (dayFilter = v)}
        options={[{ value: "", label: "All days" }, ...dayOptions]} />
    {/if}
    {#if matches}
      <span class="caption faint">{matches.size} of {plural(plan.lessons.length, "lesson")}</span>
      <button type="button" class="btn btn--ghost btn--sm" onclick={clearFilters}><Icon name="x" size="sm" />Clear</button>
    {/if}
  </div>

  {#if mode === "map"}
    <PlanMap {plan} {states} {selected} {matches} onselect={(id) => (selected = selected === id ? null : id)} />
  {:else if matches && !matches.size}
    <p class="ws__empty">No lessons match.</p>
  {:else}
    <ol class="outline">
      {#each plan.units as unit, u (unit.id)}
        {@const lessons = plan.lessons.filter((l) => l.unitId === unit.id && (!matches || matches.has(l.id)))}
        {@const count = lessons.reduce((n, l) => n + l.items.length, 0)}
        {#if lessons.length}
          <li class="outline__unit">
            <span class="eyebrow">Unit {u + 1} · {unit.title}</span>
            <span class="caption faint">{plural(count, "item")}{lessons.every((l) => l.status === "done") ? " · done" : ""}</span>
          </li>
          {#each lessons as lesson (lesson.id)}
            <li class="outline__lesson is-{states.get(lesson.id)}" class:is-selected={selected === lesson.id && states.get(lesson.id) !== "current"}>
              <span class="num mono">L{lessonNo.get(lesson.id)}</span>
              <div>
                <button type="button" class="outline__title" aria-expanded={selected === lesson.id} onclick={() => (selected = selected === lesson.id ? null : lesson.id)}>
                  <Icon name={selected === lesson.id ? "chevron-down" : "chevron-right"} size="sm" /><strong>{lesson.title}</strong>
                </button>
                <span class="caption muted">{meta(lesson)}</span>
              </div>
              <div class="outline__actions">{@render startButton(lesson)}<Menu label="Actions for {lesson.title}" items={actions(lesson)} /></div>
            </li>
            {#if selected === lesson.id}<li class="outline__detail">{@render detail(lesson, false)}</li>{/if}
          {/each}
        {/if}
      {/each}
    </ol>
  {/if}

  {#if mode === "map" && chosen}
    <section class="panel lesson-card">{@render detail(chosen, true)}</section>
  {/if}
{/if}

<!-- A lesson's details. head: its title and actions, left out under an outline row that already shows them. -->
{#snippet detail(lesson: Lesson, head: boolean)}
  {#if head}
    {@const unit = plan!.units.find((u) => u.id === lesson.unitId)}
    <div class="lesson-card__head">
      <div>
        <p class="eyebrow">{unit?.title} · Lesson {lessonNo.get(lesson.id)} of {plan!.lessons.length}</p>
        <h3 class="heading-md">{lesson.title}</h3>
      </div>
      <div class="outline__actions">{@render startButton(lesson)}<Menu label="Actions for {lesson.title}" items={actions(lesson)} /></div>
    </div>
    <p class="caption muted">{meta(lesson)}</p>
  {/if}
  {#if lesson.summary}<p class="body-sm">{lesson.summary}</p>{/if}
  {#if lesson.requires.length}
    <p class="caption">After: {lesson.requires.map((id) => titleOf.get(id)).join(" · ")}</p>
  {/if}
  <ul class="lesson-card__items">
    {#each lesson.items as id (id)}
      {@const item = itemById.get(id)}
      {#if item}<li><span class="chip">{item.type}</span><span>{item.title}</span>{#if item.status !== "pending" && item.status !== "planned"}<span class="status status--{item.status}"><i></i>{item.status}</span>{/if}</li>{/if}
    {/each}
  </ul>
{/snippet}

<Dialog bind:open={() => editingBrief, (v) => { if (!v) { editingBrief = false; replanning = null; } }} wide eyebrow="Study brief"
  title={replanning ? "The brief for the new plan" : "What this plan is built for"}>
  <BriefForm {folderId} bind:brief={draft.brief} bind:kind={draft.kind} />
  {#snippet footer()}
    {#if replanning}
      <span class="caption faint dialog__note">The current plan keeps its own brief; you can switch back to it.</span>
      <button type="button" class="btn btn--ghost" onclick={() => { editingBrief = false; replanning = null; }}>Cancel</button>
      <button type="button" class="btn btn--primary" disabled={busy || !draft.brief.goal.trim()} onclick={replanWithDraft}>Re-plan with this brief</button>
    {:else}
      <span class="caption faint dialog__note">Dates and hours re-schedule this plan. A new goal, scope or depth needs a re-plan.</span>
      <button type="button" class="btn btn--ghost" onclick={() => (editingBrief = false)}>Cancel</button>
      <button type="button" class="btn btn--secondary" disabled={busy || !draft.brief.goal.trim()} onclick={saveBrief}>Save</button>
      <button type="button" class="btn btn--primary" disabled={busy || !draft.brief.goal.trim()} onclick={replanWithDraft}>Save and re-plan</button>
    {/if}
  {/snippet}
</Dialog>

<Dialog bind:open={() => !!replanning && !editingBrief, (v) => { if (!v) replanning = null; }} eyebrow="Re-plan" title="Make a new plan">
  {#if replanning}
    {#if !replanning.briefReady}
      <div class="choices" role="radiogroup" aria-label="Brief for the new plan">
        <label class="choice">
          <input type="radio" name="how" value="same" bind:group={replanning.how} />
          <span><strong>Same brief</strong><span class="caption muted">
            {source?.brief ? `Reuse "${source.brief.brief.goal}"${source.status === "active" ? "" : ` from the ${planName(source).toLowerCase()}`}.` : "Reuse the current brief."}
          </span></span>
        </label>
        <label class="choice">
          <input type="radio" name="how" value="changed" bind:group={replanning.how} />
          <span><strong>Change the brief</strong><span class="caption muted">Edit the goal, dates or depth first, then re-plan.</span></span>
        </label>
      </div>
    {/if}
    {#if full}
      <p class="body-sm">Distil keeps {MAX_PLANS} plans. Which one should the new plan replace? It is deleted once the new plan is ready.</p>
      <div class="choices" role="radiogroup" aria-label="Plan to replace">
        {#each view.saved as p (p.id)}
          <label class="choice">
            <input type="radio" name="replace" value={p.id} bind:group={replanning.replace} />
            <span><strong>{planName(p)}{p.status === "active" ? " · active" : ""}</strong>
              <span class="caption muted">{p.brief ? `${p.brief.brief.goal} · ` : ""}{p.lessons} lessons · {p.done} done</span></span>
          </label>
        {/each}
      </div>
    {/if}
  {/if}
  {#snippet footer()}
    <button type="button" class="btn btn--ghost" onclick={() => (replanning = null)}>Cancel</button>
    <button type="button" class="btn btn--primary" disabled={busy || (full && !replanning?.replace)} onclick={confirmReplan}>
      {replanning?.how === "changed" && !replanning.briefReady ? "Next: edit the brief" : "Re-plan"}
    </button>
  {/snippet}
</Dialog>

<Dialog bind:open={managing} eyebrow="Saved plans" title="Your saved plans">
  <p class="body-sm muted">Distil keeps up to {MAX_PLANS} plans, each with the brief it was built from. Progress is shared: what you've been taught counts in each of them.</p>
  <ul class="saved">
    {#each view.saved as p (p.id)}
      <li>
        <div class="saved__text">
          <strong>{planName(p)}</strong>
          <span class="caption muted">{p.brief ? `${p.brief.brief.goal} · ` : ""}{plural(p.units, "unit")} · {p.lessons} lessons · {p.done} done</span>
        </div>
        {#if p.status === "active"}<span class="status status--done"><i></i>Active</span>
        {:else}
          <button type="button" class="btn btn--ghost btn--sm" onclick={() => edit(() => api.activatePlan(folderId, p.id))}>Switch to</button>
          <button type="button" class="btn btn--ghost btn--sm btn--icon" aria-label="Delete {planName(p)}" data-tip="Delete" onclick={() => edit(() => api.deletePlan(folderId, p.id))}><Icon name="trash" size="sm" /></button>
        {/if}
      </li>
    {/each}
  </ul>
  {#snippet footer()}
    <button type="button" class="btn btn--primary" onclick={() => (managing = false)}>Done</button>
  {/snippet}
</Dialog>

<Dialog bind:open={() => !!renaming, (v) => { if (!v) renaming = null; }} eyebrow="Lesson" title="Rename lesson">
  {#if renaming}
    <form id="rename-lesson" onsubmit={(e) => { e.preventDefault(); const r = renaming!; renaming = null; edit(() => api.updateLesson(r.id, { title: r.title })); }}>
      <input class="input" bind:value={renaming.title} maxlength="200" required aria-label="Lesson title" />
    </form>
  {/if}
  {#snippet footer()}
    <button type="button" class="btn btn--ghost" onclick={() => (renaming = null)}>Cancel</button>
    <button type="submit" form="rename-lesson" class="btn btn--primary" disabled={!renaming?.title.trim()}>Rename</button>
  {/snippet}
</Dialog>

<style>
  .brief-card { display: grid; gap: var(--s-5); padding: var(--s-6); }
  .brief-card__head { display: grid; gap: var(--s-2); }
  .brief-card__foot { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); padding-top: var(--s-4); border-top: 1px solid var(--border); }
  .brief-card__foot .spacer { flex: 1; min-width: 200px; }
  .choices { display: grid; gap: var(--s-2); }
  .choice { display: flex; gap: var(--s-3); align-items: start; padding: var(--s-3); border: 1px solid var(--border); border-radius: var(--r-sm); cursor: pointer; }
  .choice:has(input:checked) { border-color: var(--accent); background: var(--accent-wash); }
  .choice > span { display: grid; gap: 2px; min-width: 0; }
  .choice input { accent-color: var(--accent); margin-top: 3px; }
  .saved { list-style: none; padding: 0; margin: 0; display: grid; }
  .saved li { display: flex; align-items: center; gap: var(--s-2); padding: var(--s-3) 0; border-bottom: 1px solid var(--border); }
  .saved__text { flex: 1; display: grid; min-width: 0; }
  .outline__title { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; overflow-wrap: anywhere; }
  .outline__title :global(svg) { color: var(--text-faint); flex: none; }
  .outline__title:hover strong, .outline__title:focus-visible strong { text-decoration: underline; text-underline-offset: 3px; }
  .outline__detail { padding: var(--s-2) 0 var(--s-4) 74px; border-bottom: 1px solid var(--border); display: grid; gap: var(--s-2); }
  .lesson-card { display: grid; gap: var(--s-2); margin-top: var(--s-4); padding: var(--s-5); }
  .lesson-card__head { display: flex; justify-content: space-between; align-items: start; gap: var(--s-3); }
  .lesson-card__items { list-style: none; padding: 0; margin: var(--s-1) 0 0; display: grid; gap: 2px; max-height: 320px; overflow: auto; }
  .lesson-card__items li { display: flex; align-items: center; gap: var(--s-2); font-size: var(--t-body-sm); padding: 4px 0; border-bottom: 1px solid var(--border); }
  .lesson-card__items li > span:nth-child(2) { flex: 1; min-width: 0; }
  @media (max-width: 640px) { .outline__detail { padding-left: 0; } }
</style>
