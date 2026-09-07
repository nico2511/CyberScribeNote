<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { APP_VERSION } from "$lib/version";

  interface Props {
    open: boolean;
    onDismiss: (dontShowAgain: boolean) => void;
  }

  let { open, onDismiss }: Props = $props();
  let dontShowAgain = $state(true);

  const REPO = "https://github.com/nico2511/CyberScribeNote";
</script>

{#if open}
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="welcome-title"
  >
    <div
      class="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl"
      style:box-shadow="var(--shadow)"
    >
      <p class="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
        CyberScribeNote · v{APP_VERSION}
      </p>
      <h2 id="welcome-title" class="mt-1 text-lg font-semibold text-text">Bienvenue</h2>
      <p class="mt-2 text-sm leading-relaxed text-text-muted">
        Notes locales, compagnon Scribe, skills et dictée. Rien ne quitte votre machine
        (sauf Ollama en local et l’enrichissement d’un lien si vous le demandez).
      </p>
      <ul class="mt-3 space-y-1.5 text-xs text-text">
        <li>· <strong>Ctrl+T</strong> — recherche rapide</li>
        <li>· Poignée <strong>⠿</strong> — glisser une note vers un dossier</li>
        <li>· <strong>Compagnon IA</strong> — prompt libre + skills</li>
        <li>· Pixel <strong>Scribe</strong> — conseils contextuels</li>
      </ul>
      <label class="mt-4 flex cursor-pointer items-center gap-2 text-xs text-text-muted">
        <input type="checkbox" bind:checked={dontShowAgain} class="rounded border-border" />
        Ne plus afficher au prochain lancement
      </label>
      <div class="mt-4 flex items-center justify-between gap-2">
        <button
          type="button"
          class="text-[11px] text-accent-blue underline-offset-2 hover:underline"
          onclick={() => openUrl(REPO)}
        >
          Dépôt GitHub
        </button>
        <button
          type="button"
          class="rounded-xl bg-accent-lavender/45 px-4 py-2 text-xs font-semibold hover:bg-accent-lavender/60"
          onclick={() => onDismiss(dontShowAgain)}
        >
          Commencer
        </button>
      </div>
    </div>
  </div>
{/if}
