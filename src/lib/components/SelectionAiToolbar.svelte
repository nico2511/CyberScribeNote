<script lang="ts">
  import type { AiAction } from "$lib/types";
  import type { TextSelection } from "$lib/voice/commands";

  interface Props {
    selection: TextSelection;
    ollamaAvailable: boolean;
    aiLoading: boolean;
    onAction: (action: AiAction, selection: TextSelection) => void;
    onClear: () => void;
  }

  let { selection, ollamaAvailable, aiLoading, onAction, onClear }: Props = $props();

  const actions: { id: AiAction; label: string; icon: string }[] = [
    { id: "reformulate", label: "Reformuler", icon: "↻" },
    { id: "correct", label: "Corriger", icon: "✓" },
    { id: "translate_en", label: "EN", icon: "A→" },
    { id: "summarize", label: "Résumer", icon: "✦" },
  ];

  let preview = $derived(
    selection.text.length > 48 ? `${selection.text.slice(0, 48)}…` : selection.text,
  );
</script>

<div
  class="flex flex-wrap items-center gap-2 border-b border-accent-lavender/30 bg-accent-lavender/10 px-4 py-2"
  role="toolbar"
  aria-label="Actions IA sur la sélection"
>
  <span class="shrink-0 text-[10px] font-medium uppercase tracking-wide text-text-muted">
    Sélection
  </span>
  <span
    class="max-w-[12rem] truncate rounded-lg bg-surface/80 px-2 py-0.5 font-mono text-[10px] text-text-muted"
    title={selection.text}
  >
    « {preview} »
  </span>

  <div class="flex flex-wrap gap-1">
    {#each actions as action (action.id)}
      <button
        type="button"
        class="rounded-xl border border-border bg-surface px-2.5 py-1 text-[11px] transition hover:bg-surface-muted disabled:opacity-40"
        disabled={!ollamaAvailable || aiLoading}
        title={ollamaAvailable ? action.label : "Ollama requis"}
        onclick={() => onAction(action.id, selection)}
      >
        <span class="pixel-icon mr-0.5">{action.icon}</span>
        {action.label}
      </button>
    {/each}
  </div>

  <button
    type="button"
    class="ml-auto rounded-lg px-2 py-0.5 text-[10px] text-text-muted hover:bg-surface/80"
    onclick={onClear}
  >
    ✕
  </button>
</div>
