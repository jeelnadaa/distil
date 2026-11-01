<script lang="ts">
  import { untrack } from "svelte";
  import { api, localDay, type Brief, type Item, type Lesson, type PlanKind, type PlanView } from "../lib/api.ts";
  import { attempt, startLesson, toast } from "../lib/state.svelte.ts";
  import BriefForm from "./BriefForm.svelte";
  import Dialog from "./Dialog.svelte";
  import Icon from "./Icon.svelte";
  import Menu, { type MenuItem } from "./Menu.svelte";
  import PlanMap, { lessonStates } from "./PlanMap.svelte";
  import Segmented from "./Segmented.svelte";
  import Select from "./Select.svelte";

  // The Plan tab (S5, F-501…F-510): the brief card until there is a plan, then the plan as a map or an
  // outline, with the deadline strip above it and edits that keep prerequisites in order.
  let { folderId, folderName, view, items, onview, onchange }: {
    folderId: string; folderName: string; view: PlanView; items: Item[]; onview: (v: PlanView) => void; onchange: () => void;
  } = $props();

  const AIDS: Record<string, string> = { diagram: "diagram", simulation: "simulation", practice: "practice", example: "worked example" };
  const defaults = (): Brief => ({ goal: `Learn ${folderName}`, scope: "", level: "", depth: "standard", deadline: null, hoursPerDay: null, daysOff: [], assessment: "", language: "English" });

  let mode = $state<"map" | "outline">(innerWidth < 700 ? "outline" : "map");
  let selected = $state<string | null>(null);
  // The brief card starts from the stored brief; later edits go through openBrief().
  let draft = $state<{ brief: Brief; kind: PlanKind }>(untrack(() => ({ brief: view.brief?.brief ?? defaults(), kind: view.brief?.kind ?? "course" })));
  let unanswered = $state(0);
  let editingBrief = $state(false);
  let renaming = $state<{ id: string; title: string } | null>(null);
  let busy = $state(false);

  const plan = $derived(view.plan);
  const schedule = $derived(view.schedule);
  const states = $derived(plan ? lessonStates(plan) : new Map());
  const itemById = $derived(new Map(items.map((i) => [i.id, i])));
  const lessonNo = $derived(new Map(plan?.lessons.map((l, i) => [l.id, i + 1]) ?? []));
  const chosen = $derived(plan?.lessons.find((l) => l.id === selected) ?? null);
  const inScope = $derived(items.filter((i) => !i.mark).length);
  const todayKey = localDay();
  const titleOf = $derived(new Map(plan?.lessons.map((l) => [l.id, l.title]) ?? []));

  const dayLabel = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
  const longDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const hours = (minutes: number) => (minutes >= 60 ? `${+(minutes / 60).toFixed(1)} h` : `${minutes} min`);

  const summary = $derived(plan ? [
    `${plan.lessons.length} ${plan.lessons.length === 1 ? "lesson" : "lessons"}`,
    `${plan.units.length} ${plan.units.length === 1 ? "unit" : "units"}`,
    `${view.coverage.planned} of ${view.coverage.total} items planned`,
    ...(schedule ? [`${schedule.days.filter((d) => d.date >= todayKey && d.kind === "study").length} study days left`] : []),
  ].join(" · ") : "");

  async function saveBrief(rebuild: boolean) {
    busy = true;
    const saved = await attempt(() => api.saveBrief(folderId, draft.brief, draft.kind));
    const started = saved && (!rebuild || (await attempt(() => api.buildPlan(folderId))));
    busy = false;
    if (!saved) return;
    editingBrief = false;
    if (started && rebuild) toast("Planning. Lessons appear when every item has a place.");
    onchange();
  }
  async function edit(fn: () => Promise<PlanView>) {
    const next = await attempt(fn);
    if (next) onview(next);
  }
  function openBrief() {
    draft = { brief: $state.snapshot(view.brief?.brief) ?? defaults(), kind: view.brief?.kind ?? "course" };
    editingBrief = true;
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
    `${l.items.length} ${l.items.length === 1 ? "item" : "items"}`, `${l.minutes} min`,
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
        <button type="button" class="btn btn--accent" disabled={busy || !draft.brief.goal.trim() || (draft.kind === "course" && !inScope)} onclick={() => saveBrief(true)}>
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
    <button type="button" class="btn btn--secondary btn--sm" onclick={openBrief}><Icon name="sliders" size="sm" />Edit brief</button>
    <Menu label="More plan actions" items={[
      { label: "Export as Markdown", icon: "download", run: () => (location.href = api.exportUrl(folderId, "md")) },
      ...(schedule ? [{ label: "Export to calendar", icon: "download", run: () => (location.href = api.exportUrl(folderId, "ics")) }] : []),
      { label: "Rebuild plan", icon: "refresh", run: () => attempt(() => api.buildPlan(folderId)).then((j) => j && onchange()) },
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
    <div class="sched" aria-label="Schedule">
      {#each schedule.days as day (day.date)}
        <div class="sched__day" class:is-past={day.date < todayKey} class:is-today={day.date === todayKey} class:is-exam={day.kind === "exam"}
          data-tip={day.kind === "exam" ? "Exam" : day.kind === "mock" ? "Mock exam" : day.kind === "revision" ? "Revision" : day.kind === "off" ? "Day off" : day.lessons.map((id) => titleOf.get(id)).join(" · ") || "Free"}>
          <span class="eyebrow">{dayLabel(day.date)}</span>
          {#if day.kind === "exam"}<span class="drop"></span>
          {:else}<i class:is-now={day.date === todayKey} class:is-mock={day.kind === "mock"} class:is-rev={day.kind === "revision"} class:is-off={day.kind === "off" || (day.kind === "study" && !day.minutes)}
            style:--w={day.kind === "study" ? Math.min(3, Math.max(0.3, day.minutes / 60)) : 1.5}></i>{/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if mode === "map"}
    <PlanMap {plan} {states} {selected} onselect={(id) => (selected = selected === id ? null : id)} />
  {:else}
    <ol class="outline">
      {#each plan.units as unit, u (unit.id)}
        {@const lessons = plan.lessons.filter((l) => l.unitId === unit.id)}
        {@const count = lessons.reduce((n, l) => n + l.items.length, 0)}
        <li class="outline__unit">
          <span class="eyebrow">Unit {u + 1} · {unit.title}</span>
          <span class="caption faint">{count} {count === 1 ? "item" : "items"}{lessons.every((l) => l.status === "done") ? " · done" : ""}</span>
        </li>
        {#each lessons as lesson (lesson.id)}
          <li class="outline__lesson is-{states.get(lesson.id)}" class:is-selected={selected === lesson.id && states.get(lesson.id) !== "current"}>
            <span class="num mono">L{lessonNo.get(lesson.id)}</span>
            <div>
              <button type="button" class="outline__title" onclick={() => (selected = selected === lesson.id ? null : lesson.id)}><strong>{lesson.title}</strong></button>
              <span class="caption muted">{meta(lesson)}</span>
            </div>
            <div class="outline__actions">{@render startButton(lesson)}<Menu label="Actions for {lesson.title}" items={actions(lesson)} /></div>
          </li>
          {#if selected === lesson.id}<li class="outline__detail">{@render detail(lesson)}</li>{/if}
        {/each}
      {/each}
    </ol>
  {/if}

  {#if mode === "map" && chosen}
    <section class="panel lesson-card">{@render detail(chosen)}</section>
  {/if}
{/if}

{#snippet detail(lesson: Lesson)}
  {@const unit = plan!.units.find((u) => u.id === lesson.unitId)}
  <div class="lesson-card__head">
    <div>
      <p class="eyebrow">{unit?.title} · Lesson {lessonNo.get(lesson.id)} of {plan!.lessons.length}</p>
      <h3 class="heading-md">{lesson.title}</h3>
    </div>
    <div class="outline__actions">{@render startButton(lesson)}<Menu label="Actions for {lesson.title}" items={actions(lesson)} /></div>
  </div>
  {#if lesson.summary}<p class="body-sm">{lesson.summary}</p>{/if}
  <p class="caption muted">{meta(lesson)}</p>
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

<Dialog bind:open={editingBrief} wide eyebrow="Study brief" title="What this plan is built for">
  <BriefForm {folderId} bind:brief={draft.brief} bind:kind={draft.kind} />
  {#snippet footer()}
    <span class="caption faint spacer">Dates and hours re-schedule the plan. Goal, scope and depth need a rebuild.</span>
    <button type="button" class="btn btn--ghost" onclick={() => (editingBrief = false)}>Cancel</button>
    <button type="button" class="btn btn--secondary" disabled={busy || !draft.brief.goal.trim()} onclick={() => saveBrief(false)}>Save</button>
    <button type="button" class="btn btn--primary" disabled={busy || !draft.brief.goal.trim()} onclick={() => saveBrief(true)}>Save and rebuild</button>
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
  .brief-card { display: grid; gap: var(--s-5); max-width: 760px; padding: var(--s-6); }
  .brief-card__head { display: grid; gap: var(--s-2); }
  .brief-card__foot { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); padding-top: var(--s-4); border-top: 1px solid var(--border); }
  .brief-card__foot .spacer { flex: 1; min-width: 200px; }
  .outline__title { all: unset; cursor: pointer; overflow-wrap: anywhere; }
  .outline__title:hover strong, .outline__title:focus-visible strong { text-decoration: underline; text-underline-offset: 3px; }
  .outline__detail { padding: var(--s-4) 0 var(--s-4) 52px; border-bottom: 1px solid var(--border); display: grid; gap: var(--s-2); }
  .lesson-card { display: grid; gap: var(--s-2); margin-top: var(--s-4); padding: var(--s-5); }
  .lesson-card__head { display: flex; justify-content: space-between; align-items: start; gap: var(--s-3); }
  .lesson-card__items { list-style: none; padding: 0; margin: var(--s-2) 0 0; display: grid; gap: 2px; max-height: 320px; overflow: auto; }
  .lesson-card__items li { display: flex; align-items: center; gap: var(--s-2); font-size: var(--t-body-sm); padding: 4px 0; border-bottom: 1px solid var(--border); }
  .lesson-card__items li > span:nth-child(2) { flex: 1; min-width: 0; }
  @media (max-width: 640px) { .outline__detail { padding-left: 0; } }
</style>
