<script lang="ts">
  import type { OutlineItem } from "$lib/markdown/outline";

  interface Props {
    items: OutlineItem[];
    onNavigate: (offset: number) => void;
  }

  let { items, onNavigate }: Props = $props();
</script>

{#if items.length > 0}
  <nav class="outline-panel border-b border-border bg-surface-muted/40 px-3 py-2" aria-label="Table des matières">
    <p class="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Outline</p>
    <ul class="max-h-36 space-y-0.5 overflow-y-auto">
      {#each items as item, i (item.offset + "-" + i)}
        <li style:padding-left="{(item.level - 1) * 0.65}rem">
          <button
            type="button"
            class="w-full truncate rounded-lg px-1.5 py-0.5 text-left text-[11px] text-text transition hover:bg-accent-lavender/25"
            title={item.text}
            onclick={() => onNavigate(item.offset)}
          >
            {item.text}
          </button>
        </li>
      {/each}
    </ul>
  </nav>
{/if}
