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
  let { plan, states, selected, onselect }: {
    plan: Plan; states: Map<string, LessonState>; selected: string | null; onselect: (id: string) => void;
  } = $props();

  // Left-to-right layering: a lesson sits one column right of its latest prerequisite in the same unit,
  // units follow each other, and a column taller than MAX_ROWS wraps into the next one.
  const W = 184, H = 40, COL = 56, ROW = 14, UNIT_GAP = 72, TOP = 48, MAX_ROWS = 6, TITLE_CHARS = 21;

  const layout = $derived.by(() => {
    const pos = new Map<string, { x: number; y: number }>();
    const units: { title: string; x: number; end: number }[] = [];
    let x = 20;
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
      units.push({ title: unit.title, x: start, end: x - COL });
      x += UNIT_GAP - COL;
    }
    const edges = plan.lessons.flatMap((l) => l.requires.filter((r) => pos.has(r) && pos.has(l.id)).map((r) => {
      const a = pos.get(r)!, b = pos.get(l.id)!;
      const mid = b.x - COL / 2;
      return `M${a.x + W} ${a.y + H / 2} H${mid} V${b.y + H / 2} H${b.x}`;
    }));
    return { pos, units, edges, width: x - UNIT_GAP + 20, height: TOP + rows * (H + ROW) + 4 };
  });

  const short = (t: string) => (t.length > TITLE_CHARS ? `${t.slice(0, TITLE_CHARS - 1).trimEnd()}…` : t);
  const press = (id: string) => (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onselect(id); } };
</script>

<div class="plan-map panel">
  <div class="plan-map__scroll">
    <svg class="pmap" width={layout.width} height={layout.height} viewBox="0 0 {layout.width} {layout.height}" role="group" aria-label="Lesson map">
      <g class="pmap__units">
        {#each layout.units as unit, i (i)}
          <text x={unit.x} y="26">UNIT {i + 1} · {short(unit.title).toUpperCase()}</text>
          {#if i}<line x1={unit.x - UNIT_GAP / 2} y1="14" x2={unit.x - UNIT_GAP / 2} y2={layout.height - 4} />{/if}
        {/each}
      </g>
      <g class="pmap__edges">
        {#each layout.edges as d, i (i)}<path {d} />{/each}
      </g>
      <g class="pmap__nodes">
        {#each plan.lessons as lesson (lesson.id)}
          {@const p = layout.pos.get(lesson.id)}
          {#if p}
            <g class="is-{states.get(lesson.id)}" class:is-project={lesson.kind === "project"} role="button" tabindex="0"
              aria-label="{lesson.title}, {states.get(lesson.id)}" aria-pressed={selected === lesson.id}
              onclick={() => onselect(lesson.id)} onkeydown={press(lesson.id)}>
              <title>{lesson.title}</title>
              <rect x={p.x} y={p.y} width={W} height={H} rx="8" style:stroke={selected === lesson.id ? "var(--accent)" : undefined} />
              <text x={p.x + 14} y={p.y + 25}>{short(lesson.title)}</text>
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
    <span class="spacer"></span><span class="mono">numbers = items per lesson</span>
  </div>
</div>
