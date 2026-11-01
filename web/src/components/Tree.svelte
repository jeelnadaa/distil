<script lang="ts" module>
  export type TreeActions = {
    newChat: (folderId: string | null) => void;
    newFolder: (parentId: string | null) => void;
    rename: (kind: "folder" | "chat", id: string) => void;
    remove: (kind: "folder" | "chat", id: string) => void;
    move: (kind: "folder" | "chat", id: string, folderId: string | null) => void;
  };

  import { SvelteSet } from "svelte/reactivity";

  const OPEN_KEY = "distil-open-folders";
  const readOpen = (): string[] => { try { return JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]"); } catch { return []; } };
  export const openFolders = new SvelteSet<string>(readOpen());
  export function toggleFolder(id: string, force?: boolean) {
    const open = force ?? !openFolders.has(id);
    if (open) openFolders.add(id);
    else openFolders.delete(id);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...openFolders])); } catch { /* lasts for this page only */ }
  }

  export const DRAG_TYPE = "application/x-distil-item";
</script>

<script lang="ts">
  import { MAX_FOLDER_DEPTH } from "../../../server/constants.ts";
  import { go, library, nav } from "../lib/state.svelte.ts";
  import Icon from "./Icon.svelte";
  import Menu from "./Menu.svelte";
  import Tree from "./Tree.svelte";

  let { parentId, depth, act }: { parentId: string | null; depth: number; act: TreeActions } = $props();

  const folders = $derived(library.folders.filter((f) => f.parentId === parentId));
  const chats = $derived(library.chats.filter((c) => c.folderId === parentId));
  let dropTarget = $state<string | null>(null);

  const drag = (e: DragEvent, kind: "folder" | "chat", id: string) => {
    e.dataTransfer?.setData(DRAG_TYPE, JSON.stringify({ kind, id }));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  };
  const drop = (e: DragEvent, folderId: string) => {
    dropTarget = null;
    const raw = e.dataTransfer?.getData(DRAG_TYPE);
    if (!raw) return;
    e.preventDefault();
    const item = JSON.parse(raw) as { kind: "folder" | "chat"; id: string };
    if (item.id !== folderId) act.move(item.kind, item.id, folderId);
  };
</script>

<ul class="tree" class:tree--root={depth === 0} role={depth === 0 ? "tree" : "group"}>
  {#each folders as folder (folder.id)}
    {@const open = openFolders.has(folder.id)}
    {@const here = nav.route.name === "folder" && nav.route.id === folder.id}
    <li class="tree__folder" role="treeitem" aria-expanded={open} aria-selected="false">
      <div class="tree__item" class:is-drop={dropTarget === folder.id} style:--depth={depth}
        draggable="true" ondragstart={(e) => drag(e, "folder", folder.id)}
        ondragover={(e) => { if (e.dataTransfer?.types.includes(DRAG_TYPE)) { e.preventDefault(); dropTarget = folder.id; } }}
        ondragleave={() => (dropTarget = null)} ondrop={(e) => drop(e, folder.id)} role="presentation">
        <!-- The first click opens the folder's workspace; clicking it again while it's open collapses it. -->
        <button type="button" class="tree__row" class:is-active={here} aria-current={here ? "page" : undefined}
          onclick={() => { if (here) toggleFolder(folder.id); else { toggleFolder(folder.id, true); go(`#/folder/${folder.id}`); } }}>
          <span class="tree__chev" class:is-open={open}><Icon name="chevron-right" size="sm" /></span>
          <Icon name={open ? "folder-open" : "folder"} size="sm" />
          <span class="tree__label">{folder.name}</span>
        </button>
        <span class="tree__actions">
          <button type="button" class="btn btn--ghost btn--icon btn--sm" aria-label="New chat in {folder.name}" data-tip="New chat here"
            onclick={() => act.newChat(folder.id)}><Icon name="plus" size="sm" /></button>
          <Menu label="More actions for {folder.name}" items={[
            ...(depth + 1 < MAX_FOLDER_DEPTH ? [{ label: "New subfolder", icon: "folder-plus", run: () => act.newFolder(folder.id) }] : []),
            ...(folder.parentId ? [{ label: "Move to top level", icon: "arrow-up", run: () => act.move("folder", folder.id, null) }] : []),
            { label: "Rename", icon: "pencil", run: () => act.rename("folder", folder.id) },
            { label: "Delete…", icon: "trash", danger: true, run: () => act.remove("folder", folder.id) },
          ]} />
        </span>
      </div>
      {#if open}<Tree parentId={folder.id} depth={depth + 1} {act} />{/if}
    </li>
  {/each}
  {#each chats as chat (chat.id)}
    {@const active = nav.route.name === "chat" && nav.route.id === chat.id}
    <li class="tree__chat" role="treeitem" aria-selected={active}>
      <div class="tree__item" style:--depth={depth} draggable="true" ondragstart={(e) => drag(e, "chat", chat.id)} role="presentation">
        <a class="tree__row" class:is-active={active} href="#/chat/{chat.id}" aria-current={active ? "page" : undefined}>
          <span class="tree__chev"></span>
          <Icon name={chat.mode === "exam" ? "clock" : chat.mode === "practice" ? "target" : chat.mode === "teach" ? "book" : "chat"} size="sm" />
          <span class="tree__label">{chat.title}</span>
        </a>
        <span class="tree__actions">
          <Menu label="More actions for {chat.title}" items={[
            ...(chat.folderId ? [{ label: "Move to top level", icon: "arrow-up", run: () => act.move("chat", chat.id, null) }] : []),
            { label: "Rename", icon: "pencil", run: () => act.rename("chat", chat.id) },
            { label: "Delete…", icon: "trash", danger: true, run: () => act.remove("chat", chat.id) },
          ]} />
        </span>
      </div>
    </li>
  {/each}
</ul>

<style>
  .tree { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 1px; }
  .tree--root { overflow-x: hidden; }
  .tree__item { position: relative; border-radius: var(--r-sm); }
  .tree__item.is-drop { box-shadow: inset 0 0 0 1px var(--accent); background: var(--accent-wash); }
  .tree__item .tree__row { padding-left: calc(var(--s-1) + var(--depth) * 14px); padding-right: 64px; }
  .tree__chev { display: inline-flex; width: 16px; color: var(--text-faint); transition: transform var(--dur-base) var(--spring-snappy); }
  .tree__chev.is-open { transform: rotate(90deg); }
  .tree__chat :global(.icon) { color: var(--text-faint); }
  .tree__chat .is-active :global(.icon), .tree__item .is-active :global(.icon) { color: var(--accent); }
  .tree__actions { position: absolute; right: 2px; top: 0; bottom: 0; display: flex; align-items: center; opacity: 0; transition: opacity var(--dur-fast) linear; }
  .tree__item:hover .tree__actions, .tree__item:focus-within .tree__actions { opacity: 1; }
  .tree__actions :global(.btn) { width: 26px; --h: 26px; }
  @media (hover: none) { .tree__actions { opacity: 1; } }
</style>
