<script lang="ts" module>
  // Opened with ? or the keyboard button in the sidebar.
  export const shortcuts = $state({ open: false });
</script>

<script lang="ts">
  import { go, nav, openTutorial, type FolderTab } from "../lib/state.svelte.ts";
  import Dialog from "./Dialog.svelte";

  // App-wide keys (F-1303). Single keys never fire while typing, with a dialog or menu open, or with a
  // modifier held, so they can't get in the way of writing.
  const TABS: FolderTab[] = ["materials", "ledger", "plan", "practice", "cards", "progress"];
  const GO: Record<string, string> = { t: "#/today", r: "#/review", u: "#/usage", s: "#/settings" };
  let pendingG = 0;

  const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const blocked = () => !!document.querySelector(".dialog-root, [role=listbox], [role=menu]");

  function onkeydown(e: KeyboardEvent) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    if (e.key === "?") { e.preventDefault(); shortcuts.open = !shortcuts.open; return; }
    if (blocked() || nav.route.name === "review") return;
    const route = nav.route;
    if (Date.now() - pendingG < 1500 && GO[e.key]) {
      pendingG = 0;
      e.preventDefault();
      go(GO[e.key]!);
      return;
    }
    pendingG = e.key === "g" ? Date.now() : 0;
    if (e.key === "n") { e.preventDefault(); go(route.name === "folder" ? `#/new/${route.id}` : "#/"); }
    else if (e.key === "/") {
      const box = document.querySelector<HTMLTextAreaElement>("textarea[aria-label=Message]");
      if (box) { e.preventDefault(); box.focus(); }
    } else if (route.name === "folder" && /^[1-6]$/.test(e.key)) {
      e.preventDefault();
      go(`#/folder/${route.id}/${TABS[Number(e.key) - 1]}`);
    }
  }

  const GROUPS: { title: string; keys: [string[], string][] }[] = [
    { title: "Anywhere", keys: [[["?"], "Show or hide these shortcuts"], [["n"], "New chat (in the open folder)"], [["g", "t"], "Today"], [["g", "r"], "Review cards"], [["g", "u"], "Usage"], [["g", "s"], "Settings"], [["/"], "Write a message"], [["Esc"], "Close a dialog, menu or full-screen graph"]] },
    { title: "In a folder", keys: [[["1"], "Materials"], [["2"], "Ledger"], [["3"], "Plan"], [["4"], "Practice"], [["5"], "Cards"], [["6"], "Progress"]] },
    { title: "Writing", keys: [[["Enter"], "Send"], [["Shift", "Enter"], "New line"], [["Esc"], "Stop the reply"], [["Ctrl", "Enter"], "Answer a check or run code"]] },
    { title: "Reviewing cards", keys: [[["Space"], "Show the answer"], [["1"], "Again"], [["2"], "Hard"], [["3"], "Good"], [["4"], "Easy"]] },
    { title: "Exams and checks", keys: [[["j"], "Next question (exam), move down (ordering)"], [["k"], "Previous question (exam), move up (ordering)"]] },
  ];
</script>

<svelte:window {onkeydown} />

<Dialog bind:open={shortcuts.open} wide title="Keyboard shortcuts" eyebrow="Press ? any time">
  <div class="sheet">
    {#each GROUPS as group (group.title)}
      <section>
        <h3 class="eyebrow">{group.title}</h3>
        <dl>
          {#each group.keys as [keys, what], i (i)}
            <dt>{#each keys as k, j (j)}{#if j}<span class="faint then">{keys[0] === "g" ? "then" : "+"}</span>{/if}<kbd>{k}</kbd>{/each}</dt>
            <dd class="body-sm">{what}</dd>
          {/each}
        </dl>
      </section>
    {/each}
  </div>
  {#snippet footer()}
    <button type="button" class="btn btn--ghost" onclick={() => { shortcuts.open = false; void openTutorial(); }}>Open the guide</button>
    <button type="button" class="btn btn--primary" onclick={() => (shortcuts.open = false)}>Done</button>
  {/snippet}
</Dialog>

<style>
  .sheet { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: var(--s-5) var(--s-6); }
  h3 { margin-bottom: var(--s-2); }
  dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--s-2) var(--s-3); align-items: baseline; margin: 0; }
  dt { display: flex; gap: 4px; align-items: baseline; white-space: nowrap; }
  dd { margin: 0; color: var(--text-muted); }
  .then { font-size: var(--t-caption); }
  kbd { font-family: var(--font-mono); font-size: var(--t-caption); padding: 1px 6px; border: 1px solid var(--border); border-bottom-width: 2px; border-radius: var(--r-sm, 4px); background: var(--surface); color: var(--text); }
</style>
