<script lang="ts">
  import { api, type AppInfo } from "../lib/api.ts";
  import { restartApp } from "../lib/restart.ts";
  import { attempt, openTutorial } from "../lib/state.svelte.ts";

  // Version and auto-update (F-1305). Updates exist only in the installed Windows app; the page follows
  // a check or a download by asking the server again until it settles.
  let { info = $bindable() }: { info: AppInfo } = $props();
  let restarting = $state(false);
  const update = $derived(info.update);

  $effect(() => {
    if (update?.state !== "checking" && update?.state !== "downloading") return;
    const timer = setInterval(async () => { const next = await api.appInfo().catch(() => null); if (next) info = next; }, 1000);
    return () => clearInterval(timer);
  });

  const when = (ms: number | null) => ms ? new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;
  async function check() { const next = await attempt(api.checkUpdate); if (next) info = next; }
  async function install() { const next = await attempt(api.installUpdate); if (next) info = next; }
  async function restart() { restarting = true; await attempt(restartApp); restarting = false; }
</script>

<div class="srow">
  <div><strong>Distil {info.version}</strong>
    <span class="caption muted">
      {#if !update}Running from source. Updates come with the installed Windows app.
      {:else if !update.enabled}This build has no update feed, so it doesn't check for updates.
      {:else if update.state === "checking"}Checking for updates…
      {:else if update.state === "available"}Distil {update.latest?.version} is available.
      {:else if update.state === "downloading"}Downloading Distil {update.latest?.version}… {Math.round((update.progress ?? 0) * 100)}%
      {:else if update.state === "ready"}Distil {update.latest?.version ?? "update"} is installed. Restart to start using it.
      {:else if update.state === "error"}{update.error}
      {:else}Up to date{#if when(update.checkedAt)}, checked {when(update.checkedAt)}{/if}.{/if}
    </span>
    {#if update?.state === "available" && update.latest?.notes}<span class="caption faint notes">{update.latest.notes}</span>{/if}
  </div>
  {#if update?.enabled}
    {#if update.state === "available"}
      <button type="button" class="btn btn--primary btn--sm" onclick={install}>Download and install</button>
    {:else if update.state === "ready" && info.canRestart}
      <button type="button" class="btn btn--primary btn--sm" disabled={restarting} onclick={restart}>{restarting ? "Restarting…" : "Restart now"}</button>
    {:else if update.state === "idle" || update.state === "error"}
      <button type="button" class="btn btn--secondary btn--sm" onclick={check}>Check now</button>
    {/if}
  {/if}
</div>

<div class="srow">
  <div><strong>How to use Distil</strong><span class="caption muted">A chat that tours the whole app and answers questions about it.</span></div>
  <button type="button" class="btn btn--secondary btn--sm" onclick={openTutorial}>Open the guide</button>
</div>

<style>
  .notes { display: block; margin-top: var(--s-1); white-space: pre-line; }
</style>
