<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import type {
    AppConfig,
    OllamaDetect,
    OllamaStatus,
    PullProgress,
    RecommendedModel,
  } from "$lib/types";
  import { APP_VERSION } from "$lib/version";

  interface Props {
    open: boolean;
    onComplete: () => void;
    onOllamaUpdated: (status: OllamaStatus) => void;
  }

  let { open, onComplete, onOllamaUpdated }: Props = $props();

  type Step = "welcome" | "ollama" | "model" | "done";

  let step = $state<Step>("welcome");
  let detect = $state<OllamaDetect | null>(null);
  let status = $state<OllamaStatus | null>(null);
  let recommended = $state<RecommendedModel[]>([]);
  let config = $state<AppConfig | null>(null);
  let busy = $state(false);
  let pulling = $state(false);
  let pullProgress = $state<PullProgress | null>(null);
  let message = $state("");
  let error = $state("");
  let unlisten: UnlistenFn | null = null;

  const steps: { id: Step; label: string }[] = [
    { id: "welcome", label: "Bienvenue" },
    { id: "ollama", label: "Ollama" },
    { id: "model", label: "Modèle" },
    { id: "done", label: "Prêt" },
  ];

  function stepIndex(s: Step): number {
    return steps.findIndex((x) => x.id === s);
  }

  async function refresh() {
    try {
      const [d, s, rec, cfg] = await Promise.all([
        invoke<OllamaDetect>("ollama_detect"),
        invoke<OllamaStatus>("ollama_status"),
        invoke<RecommendedModel[]>("ollama_recommended_models"),
        invoke<AppConfig>("get_app_config"),
      ]);
      detect = d;
      status = s;
      recommended = rec;
      config = cfg;
      onOllamaUpdated(s);
    } catch (e) {
      error = String(e);
    }
  }

  function isInstalled(modelId: string): boolean {
    return status?.models.some((m) => m === modelId || m.startsWith(`${modelId}:`)) ?? false;
  }

  async function installOllama() {
    busy = true;
    error = "";
    message = "";
    try {
      message = await invoke<string>("ollama_install");
      await refresh();
    } catch (e) {
      error = String(e);
      try {
        await openUrl("https://ollama.com/download/windows");
        message = "Page de téléchargement Ollama ouverte — réessayez « Vérifier » après installation.";
      } catch {
        /* ignore */
      }
    } finally {
      busy = false;
    }
  }

  async function startOllama() {
    busy = true;
    error = "";
    message = "";
    try {
      message = await invoke<string>("ollama_start_service");
      await new Promise((r) => setTimeout(r, 2000));
      await refresh();
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
    }
  }

  async function pullModel(modelId: string) {
    if (pulling || !config) return;
    pulling = true;
    pullProgress = { model: modelId, status: "Téléchargement…", done: false };
    error = "";
    message = "";
    try {
      await invoke("ollama_pull_model", { model: modelId });
      config.selectedModel = modelId;
      await invoke("save_app_config", { config });
      message = `Modèle « ${modelId} » installé et sélectionné.`;
      await refresh();
    } catch (e) {
      error = String(e);
    } finally {
      pulling = false;
      pullProgress = null;
    }
  }

  function goNext() {
    error = "";
    message = "";
    if (step === "welcome") step = "ollama";
    else if (step === "ollama") step = "model";
    else if (step === "model") step = "done";
    else onComplete();
  }

  function canSkipOllama(): boolean {
    return true;
  }

  function finish() {
    onComplete();
  }

  $effect(() => {
    if (open) void refresh();
  });

  onMount(async () => {
    unlisten = await listen<PullProgress>("ollama-pull-progress", (event) => {
      pullProgress = event.payload;
      if (event.payload.error) error = event.payload.error;
    });
  });

  onDestroy(() => {
    unlisten?.();
  });
</script>

{#if open}
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="setup-title"
  >
    <div
      class="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
      style:box-shadow="var(--shadow)"
    >
      <div class="border-b border-border px-5 py-4">
        <p class="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
          CyberScribeNote · v{APP_VERSION} · Premier lancement
        </p>
        <h2 id="setup-title" class="mt-1 text-lg font-semibold text-text">Check-up installation</h2>
        <ol class="mt-3 flex flex-wrap gap-1.5">
          {#each steps as s, i}
            <li
              class="rounded-full px-2.5 py-0.5 text-[10px] font-semibold
                {stepIndex(step) === i
                ? 'bg-accent-lavender/50 text-text'
                : stepIndex(step) > i
                  ? 'bg-accent-mint/35 text-text'
                  : 'bg-surface-muted text-text-muted'}"
            >
              {i + 1}. {s.label}
            </li>
          {/each}
        </ol>
      </div>

      <div class="flex-1 overflow-y-auto px-5 py-4 text-sm">
        {#if step === "welcome"}
          <p class="leading-relaxed text-text-muted">
            Quelques vérifications pour démarrer correctement : Ollama (IA locale) et un modèle
            de langage. Tout reste sur votre machine.
          </p>
          <ul class="mt-3 space-y-1.5 text-xs text-text">
            <li>· <strong>Ctrl+T</strong> — recherche rapide</li>
            <li>· Poignée <strong>⠿</strong> — glisser une note vers un dossier</li>
            <li>· Les dossiers démarrent <strong>repliés</strong> pour la lisibilité</li>
            <li>· Les .txt du vault sont convertis en .md (sources .txt supprimées)</li>
          </ul>
        {:else if step === "ollama"}
          <p class="mb-3 text-text-muted">Ollama exécute les modèles d’IA en local.</p>
          <div class="space-y-2 rounded-xl border border-border bg-surface-muted/60 p-3 text-xs">
            <div class="flex justify-between gap-2">
              <span class="text-text-muted">Installé</span>
              <span class={detect?.cliInstalled ? "font-semibold text-accent-mint" : "font-semibold text-danger"}>
                {detect?.cliInstalled ? "Oui" : "Non"}
              </span>
            </div>
            <div class="flex justify-between gap-2">
              <span class="text-text-muted">Service</span>
              <span class={detect?.serviceRunning || status?.available ? "font-semibold text-accent-mint" : "font-semibold text-text-muted"}>
                {detect?.serviceRunning || status?.available ? "En cours" : "Arrêté"}
              </span>
            </div>
            <div class="flex justify-between gap-2">
              <span class="text-text-muted">API</span>
              <span class={status?.available ? "font-semibold text-accent-mint" : "font-semibold text-text-muted"}>
                {status?.available ? "Joignable" : "Hors ligne"}
              </span>
            </div>
          </div>

          <div class="mt-3 flex flex-wrap gap-2">
            {#if !detect?.cliInstalled}
              <button
                type="button"
                class="rounded-xl bg-accent-lavender/50 px-3 py-2 text-xs font-semibold hover:bg-accent-lavender/70 disabled:opacity-50"
                disabled={busy}
                onclick={installOllama}
              >
                Installer Ollama
              </button>
            {:else if !status?.available}
              <button
                type="button"
                class="rounded-xl bg-accent-lavender/50 px-3 py-2 text-xs font-semibold hover:bg-accent-lavender/70 disabled:opacity-50"
                disabled={busy}
                onclick={startOllama}
              >
                Démarrer Ollama
              </button>
            {:else}
              <p class="text-xs font-medium text-accent-mint">Ollama est prêt.</p>
            {/if}
            <button
              type="button"
              class="rounded-xl border border-border px-3 py-2 text-xs hover:bg-surface-muted disabled:opacity-50"
              disabled={busy}
              onclick={() => void refresh()}
            >
              Vérifier
            </button>
          </div>
        {:else if step === "model"}
          <p class="mb-3 text-text-muted">
            Choisissez un modèle à télécharger. <strong>llama3.2</strong> est un bon départ
            (équilibre taille / qualité).
          </p>
          {#if !status?.available}
            <p class="mb-3 rounded-xl border border-border bg-danger/10 px-3 py-2 text-xs text-danger">
              Ollama n’est pas joignable. Revenez à l’étape précédente ou continuez sans IA pour l’instant.
            </p>
          {/if}
          <ul class="space-y-2">
            {#each recommended as model}
              <li class="flex items-start justify-between gap-2 rounded-xl border border-border px-3 py-2">
                <div class="min-w-0">
                  <p class="text-xs font-semibold text-text">{model.label}</p>
                  <p class="text-[11px] text-text-muted">{model.description} · {model.size}</p>
                </div>
                {#if isInstalled(model.id)}
                  <span class="shrink-0 rounded-lg bg-accent-mint/30 px-2 py-1 text-[10px] font-semibold">Installé</span>
                {:else}
                  <button
                    type="button"
                    class="shrink-0 rounded-lg bg-accent-lavender/45 px-2 py-1 text-[10px] font-semibold hover:bg-accent-lavender/65 disabled:opacity-40"
                    disabled={pulling || !status?.available}
                    onclick={() => pullModel(model.id)}
                  >
                    Télécharger
                  </button>
                {/if}
              </li>
            {/each}
          </ul>
          {#if pullProgress && !pullProgress.done}
            <p class="mt-3 text-[11px] text-text-muted">
              {pullProgress.model} — {pullProgress.status}
              {#if pullProgress.percent != null}
                ({Math.round(pullProgress.percent)} %)
              {/if}
            </p>
          {/if}
          {#if status?.models?.length}
            <p class="mt-3 text-[11px] text-text-muted">
              Modèle actif : <strong class="text-text">{config?.selectedModel || status.selectedModel}</strong>
            </p>
          {/if}
        {:else}
          <p class="leading-relaxed text-text-muted">
            Vous êtes prêt. Vous pourrez toujours ajuster Ollama, les modèles et le vault dans
            <strong class="text-text">Réglages</strong> (Ctrl+,).
          </p>
          <ul class="mt-3 space-y-1.5 text-xs text-text">
            <li class={detect?.cliInstalled ? "text-accent-mint" : "text-text-muted"}>
              · Ollama {detect?.cliInstalled ? "installé" : "non installé (IA limitée)"}
            </li>
            <li class={status?.available ? "text-accent-mint" : "text-text-muted"}>
              · Service {status?.available ? "connecté" : "hors ligne"}
            </li>
            <li class={(status?.models?.length ?? 0) > 0 ? "text-accent-mint" : "text-text-muted"}>
              · {(status?.models?.length ?? 0) > 0
                ? `${status?.models.length} modèle(s)`
                : "Aucun modèle — téléchargez-en un plus tard"}
            </li>
          </ul>
        {/if}

        {#if message}
          <p class="mt-3 text-xs text-accent-mint">{message}</p>
        {/if}
        {#if error}
          <p class="mt-3 text-xs text-danger">{error}</p>
        {/if}
      </div>

      <div class="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
        {#if step !== "welcome" && step !== "done"}
          <button
            type="button"
            class="text-xs text-text-muted hover:underline"
            onclick={() => {
              error = "";
              message = "";
              if (step === "model") step = "ollama";
              else if (step === "ollama") step = "welcome";
            }}
          >
            Retour
          </button>
        {:else}
          <span></span>
        {/if}

        <div class="flex gap-2">
          {#if step === "ollama" && canSkipOllama() && !status?.available}
            <button
              type="button"
              class="rounded-xl border border-border px-3 py-2 text-xs hover:bg-surface-muted"
              onclick={goNext}
            >
              Plus tard
            </button>
          {/if}
          {#if step === "model"}
            <button
              type="button"
              class="rounded-xl border border-border px-3 py-2 text-xs hover:bg-surface-muted"
              onclick={goNext}
            >
              {(status?.models?.length ?? 0) > 0 ? "Continuer" : "Passer"}
            </button>
          {:else if step === "done"}
            <button
              type="button"
              class="rounded-xl bg-accent-lavender/50 px-4 py-2 text-xs font-semibold hover:bg-accent-lavender/70"
              onclick={finish}
            >
              Commencer
            </button>
          {:else}
            <button
              type="button"
              class="rounded-xl bg-accent-lavender/50 px-4 py-2 text-xs font-semibold hover:bg-accent-lavender/70 disabled:opacity-50"
              disabled={busy || pulling}
              onclick={goNext}
            >
              {step === "welcome" ? "Commencer le check-up" : "Continuer"}
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}
