<script lang="ts">
  import type { BuddyMood, BuddyTip, BuddyAction } from "$lib/ai/scribeBuddy";

  interface Props {
    visible: boolean;
    mood: BuddyMood;
    tip: BuddyTip | null;
    panelOpen?: boolean;
    onAction: (action: BuddyAction) => void;
    onOpenCompanion: () => void;
    onDismissTip: () => void;
  }

  let {
    visible,
    mood,
    tip,
    panelOpen = false,
    onAction,
    onOpenCompanion,
    onDismissTip,
  }: Props = $props();

  const moodLabel: Record<BuddyMood, string> = {
    idle: "au repos",
    listen: "écoute",
    think: "réfléchit",
    idea: "a une idée",
    ok: "content",
    warn: "signale un souci",
  };

  function runTipAction() {
    if (!tip?.action) {
      onOpenCompanion();
      return;
    }
    onAction(tip.action);
  }
</script>

{#if visible}
  <div
    class="scribe-buddy fixed z-40 flex flex-col items-end gap-2"
    class:buddy-shift={panelOpen}
    style:right="16px"
    style:bottom="16px"
    aria-live="polite"
  >
    {#if tip && tip.message && tip.id !== "idle" && tip.id !== "typing"}
      <div
        class="buddy-bubble max-w-[220px] rounded-2xl border border-border bg-surface px-2.5 py-2 shadow-lg"
        style:box-shadow="var(--shadow)"
      >
        <p class="text-[11px] leading-snug text-text">{tip.message}</p>
        <div class="mt-1.5 flex items-center gap-1">
          {#if tip.actionLabel}
            <button
              type="button"
              class="rounded-lg bg-accent-lavender/35 px-2 py-0.5 text-[10px] font-semibold hover:bg-accent-lavender/50"
              onclick={runTipAction}
            >
              {tip.actionLabel}
            </button>
          {/if}
          <button
            type="button"
            class="rounded-lg px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-surface-muted"
            onclick={onDismissTip}
            aria-label="Ignorer"
          >
            ✕
          </button>
        </div>
      </div>
    {/if}

    <button
      type="button"
      class="buddy-sprite relative flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface-muted transition hover:scale-[1.04] focus:outline-none focus:ring-2 focus:ring-accent-lavender"
      style:box-shadow="var(--shadow)"
      title="Scribe — {moodLabel[mood]}"
      aria-label="Compagnon Scribe, {moodLabel[mood]}. Ouvrir le panneau."
      onclick={onOpenCompanion}
    >
      <!-- Sprite 16×16 pixel-art, mis à l'échelle -->
      <svg
        class="buddy-face h-10 w-10"
        class:mood-listen={mood === "listen"}
        class:mood-think={mood === "think"}
        class:mood-idea={mood === "idea"}
        class:mood-ok={mood === "ok"}
        class:mood-warn={mood === "warn"}
        viewBox="0 0 16 16"
        shape-rendering="crispEdges"
        aria-hidden="true"
      >
        <!-- corps -->
        <rect x="3" y="4" width="10" height="9" fill="var(--accent-lavender)" />
        <rect x="4" y="3" width="8" height="1" fill="var(--accent-lavender)" />
        <rect x="5" y="2" width="6" height="1" fill="var(--accent-mint)" />
        <!-- yeux -->
        {#if mood === "think"}
          <rect x="5" y="6" width="2" height="1" fill="var(--text)" />
          <rect x="9" y="6" width="2" height="1" fill="var(--text)" />
        {:else if mood === "ok"}
          <rect x="5" y="7" width="2" height="1" fill="var(--text)" />
          <rect x="9" y="7" width="2" height="1" fill="var(--text)" />
          <rect x="6" y="6" width="1" height="1" fill="var(--text)" />
          <rect x="9" y="6" width="1" height="1" fill="var(--text)" />
        {:else if mood === "warn"}
          <rect x="5" y="6" width="2" height="2" fill="var(--text)" />
          <rect x="9" y="6" width="2" height="2" fill="var(--text)" />
        {:else}
          <rect x="5" y="6" width="2" height="2" fill="var(--text)" />
          <rect x="9" y="6" width="2" height="2" fill="var(--text)" />
        {/if}
        <!-- bouche -->
        {#if mood === "idea" || mood === "ok"}
          <rect x="6" y="10" width="4" height="1" fill="var(--text)" />
          <rect x="5" y="9" width="1" height="1" fill="var(--text)" />
          <rect x="10" y="9" width="1" height="1" fill="var(--text)" />
        {:else if mood === "warn"}
          <rect x="6" y="10" width="4" height="1" fill="var(--text)" />
        {:else if mood === "listen"}
          <rect x="7" y="9" width="2" height="2" fill="var(--accent-blue)" />
        {:else if mood === "think"}
          <rect x="7" y="10" width="2" height="1" fill="var(--text)" />
        {:else}
          <rect x="6" y="10" width="4" height="1" fill="var(--text)" />
        {/if}
        <!-- pieds -->
        <rect x="4" y="13" width="3" height="2" fill="var(--accent-blue)" />
        <rect x="9" y="13" width="3" height="2" fill="var(--accent-blue)" />
        <!-- bulle idée -->
        {#if mood === "idea"}
          <rect x="12" y="1" width="2" height="2" fill="var(--accent-mint)" />
          <rect x="13" y="3" width="1" height="1" fill="var(--accent-mint)" />
        {/if}
        {#if mood === "think"}
          <rect x="12" y="2" width="1" height="1" fill="var(--text-muted)" />
          <rect x="13" y="1" width="1" height="1" fill="var(--text-muted)" />
          <rect x="14" y="0" width="1" height="1" fill="var(--text-muted)" />
        {/if}
      </svg>
      <span class="buddy-pulse absolute inset-0 rounded-2xl" class:active={mood === "listen" || mood === "think"}></span>
    </button>
  </div>
{/if}

<style>
  .buddy-shift {
    right: 16px;
    /* laisse de la place si le panneau est ouvert à droite — le panneau est draggable, on reste bas-droit */
  }

  .buddy-face {
    image-rendering: pixelated;
  }

  .mood-listen {
    animation: buddy-bob 0.9s ease-in-out infinite;
  }
  .mood-think {
    animation: buddy-sway 1.4s ease-in-out infinite;
  }
  .mood-idea {
    animation: buddy-pop 0.45s ease-out;
  }
  .mood-ok {
    animation: buddy-pop 0.4s ease-out;
  }
  .mood-warn {
    animation: buddy-shake 0.5s ease-in-out;
  }

  .buddy-pulse.active {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-lavender) 45%, transparent);
    animation: buddy-ring 1.6s ease-out infinite;
  }

  .buddy-bubble {
    animation: buddy-fade 0.25s ease-out;
  }

  @keyframes buddy-bob {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-2px);
    }
  }
  @keyframes buddy-sway {
    0%,
    100% {
      transform: rotate(-2deg);
    }
    50% {
      transform: rotate(2deg);
    }
  }
  @keyframes buddy-pop {
    0% {
      transform: scale(0.85);
    }
    70% {
      transform: scale(1.08);
    }
    100% {
      transform: scale(1);
    }
  }
  @keyframes buddy-shake {
    0%,
    100% {
      transform: translateX(0);
    }
    25% {
      transform: translateX(-2px);
    }
    75% {
      transform: translateX(2px);
    }
  }
  @keyframes buddy-ring {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-lavender) 40%, transparent);
    }
    100% {
      box-shadow: 0 0 0 10px transparent;
    }
  }
  @keyframes buddy-fade {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
