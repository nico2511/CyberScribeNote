<script lang="ts">
  import type { AiAction } from "$lib/types";
  import type { TextSelection } from "$lib/voice/commands";

  interface Props {
    open: boolean;
    x: number;
    y: number;
    hasSelection: boolean;
    ollamaAvailable: boolean;
    aiLoading: boolean;
    onAction: (action: AiAction) => void;
    onClose: () => void;
  }

  let { open, x, y, hasSelection, ollamaAvailable, aiLoading, onAction, onClose }: Props =
    $props();

  let panelRef = $state<HTMLDivElement | null>(null);

  const actions: { id: AiAction; label: string; desc: string }[] = [
    { id: "reformulate", label: "Reformuler", desc: "Suggestion plus claire" },
    { id: "correct", label: "Corriger", desc: "Orthographe & grammaire" },
    { id: "translate_en", label: "Traduire (EN)", desc: "Vers l'anglais" },
    { id: "summarize", label: "Résumer", desc: "Synthèse courte" },
  ];

  const panelStyle = $derived.by(() => {
    const width = 240;
    const margin = 8;
    const left = Math.min(Math.max(margin, x), window.innerWidth - width - margin);
    const top = Math.min(Math.max(margin, y), window.innerHeight - 320 - margin);
    return `left:${left}px;top:${top}px;width:${width}px;`;
  });

  function handleWindowClick(e: MouseEvent) {
    if (panelRef && !panelRef.contains(e.target as Node)) onClose();
  }
</script>

{#if open}
  <div
    bind:this={panelRef}
    class="fixed z-50 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-xl"
    style={panelStyle}
    style:box-shadow="var(--shadow)"
    role="menu"
    tabindex="-1"
    aria-label="Actions sur le texte"
  >
    <div class="border-b border-border px-3 py-2">
      <p class="text-xs font-semibold">✦ Compagnon IA</p>
      <p class="text-[10px] text-text-muted">
        {hasSelection ? "Cible : sélection" : "Cible : note entière"} · suggestion latérale
      </p>
    </div>

    {#if !ollamaAvailable}
      <p class="px-3 py-2 text-xs text-text-muted">Ollama hors ligne</p>
    {:else}
      {#each actions as action (action.id)}
        <button
          type="button"
          class="block w-full px-3 py-2 text-left transition hover:bg-accent-lavender/20 disabled:opacity-40"
          role="menuitem"
          disabled={aiLoading}
          onclick={() => onAction(action.id)}
        >
          <span class="block text-xs font-medium">{action.label}</span>
          <span class="block text-[10px] text-text-muted">{action.desc}</span>
        </button>
      {/each}
    {/if}
  </div>
{/if}

<svelte:window onclick={handleWindowClick} onkeydown={(e) => e.key === "Escape" && onClose()} />
