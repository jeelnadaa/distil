<script lang="ts" module>
  import type { Lesson, Plan } from "../lib/api.ts";

  export type LessonState = "done" | "current" | "next" | "upcoming";

  // Done, the one lesson to do now (the first started one, else the first unlocked one), the other unlocked
  // ones, and the rest.
  export function lessonStates(plan: Plan): Map<string, LessonState> {
    const status = new Map(plan.lessons.map((l) => [l.id, l.status]));
    const unlocked = (l: Lesson) => l.status !== "done" && l.requires.every((r) => status.get(r) === "done");
    const current = plan.lessons.find((l) => l.status === "in_progress") ?? plan.lessons.find(unlocked);
    return new Map(plan.lessons.map((l) => [l.id,
      l.status === "done" ? "done" : l === current ? "current" : unlocked(l) ? "next" : "upcoming"]));
  }
</script>

<script lang="ts">
  import { glide } from "../lib/prefs.ts";
  import { wheelScroll } from "../lib/wheel.ts";

  // matches: lessons that pass the Plan tab's filters (the rest are dimmed), or null for no filter.
  let { plan, states, selected, matches, onselect }: {
    plan: Plan; states: Map<string, LessonState>; selected: string | null; matches: Set<string> | null; onselect: (id: string) => void;
  } = $props();

  // Left-to-right layering: a lesson sits one column right of its latest prerequisite in the same unit,
  // and a column taller than MAX_ROWS wraps into the next one. Each unit is a shaded band with its title.
  const W = 184, H = 40, COL = 56, ROW = 14, PAD = 18, BAND_GAP = 14, TOP = 72, MAX_ROWS = 6, TITLE_CHARS = 21;

  const layout = $derived.by(() => {
    const pos = new Map<string, { x: number; y: number }>();
    const units: { title: string; x: number; width: number }[] = [];
    let x = PAD + 2;
    let rows = 0;
    for (const unit of plan.units) {
      const lessons = plan.lessons.filter((l) => l.unitId === unit.id);
      if (!lessons.length) continue;
      const level = new Map<string, number>();
      for (const l of lessons) level.set(l.id, Math.max(0, ...l.requires.map((r) => (level.has(r) ? level.get(r)! + 1 : 0))));
      const columns: string[][] = [];
      for (let lv = 0; lv <= Math.max(...level.values()); lv++) {
        const here = lessons.filter((l) => level.get(l.id) === lv).map((l) => l.id);
        for (let i = 0; i < here.length; i += MAX_ROWS) columns.push(here.slice(i, i + MAX_ROWS));
      }
      const start = x;
      for (const col of columns) {
        col.forEach((id, row) => pos.set(id, { x, y: TOP + row * (H + ROW) }));
        rows = Math.max(rows, col.length);
        x += W + COL;
      }
      const end = x - COL;
      units.push({ title: unit.title, x: start - PAD, width: end - start + 2 * PAD });
      x = end + PAD + BAND_GAP + PAD;
    }
    const edges = plan.lessons.flatMap((l) => l.requires.filter((r) => pos.has(r) && pos.has(l.id)).map((r) => {
      const a = pos.get(r)!, b = pos.get(l.id)!;
      const mid = b.x - COL / 2;
      return { from: r, to: l.id, d: `M${a.x + W} ${a.y + H / 2} H${mid} V${b.y + H / 2} H${b.x}` };
    }));
    const last = units.at(-1);
    return { pos, units, edges, width: last ? last.x + last.width + 2 : 200, height: TOP + rows * (H + ROW) + PAD - ROW + 6 };
  });

  const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
  const dim = (id: string) => !!matches && !matches.has(id);
  const press = (id: string) => (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onselect(id); } };

  // A filter brings its first lesson into view.
  let scroller = $state<HTMLElement>();
  $effect(() => {
    const first = matches && plan.lessons.find((l) => matches.has(l.id));
    const p = first && layout.pos.get(first.id);
    if (p) scroller?.scrollTo({ left: Math.max(0, p.x - PAD - 24), behavior: glide() });
  });
</script>

<div class="plan-map panel" use:wheelScroll={".plan-map__scroll"}>
  <div class="plan-map__scroll" bind:this={scroller}>
    <svg class="pmap" width={layout.width} height={layout.height} viewBox="0 0 {layout.width} {layout.height}" role="group" aria-label="Lesson map">
      <g class="pmap__units">
        {#each layout.units as unit, i (i)}
          <g class:is-alt={i % 2 === 1}>
            <title>Unit {i + 1}: {unit.title}</title>
            <rect x={unit.x} y="4" width={unit.width} height={layout.height - 8} rx="12" />
            <text class="pmap__unit-no" x={unit.x + PAD} y="30">UNIT {i + 1}</text>
            <text class="pmap__unit-title" x={unit.x + PAD} y="50">{clip(unit.title, Math.floor((unit.width - 2 * PAD) / 7.4))}</text>
          </g>
        {/each}
      </g>
      <g class="pmap__edges">
        {#each layout.edges as e, i (i)}<path d={e.d} class:is-dim={dim(e.from) || dim(e.to)} />{/each}
      </g>
      <g class="pmap__nodes">
        {#each plan.lessons as lesson (lesson.id)}
          {@const p = layout.pos.get(lesson.id)}
          {#if p}
            <g class="is-{states.get(lesson.id)}" class:is-project={lesson.kind === "project"} class:is-dim={dim(lesson.id)} role="button" tabindex="0"
              aria-label="{lesson.title}, {states.get(lesson.id)}" aria-pressed={selected === lesson.id}
              onclick={() => onselect(lesson.id)} onkeydown={press(lesson.id)}>
              <title>{lesson.title}</title>
              <rect x={p.x} y={p.y} width={W} height={H} rx="8" style:stroke={selected === lesson.id ? "var(--accent)" : undefined} />
              <text x={p.x + 14} y={p.y + 25}>{clip(lesson.title, TITLE_CHARS)}</text>
              <text class="count" x={p.x + W - 10} y={p.y + 25}>{lesson.items.length}</text>
              {#if states.get(lesson.id) === "current"}<circle cx={p.x + W} cy={p.y} r="6" />{/if}
            </g>
          {/if}
        {/each}
      </g>
    </svg>
  </div>
  <div class="pmap__legend caption muted">
    <span><i class="lg lg--done"></i>Done</span><span><i class="lg lg--current"></i>Current</span><span><i class="lg lg--next"></i>Next</span><span><i class="lg"></i>Upcoming</span>
    <span class="spacer"></span><span class="mono">numbers = items per lesson · scroll to move along</span>
  </div>
</div>
