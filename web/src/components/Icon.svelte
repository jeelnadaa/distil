<script lang="ts">
  let { name, size = "md" }: { name: string; size?: "sm" | "md" } = $props();
</script>

<svg class="icon" class:icon--sm={size === "sm"} aria-hidden="true"><use href="#i-{name}" /></svg>
