<script lang="ts">
  import { onMount } from "svelte";
  import {
    dismissToast,
    subscribeToasts,
    type Toast,
    type ToastKind,
  } from "$lib/stores/notifications";

  let toasts = $state<Toast[]>([]);

  const kindStyles: Record<ToastKind, string> = {
    info: "border-accent-blue/50 bg-accent-blue/15",
    success: "border-accent-mint/50 bg-accent-mint/20",
    warning: "border-accent-lavender/60 bg-accent-lavender/20",
    error: "border-danger/50 bg-danger/15",
  };

  const kindIcons: Record<ToastKind, string> = {
    info: "ℹ",
    success: "✓",
    warning: "⚠",
    error: "✕",
  };

  onMount(() => subscribeToasts((next) => (toasts = next)));
</script>

<div
  class="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(100vw-2rem,22rem)] flex-col gap-2"
  aria-live="polite"
  aria-label="Notifications"
>
  {#each toasts as toast (toast.id)}
    <div
      class="pointer-events-auto animate-[toast-in_0.25s_ease-out] rounded-2xl border px-4 py-3 shadow-lg backdrop-blur-sm {kindStyles[toast.kind]}"
      style:box-shadow="var(--shadow)"
      role="status"
    >
      <div class="flex items-start gap-2">
        <span class="mt-0.5 shrink-0 text-sm font-bold" aria-hidden="true">{kindIcons[toast.kind]}</span>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium leading-snug">{toast.title}</p>
          {#if toast.message}
            <p class="mt-0.5 text-xs text-text-muted leading-relaxed">{toast.message}</p>
          {/if}
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg px-1.5 py-0.5 text-xs text-text-muted transition hover:bg-surface/60"
          onclick={() => dismissToast(toast.id)}
          aria-label="Fermer la notification"
        >
          ✕
        </button>
      </div>
    </div>
  {/each}
</div>

<style>
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(0.5rem);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
