<script lang="ts">
  import { activity, isActive, jobPct, refreshActivity, resumable, resumeJob, stopJob } from "../lib/activity.svelte.ts";
  import type { Job } from "../lib/api.ts";
  import { attempt, library, popoverAt } from "../lib/state.svelte.ts";
  import Icon from "./Icon.svelte";

  // The top-bar button and its panel: what is running anywhere in Distil, and how recent jobs ended.
  const STATUS: Record<Job["status"], string> = { queued: "Queued", running: "Running", done: "Done", error: "Stopped", aborted: "Stopped by you" };
  const STRATEGY: Record<string, string> = { balanced: "Balanced", thorough: "Thorough", economy: "Economy" };

  let root = $state<HTMLElement>();
  let button = $state<HTMLElement>();
  let pos = $state({ top: 0, left: 0, width: 0 });
  const running = $derived(activity.jobs.filter(isActive));
  const recent = $derived(activity.jobs.filter((j) => !isActive(j)).slice(0, 15));
  const folderName = (id: string | null) => library.folders.find((f) => f.id === id)?.name;
  const ago = (t: number) => {
    const min = Math.round((Date.now() - t) / 60000);
    return min < 1 ? "just now" : min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
  };

  $effect(() => {
    if (!activity.open) return;
    void refreshActivity();
    const place = () => (pos = popoverAt(button!, 420));
    place();
    addEventListener("resize", place);
    const close = (e: Event) => { if (!root?.contains(e.target as Node)) activity.open = false; };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") activity.open = false; };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
      removeEventListener("resize", place);
    };
  });
</script>

<div class="dock" bind:this={root}>
  <button bind:this={button} type="button" class="btn btn--ghost btn--icon btn--sm dock__button" class:is-busy={running.length > 0}
    aria-label={running.length ? `Activity: ${running.length} running` : "Activity"} aria-expanded={activity.open}
    data-tip={running.length ? `${running.length} running` : "Activity"} onclick={() => (activity.open = !activity.open)}>
    <Icon name="clock" size="sm" />
    {#if running.length}<span class="dock__badge">{running.length}</span>{/if}
  </button>

  {#if activity.open}
    <section class="dock__panel" aria-label="Activity" style:top="{pos.top}px" style:left="{pos.left}px" style:width="{pos.width}px">
      <header class="dock__head"><span class="eyebrow">Activity</span><span class="caption faint">Running now and the last 24 hours</span></header>
      {#if !activity.jobs.length}
        <p class="dock__empty body-sm muted">Nothing has run yet. Reading and distilling materials show up here.</p>
      {/if}
      {#each [...running, ...recent] as job (job.id)}
        {@const strategy = STRATEGY[(job.params as { strategy?: string }).strategy ?? ""]}
        <article class="job" class:is-error={job.status === "error"}>
          <div class="job__top">
            <strong class="job__label">{job.label}</strong>
            <span class="status status--{job.status === "done" ? "done" : job.status === "error" ? "error" : isActive(job) ? "active" : ""}"><i></i>{STATUS[job.status]}</span>
          </div>
          <p class="caption faint">
            {#if job.folderId && folderName(job.folderId)}<a href="#/folder/{job.folderId}/materials" onclick={() => (activity.open = false)}>{folderName(job.folderId)}</a>{" · "}{/if}{[strategy, isActive(job) ? `started ${ago(job.createdAt)}` : ago(job.updatedAt)].filter(Boolean).join(" · ")}
          </p>
          {#if job.total}
            <div class="job__bar"><span style:width="{jobPct(job)}%"></span></div>
            <p class="mono caption faint">{jobPct(job)}% · {job.done} of {job.total} {job.total === 1 ? "step" : "steps"}</p>
          {/if}
          {#if job.note && isActive(job)}<p class="caption muted">{job.note}</p>{/if}
          {#if job.error}<p class="caption job__error">{job.error}</p>{/if}
          {#if isActive(job) || resumable(job)}
            <div class="job__actions">
              {#if isActive(job)}
                <button type="button" class="btn btn--ghost btn--sm" data-tip="Stops after the current step; what was found is kept" onclick={() => attempt(() => stopJob(job))}><Icon name="stop" size="sm" />Stop</button>
              {:else}
                <button type="button" class="btn btn--secondary btn--sm" data-tip="Carries on from where it stopped" onclick={() => attempt(() => resumeJob(job))}><Icon name="play" size="sm" />Resume</button>
              {/if}
            </div>
          {/if}
        </article>
      {/each}
    </section>
  {/if}
</div>

<style>
  .dock { position: relative; }
  .dock__button { position: relative; }
  .dock__button.is-busy { color: var(--accent); }
  .dock__badge {
    position: absolute; top: 1px; right: 1px; min-width: 15px; height: 15px; padding: 0 4px; border-radius: 8px;
    background: var(--accent); color: var(--on-accent, #fff); font-size: 10px; font-weight: 700; line-height: 15px; text-align: center;
  }
  .dock__panel {
    position: fixed; z-index: 60;
    max-height: min(70vh, 560px); overflow: auto; padding: var(--s-3);
    background: var(--surface-raised, var(--surface)); border: 1px solid var(--border); border-radius: var(--r-md);
    box-shadow: 0 12px 32px rgb(0 0 0 / .28);
  }
  .dock__head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: var(--s-1) var(--s-3); padding: var(--s-1) var(--s-2) var(--s-3); }
  .dock__empty { padding: var(--s-2); }
  .job { display: grid; gap: 6px; padding: var(--s-3) var(--s-2); border-top: 1px solid var(--border); }
  .job__top { display: flex; justify-content: space-between; gap: var(--s-3); align-items: baseline; }
  .job__label { font-size: var(--t-body-sm); overflow-wrap: anywhere; }
  .job .status { flex: none; }
  .job a { color: inherit; }
  .job__bar { height: 4px; border-radius: 2px; background: var(--surface-sunken); overflow: hidden; }
  .job__bar span { display: block; height: 100%; background: var(--accent); }
  .job__error { color: var(--danger); }
  .job__actions { display: flex; gap: var(--s-2); }
</style>
