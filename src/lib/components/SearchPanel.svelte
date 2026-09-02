<script lang="ts">
  import type { SearchResult } from "$lib/types";

  interface Props {
    open: boolean;
    query: string;
    results: SearchResult[];
    loading: boolean;
    onQueryChange: (q: string) => void;
    onSelect: (path: string) => void;
    onClose: () => void;
  }

  let { open, query, results, loading, onQueryChange, onSelect, onClose }: Props = $props();

  let inputEl = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (open && inputEl) {
      inputEl.focus();
      inputEl.select();
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[15vh] backdrop-blur-sm"
    role="presentation"
    onclick={onClose}
  >
    <div
      class="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-lg"
      style:box-shadow="var(--shadow)"
      onclick={(e) => e.stopPropagation()}
      onkeydown={handleKeydown}
      role="dialog"
      aria-modal="true"
      aria-label="Recherche rapide"
      tabindex="-1"
    >
      <div class="flex items-center gap-3 border-b border-border px-4 py-3">
        <span class="pixel-icon text-accent-blue">⌕</span>
        <input
          bind:this={inputEl}
          type="search"
          class="flex-1 bg-transparent text-sm outline-none placeholder:text-text-muted"
          placeholder="Rechercher une note… (Ctrl+T)"
          value={query}
          oninput={(e) => onQueryChange(e.currentTarget.value)}
        />
        <kbd class="rounded-lg border border-border px-2 py-0.5 text-[10px] text-text-muted">Esc</kbd>
      </div>

      <div class="max-h-80 overflow-y-auto">
        {#if loading}
          <p class="px-4 py-6 text-center text-sm text-text-muted">Recherche…</p>
        {:else if query.trim() && results.length === 0}
          <p class="px-4 py-6 text-center text-sm text-text-muted">Aucun résultat</p>
        {:else if results.length > 0}
          <ul>
            {#each results as result (result.path)}
              <li>
                <button
                  type="button"
                  class="flex w-full flex-col gap-0.5 border-b border-border/50 px-4 py-3 text-left transition hover:bg-surface-muted"
                  onclick={() => onSelect(result.path)}
                >
                  <span class="text-sm font-medium">{result.title}</span>
                  <span class="truncate text-xs text-text-muted">{result.snippet || result.path}</span>
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="px-4 py-6 text-center text-sm text-text-muted">
            Tapez pour rechercher dans vos notes
          </p>
        {/if}
      </div>
    </div>
  </div>
{/if}
