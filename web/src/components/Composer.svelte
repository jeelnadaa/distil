<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  let { value = $bindable(""), busy = false, onsend, onstop, placeholder = "Ask, paste a problem, or have something explained…", children }: {
    value?: string; busy?: boolean; onsend: (text: string) => void; onstop?: () => void; placeholder?: string; children?: Snippet;
  } = $props();

  let field = $state<HTMLTextAreaElement>();

  // Grow with the text up to the CSS max-height (40 % of the viewport), measured again when the width changes.
  const fit = () => {
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  };
  $effect(() => {
    void value;
    fit();
  });
  $effect(() => {
    if (!field) return;
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => { if (field && field.clientWidth !== width) { width = field.clientWidth; fit(); } });
    observer.observe(field);
    return () => observer.disconnect();
  });

  $effect(() => { if (!busy) field?.focus(); });

  const submit = () => {
    if (busy || !value.trim()) return;
    onsend(value);
  };

  const onkeydown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape" && busy) {
      onstop?.();
    }
  };
</script>

<form class="composer" onsubmit={(e) => { e.preventDefault(); submit(); }}>
  <textarea bind:this={field} bind:value rows="1" {placeholder} aria-label="Message" {onkeydown}></textarea>
  <div class="composer__bar">
    {@render children?.()}
    <span class="spacer"></span>
    <span class="caption faint hint">{busy ? "Esc to stop" : "Shift + Enter for a new line"}</span>
    {#if busy}
      <button type="button" class="btn btn--secondary btn--icon btn--sm" aria-label="Stop" data-tip="Stop (Esc)" onclick={() => onstop?.()}><Icon name="stop" size="sm" /></button>
    {:else}
      <button type="submit" class="btn btn--primary btn--icon btn--sm" aria-label="Send" data-tip="Send (Enter)" disabled={!value.trim()}><Icon name="arrow-up" size="sm" /></button>
    {/if}
  </div>
</form>

<style>
  .hint { margin-right: var(--s-2); }
  @media (max-width: 600px) { .hint { display: none; } }
</style>
