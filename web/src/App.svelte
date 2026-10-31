<script lang="ts">
  import { refreshActivity } from "./lib/activity.svelte.ts";
  import ChatView from "./components/ChatView.svelte";
  import Home from "./components/Home.svelte";
  import MaterialView from "./components/MaterialView.svelte";
  import SettingsView from "./components/SettingsView.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import Toasts from "./components/Toasts.svelte";
  import WorkspaceView from "./components/WorkspaceView.svelte";
  import { attempt, loadModels, nav, refreshLibrary, refreshProviders, refreshSettings } from "./lib/state.svelte.ts";

  let ready = $state(false);

  $effect(() => {
    void refreshActivity();
    attempt(() => Promise.all([refreshLibrary(), refreshSettings(), refreshProviders()])).then((ok) => {
      ready = true;
      if (ok) loadModels();
    });
  });
</script>

<div class="app" class:sb-open={nav.sidebarOpen}>
  <Sidebar />
  {#if nav.sidebarOpen}<button type="button" class="sb-scrim" aria-label="Close menu" onclick={() => (nav.sidebarOpen = false)}></button>{/if}
  <main class="main">
    {#if ready}
      {#if nav.route.name === "chat"}
        {#key nav.route.id}<ChatView id={nav.route.id} />{/key}
      {:else if nav.route.name === "material"}
        {#key nav.route.id}<MaterialView id={nav.route.id} loc={nav.route.loc} item={nav.route.item} />{/key}
      {:else if nav.route.name === "folder"}
        {#key nav.route.id}<WorkspaceView id={nav.route.id} tab={nav.route.tab} />{/key}
      {:else if nav.route.name === "settings"}
        <SettingsView section={nav.route.section} />
      {:else}
        {#key nav.route.folderId}<Home folderId={nav.route.folderId} />{/key}
      {/if}
    {/if}
  </main>
</div>
<Toasts />

<style>
  .sb-scrim { display: none; }
  @media (max-width: 900px) {
    .sb-scrim { display: block; position: fixed; inset: 0; z-index: 34; background: rgb(0 0 0 / .35); }
  }
</style>
