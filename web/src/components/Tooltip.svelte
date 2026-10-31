<script lang="ts">
  // One tooltip for the whole app. Any element with data-tip gets one; a control with no visible
  // text (an icon button, a link) falls back to its aria-label. Hover shows it after a short delay,
  // keyboard focus shows it at once, and it never covers the pointer.
  const DELAY = 450;
  let tip = $state<{ text: string; x: number; y: number; below: boolean } | null>(null);
  let el = $state<HTMLElement>();
  let target: HTMLElement | null = null;
  let timer = 0;

  function source(node: EventTarget | null): [HTMLElement, string] | null {
    if (!(node instanceof Element)) return null;
    const withTip = node.closest<HTMLElement>("[data-tip]");
    if (withTip?.dataset.tip) return [withTip, withTip.dataset.tip];
    const control = node.closest<HTMLElement>("button[aria-label], a[aria-label], [role=button][aria-label]");
    const label = control?.getAttribute("aria-label");
    return control && label && !control.textContent?.trim() ? [control, label] : null;
  }

  function show(node: HTMLElement, text: string) {
    const r = node.getBoundingClientRect();
    const below = r.top < 44;
    tip = { text, x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below };
  }

  function hide() {
    clearTimeout(timer);
    target = null;
    tip = null;
  }

  function enter(e: Event, delay: number) {
    const found = source(e.target);
    if (!found) return void (target && !target.contains(e.target as Node) && hide());
    const [node, text] = found;
    if (node === target) return;
    hide();
    target = node;
    timer = window.setTimeout(() => target === node && node.isConnected && show(node, text), delay);
  }

  // Keep the bubble on screen once it has a width.
  $effect(() => {
    if (!tip || !el) return;
    const w = el.offsetWidth;
    const x = Math.min(Math.max(tip.x, w / 2 + 8), innerWidth - w / 2 - 8);
    if (x !== tip.x) tip.x = x;
  });

  $effect(() => {
    const over = (e: Event) => enter(e, DELAY);
    const focus = (e: Event) => (e.target as HTMLElement).matches?.(":focus-visible") && enter(e, 0);
    const out = (e: PointerEvent) => { if (target && !target.contains(e.relatedTarget as Node)) hide(); };
    const key = (e: KeyboardEvent) => e.key === "Escape" && hide();
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", key);
    addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", key);
      removeEventListener("scroll", hide, true);
    };
  });
</script>

{#if tip}
  <div bind:this={el} class="tip" class:tip--below={tip.below} role="tooltip" style:left="{tip.x}px" style:top="{tip.y}px">{tip.text}</div>
{/if}

<style>
  .tip {
    position: fixed; z-index: 100; translate: -50% -100%; max-width: 280px; padding: 5px 9px; pointer-events: none;
    background: var(--text); color: var(--surface); border-radius: var(--r-sm);
    font-size: 12px; font-weight: 520; line-height: 1.35; text-align: center; box-shadow: var(--shadow-float);
    animation: tip-in var(--dur-fast) var(--ease-out);
  }
  .tip--below { translate: -50% 0; }
  @keyframes tip-in { from { opacity: 0; } }
</style>
