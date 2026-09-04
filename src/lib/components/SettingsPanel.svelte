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
    VoiceDepsStatus,
    VoiceStatus,
    WhisperCacheEntry,
  } from "$lib/types";
  import { APP_NAME, APP_VERSION } from "$lib/version";
  import type { RagStatus } from "$lib/ai/rag";
  import { notify } from "$lib/stores/notifications";

  interface Props {
    open: boolean;
    onClose: () => void;
    onOllamaUpdated: (status: OllamaStatus) => void;
  }

  let { open, onClose, onOllamaUpdated }: Props = $props();

  let detect = $state<OllamaDetect | null>(null);
  let status = $state<OllamaStatus | null>(null);
  let config = $state<AppConfig>({
    ollamaHost: "http://127.0.0.1:11434",
    selectedModel: "llama3.2",
    voiceHotkey: "F8",
    whisperLanguage: "fr",
    whisperModel: "base",
    whisperDevice: "auto",
    whisperComputeType: "int8",
    whisperProfile: "fast",
    maxRecordSeconds: 90,
  });
  let voiceDeps = $state<VoiceDepsStatus | null>(null);
  let voiceStatus = $state<VoiceStatus | null>(null);
  let whisperCache = $state<WhisperCacheEntry[]>([]);
  let whisperModelsDir = $state("");
  let ragStatus = $state<RagStatus | null>(null);
  let ragBusy = $state(false);
  let recommended = $state<RecommendedModel[]>([]);
  let pullProgress = $state<PullProgress | null>(null);
  let pulling = $state(false);
  let busy = $state(false);
  let loading = $state(false);
  let message = $state("");
  let error = $state("");
  let customModel = $state("");

  let unlisten: UnlistenFn | null = null;

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
  }

  async function loadConfigFast() {
    try {
      config = await invoke<AppConfig>("get_app_config");
    } catch {
      /* garde les valeurs par défaut */
    }
  }

  async function refreshAsync(silent = false) {
    if (!silent) loading = true;
    error = "";
    try {
      const [d, s, rec, vd, vs, wdir, wcache, rag] = await Promise.all([
        invoke<OllamaDetect>("ollama_detect"),
        invoke<OllamaStatus>("ollama_status"),
        invoke<RecommendedModel[]>("ollama_recommended_models"),
        invoke<VoiceDepsStatus>("voice_check_deps"),
        invoke<VoiceStatus>("voice_get_status"),
        invoke<string>("voice_models_dir"),
        invoke<WhisperCacheEntry[]>("voice_list_whisper_cache"),
        invoke<RagStatus>("rag_status").catch(() => null),
      ]);
      detect = d;
      status = s;
      recommended = rec;
      voiceDeps = vd;
      voiceStatus = vs;
      whisperModelsDir = wdir;
      whisperCache = wcache;
      ragStatus = rag;
      if (status) onOllamaUpdated(status);
    } catch (e) {
      if (!silent) error = String(e);
    } finally {
      loading = false;
    }
  }

  async function reindexRag() {
    ragBusy = true;
    error = "";
    message = "Indexation RAG en cours (embeddings)…";
    notify({
      kind: "info",
      title: "RAG",
      message: "Indexation en cours (nomic-embed-text)…",
      key: "rag",
      durationMs: 0,
    });
    try {
      ragStatus = await invoke<RagStatus>("rag_reindex");
      message = `Index RAG prêt — ${ragStatus.chunkCount} extraits · ${ragStatus.noteCount} notes.`;
      notify({
        kind: "success",
        title: "RAG indexé",
        message,
        key: "rag",
      });
    } catch (e) {
      error = String(e);
      message = "";
      notify({
        kind: "error",
        title: "RAG échoué",
        message: error,
        key: "rag",
        durationMs: 16000,
      });
    } finally {
      ragBusy = false;
    }
  }

  async function waitForWhisperModel(modelName: string, timeoutMs = 300_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      voiceStatus = await invoke<VoiceStatus>("voice_get_status");
      if (voiceStatus?.error) {
        error = voiceStatus.error;
        notify({ kind: "error", title: "Échec du modèle Whisper", message: voiceStatus.error });
        return false;
      }
      if (voiceStatus?.modelLoaded) {
        notify({
          kind: "success",
          title: "Modèle Whisper prêt",
          message: `${modelName} · raccourci ${config.voiceHotkey}`,
        });
        return true;
      }
      if (!voiceStatus?.modelLoading && !voiceStatus?.modelLoaded && voiceStatus?.running) {
        error = `Le modèle « ${modelName} » n'a pas pu être chargé.`;
        notify({ kind: "error", title: "Modèle non chargé", message: error });
        return false;
      }
      message = `Chargement du modèle ${modelName}…`;
    }
    error = `Timeout — le modèle « ${modelName} » met trop longtemps à charger.`;
    notify({ kind: "error", title: "Chargement trop long", message: error });
    return false;
  }

  async function applyVoiceConfig() {
    busy = true;
    error = "";
    message = "Application de la configuration vocale…";
    notify({
      kind: "info",
      title: "Configuration vocale",
      message: `Chargement du modèle ${config.whisperModel}…`,
      key: "voice-apply",
    });
    try {
      await invoke("save_app_config", { config });
      await invoke("voice_restart", { force: true });
      await invoke("voice_preload_whisper_model");
      const ok = await waitForWhisperModel(config.whisperModel);
      if (ok) {
        message = `Voix prête · modèle ${config.whisperModel} · raccourci ${config.voiceHotkey}`;
      } else {
        message = "";
      }
      await refreshAsync(true);
    } catch (e) {
      error = String(e);
      message = "";
      notify({ kind: "error", title: "Configuration vocale échouée", message: error });
    } finally {
      busy = false;
    }
  }

  async function installVoiceDeps() {
    busy = true;
    error = "";
    message = "";
    try {
      message = await invoke<string>("voice_install_deps");
      await refreshAsync(true);
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
    }
  }

  async function preloadWhisper() {
    await applyVoiceConfig();
  }

  async function saveConfig() {
    busy = true;
    error = "";
    message = "";
    try {
      await invoke("save_app_config", { config });
      message = "Configuration enregistrée.";
      await refreshAsync(true);
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
    }
  }

  async function installOllama() {
    busy = true;
    error = "";
    message = "";
    try {
      message = await invoke<string>("ollama_install");
    } catch (e) {
      error = String(e);
      try {
        await openUrl("https://ollama.com/download/windows");
        message = "Ouverture de la page de téléchargement Ollama…";
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
    try {
      message = await invoke<string>("ollama_start_service");
      await new Promise((r) => setTimeout(r, 2500));
      await refreshAsync(true);
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
    }
  }

  async function pullModel(modelId: string) {
    if (pulling) return;
    pulling = true;
    pullProgress = { model: modelId, status: "Démarrage…", done: false };
    error = "";
    message = "";
    try {
      await invoke("ollama_pull_model", { model: modelId });
      message = `Modèle « ${modelId} » installé.`;
      config.selectedModel = modelId;
      await invoke("save_app_config", { config });
      await refreshAsync(true);
    } catch (e) {
      error = String(e);
    } finally {
      pulling = false;
      pullProgress = null;
    }
  }

  async function deleteModel(modelId: string) {
    if (!confirm(`Supprimer le modèle « ${modelId} » ?`)) return;
    busy = true;
    error = "";
    try {
      await invoke("ollama_delete_model", { model: modelId });
      message = `Modèle « ${modelId} » supprimé.`;
      await refreshAsync(true);
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
    }
  }

  function isInstalled(modelId: string): boolean {
    return status?.models.some((m) => m === modelId || m.startsWith(`${modelId}:`)) ?? false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  onMount(async () => {
    unlisten = await listen<PullProgress>("ollama-pull-progress", (event) => {
      pullProgress = event.payload;
      if (event.payload.error) error = event.payload.error;
    });
  });

  onDestroy(() => {
    unlisten?.();
  });

  $effect(() => {
    if (open) {
      loadConfigFast();
      refreshAsync(true);
    }
  });
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 z-50 flex justify-end bg-black/25 backdrop-blur-sm"
    role="presentation"
    onclick={onClose}
  >
    <div
      class="flex h-full w-full max-w-md flex-col border-l border-border bg-surface shadow-lg"
      style:box-shadow="var(--shadow)"
      onclick={(e) => e.stopPropagation()}
      onkeydown={handleKeydown}
      role="dialog"
      aria-modal="true"
      aria-label="Réglages"
      tabindex="-1"
    >
      <header class="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 class="text-lg font-semibold">Réglages</h2>
          <p class="text-xs text-text-muted">
            {#if loading}
              Actualisation en arrière-plan…
            {:else}
              Ollama & voix CyberScribe
            {/if}
          </p>
        </div>
        <button
          type="button"
          class="rounded-xl px-2 py-1 text-text-muted hover:bg-surface-muted"
          onclick={onClose}
        >
          ✕
        </button>
      </header>

      <div class="flex-1 space-y-6 overflow-y-auto px-5 py-4">
        <!-- Ollama -->
        <section class="space-y-3">
          <h3 class="text-sm font-semibold">État d'Ollama</h3>

          {#if loading && !detect}
            <div class="animate-pulse space-y-2 rounded-2xl border border-border bg-surface-muted p-4">
              <div class="h-3 w-2/3 rounded bg-border"></div>
              <div class="h-3 w-1/2 rounded bg-border"></div>
              <div class="h-3 w-3/4 rounded bg-border"></div>
            </div>
          {:else}
            <div class="rounded-2xl border border-border bg-surface-muted p-4 text-sm">
              <div class="flex justify-between py-1">
                <span class="text-text-muted">Application</span>
                <span class={detect?.cliInstalled ? "text-accent-mint" : "text-danger"}>
                  {detect?.cliInstalled ? "Installée" : "Non installée"}
                </span>
              </div>
              <div class="flex justify-between py-1">
                <span class="text-text-muted">Service</span>
                <span class={detect?.serviceRunning ? "text-accent-mint" : "text-danger"}>
                  {detect?.serviceRunning ? "Actif" : "Hors ligne"}
                </span>
              </div>
              <div class="flex justify-between py-1">
                <span class="text-text-muted">Connexion</span>
                <span>{detect?.networkMode ?? "—"} · {detect?.host ?? config.ollamaHost}</span>
              </div>
              <div class="flex justify-between py-1">
                <span class="text-text-muted">Modèles Ollama</span>
                <span>{status?.models.length ?? 0}</span>
              </div>
            </div>

            {#if detect?.networkGuidance}
              <p class="rounded-xl bg-accent-blue/10 px-3 py-2 text-[11px] text-text-muted">
                {detect.networkGuidance}
                {#if detect.ollamaHostEnv}
                  <br /><span class="text-accent-blue">OLLAMA_HOST = {detect.ollamaHostEnv}</span>
                {/if}
              </p>
            {/if}
          {/if}

          <div class="flex flex-wrap gap-2">
            {#if detect && !detect.cliInstalled}
              <button type="button" class="rounded-2xl bg-accent-lavender/50 px-3 py-2 text-xs font-medium hover:bg-accent-lavender/70 disabled:opacity-50" disabled={busy} onclick={installOllama}>Installer Ollama</button>
            {/if}
            {#if detect?.cliInstalled && !detect?.serviceRunning}
              <button type="button" class="rounded-2xl bg-accent-mint/40 px-3 py-2 text-xs font-medium hover:bg-accent-mint/60 disabled:opacity-50" disabled={busy} onclick={startOllama}>Démarrer Ollama</button>
            {/if}
            <button type="button" class="rounded-2xl border border-border px-3 py-2 text-xs hover:bg-surface-muted disabled:opacity-50" disabled={busy} onclick={() => refreshAsync()}>Actualiser</button>
          </div>
        </section>

        <!-- Connexion Ollama -->
        <section class="space-y-3">
          <h3 class="text-sm font-semibold">Connexion Ollama</h3>
          <label class="block space-y-1">
            <span class="text-xs text-text-muted">Adresse (local ou réseau)</span>
            <input type="url" class="w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent-blue" bind:value={config.ollamaHost} placeholder="http://127.0.0.1:11434 ou http://192.168.x.x:11434" />
          </label>
          <label class="block space-y-1">
            <span class="text-xs text-text-muted">Modèle actif</span>
            <select class="w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent-blue" bind:value={config.selectedModel}>
              {#if status?.models.length}
                {#each status.models as model (model)}
                  <option value={model}>{model}</option>
                {/each}
              {:else}
                <option value={config.selectedModel}>{config.selectedModel} (à télécharger)</option>
              {/if}
            </select>
          </label>
          <button type="button" class="w-full rounded-2xl bg-accent-blue/30 py-2 text-xs font-medium hover:bg-accent-blue/50 disabled:opacity-50" disabled={busy} onclick={saveConfig}>Enregistrer</button>
        </section>

        <!-- Modèles Ollama -->
        <section class="space-y-3">
          <h3 class="text-sm font-semibold">Modèles Ollama recommandés</h3>
          {#if pullProgress}
            <div class="rounded-2xl border border-accent-blue/40 bg-accent-blue/10 p-3 text-xs">
              <p class="font-medium">{pullProgress.model}</p>
              <p class="text-text-muted">{pullProgress.status}</p>
              {#if pullProgress.percent != null}
                <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
                  <div class="h-full rounded-full bg-accent-blue transition-all" style:width="{Math.min(pullProgress.percent, 100)}%"></div>
                </div>
              {/if}
            </div>
          {/if}
          {#if loading && recommended.length === 0}
            <div class="animate-pulse h-16 rounded-2xl bg-surface-muted"></div>
          {:else}
            <ul class="space-y-2">
              {#each recommended as model (model.id)}
                <li class="rounded-2xl border border-border bg-surface-muted p-3">
                  <div class="flex items-start justify-between gap-2">
                    <div>
                      <p class="text-sm font-medium">{model.label}</p>
                      <p class="text-xs text-text-muted">{model.description}</p>
                    </div>
                    {#if isInstalled(model.id)}
                      <span class="shrink-0 rounded-lg bg-accent-mint/30 px-2 py-0.5 text-[10px]">Installé</span>
                    {/if}
                  </div>
                  <div class="mt-2 flex gap-2">
                    <button type="button" class="rounded-xl bg-accent-lavender/40 px-2 py-1 text-[11px] hover:bg-accent-lavender/60 disabled:opacity-40" disabled={pulling || isInstalled(model.id)} onclick={() => pullModel(model.id)}>
                      {isInstalled(model.id) ? "Déjà là" : "Télécharger"}
                    </button>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <!-- RAG -->
        <section class="space-y-3 border-t border-border pt-4">
          <h3 class="text-sm font-semibold">RAG · recherche sémantique</h3>
          <p class="text-[11px] text-text-muted leading-relaxed">
            Indexe le vault avec <code class="text-accent-blue">nomic-embed-text</code> pour enrichir
            résumé, reformulation et prompts custom avec des extraits d'autres notes.
          </p>
          <div class="rounded-2xl border border-border bg-surface-muted p-3 text-xs space-y-1">
            <div class="flex justify-between">
              <span class="text-text-muted">État</span>
              <span class={ragStatus?.indexed ? "text-accent-mint" : "text-text-muted"}>
                {ragStatus?.indexed ? "Indexé" : "Non indexé"}
              </span>
            </div>
            <div class="flex justify-between">
              <span class="text-text-muted">Extraits</span>
              <span>{ragStatus?.chunkCount ?? 0}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-text-muted">Notes</span>
              <span>{ragStatus?.noteCount ?? 0}</span>
            </div>
            {#if ragStatus?.updatedAt}
              <p class="truncate text-[10px] text-text-muted" title={ragStatus.updatedAt}>
                Maj · {ragStatus.updatedAt}
              </p>
            {/if}
          </div>
          <button
            type="button"
            class="w-full rounded-2xl bg-accent-lavender/40 py-2 text-xs font-medium hover:bg-accent-lavender/60 disabled:opacity-50"
            disabled={busy || ragBusy || pulling}
            onclick={reindexRag}
          >
            {ragBusy ? "Indexation…" : "Indexer / réindexer le vault"}
          </button>
        </section>

        <!-- Voix -->
        <section class="space-y-3 border-t border-border pt-4">
          <h3 class="text-sm font-semibold">Voix (CyberScribe)</h3>

          {#if loading && !voiceDeps}
            <div class="animate-pulse h-20 rounded-2xl bg-surface-muted"></div>
          {:else}
            <div class="rounded-2xl border border-border bg-surface-muted p-4 text-sm">
              <div class="flex justify-between py-1">
                <span class="text-text-muted">Worker</span>
                <span class={voiceDeps?.workerPath ? "text-accent-mint" : "text-danger"} title={voiceDeps?.workerPath}>
                  {voiceDeps?.workerPath ? "Trouvé" : "Introuvable"}
                </span>
              </div>
              <div class="flex justify-between py-1">
                <span class="text-text-muted">Python</span>
                <span>{voiceDeps?.pythonFound ? voiceDeps.pythonPath : "Non trouvé"}</span>
              </div>
              <div class="flex justify-between py-1">
                <span class="text-text-muted">Dépendances</span>
                <span class={voiceDeps?.depsOk ? "text-accent-mint" : "text-danger"}>
                  {voiceDeps?.depsOk ? "OK" : "Manquantes"}
                </span>
              </div>
              <div class="flex justify-between py-1">
                <span class="text-text-muted">Modèle en mémoire</span>
                <span>{voiceStatus?.modelLoaded ? "Chargé ✓" : voiceStatus?.modelLoading ? "Chargement…" : "Non chargé"}</span>
              </div>
              <div class="flex justify-between py-1">
                <span class="text-text-muted">Worker actif</span>
                <span class={voiceStatus?.running ? "text-accent-mint" : "text-danger"}>
                  {voiceStatus?.running ? "Oui" : "Non"}
                </span>
              </div>
            </div>

            {#if voiceDeps?.workerPath}
              <p class="truncate text-[10px] text-text-muted" title={voiceDeps.workerPath}>{voiceDeps.workerPath}</p>
            {/if}
            {#if voiceDeps?.error}
              <p class="rounded-xl bg-danger/10 px-3 py-2 text-[11px] text-danger">{voiceDeps.error}</p>
            {/if}
            {#if voiceStatus?.error}
              <p class="rounded-xl bg-danger/10 px-3 py-2 text-[11px] text-danger">{voiceStatus.error}</p>
            {/if}
          {/if}

          <div class="flex flex-wrap gap-2">
            {#if !voiceDeps?.depsOk}
              <button type="button" class="rounded-2xl bg-accent-mint/40 px-3 py-2 text-xs font-medium hover:bg-accent-mint/60 disabled:opacity-50" disabled={busy} onclick={installVoiceDeps}>Installer dépendances (pip)</button>
            {/if}
            <button type="button" class="rounded-2xl bg-accent-lavender/40 px-3 py-2 text-xs font-medium hover:bg-accent-lavender/60 disabled:opacity-50" disabled={busy || !voiceDeps?.depsOk} onclick={preloadWhisper}>
              Télécharger / vérifier Whisper
            </button>
          </div>

          <div class="space-y-1">
            <p class="text-xs text-text-muted">Cache Whisper · {config.whisperModel}</p>
            <p class="truncate text-[10px] text-text-muted" title={whisperModelsDir}>{whisperModelsDir || "Documents/CyberScribeNote/models"}</p>
            {#if whisperCache.length === 0}
              <p class="text-[11px] text-text-muted">Aucun modèle dans le cache — cliquez « Télécharger / vérifier Whisper »</p>
            {:else}
              <ul class="max-h-32 space-y-1 overflow-y-auto rounded-xl border border-border bg-bg p-2 text-[10px]">
                {#each whisperCache as entry (entry.path)}
                  <li class="flex justify-between gap-2">
                    <span class="truncate" title={entry.path}>{entry.name}</span>
                    <span class="shrink-0 text-text-muted">{formatBytes(entry.sizeBytes)}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>

          <label class="block space-y-1">
            <span class="text-xs text-text-muted">Raccourci push-to-talk (PTT)</span>
            <input type="text" class="w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none" bind:value={config.voiceHotkey} placeholder="F8" />
            <span class="text-[10px] text-text-muted">Appuyez pour démarrer l'enregistrement, rappuyez pour transcrire. Pas d'écoute continue.</span>
          </label>

          <div class="grid grid-cols-2 gap-2">
            <label class="block space-y-1">
              <span class="text-xs text-text-muted">Langue</span>
              <select class="w-full rounded-xl border border-border bg-bg px-2 py-2 text-xs" bind:value={config.whisperLanguage}>
                <option value="fr">Français</option>
                <option value="en">Anglais</option>
                <option value="auto">Auto</option>
              </select>
            </label>
            <label class="block space-y-1">
              <span class="text-xs text-text-muted">Modèle Whisper</span>
              <select class="w-full rounded-xl border border-border bg-bg px-2 py-2 text-xs" bind:value={config.whisperModel}>
                <option value="tiny">Tiny</option>
                <option value="base">Base</option>
                <option value="small">Small</option>
                <option value="medium">Medium</option>
              </select>
            </label>
            <label class="block space-y-1">
              <span class="text-xs text-text-muted">Profil</span>
              <select class="w-full rounded-xl border border-border bg-bg px-2 py-2 text-xs" bind:value={config.whisperProfile}>
                <option value="fast">Rapide</option>
                <option value="balanced">Équilibré</option>
                <option value="accurate">Précis</option>
              </select>
            </label>
            <label class="block space-y-1">
              <span class="text-xs text-text-muted">Durée max (s)</span>
              <input type="number" min="0" max="600" class="w-full rounded-xl border border-border bg-bg px-2 py-2 text-xs" bind:value={config.maxRecordSeconds} />
            </label>
          </div>
          <p class="text-[10px] text-text-muted">
            90 s recommandé pour les phrases longues. 25 s les coupe souvent. 0 = pas de limite.
          </p>

          <button
            type="button"
            class="w-full rounded-2xl bg-accent-mint/40 py-2 text-xs font-medium hover:bg-accent-mint/60 disabled:opacity-50"
            disabled={busy || !voiceDeps?.depsOk}
            onclick={applyVoiceConfig}
          >
            {busy ? "Application…" : "Appliquer la config voix"}
          </button>
          <p class="text-[10px] text-text-muted">
            Obligatoire après changement de modèle ou de raccourci. Attend la fin du chargement Whisper.
          </p>
        </section>

        {#if message}
          <p class="rounded-xl bg-accent-mint/20 px-3 py-2 text-xs text-accent-mint">{message}</p>
        {/if}
        {#if error}
          <p class="rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
        {/if}

        <footer class="border-t border-border pt-4 text-center text-[10px] text-text-muted">
          {APP_NAME} v{APP_VERSION}
        </footer>
      </div>
    </div>
  </div>
{/if}
