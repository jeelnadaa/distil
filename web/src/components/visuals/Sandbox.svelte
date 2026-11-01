<script lang="ts" module>
  export type SandboxMessage = { type: "error"; message: string } | { type: "height"; height: number } | { type: "ready" };
</script>

<script lang="ts">
  import { kitDocument } from "../../../../server/visuals/kit.ts";
  import { onThemeChange, themeCss } from "../../lib/visuals.ts";

  // A sandboxed frame with the Distil kit (F-754): scripts run in an opaque origin with no access to the app,
  // its storage or the network. The kit reports errors and height; theme changes are sent in live (F-756).
  let { body, title, hidden = false, maxHeight = 720, onmessage }: {
    body: string; title: string; hidden?: boolean; maxHeight?: number; onmessage?: (m: SandboxMessage) => void;
  } = $props();

  let frame = $state<HTMLIFrameElement>();
  let srcdoc = $state("");
  let height = $state(200);

  $effect(() => {
    const html = body;
    let current = true;
    void themeCss().then((css) => { if (current) srcdoc = kitDocument(html, css); });
    return () => { current = false; };
  });
  $effect(() => onThemeChange(() => {
    void themeCss().then((css) => frame?.contentWindow?.postMessage({ distil: "theme", css }, "*"));
  }));
  $effect(() => {
    const on = (e: MessageEvent) => {
      if (!frame || e.source !== frame.contentWindow || !e.data?.distil) return;
      const m = e.data as SandboxMessage;
      if (m.type === "height") height = Math.min(maxHeight, Math.max(80, Number(m.height) || 0));
      onmessage?.(m);
    };
    addEventListener("message", on);
    return () => removeEventListener("message", on);
  });
</script>

{#if srcdoc}
  <iframe bind:this={frame} {title} {srcdoc} sandbox="allow-scripts" referrerpolicy="no-referrer" class:is-hidden={hidden} style:height="{height}px" aria-hidden={hidden}></iframe>
{/if}

<style>
  iframe { display: block; width: 100%; border: 0; background: var(--surface); }
  /* Tested at its real width, out of sight, so what it measures is what will show. */
  .is-hidden { position: absolute; inset: 0 auto auto 0; visibility: hidden; pointer-events: none; }
  :global(.widget:fullscreen) iframe { flex: 1; height: auto !important; }
</style>
