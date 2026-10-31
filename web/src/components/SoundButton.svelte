<script lang="ts">
  import { pause, play, setVolume, sound, SOUNDS } from "../lib/sound.svelte.ts";
  import { popoverAt } from "../lib/state.svelte.ts";
  import Icon from "./Icon.svelte";

  // Top-bar button for study sounds: pick a sound, play or pause it, set the volume.
  let root = $state<HTMLElement>();
  let button = $state<HTMLElement>();
  let pos = $state({ top: 0, left: 0, width: 0 });
  const current = $derived(SOUNDS.find((s) => s.id === sound.id)!);

  $effect(() => {
    if (!sound.open) return;
    const place = () => (pos = popoverAt(button!, 300));
    place();
    addEventListener("resize", place);
    const close = (e: Event) => { if (!root?.contains(e.target as Node)) sound.open = false; };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") sound.open = false; };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
      removeEventListener("resize", place);
    };
  });
</script>

<div class="sound" bind:this={root}>
  <button bind:this={button} type="button" class="btn btn--ghost btn--icon btn--sm" class:is-on={sound.playing} aria-expanded={sound.open}
    aria-label={sound.playing ? `Study sound: ${current.label} playing` : "Study sound"}
    data-tip={sound.playing ? `${current.label} playing` : "Study sound"} onclick={() => (sound.open = !sound.open)}>
    <Icon name="headphones" size="sm" />
  </button>

  {#if sound.open}
    <section class="sound__panel" aria-label="Study sound" style:top="{pos.top}px" style:left="{pos.left}px" style:width="{pos.width}px">
      <header class="sound__head">
        <span class="eyebrow">Study sound</span>
        <button type="button" class="btn btn--sm" class:btn--primary={!sound.playing} class:btn--secondary={sound.playing}
          onclick={() => (sound.playing ? pause() : play())}>
          <Icon name={sound.playing ? "pause" : "play"} size="sm" />{sound.playing ? "Pause" : "Play"}</button>
      </header>
      <div class="sound__list" role="radiogroup" aria-label="Sound">
        {#each SOUNDS as s (s.id)}
          <button type="button" role="radio" aria-checked={s.id === sound.id} data-tip={s.tip}
            onclick={() => (sound.playing ? play(s.id) : (sound.id = s.id))}>{s.label}</button>
        {/each}
      </div>
      <label class="sound__volume">
        <span class="caption muted">Volume</span>
        <input type="range" min="0" max="1" step="0.01" value={sound.volume} aria-label="Volume"
          oninput={(e) => setVolume(Number(e.currentTarget.value))} />
        <span class="mono caption faint">{Math.round(sound.volume * 100)}</span>
      </label>
      <p class="caption faint">Made live on this computer; nothing is downloaded.</p>
    </section>
  {/if}
</div>

<style>
  .sound { position: relative; }
  .is-on { color: var(--accent); }
  .sound__panel {
    position: fixed; z-index: 60;
    display: grid; gap: var(--s-3); padding: var(--s-3);
    background: var(--surface-raised, var(--surface)); border: 1px solid var(--border); border-radius: var(--r-md);
    box-shadow: 0 12px 32px rgb(0 0 0 / .28);
  }
  .sound__head { display: flex; justify-content: space-between; align-items: center; }
  .sound__list { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 3px; background: var(--surface-sunken); border-radius: var(--r-sm); }
  .sound__list button { height: 32px; border-radius: 4px; font-size: 13px; font-weight: 550; color: var(--text-muted); }
  .sound__list button:hover { color: var(--text); }
  .sound__list button[aria-checked="true"] { color: var(--text); background: var(--surface); box-shadow: 0 1px 2px rgb(0 0 0 / .08), 0 0 0 1px var(--border); }
  .sound__volume { display: grid; grid-template-columns: auto 1fr 28px; align-items: center; gap: var(--s-2); }
  .sound__volume input { width: 100%; accent-color: var(--accent); }
  .sound__volume .mono { text-align: right; }
</style>
