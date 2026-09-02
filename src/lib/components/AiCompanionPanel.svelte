<script lang="ts">
  import type { AiSuggestion } from "$lib/types";

  interface Props {
    open: boolean;
    noteContext: string;
    suggestions: AiSuggestion[];
    aiLoading: boolean;
    onContextChange: (value: string) => void;
    onApply: (id: string) => void;
    onDismiss: (id: string) => void;
    onDismissAll: () => void;
    onClose: () => void;
  }

  let {
    open,
    noteContext,
    suggestions,
    aiLoading,
    onContextChange,
    onApply,
    onDismiss,
    onDismissAll,
    onClose,
  }: Props = $props();
</script>

{#if open}
  <aside
    class="flex h-full w-80 shrink-0 flex-col border-l border-border bg-surface-muted"
    aria-label="Compagnon IA — suggestions"
  >
    <header class="flex items-center justify-between border-b border-border px-3 py-2">
      <div>
        <h3 class="text-sm font-semibold">Compagnon IA</h3>
        <p class="text-[10px] text-text-muted">Suggestions · vous choisissez d'appliquer</p>
      </div>
      <button
        type="button"
        class="rounded-lg px-2 py-1 text-xs text-text-muted hover:bg-surface"
        onclick={onClose}
        aria-label="Fermer le panneau"
      >
        ✕
      </button>
    </header>

    <section class="border-b border-border px-3 py-3">
      <label
        for="note-context-field"
        class="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-text-muted"
      >
        Contexte / objectif de la note
      </label>
      <textarea
        id="note-context-field"
        class="w-full resize-none rounded-xl border border-border bg-surface px-2 py-1.5 text-xs leading-relaxed outline-none focus:ring-1 focus:ring-accent-lavender"
        rows="3"
        placeholder="Ex. : recette pour un dîner entre amis, plan de table…"
        value={noteContext}
        oninput={(e) => onContextChange(e.currentTarget.value)}
      ></textarea>
      <p class="mt-1 text-[10px] text-text-muted">
        Utilisé pour reformulations et traductions cohérentes avec votre intention.
      </p>
    </section>

    <div class="flex items-center justify-between border-b border-border px-3 py-1.5">
      <span class="text-[10px] font-medium text-text-muted">
        {suggestions.length} suggestion{suggestions.length === 1 ? "" : "s"}
      </span>
      {#if suggestions.length}
        <button
          type="button"
          class="text-[10px] text-text-muted hover:text-text"
          onclick={onDismissAll}
        >
          Tout ignorer
        </button>
      {/if}
    </div>

    <div class="flex-1 space-y-2 overflow-y-auto px-3 py-2">
      {#if aiLoading}
        <p class="text-xs text-accent-blue">Réflexion en cours…</p>
      {/if}

      {#if suggestions.length === 0 && !aiLoading}
        <p class="text-xs text-text-muted">
          Clic droit dans l'éditeur ou bouton ✦ IA pour demander une suggestion. Rien n'est
          modifié tant que vous n'appliquez pas.
        </p>
      {/if}

      {#each suggestions as s (s.id)}
        <article class="rounded-xl border border-border bg-surface p-2.5">
          <div class="mb-1 flex items-center justify-between gap-2">
            <span class="text-[10px] font-semibold text-accent-lavender">{s.label}</span>
            <span class="text-[9px] text-text-muted">{s.scope}</span>
          </div>
          <p class="mb-2 line-clamp-4 whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-text">
            {s.proposedText}
          </p>
          <div class="flex gap-1">
            <button
              type="button"
              class="flex-1 rounded-lg bg-accent-mint/40 px-2 py-1 text-[10px] font-medium hover:bg-accent-mint/60"
              onclick={() => onApply(s.id)}
            >
              Appliquer
            </button>
            <button
              type="button"
              class="rounded-lg border border-border px-2 py-1 text-[10px] hover:bg-surface-muted"
              onclick={() => onDismiss(s.id)}
            >
              Ignorer
            </button>
          </div>
        </article>
      {/each}
    </div>
  </aside>
{/if}
