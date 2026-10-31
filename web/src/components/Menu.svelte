<script lang="ts" module>
  export type MenuItem = { label: string; icon: string; danger?: boolean; run: () => void };
</script>

<script lang="ts">
  import Icon from "./Icon.svelte";

  let { items, label }: { items: MenuItem[]; label: string } = $props();

  let open = $state(false);
  let root = $state<HTMLElement>();
  let pos = $state({ top: 0, right: 0, up: false });

  // Fixed positioning keeps the list clear of scrolling parents such as the sidebar tree.
  function toggle(e: MouseEvent) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const up = rect.bottom + 40 * items.length + 16 > innerHeight;
    pos = { top: up ? rect.top - 4 : rect.bottom + 4, right: innerWidth - rect.right, up };
    open = !open;
  }

  $effect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!root?.contains(e.target as Node)) open = false; };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") open = false; };
    const dismiss = () => (open = false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    addEventListener("resize", dismiss);
    addEventListener("scroll", dismiss, true);
    root?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
      removeEventListener("resize", dismiss);
      removeEventListener("scroll", dismiss, true);
    };
  });

  const choose = (item: MenuItem) => {
    open = false;
    item.run();
  };
</script>

<span class="menu" bind:this={root}>
  <button type="button" class="btn btn--ghost btn--icon btn--sm menu__trigger" aria-label={label} aria-haspopup="menu" aria-expanded={open}
    onclick={toggle}>
    <Icon name="dots" size="sm" />
  </button>
  {#if open}
    <span class="menu__list" class:menu__list--up={pos.up} role="menu" style:top="{pos.top}px" style:right="{pos.right}px">
      {#each items as item (item.label)}
        <button type="button" role="menuitem" class:is-danger={item.danger} onclick={(e) => { e.stopPropagation(); choose(item); }}>
          <Icon name={item.icon} size="sm" />{item.label}
        </button>
      {/each}
    </span>
  {/if}
</span>

<style>
  .menu { position: relative; display: inline-flex; }
  .menu__list {
    position: fixed; z-index: 40; min-width: 180px;
    display: grid; padding: 4px; background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--r-md); box-shadow: var(--shadow-float); animation: dialog-in var(--dur-base) var(--spring-smooth);
  }
  .menu__list--up { translate: 0 -100%; }
  .menu__list button {
    display: flex; align-items: center; gap: var(--s-2); height: 32px; padding: 0 var(--s-2);
    border-radius: var(--r-sm); font-size: var(--t-body-sm); font-weight: 520; color: var(--text-muted); text-align: left;
  }
  .menu__list button:hover, .menu__list button:focus-visible { background: var(--surface-sunken); color: var(--text); outline: none; }
  .menu__list .is-danger { color: var(--danger); }
  .menu__list .is-danger:hover { color: var(--danger); background: var(--danger-wash); }
</style>
