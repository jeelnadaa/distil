<script lang="ts">
  // The approved Condense mark (DESIGN.md §2.1): three strokes narrowing to an accent drop.
  let { size = 22, animated = false, label = "" }: { size?: number; animated?: boolean; label?: string } = $props();
</script>

<svg class="mark" class:mark--animate={animated} width={size} height={size} viewBox="0 0 32 32"
  role={label ? "img" : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : "true"}>
  <rect class="mk-bar mk-bar--1" x="4" y="4.5" width="24" height="3" rx="1.5" fill="currentColor" />
  <rect class="mk-bar mk-bar--2" x="8.5" y="11" width="15" height="3" rx="1.5" fill="currentColor" />
  <rect class="mk-bar mk-bar--3" x="13" y="17.5" width="6" height="3" rx="1.5" fill="currentColor" />
  <path class="mk-drop" d="M16 21.5C16 21.5 12.8 23.42 12.8 26.3A3.2 3.2 0 0 0 19.2 26.3C19.2 23.42 16 21.5 16 21.5Z" fill="var(--accent)" />
</svg>
