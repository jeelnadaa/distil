<script lang="ts">
  import { api, type FolderMaterial, type Job } from "../lib/api.ts";
  import { attempt, toast } from "../lib/state.svelte.ts";
  import Dialog from "./Dialog.svelte";
  import Icon from "./Icon.svelte";
  import Segmented from "./Segmented.svelte";

  let { folderId, materials, jobs, onchange, ondistil }: {
    folderId: string; materials: FolderMaterial[]; jobs: Job[]; onchange: () => void; ondistil: (m: FolderMaterial) => void;
  } = $props();

  const ACCEPT = ".pdf,.docx,.pptx,.md,.markdown,.txt,.png,.jpg,.jpeg,.webp,.gif";
  const KIND_ICON: Record<string, string> = { pdf: "file", docx: "file", pptx: "layers", markdown: "type", text: "type", image: "image" };
  const UNIT: Record<string, [string, string]> = { page: ["page", "pages"], slide: ["slide", "slides"], para: ["paragraph", "paragraphs"], line: ["line", "lines"] };

  let input = $state<HTMLInputElement>();
  let over = $state(false);
  let uploading = $state(0);
  let removing = $state<FolderMaterial | null>(null);
  let replaceInput = $state<HTMLInputElement>();
  let replacing = $state<FolderMaterial | null>(null);
  let diff = $state<FolderMaterial | null>(null);
  let link = $state("");
  let fetching = $state(false);

  const size = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  const length = (m: FolderMaterial) => {
    if (m.length === null || !m.unit) return "";
    const [one, many] = UNIT[m.unit] ?? ["part", "parts"];
    return `${m.length} ${m.length === 1 ? one : many}`;
  };
  const extracting = (m: FolderMaterial) => jobs.some((j) => j.materialId === m.id && j.kind === "extract" && (j.status === "queued" || j.status === "running"));
  const statusOf = (m: FolderMaterial): { label: string; tone: string } => {
    if (m.status === "error") return { label: "Couldn't read", tone: "error" };
    if (m.status !== "ready") return { label: m.status === "parsing" ? "Reading" : "Queued", tone: "active" };
    if (extracting(m)) return { label: `Distilling ${Math.round((m.distilled / Math.max(1, m.chunks)) * 100)}%`, tone: "active" };
    if (m.distilled >= m.chunks) return { label: "Distilled", tone: "done" };
    return { label: m.distilled ? "Partly distilled" : "Ready to distil", tone: "" };
  };

  // Files go up one at a time: each is copied into the data folder, then read in the background.
  async function upload(files: FileList | File[]) {
    const list = [...files];
    uploading += list.length;
    for (const file of list) {
      const added = await attempt(() => api.uploadMaterial(folderId, file));
      uploading -= 1;
      if (added) onchange();
    }
    if (list.length > 1) toast(`Added ${list.length} files. Distil them when they've been read.`);
  }

  // Links are fetched by Distil now and kept as a copy; the page can change or vanish later.
  // A YouTube link asks first how to get its transcript, since one way spends tokens.
  const YOUTUBE = /^https?:\/\/(?:(?:www|m|music)\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)\//i;
  let video = $state<{ url: string; how: "gemini" | "paste"; transcript: string } | null>(null);

  async function addLink(e: SubmitEvent) {
    e.preventDefault();
    const url = link.trim();
    if (!url || fetching) return;
    if (YOUTUBE.test(url)) { video = { url, how: "gemini", transcript: "" }; return; }
    await submitLink(url);
  }

  async function submitLink(url: string, transcript?: string) {
    fetching = true;
    const added = await attempt(() => api.addLink(folderId, url, transcript));
    fetching = false;
    if (added) { link = ""; video = null; onchange(); }
  }
  const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

  // A new version (F-212): unchanged sections keep their items; the rest is read again and waits to be distilled.
  const isVideo = (m: FolderMaterial) => !!m.source && /youtube\.com\/watch/.test(m.source);
  async function replaceWith(file: File) {
    const target = replacing!;
    replacing = null;
    if (await attempt(() => api.replaceMaterial(target.id, file))) onchange();
  }
  async function refetch(m: FolderMaterial) {
    if (await attempt(() => api.refetchMaterial(m.id))) onchange();
  }
  async function dismiss(m: FolderMaterial) {
    diff = null;
    if (await attempt(() => api.dismissReimport(m.id))) onchange();
  }
  const changes = (m: FolderMaterial) => {
    const r = m.reimport!;
    const parts = [`${r.added} new or changed ${r.added === 1 ? "section" : "sections"}`];
    if (r.items.length) parts.push(`${r.items.length} ${r.items.length === 1 ? "item" : "items"} removed`);
    return `Updated: ${parts.join(", ")}.`;
  };

  async function remove() {
    const target = removing!;
    removing = null;
    if (await attempt(() => api.deleteMaterial(target.id))) onchange();
  }
</script>

<button type="button" class="dropzone" class:is-over={over} onclick={() => input?.click()}
  ondragover={(e) => { if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); over = true; } }}
  ondragleave={() => (over = false)}
  ondrop={(e) => { e.preventDefault(); over = false; if (e.dataTransfer?.files.length) upload(e.dataTransfer.files); }}>
  <Icon name="upload" />
  <span class="body-sm">
    {#if uploading}<strong>Adding {uploading} {uploading === 1 ? "file" : "files"}…</strong>
    {:else}<strong>Drop files</strong> or click to choose. PDF, Word, PowerPoint, Markdown, text and images (photos of notes or whiteboards), up to 200 MB each.{/if}
  </span>
</button>
<form class="link-row" onsubmit={addLink}>
  <label class="sr-only" for="material-link">Link to a web page, PDF or YouTube video</label>
  <span class="link-row__icon"><Icon name="link" size="sm" /></span>
  <input id="material-link" class="input" type="url" placeholder="Or paste a link to a web page, PDF or YouTube video" bind:value={link} disabled={fetching} />
  <button type="submit" class="btn btn--secondary btn--sm" disabled={!link.trim() || fetching}>{fetching ? "Fetching…" : "Add link"}</button>
</form>
<input type="file" accept={ACCEPT} hidden bind:this={replaceInput} onchange={(e) => { const t = e.currentTarget; if (t.files?.[0]) replaceWith(t.files[0]); t.value = ""; }} />
<input type="file" multiple accept={ACCEPT} hidden bind:this={input} onchange={(e) => { const t = e.currentTarget; if (t.files?.length) upload(t.files); t.value = ""; }} />

{#if materials.length}
  <div class="table-wrap">
    <table class="table materials">
      <thead><tr><th>File</th><th>Size</th><th>Length</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>
        {#each materials as m (m.id)}
          {@const s = statusOf(m)}
          <tr>
            <td>
              <a class="pf-src" href="#/material/{m.id}"><Icon name={m.source && m.kind === "markdown" ? (/youtube\.com/.test(m.source) ? "video" : "link") : KIND_ICON[m.kind] ?? "file"} size="sm" /><span>{m.name}</span></a>
              {#if m.source}<a class="caption faint source" href={m.source} target="_blank" rel="noopener noreferrer">{host(m.source)}</a>{/if}
              {#if m.inherited}<span class="caption faint"> · from a parent folder</span>{/if}
              {#if m.error}<div class="caption error">{m.error}</div>{/if}
              {#if m.reimport && !m.inherited}
                <div class="caption muted reimport">{changes(m)}
                  {#if m.reimport.items.length}<button type="button" class="linkish" onclick={() => (diff = m)}>See removed</button>{/if}
                  <button type="button" class="linkish" onclick={() => dismiss(m)}>Dismiss</button>
                </div>
              {/if}
            </td>
            <td class="body-sm muted">{size(m.size)}</td>
            <td class="body-sm muted">{length(m)}</td>
            <td><span class="status status--{s.tone}"><i></i>{s.label}</span></td>
            <td class="num">
              {#if !m.inherited && m.status === "ready" && m.distilled < m.chunks && !extracting(m)}
                <button type="button" class="btn btn--ghost btn--sm" onclick={() => ondistil(m)}>Distil…</button>
              {/if}
              {#if !m.inherited && m.status !== "queued" && m.status !== "parsing" && !isVideo(m)}
                {#if m.source}
                  <button type="button" class="btn btn--ghost btn--icon btn--sm" aria-label="Fetch {m.name} again" title="Fetch again" onclick={() => refetch(m)}><Icon name="refresh" size="sm" /></button>
                {:else}
                  <button type="button" class="btn btn--ghost btn--icon btn--sm" aria-label="Replace {m.name} with a new version" title="Replace with a new version" onclick={() => { replacing = m; replaceInput?.click(); }}><Icon name="upload" size="sm" /></button>
                {/if}
              {/if}
              {#if !m.inherited}
                <button type="button" class="btn btn--ghost btn--icon btn--sm" aria-label="Remove {m.name}" title="Remove" onclick={() => (removing = m)}><Icon name="trash" size="sm" /></button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<Dialog bind:open={() => !!video, (v) => { if (!v && !fetching) video = null; }} title="Add a video" eyebrow="YouTube">
  {#if video}
    <div class="video-how">
      <Segmented label="How to get the transcript" value={video.how} onchange={(v) => (video!.how = v)}
        options={[{ value: "gemini", label: "Transcribe with Gemini" }, { value: "paste", label: "Paste transcript" }]} />
      {#if video.how === "gemini"}
        <p class="body-sm">A Gemini model watches the video and writes down what is said and what is shown on screen: formulas, slides and code.</p>
        <p class="caption faint">Roughly 6,000 tokens per minute of video, from your Gemini quota. A long lecture can take a few minutes.</p>
      {:else}
        <label class="field">
          <span class="field__label">Transcript</span>
          <textarea class="textarea" rows="8" bind:value={video.transcript} placeholder="0:00&#10;Today we look at…"></textarea>
          <span class="field__hint">On YouTube, open the description, choose Show transcript, then select all of it and copy. Costs no tokens, but leaves out what is only shown on screen.</span>
        </label>
      {/if}
    </div>
  {/if}
  {#snippet footer()}
    <button type="button" class="btn btn--ghost" disabled={fetching} onclick={() => (video = null)}>Cancel</button>
    <button type="button" class="btn btn--primary" disabled={fetching || (video?.how === "paste" && !video.transcript.trim())}
      onclick={() => submitLink(video!.url, video!.how === "paste" ? video!.transcript : undefined)}>
      {fetching ? (video?.how === "gemini" ? "Transcribing…" : "Adding…") : "Add video"}
    </button>
  {/snippet}
</Dialog>

<Dialog bind:open={() => !!diff, (v) => { if (!v) diff = null; }} title="Removed with the old text" eyebrow={diff?.name ?? ""}>
  {#if diff?.reimport}
    <p class="body-sm">These ledger items were only found in text the new version no longer has, so they left the ledger. Items you added by hand stay.</p>
    <ul class="removed">
      {#each diff.reimport.items as removedItem, i (i)}<li><span class="chip">{removedItem.type}</span>{removedItem.title}</li>{/each}
    </ul>
  {/if}
  {#snippet footer()}
    <button type="button" class="btn btn--ghost" onclick={() => (diff = null)}>Close</button>
    <button type="button" class="btn btn--secondary" onclick={() => dismiss(diff!)}>Dismiss</button>
  {/snippet}
</Dialog>

<Dialog bind:open={() => !!removing, (v) => { if (!v) removing = null; }} title="Remove {removing?.name}?" eyebrow="Remove material" danger>
  <p class="body-sm">Distil deletes its copy of the file. Ledger items found only in it go too; items you added by hand stay.</p>
  {#snippet footer()}
    <button type="button" class="btn btn--ghost" onclick={() => (removing = null)}>Cancel</button>
    <button type="button" class="btn btn--danger" onclick={remove}>Remove</button>
  {/snippet}
</Dialog>

<style>
  .dropzone { margin-bottom: var(--s-3); }
  .link-row { position: relative; display: flex; gap: var(--s-2); align-items: center; margin-bottom: var(--s-5); }
  .link-row .input { flex: 1; min-width: 0; padding-left: 34px; }
  .link-row__icon { position: absolute; left: 11px; display: flex; color: var(--text-faint); pointer-events: none; }
  .source { margin-left: var(--s-2); }
  .reimport { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: baseline; margin-top: 2px; }
  .linkish { color: var(--text-muted); text-decoration: underline; text-underline-offset: 3px; }
  .linkish:hover { color: var(--text); }
  .removed { display: grid; gap: var(--s-2); max-height: 50vh; overflow: auto; padding: 0; list-style: none; }
  .removed li { display: flex; gap: var(--s-2); align-items: baseline; font-size: var(--t-body-sm); }
  .video-how { display: grid; gap: var(--s-3); justify-items: start; }
  .video-how .field { width: 100%; }
  .materials a.pf-src { color: inherit; text-decoration: none; max-width: 44ch; }
  .materials a.pf-src:hover span { text-decoration: underline; text-underline-offset: 3px; }
  .error { color: var(--danger); }
</style>
