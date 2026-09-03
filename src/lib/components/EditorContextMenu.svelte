<script lang="ts">
  import type { AiActionRequest } from "$lib/voice/commands";
  import { TRANSLATE_LANGUAGES, type TranslateLang } from "$lib/ai/languages";

  interface Props {
    open: boolean;
    x: number;
    y: number;
    hasSelection: boolean;
    ollamaAvailable: boolean;
    aiLoading: boolean;
    onAction: (request: AiActionRequest) => void;
    onClose: () => void;
  }

  let { open, x, y, hasSelection, ollamaAvailable, aiLoading, onAction, onClose }: Props =
    $props();

  let panelRef = $state<HTMLDivElement | null>(null);
  let translateOpen = $state(false);

  const actions: { id: AiActionRequest["action"]; label: string; desc: string }[] = [
    { id: "reformulate", label: "Reformuler", desc: "Suggestion plus claire" },
    { id: "correct", label: "Corriger", desc: "Orthographe & grammaire" },
    { id: "summarize", label: "Résumer", desc: "Ajoute un résumé en fin de note" },
  ];

  const panelStyle = $derived.by(() => {
    const width = 260;
    const margin = 8;
    const left = Math.min(Math.max(margin, x), window.innerWidth - width - margin);
    const top = Math.min(Math.max(margin, y), window.innerHeight - 380 - margin);
    return `left:${left}px;top:${top}px;width:${width}px;`;
  });

  function handleWindowClick(e: MouseEvent) {
    if (panelRef && !panelRef.contains(e.target as Node)) onClose();
  }

  function run(action: AiActionRequest["action"], translateTo?: TranslateLang) {
    onAction({ action, translateTo });
    onClose();
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
          onclick={() => run(action.id)}
        >
          <span class="block text-xs font-medium">{action.label}</span>
          <span class="block text-[10px] text-text-muted">{action.desc}</span>
        </button>
      {/each}

      <button
        type="button"
        class="block w-full px-3 py-2 text-left transition hover:bg-accent-lavender/20 disabled:opacity-40"
        role="menuitem"
        disabled={aiLoading}
        onclick={() => (translateOpen = !translateOpen)}
      >
        <span class="block text-xs font-medium">Traduire ▾</span>
        <span class="block text-[10px] text-text-muted">Langues européennes majeures</span>
      </button>
      {#if translateOpen}
        <div class="border-t border-border bg-surface-muted/40 py-1">
          {#each TRANSLATE_LANGUAGES as lang (lang.id)}
            <button
              type="button"
              class="block w-full px-4 py-1.5 text-left text-xs transition hover:bg-accent-blue/20 disabled:opacity-40"
              disabled={aiLoading}
              onclick={() => run("translate", lang.id)}
            >
              {lang.label}
              <span class="text-text-muted"> · {lang.native}</span>
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
{/if}

<svelte:window onclick={handleWindowClick} onkeydown={(e) => e.key === "Escape" && onClose()} />
