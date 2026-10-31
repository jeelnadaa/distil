<script lang="ts">
  import type { PDFDocumentProxy } from "pdfjs-dist";

  // The original PDF, drawn page by page with pdf.js (loaded only when this opens). Pages render as
  // they scroll into view, so a 500-page book opens as fast as a short handout.
  let { url, page }: { url: string; page: number } = $props();

  let root = $state<HTMLElement>();
  let doc = $state<PDFDocumentProxy | null>(null);
  let ratio = $state(1.414);
  let error = $state("");

  $effect(() => {
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | null = null;
    (async () => {
      const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const loading = pdfjs.getDocument({ url });
      task = loading;
      const loaded = await loading.promise;
      if (cancelled) return;
      const first = (await loaded.getPage(1)).getViewport({ scale: 1 });
      ratio = first.height / first.width;
      doc = loaded;
    })().catch((err) => { if (!cancelled) error = err instanceof Error ? err.message : String(err); });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  });

  // Jump to the cited page once the placeholders exist.
  $effect(() => {
    if (!doc || !root) return;
    root.querySelector(`[data-page="${page}"]`)?.scrollIntoView({ block: "start" });
  });

  // Draw each page the first time it comes near the viewport.
  $effect(() => {
    if (!doc || !root) return;
    const pdf = doc;
    const drawn = new Set<number>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const n = Number(el.dataset.page);
        if (!entry.isIntersecting || drawn.has(n)) continue;
        drawn.add(n);
        void draw(pdf, n, el.querySelector("canvas")!);
      }
    }, { root: root.closest(".scroll"), rootMargin: "600px 0px" });
    root.querySelectorAll("[data-page]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  });

  async function draw(pdf: PDFDocumentProxy, n: number, canvas: HTMLCanvasElement) {
    const p = await pdf.getPage(n);
    const scale = (canvas.clientWidth / p.getViewport({ scale: 1 }).width) * devicePixelRatio;
    const viewport = p.getViewport({ scale });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await p.render({ canvas, viewport }).promise;
  }
</script>

<div class="pdf" bind:this={root}>
  {#if error}
    <p class="ws__empty">This PDF couldn't be shown: {error}</p>
  {:else if !doc}
    <p class="ws__empty">Opening the PDF…</p>
  {:else}
    {#each { length: doc.numPages } as _, i (i)}
      <figure class="pdf__page" data-page={i + 1} class:is-target={i + 1 === page}>
        <canvas style:aspect-ratio="1 / {ratio}" aria-label="Page {i + 1}"></canvas>
        <figcaption class="mono">p.{i + 1}</figcaption>
      </figure>
    {/each}
  {/if}
</div>

<style>
  .pdf { display: grid; gap: var(--s-5); width: min(860px, 100% - 2 * var(--s-6)); margin-inline: auto; padding-block: var(--s-6) var(--s-9); }
  .pdf__page { margin: 0; display: grid; gap: var(--s-2); scroll-margin-top: var(--s-4); }
  .pdf__page canvas { display: block; width: 100%; background: #fff; border-radius: var(--r-xs); box-shadow: 0 0 0 1px var(--border), var(--shadow-sm, none); }
  .pdf__page.is-target canvas { box-shadow: 0 0 0 2px var(--accent); }
  figcaption { font-size: 11px; color: var(--text-faint); text-align: center; }
  .pdf__page.is-target figcaption { color: var(--accent); }
</style>
