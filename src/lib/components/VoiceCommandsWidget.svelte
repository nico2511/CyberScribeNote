<script lang="ts">
  import {
    VOICE_CATEGORY_LABELS,
    VOICE_COMMANDS,
    type VoiceCommandInfo,
  } from "$lib/voice/commands";

  interface Props {
    hotkey: string;
    open: boolean;
    x: number;
    y: number;
    onClose: () => void;
  }

  let { hotkey, open, x, y, onClose }: Props = $props();

  let panelRef = $state<HTMLDivElement | null>(null);

  const categories = ["dictée", "ia", "navigation"] as const;

  const panelStyle = $derived.by(() => {
    const width = 300;
    const maxHeight = 420;
    const margin = 8;
    const left = Math.min(Math.max(margin, x), window.innerWidth - width - margin);
    const top = Math.min(Math.max(margin, y), window.innerHeight - maxHeight - margin);
    return `left:${left}px;top:${top}px;width:${width}px;max-height:${maxHeight}px;`;
  });

  function commandsFor(cat: VoiceCommandInfo["category"]) {
    return VOICE_COMMANDS.filter((c) => c.category === cat);
  }

  function handleWindowClick(e: MouseEvent) {
    if (!open) return;
    if (panelRef && !panelRef.contains(e.target as Node)) {
      onClose();
    }
  }

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
  }
</script>

{#if open}
  <div
    bind:this={panelRef}
    class="voice-context-menu fixed z-50 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-xl"
    style={panelStyle}
    style:box-shadow="var(--shadow)"
    role="menu"
    tabindex="-1"
    aria-label="Commandes vocales CyberScribe"
    oncontextmenu={handleContextMenu}
  >
    <div class="border-b border-border px-3 py-2">
      <p class="text-xs font-semibold">Commandes vocales</p>
      <p class="text-[10px] text-text-muted">Dites « Scribe, … » · {hotkey} pour enregistrer</p>
    </div>

    <div class="max-h-80 overflow-y-auto py-1">
      {#each categories as cat (cat)}
        <div class="px-1 py-0.5">
          <p class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            {VOICE_CATEGORY_LABELS[cat]}
          </p>
          {#each commandsFor(cat) as cmd (cmd.phrase)}
            <div
              class="mx-1 rounded-md px-2 py-1.5 text-left hover:bg-accent-lavender/20"
              role="menuitem"
            >
              <p class="font-mono text-[11px] text-accent-blue">{cmd.phrase}</p>
              <p class="text-[10px] leading-snug text-text-muted">{cmd.description}</p>
              {#if cmd.requiresNote || cmd.requiresOllama}
                <div class="mt-0.5 flex flex-wrap gap-1">
                  {#if cmd.requiresNote}
                    <span class="text-[9px] text-text-muted">· note ouverte</span>
                  {/if}
                  {#if cmd.requiresOllama}
                    <span class="text-[9px] text-text-muted">· Ollama</span>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
        {#if cat !== "navigation"}
          <div class="my-1 border-t border-border/70" role="separator"></div>
        {/if}
      {/each}
    </div>

    <div class="border-t border-border px-3 py-1.5 text-[10px] text-text-muted">
      Préfixe « Scribe, … » · {hotkey} pour dicter · bouton 🗣 Commandes ci-dessus
    </div>
  </div>
{/if}

<svelte:window onclick={handleWindowClick} onkeydown={(e) => e.key === "Escape" && onClose()} />

<style>
  .voice-context-menu {
    animation: voice-menu-in 120ms ease-out;
  }

  @keyframes voice-menu-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
