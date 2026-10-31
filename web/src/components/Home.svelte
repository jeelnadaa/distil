<script lang="ts">
  import { api } from "../lib/api.ts";
  import { app, attempt, go, nav, pending, refreshLibrary } from "../lib/state.svelte.ts";
  import Composer from "./Composer.svelte";
  import Icon from "./Icon.svelte";
  import Mark from "./Mark.svelte";

  let draft = $state("");
  const connected = $derived(app.providers.some((p) => p.configured));
  const ready = $derived(connected && app.settings?.models.strong);

  async function start(text: string) {
    const chat = await attempt(() => api.createChat(null));
    if (!chat) return;
    pending.chatId = chat.id;
    pending.text = text;
    await refreshLibrary();
    go(`#/chat/${chat.id}`);
  }
</script>

<header class="topbar">
  <button type="button" class="btn btn--ghost btn--icon btn--sm topbar__menu" aria-label="Open menu" onclick={() => (nav.sidebarOpen = true)}><Icon name="sidebar" size="sm" /></button>
</header>

<div class="scroll">
  <div class="page home">
    <Mark size={44} />
    {#if ready}
      <h1 class="display-xl" data-condense>What do you want to <em>learn?</em></h1>
      <p class="body-lg muted">Ask anything. Folders in the sidebar keep each subject's chats together.</p>
      <Composer bind:value={draft} onsend={start} />
    {:else}
      <h1 class="display-xl">Connect a <em>model</em> first.</h1>
      <p class="body-lg muted">Distil runs on your machine and uses your own AI provider. The quickest free option takes about 30 seconds:</p>
      <ol class="steps-list">
        <li>Open <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a> and sign in.</li>
        <li>Choose <strong>Create API key</strong> and copy it.</li>
        <li>Paste it under <strong>Settings › Providers › Google AI Studio</strong>, then pick a model.</li>
      </ol>
      <div><a class="btn btn--primary btn--lg" href={connected ? "#/settings/models" : "#/settings/providers"}>
        {connected ? "Pick a model" : "Add a key"}<Icon name="arrow-right" size="sm" /></a></div>
      <p class="caption faint">Keys stay in your data folder and are only ever sent to the provider they belong to.</p>
    {/if}
  </div>
</div>

<style>
  .home { display: grid; gap: var(--s-4); align-content: start; padding-top: 14vh; max-width: 720px; }
  .home :global(.mark) { color: var(--text); }
  .home :global(.composer) { margin-top: var(--s-4); }
  .steps-list { padding-left: 1.3em; display: grid; gap: var(--s-2); font-size: var(--t-body); }
  .steps-list li::marker { font-family: var(--font-mono); font-size: 12px; color: var(--text-faint); }
  .steps-list a { color: var(--accent); }
</style>
