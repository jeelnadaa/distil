<script lang="ts">
  import { api, localDay, type TodayLesson, type TodayView } from "../lib/api.ts";
  import { attempt, nav, startLesson } from "../lib/state.svelte.ts";
  import ActivityDock from "./ActivityDock.svelte";
  import CoverageBars from "./CoverageBars.svelte";
  import Icon from "./Icon.svelte";
  import SoundButton from "./SoundButton.svelte";

  // Today (S1, F-506): today's lessons from every subject with a plan, cards due, where practice would help
  // most, each subject's coverage and the week ahead of the nearest exam.
  let today = $state<TodayView | null>(null);
  $effect(() => { attempt(api.today).then((v) => { if (v) today = v; }); });

  const date = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, o);
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  const first = $derived(today?.lessons[0] ?? today?.later[0] ?? null);
  const after = $derived(today ? [...today.lessons, ...today.later].filter((l) => l !== first).slice(0, 3) : []);
  const minutes = $derived(today?.lessons.reduce((n, l) => n + l.minutes, 0) ?? 0);
  const where = (l: TodayLesson) => `${l.folderName} · ${l.unit}`;
</script>

<header class="topbar">
  <button type="button" class="btn btn--ghost btn--icon btn--sm topbar__menu" aria-label="Open menu" onclick={() => (nav.sidebarOpen = true)}><Icon name="sidebar" size="sm" /></button>
  <nav class="topbar__crumb" aria-label="Location"><strong>Today</strong></nav>
  <span class="topbar__spacer"></span>
  <SoundButton />
  <ActivityDock />
</header>

<div class="scroll">
  {#if today}
    <div class="page page--wide today">
      <header class="today__head">
        <p class="eyebrow">{date(today.date, { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1 class="display-lg">
          {#if today.exam && today.exam.daysLeft === 0}The deadline for <em>{today.exam.name}</em> is today.
          {:else if today.exam && today.exam.daysLeft < 7}{today.exam.daysLeft === 1 ? "Tomorrow" : date(today.exam.date, { weekday: "long" })} is the deadline for <em>{today.exam.name}</em>.
          {:else if today.exam}<em>{today.exam.name}</em>: {today.exam.daysLeft} days to go.
          {:else if first}Pick up where you left off.
          {:else}Nothing planned yet.{/if}
        </h1>
        <p class="body-lg muted">
          {#if today.lessons.length}{plural(today.lessons.length, "lesson")} today, about {minutes} min{today.exam ? ", keeps you on schedule" : ""}.{:else if first}Nothing is scheduled for today. Start the next lesson if you have time.{:else}Open a folder, distil its materials, then build a plan in its Plan tab.{/if}
          {#if today.cards.due}{plural(today.cards.due, "card")} due for review.{/if}
        </p>
      </header>

      {#if first}
        <section class="upnext">
          <div class="upnext__main">
            <span class="eyebrow">Up next</span>
            <h2 class="display-md">{first.title}</h2>
            <p class="muted">{where(first)} · Lesson {first.index} of {first.total} · ~{first.minutes} min · {plural(first.items, "item")}</p>
            <div class="upnext__actions">
              <button type="button" class="btn btn--accent btn--lg" onclick={() => startLesson(first.id)}><Icon name="play" size="sm" />{first.status === "in_progress" ? "Continue lesson" : "Start lesson"}</button>
              <a class="btn btn--ghost btn--lg" href="#/folder/{first.folderId}/plan">See the plan</a>
            </div>
          </div>
          {#if after.length || today.cards.due}
            <ol class="upnext__later">
              {#each after as lesson, i (lesson.id)}
                <li><span class="num mono faint">{i + 2}</span><div><strong>{lesson.title}</strong><span class="caption muted">{where(lesson)} · ~{lesson.minutes} min</span></div></li>
              {/each}
              {#if today.cards.due}
                <li><span class="num mono faint">{after.length + 2}</span><div><strong>{plural(today.cards.due, "flashcard")}</strong><span class="caption muted">Review</span></div></li>
              {/if}
            </ol>
          {/if}
        </section>
      {/if}

      {#if today.subjects.length}
        <div class="today__grid">
          <section class="tcard">
            <header><span class="eyebrow">Review</span></header>
            <p class="display-md">{today.cards.due}</p>
            <p class="caption muted">{today.cards.due ? today.cards.folders.map((f) => `${f.name} ${f.due}`).join(" · ") : "No cards due. Cards come from what you've been taught."}</p>
          </section>
          <section class="tcard">
            <header><span class="eyebrow">Practice</span></header>
            {#if today.practice}
              <p class="display-md">{today.practice.items}</p>
              <p class="caption muted">items in {today.practice.name} taught but not checked yet</p>
            {:else}
              <p class="caption muted">Nothing waiting. Items you're taught show up here until a check confirms them.</p>
            {/if}
          </section>
          {#each today.subjects as subject (subject.folderId)}
            <section class="tcard">
              <header><span class="eyebrow">{subject.name}</span><a class="btn btn--ghost btn--sm" href="#/folder/{subject.folderId}/plan">Open</a></header>
              <CoverageBars {...subject.coverage} />
              <p class="caption muted">{plural(subject.coverage.total, "item")} · {plural(subject.lessonsLeft, "lesson")} left{subject.daysLeft !== null && subject.daysLeft >= 0 ? ` · deadline in ${plural(subject.daysLeft, "day")}` : ""}</p>
            </section>
          {/each}
        </div>
      {/if}

      {#if today.week}
        <section class="week">
          <header class="week__head"><span class="eyebrow">This week · {today.week.name}</span><span class="caption faint">Re-balances itself each day</span></header>
          <div class="week__days">
            {#each today.week.days as day (day.date)}
              <div class="day" class:is-today={day.date === localDay()} class:day--exam={day.kind === "exam"}>
                <span class="eyebrow">{date(day.date, { weekday: "short", day: "numeric" })}</span>
                {#if day.kind === "exam"}<span class="drop drop--lg"></span><b>Exam</b>
                {:else if day.kind === "mock"}<b class="day__exam">Mock exam</b>
                {:else if day.kind === "revision"}<b>Revision</b>
                {:else if day.kind === "off"}<i class="day__note">Day off</i>
                {:else}
                  {#each day.lessons as id (id)}<b title={today.week.titles[id]}>{today.week.titles[id]}</b>{/each}
                  {#if !day.lessons.length}<i class="day__note">Free</i>{/if}
                {/if}
              </div>
            {/each}
          </div>
        </section>
      {/if}
    </div>
  {/if}
</div>
