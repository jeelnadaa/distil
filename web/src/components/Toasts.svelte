<script lang="ts">
  import { toasts } from "../lib/state.svelte.ts";
  import Icon from "./Icon.svelte";

  const dismiss = (id: number) => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i !== -1) toasts.splice(i, 1);
  };
</script>

<div class="toast-stack" aria-live="polite">
  {#each toasts as t (t.id)}
    <div class="toast" role={t.tone === "error" ? "alert" : "status"}>
      {#if t.tone === "error"}<Icon name="warning" size="sm" />{/if}
      <span>{t.text}</span><span class="spacer"></span>
      <button type="button" class="btn btn--ghost btn--icon btn--sm" aria-label="Dismiss" onclick={() => dismiss(t.id)}><Icon name="x" size="sm" /></button>
    </div>
  {/each}
</div>
