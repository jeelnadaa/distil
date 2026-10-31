<script lang="ts">
  import { api, type FolderMaterial, type Job } from "../lib/api.ts";
  import { attempt, toast } from "../lib/state.svelte.ts";
  import Dialog from "./Dialog.svelte";
  import Icon from "./Icon.svelte";

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
              <a class="pf-src" href="#/material/{m.id}"><Icon name={KIND_ICON[m.kind] ?? "file"} size="sm" /><span>{m.name}</span></a>
              {#if m.inherited}<span class="caption faint"> · from a parent folder</span>{/if}
              {#if m.error}<div class="caption error">{m.error}</div>{/if}
            </td>
            <td class="body-sm muted">{size(m.size)}</td>
            <td class="body-sm muted">{length(m)}</td>
            <td><span class="status status--{s.tone}"><i></i>{s.label}</span></td>
            <td class="num">
              {#if !m.inherited && m.status === "ready" && m.distilled < m.chunks && !extracting(m)}
                <button type="button" class="btn btn--ghost btn--sm" onclick={() => ondistil(m)}>Distil…</button>
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

<Dialog bind:open={() => !!removing, (v) => { if (!v) removing = null; }} title="Remove {removing?.name}?" eyebrow="Remove material" danger>
  <p class="body-sm">Distil deletes its copy of the file. Ledger items found only in it go too; items you added by hand stay.</p>
  {#snippet footer()}
    <button type="button" class="btn btn--ghost" onclick={() => (removing = null)}>Cancel</button>
    <button type="button" class="btn btn--danger" onclick={remove}>Remove</button>
  {/snippet}
</Dialog>

<style>
  .dropzone { margin-bottom: var(--s-5); }
  .materials a.pf-src { color: inherit; text-decoration: none; max-width: 44ch; }
  .materials a.pf-src:hover span { text-decoration: underline; text-underline-offset: 3px; }
  .error { color: var(--danger); }
</style>
