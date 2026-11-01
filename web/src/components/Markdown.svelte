<script lang="ts">
  import { renderMarkdown } from "../lib/markdown.ts";
  import { type Segment, segments } from "../lib/visuals.ts";
  import Widget from "./visuals/Widget.svelte";

  // A reply as Markdown with its widget blocks drawn in place (plan.md §7.5). Text and widgets are separate
  // segments, so streamed text re-renders below a widget without re-mounting it.
  // messageId: lets mini-apps and figures be built for this reply; onretry: redraws blocks that failed.
  let { source, streaming = false, messageId = null, onretry }: {
    source: string; streaming?: boolean; messageId?: string | null; onretry?: () => Promise<void>;
  } = $props();

  // While streaming, split and render at most once per frame, always the latest text, however fast tokens arrive.
  let parts = $state<(Segment & { html?: string })[]>([]);
  let latest = "";
  let scheduled = false;
  const render = (text: string) => segments(text).map((s) => (s.kind === "md" ? { ...s, html: renderMarkdown(s.text) } : s));
  $effect(() => {
    latest = source;
    if (!streaming) {
      parts = render(latest);
      return;
    }
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      parts = render(latest);
    });
  });
</script>

{#each parts as part, i (i)}
  {#if part.kind === "md"}
    <div class="md">{@html part.html}</div>
  {:else}
    {#key part.closed ? `${part.lang}:${part.source}` : part.lang}
      <Widget lang={part.lang} source={part.source} closed={part.closed} {streaming} messageId={streaming ? null : messageId} built={part.built} {onretry} />
    {/key}
  {/if}
{/each}
