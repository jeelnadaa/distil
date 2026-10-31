<script lang="ts">
  import type { Snippet } from "svelte";

  let { open = $bindable(false), title, eyebrow = "", danger = false, wide = false, children, footer }: {
    open?: boolean; title: string; eyebrow?: string; danger?: boolean; wide?: boolean; children: Snippet; footer?: Snippet;
  } = $props();

  let dialog = $state<HTMLElement>();
  const titleId = `dlg-${Math.random().toString(36).slice(2, 8)}`;

  // Focus the first field (or button) on open; give focus back to whatever opened it on close.
  $effect(() => {
    if (!open || !dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    (dialog.querySelector<HTMLElement>("input, textarea, select") ?? dialog.querySelector<HTMLElement>("button"))?.focus();
    return () => opener?.focus();
  });

  const onkeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      open = false;
    }
  };
</script>

{#if open}
  <div class="dialog-root" role="presentation" {onkeydown}>
    <div class="dialog-scrim" role="presentation" onclick={() => (open = false)}></div>
    <div class="dialog" class:dialog--danger={danger} class:dialog--wide={wide} role="dialog" aria-modal="true" aria-labelledby={titleId} bind:this={dialog}>
      <div class="dialog__head">
        {#if eyebrow}<p class="eyebrow" style:color={danger ? "var(--danger)" : undefined}>{eyebrow}</p>{/if}
        <h2 class="heading-lg" id={titleId}>{title}</h2>
      </div>
      <div class="dialog__body">{@render children()}</div>
      {#if footer}<div class="dialog__foot">{@render footer()}</div>{/if}
    </div>
  </div>
{/if}
