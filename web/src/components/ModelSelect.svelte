<script lang="ts">
  import type { ModelRef } from "../lib/api.ts";
  import { app } from "../lib/state.svelte.ts";

  let { value, onchange, label, compact = false, placeholder = "Choose a model" }: {
    value: ModelRef | null; onchange: (ref: ModelRef) => void; label: string; compact?: boolean; placeholder?: string;
  } = $props();

  const key = (ref: ModelRef | null) => (ref ? `${ref.provider}\u0000${ref.id}` : "");
  const groups = $derived(app.providers.filter((p) => p.configured).map((p) => {
    const models = app.models[p.id];
    return { provider: p, models: Array.isArray(models) ? models : [], state: Array.isArray(models) ? "ready" : models };
  }));
  // Keep the current choice visible even if its provider's list hasn't loaded or no longer has it.
  const missing = $derived(value && !groups.some((g) => g.provider.id === value.provider && g.models.some((m) => m.id === value.id)) ? value : null);

  const change = (e: Event) => {
    const [provider, id] = (e.currentTarget as HTMLSelectElement).value.split("\u0000");
    if (provider && id) onchange({ provider, id });
  };
</script>

<select class="select" class:select--compact={compact} aria-label={label} value={key(value)} onchange={change}>
  {#if !value}<option value="" disabled>{placeholder}</option>{/if}
  {#if missing}<option value={key(missing)}>{missing.id}</option>{/if}
  {#each groups as group (group.provider.id)}
    <optgroup label={group.state === "loading" ? `${group.provider.name} (loading…)` : group.state && typeof group.state === "object" ? `${group.provider.name} (couldn't load models)` : group.provider.name}>
      {#each group.models as model (model.id)}
        <option value={key({ provider: group.provider.id, id: model.id })}>{model.name === model.id ? model.id : `${model.name} · ${model.id}`}</option>
      {/each}
    </optgroup>
  {/each}
</select>

<style>
  .select--compact { width: auto; max-width: 260px; height: 32px; font-size: 12.5px; border-color: transparent; background-color: transparent; }
  .select--compact:hover { background-color: var(--surface-sunken); }
</style>
