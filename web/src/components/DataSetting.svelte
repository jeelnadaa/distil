<script lang="ts">
  import { api, type AppInfo } from "../lib/api.ts";
  import { restartApp } from "../lib/restart.ts";
  import { attempt, toast } from "../lib/state.svelte.ts";

  // Backup and restore (F-1304). A restore is checked and staged by the server, then swapped in when
  // Distil starts again, before anything is opened.
  let { info = $bindable() }: { info: AppInfo } = $props();
  let file = $state<HTMLInputElement>();
  let busy = $state<"restore" | "restart" | null>(null);

  const date = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

  async function stage(f: File) {
    busy = "restore";
    const next = await attempt(() => api.restoreBackup(f));
    busy = null;
    if (next) info = next;
  }
  async function cancel() {
    const next = await attempt(api.cancelRestore);
    if (next) { info = next; toast("Restore cancelled. Nothing was changed."); }
  }
  async function restart() {
    busy = "restart";
    await attempt(restartApp);
    busy = null;
  }
</script>

<div class="srow">
  <div><strong>Back up</strong><span class="caption muted">A zip of your library, chats, materials, plans and progress. Keys aren't included; on another computer, add them again.</span></div>
  <a class="btn btn--secondary btn--sm" href={api.backupUrl} download>Download backup</a>
</div>
<div class="srow">
  <div><strong>Restore</strong><span class="caption muted">Replaces everything in Distil with a backup. What's here now is kept in <span class="mono">before-restore</span> in the data folder until the next restore.</span></div>
  <button type="button" class="btn btn--secondary btn--sm" disabled={!!busy} onclick={() => file?.click()}>{busy === "restore" ? "Checking…" : "Choose backup…"}</button>
  <input type="file" accept=".zip,application/zip" hidden bind:this={file} onchange={(e) => { const t = e.currentTarget; if (t.files?.[0]) stage(t.files[0]); t.value = ""; }} />
</div>
{#if info.restore}
  {@const r = info.restore}
  <div class="panel restore" role="status">
    <p class="body-sm"><strong>Backup ready to restore.</strong> Made {date(r.createdAt)} with Distil {r.version}: {plural(r.folders, "folder")}, {plural(r.materials, "material")}.
      {info.canRestart ? "Restart to finish." : "Close Distil and start it again to finish."}</p>
    <div class="restore__actions">
      <button type="button" class="btn btn--ghost btn--sm" disabled={!!busy} onclick={cancel}>Cancel restore</button>
      {#if info.canRestart}<button type="button" class="btn btn--primary btn--sm" disabled={!!busy} onclick={restart}>{busy === "restart" ? "Restarting…" : "Restart now"}</button>{/if}
    </div>
  </div>
{/if}

<style>
  .restore { display: grid; gap: var(--s-3); padding: var(--s-4); margin-top: var(--s-3); }
  .restore__actions { display: flex; gap: var(--s-2); justify-content: flex-end; flex-wrap: wrap; }
</style>
