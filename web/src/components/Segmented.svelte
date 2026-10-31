<script lang="ts" generics="T extends string">
  let { options, value, onchange, label }: {
    options: { value: T; label: string; tip?: string }[]; value: T; onchange: (v: T) => void; label: string;
  } = $props();

  let root = $state<HTMLElement>();
  let thumb = $state({ x: 0, w: 0 });

  // Slide the thumb under the pressed option (spring timing comes from the CSS tokens).
  $effect(() => {
    void value;
    const pressed = root?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (pressed) thumb = { x: pressed.offsetLeft, w: pressed.offsetWidth };
  });
</script>

<div class="segmented" role="group" aria-label={label} bind:this={root}>
  <span class="segmented__thumb" style:width="{thumb.w}px" style:transform="translateX({thumb.x}px)"></span>
  {#each options as option (option.value)}
    <button type="button" aria-pressed={option.value === value} data-tip={option.tip} onclick={() => onchange(option.value)}>{option.label}</button>
  {/each}
</div>
