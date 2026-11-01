<script lang="ts" module>
  import type { Dial } from "../lib/api.ts";
  import { app, library } from "../lib/state.svelte.ts";

  export const DIAL_LABEL: Record<Dial, string> = { text: "Text-only", balanced: "Balanced", visual: "Visual-heavy" };
  export const DIAL_TIP: Record<Dial, string> = {
    text: "No visuals unless you ask for one",
    balanced: "A visual when the idea is a process, a shape or something that moves",
    visual: "A visual for every step where one fits",
  };

  // The dial a chat or folder inherits: the nearest folder's up the tree, else Settings' (F-741).
  export function inheritedDial(folderId: string | null): Dial {
    for (let id = folderId; id; ) {
      const folder = library.folders.find((f) => f.id === id);
      if (!folder) break;
      if (folder.dial) return folder.dial;
      id = folder.parentId;
    }
    return app.settings?.dial ?? "balanced";
  }
</script>

<script lang="ts">
  import Select from "./Select.svelte";

  // The interactivity dial for one chat or folder (F-741): its own setting, or the one it inherits.
  let { value, inherited, label, onchange }: { value: Dial | null; inherited: Dial; label: string; onchange: (dial: Dial | null) => void } = $props();

  const options = $derived([
    { value: "inherit", label: `Visuals · ${DIAL_LABEL[inherited]} (default)` },
    ...(Object.keys(DIAL_LABEL) as Dial[]).map((d) => ({ value: d, label: `Visuals · ${DIAL_LABEL[d]}` })),
  ]);
</script>

<Select compact {label} value={value ?? "inherit"} {options} tip={DIAL_TIP[value ?? inherited]} onchange={(v) => onchange(v === "inherit" ? null : (v as Dial))} />
