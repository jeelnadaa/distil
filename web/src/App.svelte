<script lang="ts">
  import { refreshActivity } from "./lib/activity.svelte.ts";
  import ChatView from "./components/ChatView.svelte";
  import Home from "./components/Home.svelte";
  import MaterialView from "./components/MaterialView.svelte";
  import ReviewView from "./components/ReviewView.svelte";
  import SettingsView from "./components/SettingsView.svelte";
  import ShortcutSheet from "./components/ShortcutSheet.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import Tooltip from "./components/Tooltip.svelte";
  import Toasts from "./components/Toasts.svelte";
  import TodayView from "./components/TodayView.svelte";
  import UsageView from "./components/UsageView.svelte";
  import WorkspaceView from "./components/WorkspaceView.svelte";
  import { attempt, library, loadModels, nav, refreshLibrary, refreshProviders, refreshSettings } from "./lib/state.svelte.ts";

  let ready = $state(false);
  let main = $state<HTMLElement>();

  // The window title names the page, for screen readers and the desktop window.
  const PAGES: Record<string, string> = { today: "Today", usage: "Usage", review: "Review", settings: "Settings", home: "New chat" };
  const page = $derived.by(() => {
    const r = nav.route;
    if (r.name === "chat") return library.chats.find((c) => c.id === r.id)?.title;
    if (r.name === "folder") return library.folders.find((f) => f.id === r.id)?.name;
    if (r.name === "material") return "Material";
    return PAGES[r.name];
  });
  $effect(() => { document.title = page ? `${page} · Distil` : "Distil"; });

  $effect(() => {
    void refreshActivity();
    attempt(() => Promise.all([refreshLibrary(), refreshSettings(), refreshProviders()])).then((ok) => {
      ready = true;
      if (ok) loadModels();
    });
  });
</script>

<button type="button" class="skip-link" onclick={() => main?.focus()}>Skip to content</button>
<div class="app" class:sb-open={nav.sidebarOpen}>
  <Sidebar />
  {#if nav.sidebarOpen}<button type="button" class="sb-scrim" aria-label="Close menu" onclick={() => (nav.sidebarOpen = false)}></button>{/if}
  <main class="main" id="main" tabindex="-1" bind:this={main}>
    {#if ready}
      {#if nav.route.name === "chat"}
        {#key nav.route.id}<ChatView id={nav.route.id} />{/key}
      {:else if nav.route.name === "material"}
        {#key nav.route.id}<MaterialView id={nav.route.id} loc={nav.route.loc} item={nav.route.item} />{/key}
      {:else if nav.route.name === "folder"}
        {#key nav.route.id}<WorkspaceView id={nav.route.id} tab={nav.route.tab} />{/key}
      {:else if nav.route.name === "today"}
        <TodayView />
      {:else if nav.route.name === "usage"}
        <UsageView />
      {:else if nav.route.name === "review"}
        {#key nav.route.folderId}<ReviewView folderId={nav.route.folderId} />{/key}
      {:else if nav.route.name === "settings"}
        <SettingsView section={nav.route.section} />
      {:else}
        {#key nav.route.folderId}<Home folderId={nav.route.folderId} />{/key}
      {/if}
    {/if}
  </main>
</div>
<Toasts />
<Tooltip />
<ShortcutSheet />

<style>
  .sb-scrim { display: none; }
  .skip-link { position: fixed; top: var(--s-2); left: var(--s-2); z-index: 100; transform: translateY(-200%); padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); background: var(--accent); color: var(--on-accent, #fff); }
  .skip-link:focus-visible { transform: none; }
  .main:focus { outline: none; }
  @media (max-width: 900px) {
    .sb-scrim { display: block; position: fixed; inset: 0; z-index: 34; background: rgb(0 0 0 / .35); }
  }
</style>
