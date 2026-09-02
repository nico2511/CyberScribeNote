<script lang="ts">
  interface Props {
    recording: boolean;
    transcribing: boolean;
    modelLoading: boolean;
    hotkey: string;
  }

  let { recording, transcribing, modelLoading, hotkey }: Props = $props();

  let label = $derived.by(() => {
    if (recording) return "Enregistrement…";
    if (transcribing) return "Transcription…";
    if (modelLoading) return "Chargement Whisper…";
    return `Prêt · ${hotkey}`;
  });
</script>

{#if recording || transcribing || modelLoading}
  <div
    class="pointer-events-none fixed bottom-8 left-1/2 z-40 -translate-x-1/2 rounded-2xl border border-accent-blue/40 bg-surface/95 px-5 py-3 shadow-lg backdrop-blur-sm"
    style:box-shadow="var(--shadow)"
  >
    <div class="flex items-center gap-3">
      <span
        class="pixel-icon inline-block h-3 w-3 rounded-full bg-danger"
        class:animate-pulse={recording}
      ></span>
      <span class="text-sm font-medium">{label}</span>
      {#if recording}
        <span class="text-xs text-text-muted">Appuyez sur {hotkey} pour arrêter</span>
      {/if}
    </div>
  </div>
{/if}
