<script lang="ts">
  import { renderMarkdown } from "../lib/markdown.ts";

  let { source, streaming = false }: { source: string; streaming?: boolean } = $props();

  // While streaming, render at most once per frame, always the latest text, however fast tokens arrive.
  let html = $state("");
  let latest = "";
  let scheduled = false;
  $effect(() => {
    latest = source;
    if (!streaming) {
      html = renderMarkdown(latest);
      return;
    }
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      html = renderMarkdown(latest);
    });
  });
</script>

<div class="md">{@html html}</div>
