<script lang="ts" module>
  export type SelectOption = { value: string; label: string; group?: string; disabled?: boolean };
</script>

<script lang="ts">
  import Icon from "./Icon.svelte";

  // The themed dropdown used in place of the browser's <select>, whose open list can't follow the
  // palette. A button plus a listbox: arrow keys, Home/End, type-ahead, Enter or Space to choose, Escape to close.
  let { value, options, onchange, label, placeholder = "Choose…", compact = false, tip, id }: {
    value: string; options: SelectOption[]; onchange: (value: string) => void; label: string;
    placeholder?: string; compact?: boolean; tip?: string; id?: string;
  } = $props();

  const uid = `sel-${Math.random().toString(36).slice(2, 8)}`;
  let open = $state(false);
  let active = $state(-1);
  let trigger = $state<HTMLButtonElement>();
  let list = $state<HTMLElement>();
  let pos = $state({ top: 0, left: 0, width: 0, up: false });
  let typed = "";
  let typedAt = 0;

  const current = $derived(options.find((o) => o.value === value));
  const enabled = (i: number) => !!options[i] && !options[i]!.disabled;

  function show() {
    const rect = trigger!.getBoundingClientRect();
    const height = Math.min(320, options.length * 34 + 16);
    const up = rect.bottom + height + 8 > innerHeight && rect.top > height;
    pos = { top: up ? rect.top - 4 : rect.bottom + 4, left: rect.left, width: rect.width, up };
    active = Math.max(0, options.findIndex((o) => o.value === value));
    open = true;
  }

  function choose(i: number) {
    if (!enabled(i)) return;
    open = false;
    trigger?.focus();
    if (options[i]!.value !== value) onchange(options[i]!.value);
  }

  function move(from: number, step: 1 | -1) {
    for (let i = from + step; i >= 0 && i < options.length; i += step) if (enabled(i)) return (active = i);
  }

  function key(e: KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); show(); }
      return;
    }
    if (e.key === "ArrowDown") move(active, 1);
    else if (e.key === "ArrowUp") move(active, -1);
    else if (e.key === "Home") move(-1, 1);
    else if (e.key === "End") move(options.length, -1);
    else if (e.key === "Enter" || e.key === " ") choose(active);
    else if (e.key === "Escape" || e.key === "Tab") { open = false; if (e.key === "Tab") return; }
    else if (e.key.length === 1) {
      typed = Date.now() - typedAt > 700 ? e.key.toLowerCase() : typed + e.key.toLowerCase();
      typedAt = Date.now();
      const hit = options.findIndex((o, i) => enabled(i) && o.label.toLowerCase().startsWith(typed));
      if (hit >= 0) active = hit;
    } else return;
    e.preventDefault();
  }

  $effect(() => {
    if (!open) return;
    list?.querySelector(`#${uid}-${active}`)?.scrollIntoView({ block: "nearest" });
  });

  $effect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!trigger?.contains(e.target as Node) && !list?.contains(e.target as Node)) open = false; };
    const dismiss = (e: Event) => { if (!list?.contains(e.target as Node)) open = false; };
    document.addEventListener("pointerdown", close);
    addEventListener("resize", dismiss);
    addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      removeEventListener("resize", dismiss);
      removeEventListener("scroll", dismiss, true);
    };
  });
</script>

<button bind:this={trigger} type="button" {id} class="select sel" class:select--compact={compact} role="combobox"
  aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={uid}
  aria-activedescendant={open && active >= 0 ? `${uid}-${active}` : undefined} data-tip={tip}
  onclick={() => (open ? (open = false) : show())} onkeydown={key}>
  <span class="sel__value" class:faint={!current}>{current?.label ?? placeholder}</span>
</button>

{#if open}
  <div bind:this={list} id={uid} class="sel__list" class:sel__list--up={pos.up} role="listbox" aria-label={label}
    style:top="{pos.top}px" style:left="{pos.left}px" style:min-width="{pos.width}px">
    {#each options as option, i (option.value)}
      {#if option.group && option.group !== options[i - 1]?.group}<div class="sel__group" role="presentation">{option.group}</div>{/if}
      <div id="{uid}-{i}" role="option" class="sel__option" class:is-active={i === active} aria-selected={option.value === value}
        aria-disabled={option.disabled || undefined} tabindex="-1"
        onpointermove={() => enabled(i) && (active = i)} onclick={() => choose(i)} onkeydown={key}>
        <span>{option.label}</span>
        {#if option.value === value}<Icon name="check" size="sm" />{/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .sel { display: inline-flex; align-items: center; text-align: left; cursor: pointer; }
  .sel__value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sel[aria-expanded="true"] { border-color: var(--accent); }
  .sel__list {
    position: fixed; z-index: 70; max-width: min(420px, calc(100vw - 32px)); max-height: 320px; overflow: auto;
    display: grid; padding: 4px; background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--r-md); box-shadow: var(--shadow-float); animation: dialog-in var(--dur-base) var(--spring-smooth);
  }
  .sel__list--up { translate: 0 -100%; }
  .sel__group { padding: var(--s-2) var(--s-2) 2px; font-size: 11px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; color: var(--text-faint); }
  .sel__option {
    display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); min-height: 32px; padding: 0 var(--s-2);
    border-radius: var(--r-sm); font-size: var(--t-body-sm); color: var(--text-muted); cursor: pointer;
  }
  .sel__option.is-active { background: var(--surface-sunken); color: var(--text); }
  .sel__option[aria-selected="true"] { color: var(--text); font-weight: 560; }
  .sel__option[aria-disabled="true"] { color: var(--text-faint); cursor: default; }
  .sel__option :global(.icon) { flex: none; color: var(--accent); }
</style>
