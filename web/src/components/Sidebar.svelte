<script lang="ts">
  import { api } from "../lib/api.ts";
  import { resolvedTheme, setTheme } from "../lib/prefs.ts";
  import { attempt, folderPath, go, library, nav, refreshLibrary, toast } from "../lib/state.svelte.ts";
  import Dialog from "./Dialog.svelte";
  import Icon from "./Icon.svelte";
  import Lockup from "./Lockup.svelte";
  import Tree, { DRAG_TYPE, toggleFolder, type TreeActions } from "./Tree.svelte";

  let theme = $state(resolvedTheme());
  const flipTheme = () => {
    theme = theme === "dark" ? "light" : "dark";
    setTheme(theme);
  };

  // One naming dialog serves new folders and renames.
  let naming = $state({ open: false, title: "", label: "", value: "", submit: async (_: string) => {} });
  let removing = $state({ open: false, title: "", detail: "", confirm: async () => {} });
  let rootDrop = $state(false);

  const ask = (title: string, label: string, value: string, submit: (v: string) => Promise<void>) => {
    naming = { open: true, title, label, value, submit };
  };

  const act: TreeActions = {
    // A chat is only created when its first message is sent, so an abandoned "New chat" leaves nothing behind.
    newChat(folderId) {
      if (folderId) folderPath(folderId).forEach((f) => toggleFolder(f.id, true));
      go(folderId ? `#/new/${folderId}` : "#/");
    },
    newFolder(parentId) {
      const parent = library.folders.find((f) => f.id === parentId);
      ask(parent ? `New folder in ${parent.name}` : "New folder", "Folder name", "", async (name) => {
        const folder = await api.createFolder(name, parentId);
        if (parentId) toggleFolder(parentId, true);
        toggleFolder(folder.id, true);
      });
    },
    rename(kind, id) {
      const current = kind === "folder" ? library.folders.find((f) => f.id === id)?.name : library.chats.find((c) => c.id === id)?.title;
      ask(kind === "folder" ? "Rename folder" : "Rename chat", "Name", current ?? "", async (name) => {
        if (kind === "folder") await api.updateFolder(id, { name });
        else await api.updateChat(id, { title: name });
      });
    },
    async remove(kind, id) {
      if (kind === "chat") {
        const chat = library.chats.find((c) => c.id === id);
        removing = {
          open: true, title: `Delete “${chat?.title}”?`, detail: "Its messages are removed from this machine. Token usage history is kept.",
          confirm: async () => {
            await api.deleteChat(id);
            if (nav.route.name === "chat" && nav.route.id === id) go("#/");
          },
        };
        return;
      }
      const folder = library.folders.find((f) => f.id === id);
      const contents = await attempt(() => api.folderContents(id));
      if (!folder || !contents) return;
      const parts = [contents.folders && `${contents.folders} subfolder${contents.folders === 1 ? "" : "s"}`, contents.chats && `${contents.chats} chat${contents.chats === 1 ? "" : "s"}`].filter(Boolean);
      removing = {
        open: true, title: `Delete “${folder.name}”?`,
        detail: parts.length ? `This also deletes ${parts.join(" and ")} inside it. It can't be undone.` : "The folder is empty.",
        confirm: async () => {
          const openChat = nav.route.name === "chat" ? library.chats.find((c) => c.id === (nav.route as { id: string }).id) : undefined;
          await api.deleteFolder(id);
          if (openChat?.folderId && folderPath(openChat.folderId).some((f) => f.id === id)) go("#/");
        },
      };
    },
    async move(kind, id, folderId) {
      const ok = await attempt<unknown>(() => kind === "folder" ? api.updateFolder(id, { parentId: folderId }) : api.updateChat(id, { folderId }));
      if (!ok) return;
      if (folderId) toggleFolder(folderId, true);
      await refreshLibrary();
    },
  };

  async function submitName(e: SubmitEvent) {
    e.preventDefault();
    const done = await attempt(async () => {
      await naming.submit(naming.value);
      await refreshLibrary();
      return true;
    });
    if (done) naming.open = false;
  }

  async function confirmRemove() {
    const done = await attempt(async () => {
      await removing.confirm();
      await refreshLibrary();
      return true;
    });
    if (done) {
      removing.open = false;
      toast("Deleted.");
    }
  }

  const dropOnRoot = (e: DragEvent) => {
    rootDrop = false;
    const raw = e.dataTransfer?.getData(DRAG_TYPE);
    if (!raw) return;
    e.preventDefault();
    const item = JSON.parse(raw) as { kind: "folder" | "chat"; id: string };
    act.move(item.kind, item.id, null);
  };
</script>

<aside class="sb" aria-label="Sidebar">
  <div class="sb__top">
    <a class="sb__brand" href="#/" aria-label="Distil home"><Lockup /></a>
  </div>
  <button type="button" class="btn btn--secondary sb__new" onclick={() => act.newChat(null)}>
    <Icon name="plus" size="sm" />New chat
  </button>

  <div class="sb__section" class:is-drop={rootDrop} role="presentation"
    ondragover={(e) => { if (e.dataTransfer?.types.includes(DRAG_TYPE)) { e.preventDefault(); rootDrop = true; } }}
    ondragleave={() => (rootDrop = false)} ondrop={dropOnRoot}>
    <span class="eyebrow">Library</span>
    <button type="button" class="btn btn--ghost btn--icon btn--sm" aria-label="New folder" data-tip="New folder" onclick={() => act.newFolder(null)}>
      <Icon name="folder-plus" size="sm" />
    </button>
  </div>
  <nav class="sb__tree" aria-label="Library">
    {#if library.loaded && !library.folders.length && !library.chats.length}
      <p class="caption faint sb__empty">Folders hold a subject's chats. Make one for each course or topic.</p>
    {/if}
    <Tree parentId={null} depth={0} {act} />
  </nav>

  <div class="sb__foot">
    <a class="sb__link" class:is-active={nav.route.name === "settings"} href="#/settings"><Icon name="gear" size="sm" />Settings</a>
    <button type="button" class="btn btn--ghost btn--icon btn--sm" aria-label="Switch to {theme === 'dark' ? 'light' : 'dark'} theme" onclick={flipTheme}>
      <Icon name={theme === "dark" ? "sun" : "moon"} size="sm" />
    </button>
  </div>
</aside>

<Dialog bind:open={naming.open} title={naming.title}>
  <form id="name-form" onsubmit={submitName}>
    <label class="field"><span class="field__label">{naming.label}</span>
      <input class="input" bind:value={naming.value} maxlength="120" required /></label>
  </form>
  {#snippet footer()}
    <button type="button" class="btn btn--ghost" onclick={() => (naming.open = false)}>Cancel</button>
    <button type="submit" form="name-form" class="btn btn--primary">Save</button>
  {/snippet}
</Dialog>

<Dialog bind:open={removing.open} title={removing.title}>
  <p class="body-sm muted">{removing.detail}</p>
  {#snippet footer()}
    <button type="button" class="btn btn--ghost" onclick={() => (removing.open = false)}>Cancel</button>
    <button type="button" class="btn btn--danger" onclick={confirmRemove}>Delete</button>
  {/snippet}
</Dialog>

<style>
  .sb__new { margin: 0 var(--s-1) var(--s-2); justify-content: flex-start; }
  .sb__section { border-radius: var(--r-sm); }
  .sb__section.is-drop { box-shadow: inset 0 0 0 1px var(--accent); background: var(--accent-wash); }
  .sb__tree { flex: 1; min-height: 0; overflow: auto; padding-bottom: var(--s-3); }
  .sb__empty { padding: var(--s-1) var(--s-2) var(--s-3); }
  .sb__foot { border-top: 1px solid var(--border); padding-top: var(--s-2); }
</style>
