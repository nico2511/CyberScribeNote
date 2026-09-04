<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { save, open } from "@tauri-apps/plugin-dialog";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import MarkdownEditor from "$lib/components/MarkdownEditor.svelte";
  import SearchPanel from "$lib/components/SearchPanel.svelte";
  import SettingsPanel from "$lib/components/SettingsPanel.svelte";
  import VoiceOverlay from "$lib/components/VoiceOverlay.svelte";
  import AiCompanionPanel from "$lib/components/AiCompanionPanel.svelte";
  import { applyTheme, loadTheme, saveTheme, toggleTheme } from "$lib/stores/theme";
  import type { ParagraphSpan } from "$lib/note/paragraph";
  import {
    loadProactiveEnabled,
    saveProactiveEnabled,
    loadAutoTypoFixEnabled,
    saveAutoTypoFixEnabled,
    loadAutoSummarizeEnabled,
    saveAutoSummarizeEnabled,
  } from "$lib/stores/companion";
  import { autoFixAllTypoLines, tryAutoFixSpan, lineNeedsAiTypoFix } from "$lib/ai/autoTypo";
  import { sanitizeAiOutput } from "$lib/ai/sanitize";
  import { hasMeaningfulDiff } from "$lib/ai/textDiff";
  import { buildAiProposal, buildLocalCorrection } from "$lib/ai/buildProposal";
  import { finalizeCorrection } from "$lib/ai/localCorrect";
  import { isFaithfulCorrection } from "$lib/ai/faithful";
  import { likelyNeedsCorrection } from "$lib/ai/typoHints";
  import { scanBodyTypoLines, bodyHasTypoLines } from "$lib/note/scanTypos";
  import { parseVoiceTranscript } from "$lib/voice/keywords";
  import { replaceTextRange, type AiActionRequest, type TextSelection } from "$lib/voice/commands";
  import { mapCaretThroughReplace, locateSelectionInContent } from "$lib/note/caret";
  import { resolveWikilink } from "$lib/vault/wikilinks";
  import {
    extractExistingSummary,
    formatSummaryAppendix,
    isDuplicateSummary,
    translateLangLabel,
  } from "$lib/ai/languages";
  import { fetchRagContext } from "$lib/ai/rag";
  import { noteBody, parseNoteContext, setNoteContext, ensureVisibleContextBlock, touchUpdatedDate } from "$lib/note/frontmatter";
  import { mergeBodyMarkdown } from "$lib/markdown/bridge";
  import PixelIcon from "$lib/components/PixelIcon.svelte";
  import { dismissToast, notify } from "$lib/stores/notifications";
  import type {
    AiAction,
    OllamaStatus,
    OllamaDetect,
    SearchResult,
    ThemeMode,
    VaultEntry,
    VoiceStatus,
    VoiceTranscript,
    AiSuggestion,
    ProactiveSuggestionResponse,
  } from "$lib/types";

  let entries = $state<VaultEntry[]>([]);
  let vaultPath = $state("");
  let selectedPath = $state<string | null>(null);
  let content = $state("");
  let savedContent = $state("");
  let dirty = $state(false);
  let saving = $state(false);
  let theme = $state<ThemeMode>("light");
  let searchOpen = $state(false);
  let settingsOpen = $state(false);
  let searchQuery = $state("");
  let searchResults = $state<SearchResult[]>([]);
  let searchLoading = $state(false);
  let ollamaStatus = $state<OllamaStatus>({
    available: false,
    models: [],
    host: "http://127.0.0.1:11434",
    selectedModel: "llama3.2",
    networkMode: "local",
    isLocalhost: true,
  });
  let aiLoading = $state(false);
  let companionOpen = $state(false);
  let aiSuggestions = $state<AiSuggestion[]>([]);
  let proactiveEnabled = $state(false);
  let autoTypoFixEnabled = $state(true);
  let autoSummarizeEnabled = $state(false);
  let proactiveLoading = $state(false);
  let editorCursor = $state<number | null>(null);
  let editorSelection = $state<TextSelection | null>(null);
  /** Dernière position curseur connue (pour insérer la dictée au bon endroit). */
  let lastCaretOffset = 0;
  let pendingImageMarkdown = $state<string | null>(null);
  let pendingDictation = $state<{ text: string; id: number } | null>(null);
  let autoTypoNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  let autoTypoFixBusy = false;
  let proactiveStatus = $state("");
  let statusMessage = $state("");
  let autoSummaryTimer: ReturnType<typeof setTimeout> | null = null;
  let lastAutoSummaryKey = "";
  let voiceStatus = $state<VoiceStatus>({
    running: false,
    recording: false,
    transcribing: false,
    modelLoaded: false,
    modelLoading: false,
    depsOk: false,
    hotkey: "F8",
  });

  let unlisteners: UnlistenFn[] = [];

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  let title = $derived.by(() => {
    if (!selectedPath) return "Aucune note sélectionnée";
    const name = selectedPath.split("/").pop() ?? selectedPath;
    return name.replace(/\.md$/, "");
  });

  let activeModel = $derived(ollamaStatus.selectedModel || ollamaStatus.models[0] || "llama3.2");
  let noteContext = $derived(parseNoteContext(content));
  let customPromptTargetLabel = $derived.by(() =>
    editorSelection
      ? `sélection (${editorSelection.text.length} car.)`
      : "note entière",
  );
  let editorHighlight = $derived.by(() => {
    const latest = aiSuggestions.find((s) => s.selection);
    if (!latest?.selection) return null;
    return { start: latest.selection.start, end: latest.selection.end };
  });

  let lastProactiveAt = 0;
  let lastProactiveKey = "";
  let voiceTranscriptChain: Promise<void> = Promise.resolve();
  let voiceLoadingToastId: string | null = null;
  let voiceCrashRestarts = 0;
  let voiceCrashWindowStart = 0;
  let noteScanTimer: ReturnType<typeof setTimeout> | null = null;
  let fullTypoScanTimer: ReturnType<typeof setTimeout> | null = null;
  /** Invalide les réponses IA en cours quand on change de note. */
  let aiEpoch = 0;
  let noteOpenedAt = 0;
  /** Après une action IA manuelle (traduction…), ne pas relancer typo/proactif. */
  let aiQuietUntil = 0;

  function silenceAiHelpers(ms = 90000) {
    aiQuietUntil = Date.now() + ms;
    // N'annule que les scans « suggestions » — la correction de fautes reste active
    if (noteScanTimer) {
      clearTimeout(noteScanTimer);
      noteScanTimer = null;
    }
  }

  function isAiQuiet() {
    return Date.now() < aiQuietUntil;
  }

  async function refreshVoice() {
    voiceStatus = await invoke<VoiceStatus>("voice_get_status");
  }

  async function handleVoiceToggle() {
    if (voiceStatus.transcribing) {
      const msg = "Transcription en cours — patientez quelques secondes.";
      statusMessage = msg;
      notify({ kind: "info", title: "Transcription en cours", message: msg });
      return;
    }
    await refreshVoice();
    if (voiceStatus.modelLoading) {
      const msg = "Chargement du modèle Whisper en cours — patientez avant de dicter.";
      statusMessage = msg;
      notify({ kind: "warning", title: "Modèle en chargement", message: msg });
      return;
    }
    if (voiceStatus.running && !voiceStatus.modelLoaded) {
      const msg = "Modèle Whisper non chargé — Réglages → Voix → « Appliquer la config voix ».";
      statusMessage = msg;
      notify({ kind: "warning", title: "Dictée indisponible", message: msg });
      return;
    }
    if (voiceStatus.error) {
      // Erreurs non bloquantes (timeout d'enregistrement, etc.) : on laisse retenter
      const soft =
        voiceStatus.error.includes("automatiquement") ||
        voiceStatus.error.includes("Transcription encore");
      if (!soft) {
        statusMessage = `Voix : ${voiceStatus.error}`;
        notify({ kind: "error", title: "Erreur vocale", message: voiceStatus.error });
        return;
      }
    }
    try {
      await invoke("voice_toggle");
      await refreshVoice();
    } catch (e) {
      const msg = String(e);
      statusMessage = msg;
      notify({
        kind: msg.includes("chargement") || msg.includes("redémarré") ? "warning" : "error",
        title: "Dictée",
        message: msg,
        key: "voice-toggle",
      });
      await refreshVoice();
    }
  }

  $effect(() => {
    if (voiceStatus.modelLoading && !voiceLoadingToastId) {
      voiceLoadingToastId = notify({
        kind: "info",
        title: "Chargement du modèle Whisper…",
        message: "La dictée sera disponible une fois le chargement terminé.",
        durationMs: 0,
        key: "voice-loading",
      });
      return;
    }
    if (!voiceStatus.modelLoading && voiceLoadingToastId) {
      dismissToast(voiceLoadingToastId);
      voiceLoadingToastId = null;
      if (voiceStatus.modelLoaded && voiceStatus.running) {
        notify({
          kind: "success",
          title: "Dictée prête",
          message: `Appuyez sur ${voiceStatus.hotkey} pour parler, rappuyez pour transcrire.`,
          key: "voice-ready",
        });
      } else if (voiceStatus.running && !voiceStatus.modelLoaded) {
        notify({
          kind: "warning",
          title: "Modèle Whisper non chargé",
          message:
            voiceStatus.error ??
            "Réglages → Voix → « Appliquer la config voix », puis réessayez.",
          key: "voice-not-loaded",
        });
      }
    }
  });

  async function tryAiAutoTypoFix(span: ParagraphSpan, baseContent?: string): Promise<boolean> {
    if (autoTypoFixBusy || !autoTypoFixEnabled) return false;

    const body = baseContent ?? content;
    const lineText = body.slice(span.start, span.end);
    if (!lineNeedsAiTypoFix(lineText)) return false;

    autoTypoFixBusy = true;
    try {
      if (!ollamaStatus.available) {
        const ok = await ensureOllamaRunning(true);
        if (!ok) return false;
      }

      showAutoTypoNotice("Analyse de la phrase pour corriger les fautes…");
      const corrected = await invoke<string>("ollama_transform_note", {
        action: "correct",
        content: lineText,
        model: activeModel,
        noteContext: null,
        targetLanguage: null,
        ragContext: null,
      });
      const proposal =
        buildAiProposal("correct", lineText, corrected) ??
        (() => {
          const merged = finalizeCorrection(lineText, corrected);
          if (hasMeaningfulDiff(lineText, merged) && isFaithfulCorrection(lineText, merged)) {
            return merged;
          }
          return null;
        })();
      if (!proposal) return false;

      const next = replaceTextRange(body, span.start, span.end, proposal);
      if (next === body) return false;

      applyAutoTypoResult(
        next,
        span.start,
        span.end,
        proposal.length,
        "✓ Fautes corrigées (analyse de la phrase)",
      );
      return true;
    } catch {
      return false;
    } finally {
      autoTypoFixBusy = false;
    }
  }

  async function runAiTypoFixPass(baseContent?: string) {
    if (!autoTypoFixEnabled || !selectedPath) return;

    for (let attempt = 0; attempt < 5; attempt++) {
      const body = baseContent ?? content;
      const lines = scanBodyTypoLines(body).filter((line) => {
        const text = body.slice(line.start, line.end);
        return lineNeedsAiTypoFix(text);
      });
      if (!lines.length) break;

      const line = lines[0];
      const text = body.slice(line.start, line.end);
      const applied = await tryAiAutoTypoFix({ ...line, text }, body);
      if (!applied) break;
      baseContent = content;
    }
  }

  function showAutoTypoNotice(detail: string) {
    statusMessage = detail;
    if (autoTypoNoticeTimer) clearTimeout(autoTypoNoticeTimer);
    autoTypoNoticeTimer = setTimeout(() => {
      if (statusMessage === detail) statusMessage = "";
    }, 3500);
  }

  function applyAutoTypoResult(
    next: string,
    editStart: number,
    editEnd: number,
    replacementLen: number,
    message: string,
  ) {
    const caret = mapCaretThroughReplace(
      lastCaretOffset,
      editStart,
      editEnd,
      replacementLen,
    );
    content = next;
    lastCaretOffset = caret;
    editorCursor = caret;
    dirty = next !== savedContent;
    scheduleAutoSave();
    if (selectedPath && dirty) void persistNote(selectedPath, next);
    scheduleFullTypoScan(800);
    scheduleNoteScan(8000);
    showAutoTypoNotice(message);
  }

  async function handleAutoTypoFix(_span: ParagraphSpan) {
    if (!autoTypoFixEnabled || voiceStatus.recording || voiceStatus.transcribing) return;
    await runBatchAutoTypoFix();
  }

  async function runBatchAutoTypoFix() {
    if (!autoTypoFixEnabled || !selectedPath || autoTypoFixBusy) return;
    if (voiceStatus.recording || voiceStatus.transcribing) return;
    autoTypoFixBusy = true;

    try {
      aiSuggestions = aiSuggestions.filter(
        (s) => !(s.action === "correct" && s.source === "proactive"),
      );

      const before = content;
      const caretBefore = lastCaretOffset;
      const { content: next, count, caret } = autoFixAllTypoLines(content, caretBefore);
      let working = content;
      if (count > 0 && next !== before) {
        working = next;
        content = next;
        lastCaretOffset = caret;
        editorCursor = caret;
        dirty = next !== savedContent;
        scheduleAutoSave();
        if (selectedPath) await persistNote(selectedPath, next);
        showAutoTypoNotice(`✓ ${count} faute${count > 1 ? "s" : ""} corrigée${count > 1 ? "s" : ""} automatiquement`);
      }
      await runAiTypoFixPass(working);
      proactiveStatus = bodyHasTypoLines(content)
        ? "Certaines fautes nécessitent une correction manuelle."
        : count > 0
          ? "Fautes corrigées."
          : "";
    } finally {
      autoTypoFixBusy = false;
    }
  }

  function handleAutoTypoToggle(enabled: boolean) {
    autoTypoFixEnabled = enabled;
    saveAutoTypoFixEnabled(enabled);
    if (enabled) runBatchAutoTypoFix();
  }

  function appendTranscript(fragment: string) {
    const raw = fragment.trim();
    if (!raw) return;
    // Insertion via TipTap au caret réel (évite le décalage markdown n-1 / avant le point)
    pendingDictation = { text: raw, id: Date.now() };
    if (autoTypoFixEnabled) {
      silenceAiHelpers(8000);
      setTimeout(() => {
        if (!voiceStatus.recording && !voiceStatus.transcribing) {
          void runBatchAutoTypoFix();
        }
      }, 5000);
    }
  }

  async function handleVoiceTranscript(text: string) {
    voiceTranscriptChain = voiceTranscriptChain.then(async () => {
      if (!text.trim()) {
        const msg =
          "Aucune parole reconnue — phrase trop longue, trop de pauses, ou micro trop bas. Réessayez, ou passez la durée max à 90 s (Réglages → Voix).";
        statusMessage = msg;
        notify({ kind: "warning", title: "Aucune parole détectée", message: msg, key: "voice-empty" });
        return;
      }

      // Ne pas laisser un scan fautes écraser le feedback vocal tout de suite
      silenceAiHelpers(8000);

      const parsed = parseVoiceTranscript(text);

      if (parsed.kind === "unknown") {
        const preview = text.slice(0, 80);
        const msg = `Commande non reconnue : « ${preview} ». Dites par ex. « Scribe, corrige ».`;
        statusMessage = msg;
        notify({
          kind: "warning",
          title: "Commande vocale",
          message: msg,
          key: "voice-cmd",
        });
        return;
      }

      if (parsed.kind === "search") {
        openSearch();
        if (parsed.query) await runSearch(parsed.query);
        const msg = parsed.query
          ? `Recherche vocale : ${parsed.query}`
          : "Recherche vocale — saisissez un mot-clé.";
        statusMessage = msg;
        notify({ kind: "success", title: "Scribe · chercher", message: msg, key: "voice-cmd" });
        return;
      }

      if (parsed.kind === "open") {
        await openNoteByQuery(parsed.query);
        return;
      }

      if (parsed.kind === "ai") {
        const labels: Record<string, string> = {
          summarize: "résume",
          reformulate: "reformule",
          correct: "corrige",
          translate: parsed.translateTo
            ? `traduis en ${translateLangLabel(parsed.translateTo).toLowerCase()}`
            : "traduis",
        };
        const phrase = labels[parsed.action] ?? parsed.action;
        if (!selectedPath) {
          const msg = "Ouvrez une note pour les commandes IA vocales (PTT).";
          statusMessage = msg;
          notify({ kind: "warning", title: "Scribe", message: msg, key: "voice-cmd" });
          return;
        }
        if (!noteBody(content).trim()) {
          const msg = "La note est vide — rien à transformer. Dictez d'abord du texte.";
          statusMessage = msg;
          notify({ kind: "warning", title: "Scribe", message: msg, key: "voice-cmd" });
          return;
        }
        if (!ollamaStatus.available && parsed.action !== "correct") {
          const ok = await ensureOllamaRunning(true);
          if (!ok) {
            const msg = "Ollama hors ligne — impossible d'exécuter la commande IA.";
            statusMessage = msg;
            notify({ kind: "error", title: "Scribe", message: msg, key: "voice-cmd" });
            settingsOpen = true;
            return;
          }
        }
        statusMessage = `Commande vocale : ${phrase}…`;
        notify({
          kind: "info",
          title: "Scribe",
          message: `Commande « ${phrase} » reconnue — traitement…`,
          key: "voice-cmd",
        });
        await handleAiAction({
          action: parsed.action,
          translateTo: parsed.translateTo,
        });
        return;
      }

      if (!selectedPath) {
        const msg = "Ouvrez une note pour insérer la dictée (PTT).";
        statusMessage = msg;
        notify({ kind: "warning", title: "Note requise", message: msg });
        return;
      }

      appendTranscript(parsed.text);
      const preview = `« ${parsed.text.slice(0, 60)}${parsed.text.length > 60 ? "…" : ""} »`;
      statusMessage = `Dictée insérée : ${preview}`;
      notify({ kind: "success", title: "Dictée insérée", message: preview });
    });

    await voiceTranscriptChain;
  }

  async function openNoteByQuery(query: string) {
    const match = resolveWikilink(query, entries);
    if (!match) {
      const msg = `Aucune note trouvée pour « ${query} ».`;
      statusMessage = msg;
      notify({ kind: "warning", title: "Scribe · ouvrir", message: msg, key: "voice-cmd" });
      openSearch();
      await runSearch(query);
      return;
    }
    await loadNote(match.path);
    statusMessage = `Note ouverte : ${match.title}`;
    notify({
      kind: "success",
      title: "Scribe · ouvrir",
      message: `Note ouverte : ${match.title}`,
      key: "voice-cmd",
    });
  }

  function handleOpenWikilink(title: string) {
    void openNoteByQuery(title);
  }

  async function refreshOllama() {
    ollamaStatus = await invoke<OllamaStatus>("ollama_status");
  }

  async function ensureOllamaRunning(silent = false) {
    await refreshOllama();
    if (ollamaStatus.available) return true;

    try {
      const detect = await invoke<OllamaDetect>("ollama_detect");
      if (!detect.cliInstalled && !detect.serviceRunning) {
        try {
          await invoke<string>("ollama_start_service");
        } catch {
          return false;
        }
      } else if (!detect.serviceRunning) {
        await invoke<string>("ollama_start_service");
      }

      if (!silent) {
        statusMessage = "Démarrage d'Ollama…";
      }

      for (const delay of [2500, 3500, 5000]) {
        await new Promise((r) => setTimeout(r, delay));
        await refreshOllama();
        if (ollamaStatus.available) {
          if (!silent) {
            statusMessage = "Ollama connecté.";
          }
          return true;
        }
      }
    } catch (e) {
      if (!silent) {
        statusMessage = String(e);
      }
    }

    return ollamaStatus.available;
  }

  async function handleOllamaHeaderClick() {
    if (ollamaStatus.available) {
      openSettings();
      return;
    }
    const ok = await ensureOllamaRunning();
    if (!ok) {
      openSettings();
      statusMessage = "Ollama hors ligne — lancez-le ou installez-le dans Réglages.";
    }
  }

  async function refreshVault() {
    vaultPath = await invoke<string>("init_vault");
    entries = await invoke<VaultEntry[]>("list_vault");
  }

  async function loadNote(path: string) {
    if (selectedPath && selectedPath !== path) {
      if (dirty) await persistNote(selectedPath, content);
    }
    aiEpoch += 1;
    noteOpenedAt = Date.now();
    if (autoSummaryTimer) clearTimeout(autoSummaryTimer);
    if (noteScanTimer) clearTimeout(noteScanTimer);
    if (fullTypoScanTimer) clearTimeout(fullTypoScanTimer);

    selectedPath = path;
    const raw = await invoke<string>("read_note", { relativePath: path });
    content = ensureVisibleContextBlock(raw);
    savedContent = content;
    dirty = false;
    aiSuggestions = [];
    editorSelection = null;
    lastProactiveKey = "";
    lastAutoSummaryKey = "";
    proactiveStatus = "";
    companionOpen = true;
    if (content !== raw) {
      await persistNote(path, content);
    }
    scheduleNoteScan(4000);
    scheduleAutoSummary(45000);
    if (autoTypoFixEnabled) {
      queueMicrotask(() => void runBatchAutoTypoFix());
    }
  }

  async function persistNote(path: string, body: string) {
    saving = true;
    try {
      const stamped = touchUpdatedDate(body);
      await invoke("write_note", { relativePath: path, content: stamped });
      savedContent = stamped;
      dirty = false;
      if (selectedPath === path && stamped !== content) {
        // Frontmatter only → update content without forcing caret remap
        content = stamped;
      }
    } finally {
      saving = false;
    }
  }

  function scheduleAutoSave() {
    if (!selectedPath) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (dirty && selectedPath) persistNote(selectedPath, content);
    }, 1200);
  }

  function scheduleFullTypoScan(delayMs = 1200) {
    if (!autoTypoFixEnabled || !selectedPath) return;
    if (fullTypoScanTimer) clearTimeout(fullTypoScanTimer);
    fullTypoScanTimer = setTimeout(() => {
      if (voiceStatus.recording || voiceStatus.transcribing) return;
      void runBatchAutoTypoFix();
    }, delayMs);
  }

  function handleContentChange(value: string) {
    content = value;
    dirty = value !== savedContent;
    scheduleAutoSave();
    scheduleFullTypoScan(1200);
    if (!isAiQuiet()) {
      scheduleNoteScan(8000);
    }
    scheduleAutoSummary(40000);
  }

  function scheduleAutoSummary(delayMs = 40000) {
    if (!autoSummarizeEnabled || !selectedPath) return;
    // Après ouverture, attendre au moins 45 s avant le premier résumé auto
    const sinceOpen = Date.now() - noteOpenedAt;
    const wait = Math.max(delayMs, 45000 - sinceOpen);
    if (autoSummaryTimer) clearTimeout(autoSummaryTimer);
    autoSummaryTimer = setTimeout(() => {
      void maybeAutoSummarize(selectedPath!, content);
    }, wait);
  }

  async function maybeAutoSummarize(path: string, body: string) {
    if (!autoSummarizeEnabled) return;
    // Pas de résumé auto juste après ouverture (évite le spam à chaud)
    if (Date.now() - noteOpenedAt < 20000) return;

    const epoch = aiEpoch;
    const text = noteBody(body).trim();
    if (text.length < 280) return;
    if (text.split(/\s+/).length < 40) return;

    const existing = extractExistingSummary(body);
    const key = `${path}:${text.length}:${text.slice(0, 80)}`;
    if (key === lastAutoSummaryKey) return;
    if (aiLoading || proactiveLoading) return;

    if (!ollamaStatus.available) {
      const ok = await ensureOllamaRunning(true);
      if (!ok) return;
    }

    const already = aiSuggestions.some(
      (s) =>
        s.action === "summarize" &&
        s.source === "proactive" &&
        s.notePath === path &&
        !s.selection,
    );
    if (already) return;

    try {
      statusMessage = "Résumé automatique en cours…";
      const ragContext = await fetchRagContext(text.slice(0, 800), path);
      if (epoch !== aiEpoch || selectedPath !== path) return;

      const result = await invoke<string>("ollama_summarize_note", {
        content: text,
        model: activeModel,
        noteContext: parseNoteContext(body).trim() || null,
        ragContext: ragContext || null,
      });
      if (epoch !== aiEpoch || selectedPath !== path) return;

      const proposal = buildAiProposal("summarize", text, result);
      if (!proposal) return;
      if (isDuplicateSummary(existing, proposal)) {
        lastAutoSummaryKey = key;
        statusMessage = "Résumé déjà à jour — aucune proposition.";
        return;
      }

      lastAutoSummaryKey = key;
      companionOpen = true;
      const suggestion: AiSuggestion = {
        id: crypto.randomUUID(),
        action: "summarize",
        label: "Résumé",
        scope: "à ajouter en fin de note",
        proposedText: proposal,
        originalText: "",
        notePath: path,
        source: "proactive",
        applyMode: "append",
        reason: "Inactivité d'édition — complément, pas un remplacement",
      };
      aiSuggestions = [suggestion, ...aiSuggestions.filter((s) => s.notePath === path)].slice(0, 12);
      statusMessage = "Résumé prêt (ajout en fin de note) — appliquez ou ignorez.";
    } catch (e) {
      if (epoch === aiEpoch && selectedPath === path) {
        statusMessage = `Résumé auto indisponible : ${e}`;
      }
    }
  }

  function handleAutoSummarizeToggle(enabled: boolean) {
    autoSummarizeEnabled = enabled;
    saveAutoSummarizeEnabled(enabled);
    if (enabled) scheduleAutoSummary(5000);
  }

  async function handleCreateNote(parentPath: string) {
    const name = prompt("Nom de la note :");
    if (!name?.trim()) return;
    const path = await invoke<string>("create_note", { parentPath, name: name.trim() });
    await refreshVault();
    await loadNote(path);
  }

  async function handleCreateFolder(parentPath: string) {
    const name = prompt("Nom du dossier :");
    if (!name?.trim()) return;
    await invoke("create_folder", { parentPath, name: name.trim() });
    await refreshVault();
  }

  async function handleDelete(path: string) {
    if (!confirm(`Supprimer « ${path} » ?`)) return;
    await invoke("delete_item", { relativePath: path });
    if (selectedPath === path) {
      selectedPath = null;
      content = "";
      savedContent = "";
      dirty = false;
    }
    await refreshVault();
  }

  async function handleMove(sourcePath: string, destinationParent: string) {
    try {
      const newPath = await invoke<string>("move_vault_item", {
        relativePath: sourcePath,
        destinationParent,
      });

      if (selectedPath === sourcePath) {
        selectedPath = newPath;
      } else if (selectedPath?.startsWith(`${sourcePath}/`)) {
        selectedPath = `${newPath}${selectedPath.slice(sourcePath.length)}`;
      }

      await refreshVault();
      statusMessage = destinationParent
        ? `Déplacé dans « ${destinationParent} »`
        : "Déplacé à la racine du vault";
    } catch (e) {
      statusMessage = String(e);
    }
  }

  async function handleAiAction(request: AiActionRequest) {
    const { action, selection: rawSel, translateTo } = request;
    const located = rawSel ? locateSelectionInContent(content, rawSel) : null;
    const sel = rawSel && located
      ? { ...rawSel, start: located.start, end: located.end }
      : rawSel && rawSel.text
        ? rawSel
        : undefined;
    // Si une sélection était demandée mais introuvable → ne pas traduire toute la note par erreur
    if (rawSel?.text && !located && (action === "translate" || action === "reformulate" || action === "correct")) {
      const msg =
        "Sélection introuvable dans la note — resélectionnez le passage puis relancez l'action.";
      statusMessage = msg;
      notify({ kind: "warning", title: "Sélection", message: msg, key: "ai-sel" });
      return;
    }
    const fullNote = !sel;
    const targetText = sel?.text ?? noteBody(content);
    if (!targetText.trim()) {
      const msg = "La note est vide — rien à transformer.";
      statusMessage = msg;
      notify({ kind: "warning", title: "IA", message: msg, key: "ai-empty" });
      return;
    }

    const epoch = aiEpoch;
    const pathAtStart = selectedPath;

    if (!ollamaStatus.available && action !== "correct") {
      const started = await ensureOllamaRunning(true);
      if (!started) {
        settingsOpen = true;
        statusMessage = "Configurez ou démarrez Ollama dans les réglages.";
        return;
      }
    }

    aiLoading = true;
    companionOpen = true;
    const lang = translateTo ?? "en";
    const labels: Record<AiAction, string> = {
      summarize: "Résumé",
      reformulate: "Reformulation",
      correct: "Correction",
      translate: `Traduction (${translateLangLabel(lang)})`,
      custom: "Prompt custom",
    };
    const scope =
      action === "summarize"
        ? "à ajouter en fin de note"
        : sel
          ? "sélection"
          : "note";
    statusMessage = `${labels[action]} (${scope}) — suggestion en cours…`;

    const stillCurrent = () => epoch === aiEpoch && selectedPath === pathAtStart;

    try {
      let result = "";
      const ctx = noteContext.trim() || null;
      const wantsRag = action === "summarize" || action === "reformulate" || action === "custom";
      const ragContext = wantsRag
        ? await fetchRagContext(targetText.slice(0, 800), pathAtStart)
        : "";

      if (!stillCurrent()) return;

      if (action === "correct" && !ollamaStatus.available) {
        result = "";
      } else if (action === "summarize") {
        result = await invoke<string>("ollama_summarize_note", {
          content: targetText,
          model: activeModel,
          noteContext: ctx,
          ragContext: ragContext || null,
        });
      } else if (action === "translate") {
        result = await invoke<string>("ollama_transform_note", {
          action: "translate",
          content: targetText,
          model: activeModel,
          noteContext: ctx,
          targetLanguage: translateLangLabel(lang).toLowerCase(),
          ragContext: null,
        });
      } else {
        result = await invoke<string>("ollama_transform_note", {
          action,
          content: targetText,
          model: activeModel,
          noteContext: action === "correct" ? null : ctx,
          targetLanguage: null,
          ragContext: action === "reformulate" ? ragContext || null : null,
        });
      }

      if (!stillCurrent()) return;

      const proposal = buildAiProposal(action, targetText, result);
      if (!proposal && action === "correct") {
        const localOnly = buildLocalCorrection(targetText);
        if (localOnly && hasMeaningfulDiff(targetText, localOnly)) {
          pushSuggestion({
            action,
            label: labels[action],
            scope,
            proposedText: localOnly,
            originalText: targetText,
            source: "manual",
            notePath: pathAtStart ?? undefined,
            selection: sel ? { start: sel.start, end: sel.end, text: sel.text } : undefined,
          });
          statusMessage = "Correction locale proposée.";
          return;
        }
      }

      if (!proposal) {
        statusMessage =
          action === "correct"
            ? "Aucune correction trouvée pour ce passage."
            : "Réponse IA vide — réessayez.";
        return;
      }

      if (action === "summarize") {
        if (isDuplicateSummary(extractExistingSummary(content), proposal)) {
          statusMessage = "Ce résumé est déjà présent dans la note.";
          return;
        }
      }

      if (
        (action === "translate" || action === "reformulate") &&
        !hasMeaningfulDiff(targetText, proposal)
      ) {
        statusMessage = "La proposition est identique au texte actuel.";
        return;
      }

      const isSummary = action === "summarize";

      // Traduction sélection : appliquer tout de suite + silence des helpers auto
      if (!isSummary && action === "translate" && sel) {
        const range = locateSelectionInContent(content, sel) ?? {
          start: sel.start,
          end: sel.end,
        };
        const next = replaceTextRange(content, range.start, range.end, proposal);
        silenceAiHelpers(120000);
        handleContentChange(next);
        editorCursor = range.start + proposal.length;
        lastCaretOffset = range.start + proposal.length;
        companionOpen = true;
        statusMessage = `${labels[action]} appliquée à la sélection.`;
        notify({
          kind: "success",
          title: "Traduction",
          message: `Sélection traduite (${proposal.length} car.)`,
          key: "ai-translate",
        });
        return;
      }

      // Traduction / reformulation / correction sur toute la note : appliquer tout de suite
      if (
        fullNote &&
        !isSummary &&
        (action === "translate" || action === "reformulate" || action === "correct")
      ) {
        const next = mergeBodyMarkdown(content, proposal.trim() + "\n");
        silenceAiHelpers(action === "translate" ? 120000 : 90000);
        handleContentChange(next);
        editorCursor = Math.min(next.length, Math.max(1, proposal.length));
        companionOpen = true;
        statusMessage = `${labels[action]} appliquée à la note.`;
        return;
      }

      if (!isSummary && (action === "reformulate" || action === "correct") && sel) {
        silenceAiHelpers(60000);
      }

      pushSuggestion({
        action,
        label: labels[action],
        scope,
        proposedText: proposal,
        originalText: isSummary ? "" : targetText,
        source: "manual",
        notePath: pathAtStart ?? undefined,
        applyMode: isSummary ? "append" : "replace",
        reason: isSummary
          ? "Sera ajouté en fin de note (complément)"
          : undefined,
        selection:
          isSummary || !sel
            ? undefined
            : { start: sel.start, end: sel.end, text: sel.text },
      });
      statusMessage = isSummary
        ? "Résumé prêt — appliquez pour l'ajouter en fin de note."
        : `Suggestion « ${labels[action]} » prête — cliquez « Appliquer » dans le Compagnon.`;
    } catch (e) {
      if (!stillCurrent()) return;
      if (action === "correct") {
        const proposal = buildAiProposal("correct", targetText, "");
        if (proposal) {
          pushSuggestion({
            action,
            label: labels[action],
            scope,
            proposedText: proposal,
            originalText: targetText,
            source: "manual",
            notePath: pathAtStart ?? undefined,
            selection: sel ? { start: sel.start, end: sel.end, text: sel.text } : undefined,
          });
          statusMessage = "Correction locale proposée.";
          return;
        }
      }
      statusMessage = `Erreur IA : ${e}`;
    } finally {
      aiLoading = false;
    }
  }

  function pushSuggestion(
    partial: Omit<AiSuggestion, "id"> & { id?: string },
  ) {
    const path = partial.notePath ?? selectedPath ?? undefined;
    const suggestion: AiSuggestion = {
      id: partial.id ?? crypto.randomUUID(),
      ...partial,
      notePath: path,
    };
    aiSuggestions = [
      suggestion,
      ...aiSuggestions.filter((s) => !s.notePath || s.notePath === path),
    ].slice(0, 12);
  }

  async function handleCustomPrompt(instruction: string) {
    if (!instruction.trim() || !selectedPath) return;

    const epoch = aiEpoch;
    const pathAtStart = selectedPath;
    const sel = editorSelection;
    const targetText = sel?.text ?? content;
    if (!targetText.trim()) {
      statusMessage = "Rien à traiter — sélectionnez du texte ou écrivez dans la note.";
      return;
    }

    if (!ollamaStatus.available) {
      const started = await ensureOllamaRunning(true);
      if (!started) {
        settingsOpen = true;
        statusMessage = "Configurez ou démarrez Ollama dans les réglages.";
        return;
      }
    }

    aiLoading = true;
    companionOpen = true;
    const scope = sel ? "sélection" : "note";
    statusMessage = `Prompt custom (${scope}) — en cours…`;

    try {
      const result = await invoke<string>("ollama_custom_prompt", {
        instruction: instruction.trim(),
        content: targetText,
        model: activeModel,
        noteContext: noteContext.trim() || null,
        ragContext: (await fetchRagContext(targetText.slice(0, 800), pathAtStart)) || null,
      });

      if (epoch !== aiEpoch || selectedPath !== pathAtStart) return;

      const proposal = buildAiProposal("custom", targetText, result);
      if (!proposal) {
        statusMessage = "Réponse IA vide — modifiez le prompt ou réessayez.";
        return;
      }

      const label =
        instruction.trim().length > 42
          ? `Custom : ${instruction.trim().slice(0, 39)}…`
          : `Custom : ${instruction.trim()}`;

      pushSuggestion({
        action: "custom",
        label,
        scope,
        proposedText: proposal,
        originalText: targetText,
        source: "manual",
        notePath: pathAtStart,
        reason: instruction.trim(),
        selection: sel ? { start: sel.start, end: sel.end, text: sel.text } : undefined,
      });
      statusMessage = "Suggestion custom prête — appliquez ou ignorez.";
    } catch (e) {
      if (epoch === aiEpoch && selectedPath === pathAtStart) {
        statusMessage = `Erreur IA : ${e}`;
      }
    } finally {
      aiLoading = false;
    }
  }

  function applySuggestion(id: string) {
    const suggestion = aiSuggestions.find((s) => s.id === id);
    if (!suggestion) return;
    if (suggestion.notePath && selectedPath && suggestion.notePath !== selectedPath) {
      aiSuggestions = aiSuggestions.filter((s) => s.id !== id);
      statusMessage = "Suggestion d'une autre note — ignorée.";
      return;
    }

    // Ne jamais laisser le proactif / typo-IA réécrire juste après une applique manuelle
    silenceAiHelpers(
      suggestion.action === "translate" || suggestion.action === "reformulate" ? 120000 : 60000,
    );

    if (suggestion.applyMode === "append" || suggestion.action === "summarize") {
      const block = formatSummaryAppendix(suggestion.proposedText, suggestion.label || "Résumé");
      editorCursor = content.length + block.length;
      handleContentChange(content + block);
    } else if (suggestion.selection) {
      const start = suggestion.selection.start;
      const proposed = suggestion.proposedText;
      handleContentChange(
        replaceTextRange(content, start, suggestion.selection.end, proposed),
      );
      editorCursor = start + proposed.length;
    } else if (
      suggestion.action === "translate" ||
      suggestion.action === "reformulate" ||
      suggestion.action === "correct"
    ) {
      const next = mergeBodyMarkdown(content, suggestion.proposedText.trim() + "\n");
      editorCursor = Math.min(next.length, Math.max(1, suggestion.proposedText.length));
      handleContentChange(next);
    } else {
      handleContentChange(suggestion.proposedText);
      editorCursor = Math.min(suggestion.proposedText.length, content.length);
    }

    aiSuggestions = aiSuggestions.filter((s) => s.id !== id);
    statusMessage =
      suggestion.action === "summarize"
        ? "Résumé ajouté en fin de note."
        : "Suggestion appliquée.";
  }

  function dismissSuggestion(id: string) {
    aiSuggestions = aiSuggestions.filter((s) => s.id !== id);
  }

  function toggleCompanion() {
    companionOpen = !companionOpen;
    if (companionOpen) {
      if (autoTypoFixEnabled) void runBatchAutoTypoFix();
      scheduleNoteScan(5000);
    }
  }

  function scheduleNoteScan(delayMs = 5000) {
    if (!selectedPath) return;
    if (isAiQuiet()) return;
    if (!proactiveEnabled && !autoTypoFixEnabled) return;
    if (noteScanTimer) clearTimeout(noteScanTimer);
    noteScanTimer = setTimeout(() => {
      void scanNoteForSuggestions();
    }, delayMs);
  }

  function hasSuggestionForSpan(span: { start: number; end: number }) {
    return aiSuggestions.some((s) => s.selection?.start === span.start && s.selection?.end === span.end);
  }

  async function scanNoteForSuggestions() {
    if (!selectedPath) return;

    if (autoTypoFixEnabled && !aiLoading) {
      await runBatchAutoTypoFix();
    }

    if (proactiveLoading || aiLoading || !proactiveEnabled || isAiQuiet()) return;

    const typoLines = scanBodyTypoLines(content);
    if (typoLines.length) {
      const target = typoLines.find((line) => !hasSuggestionForSpan(line));
      if (target) {
        await processProactiveSpan(
          { ...target, text: content.slice(target.start, target.end) },
          "passage fautif",
        );
      } else if (!proactiveStatus) {
        proactiveStatus = "Des fautes restent — utilisez Corriger (clic droit) si besoin.";
      }
      return;
    }

    proactiveStatus = "";
  }

  async function processProactiveSpan(span: ParagraphSpan, scopeLabel = "passage en cours") {
    if (!proactiveEnabled || !selectedPath || isAiQuiet()) return;
    if (bodyHasTypoLines(content) && !likelyNeedsCorrection(span.text)) return;

    const minLen = 12;
    if (span.text.trim().length < minLen) return;
    if (!likelyNeedsCorrection(span.text)) return;
    if (aiLoading || proactiveLoading) return;

    const now = Date.now();
    const cooldown = 30000;
    const key = `${selectedPath}:${span.start}:${span.end}:${span.text.trim()}`;
    if (now - lastProactiveAt < cooldown && key === lastProactiveKey) return;
    if (key === lastProactiveKey && hasSuggestionForSpan(span)) return;

    if (hasSuggestionForSpan(span)) return;

    proactiveLoading = true;
    companionOpen = true;
    proactiveStatus = "Vérification orthographique…";
    statusMessage = proactiveStatus;
    const epoch = aiEpoch;
    const pathAtStart = selectedPath;

    const addSuggestion = (
      action: AiAction,
      label: string,
      proposed: string,
      reason?: string,
      scopeLabel = "passage en cours",
    ) => {
      if (epoch !== aiEpoch || selectedPath !== pathAtStart) return;
      // Uniquement des corrections fidèles — jamais de reformulation auto
      if (action !== "correct") return;
      if (!isFaithfulCorrection(span.text, proposed)) return;
      pushSuggestion({
        action: "correct",
        label,
        scope: scopeLabel,
        source: "proactive",
        reason,
        proposedText: proposed,
        originalText: span.text,
        notePath: pathAtStart ?? undefined,
        selection: { start: span.start, end: span.end, text: span.text },
      });
      lastProactiveKey = key;
      lastProactiveAt = now;
      proactiveStatus = "";
      statusMessage = "Correction proposée — appliquez ou ignorez.";
    };

    try {
      if (ollamaStatus.available) {
        const result = await invoke<ProactiveSuggestionResponse>("ollama_proactive_suggest", {
          paragraph: span.text,
          noteExcerpt: content.slice(0, 1500),
          noteContext: noteContext.trim() || null,
          model: activeModel,
        });

        if (epoch !== aiEpoch || selectedPath !== pathAtStart || isAiQuiet()) return;

        if (result.suggest && result.proposed?.trim()) {
          const label = result.label?.toLowerCase() ?? "";
          if (label.includes("reform")) {
            lastProactiveAt = now;
            proactiveStatus = "";
            return;
          }
          const proposed = sanitizeAiOutput(result.proposed, "correct");
          if (
            proposed.trim() &&
            hasMeaningfulDiff(span.text, proposed) &&
            isFaithfulCorrection(span.text, proposed)
          ) {
            addSuggestion(
              "correct",
              result.label?.trim() || "Correction",
              proposed,
              result.reason?.trim(),
              scopeLabel,
            );
            return;
          }
        }
      }

      if (epoch !== aiEpoch || selectedPath !== pathAtStart) return;

      proactiveStatus = bodyHasTypoLines(content)
        ? "Certaines fautes nécessitent une correction manuelle."
        : "";
      statusMessage = proactiveStatus;
      lastProactiveAt = now;
    } catch (e) {
      proactiveStatus = `Analyse indisponible : ${e}`;
      statusMessage = proactiveStatus;
    } finally {
      proactiveLoading = false;
      if (!isAiQuiet()) scheduleNoteScan(20000);
    }
  }

  async function handleEditingIdle(span: ParagraphSpan) {
    if (!selectedPath) return;

    if (autoTypoFixEnabled && bodyHasTypoLines(content)) {
      await runBatchAutoTypoFix();
      return;
    }

    if (!proactiveEnabled || isAiQuiet()) return;
    if (!likelyNeedsCorrection(span.text)) return;
    await processProactiveSpan(span);
  }

  function handleProactiveToggle(enabled: boolean) {
    proactiveEnabled = enabled;
    saveProactiveEnabled(enabled);
  }

  function handleNoteContextChange(value: string) {
    const next = setNoteContext(content, value);
    handleContentChange(next);
  }

  async function queueImageMarkdown(relative: string) {
    const alt = relative.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "image";
    pendingImageMarkdown = `![${alt}](${relative})`;
    statusMessage = `Image copiée dans ${relative.includes("/_media/") || relative.startsWith("_media/") ? "le dossier de la note" : "media/"}.`;
  }

  async function importImageFromPath(sourcePath: string, useGlobalMedia = false) {
    const relative = await invoke<string>("import_image", {
      sourcePath,
      notePath: selectedPath,
      useGlobalMedia,
    });
    await queueImageMarkdown(relative);
  }

  async function importImagesFromPaths(paths: string[]) {
    if (!selectedPath) {
      statusMessage = "Ouvrez une note pour y insérer une image.";
      return;
    }
    for (const sourcePath of paths) {
      await importImageFromPath(sourcePath, false);
    }
  }

  async function importPastedImage(base64: string, extension: string) {
    if (!selectedPath) {
      statusMessage = "Ouvrez une note pour y coller une image.";
      return;
    }
    const relative = await invoke<string>("import_image_bytes", {
      dataBase64: base64,
      extension,
      notePath: selectedPath,
      useGlobalMedia: false,
    });
    await queueImageMarkdown(relative);
  }

  async function handleInsertImage() {
    if (!selectedPath) {
      statusMessage = "Ouvrez une note pour y insérer une image.";
      return;
    }

    const picked = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"] }],
    });
    if (!picked) return;

    const sourcePath = typeof picked === "string" ? picked : picked;
    try {
      await importImageFromPath(sourcePath, false);
    } catch (e) {
      statusMessage = `Erreur image : ${e}`;
    }
  }

  async function handleExport() {
    if (!selectedPath) return;
    const dest = await save({
      defaultPath: selectedPath.split("/").pop() ?? "note.md",
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!dest) return;
    await invoke("export_note", { relativePath: selectedPath, destination: dest });
    statusMessage = "Note exportée.";
  }

  function handleThemeToggle() {
    theme = toggleTheme(theme);
    saveTheme(theme);
  }

  async function runSearch(q: string) {
    searchQuery = q;
    if (searchTimer) clearTimeout(searchTimer);
    if (!q.trim()) {
      searchResults = [];
      return;
    }
    searchLoading = true;
    searchTimer = setTimeout(async () => {
      try {
        searchResults = await invoke<SearchResult[]>("search_vault", { query: q });
      } finally {
        searchLoading = false;
      }
    }, 200);
  }

  function openSearch() {
    searchOpen = true;
    searchQuery = "";
    searchResults = [];
  }

  function closeSearch() {
    searchOpen = false;
  }

  function openSettings() {
    settingsOpen = true;
  }

  function closeSettings() {
    settingsOpen = false;
  }

  async function selectFromSearch(path: string) {
    closeSearch();
    await loadNote(path);
  }

  function onGlobalKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "t") {
      e.preventDefault();
      if (searchOpen) closeSearch();
      else openSearch();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === ",") {
      e.preventDefault();
      if (settingsOpen) closeSettings();
      else openSettings();
    }
  }

  onMount(async () => {
    theme = loadTheme();
    applyTheme(theme);
    proactiveEnabled = loadProactiveEnabled();
    autoTypoFixEnabled = loadAutoTypoFixEnabled();
    autoSummarizeEnabled = loadAutoSummarizeEnabled();
    await refreshVault();
    await ensureOllamaRunning(true);
    await refreshVoice();

    unlisteners.push(
      await listen<VoiceTranscript>("voice-transcript", (event) => {
        handleVoiceTranscript(event.payload.text);
      }),
      await listen("voice-event", async (event) => {
        await refreshVoice();
        const payload = event.payload as {
          type?: string;
          message?: string;
          active?: boolean;
          loading?: boolean;
          loaded?: boolean;
        };
        if (payload?.type === "error" && payload.message) {
          const soft =
            payload.message.includes("Transcription encore") ||
            payload.message.includes("automatiquement");
          statusMessage = `Voix : ${payload.message}`;
          if (!soft) {
            notify({
              kind: "error",
              title: "Erreur vocale",
              message: payload.message,
              key: `voice-error:${payload.message}`,
            });
          } else {
            notify({
              kind: "warning",
              title: "Voix",
              message: payload.message,
              key: "voice-soft",
            });
          }
        }
        if (payload?.type === "transcript") {
          // statut rafraîchi ci-dessus
        }
      }),
      await listen("voice-worker-stopped", async (event) => {
        await refreshVoice();
        const payload = (event.payload ?? {}) as { message?: string; exitCode?: number | null };
        const detail =
          payload.message?.trim() ||
          "Worker vocal arrêté. Réglages → Voix → « Appliquer la config voix » pour le relancer.";
        statusMessage = detail;
        notify({
          kind: "error",
          title: "Worker vocal arrêté",
          message: detail,
          key: "voice-stopped",
          durationMs: 16000,
        });

        const now = Date.now();
        if (now - voiceCrashWindowStart > 60_000) {
          voiceCrashWindowStart = now;
          voiceCrashRestarts = 0;
        }
        if (voiceCrashRestarts >= 1) {
          notify({
            kind: "warning",
            title: "Voix bloquée",
            message:
              "Relance auto arrêtée. Réglages → Voix → « Appliquer la config voix ». Logs : Documents/CyberScribeNote/voice_worker.log",
            key: "voice-blocked",
            durationMs: 20000,
          });
          return;
        }
        voiceCrashRestarts += 1;

        try {
          await invoke("voice_restart", { force: true });
          await invoke("voice_preload_whisper_model");
          notify({
            kind: "info",
            title: "Worker vocal relancé",
            message: "Attendez le chargement du modèle Whisper avant de dicter.",
            key: "voice-restart",
          });
          await refreshVoice();
        } catch (e) {
          notify({
            kind: "error",
            title: "Relance impossible",
            message: String(e),
            key: "voice-restart-fail",
          });
        }
      }),
    );

    const welcome = entries.find((e) => !e.isDir && e.path === "Bienvenue.md");
    if (welcome) await loadNote(welcome.path);
  });

  onDestroy(() => {
    for (const u of unlisteners) u();
  });
</script>

<svelte:window onkeydown={onGlobalKeydown} />

<div class="flex h-screen flex-col overflow-hidden">
  <header class="flex items-center justify-between border-b border-border bg-surface px-4 py-2">
    <div class="flex items-center gap-3 text-xs text-text-muted">
      <button
        type="button"
        class="rounded-lg px-2 py-0.5 transition hover:bg-surface-muted {voiceStatus.recording ? 'bg-danger/20' : ''}"
        onclick={handleVoiceToggle}
        title="Push-to-talk ({voiceStatus.hotkey}) — appuyez pour parler, rappuyez pour arrêter"
      >
        <span class="inline-flex items-center gap-1">
          <PixelIcon name="mic" size={16} class={voiceStatus.recording ? "text-danger" : ""} />
          {voiceStatus.recording ? "REC…" : voiceStatus.hotkey}
        </span>
      </button>
      <button
        type="button"
        class="rounded-lg px-1 transition hover:bg-surface-muted {ollamaStatus.available ? '' : 'text-accent-blue'}"
        onclick={handleOllamaHeaderClick}
        title={ollamaStatus.available ? "Ollama connecté — réglages" : "Cliquer pour démarrer Ollama"}
      >
        Ollama : {ollamaStatus.available ? "connecté" : "hors ligne"}
        {#if ollamaStatus.available}
          · {activeModel}
        {/if}
      </button>
      {#if statusMessage}
        <span class="text-accent-blue">· {statusMessage}</span>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="rounded-2xl border border-border px-3 py-1.5 text-xs transition hover:bg-surface-muted"
        onclick={openSearch}
      >
        ⌕ Recherche
        <kbd class="ml-1 rounded border border-border px-1 text-[10px]">Ctrl+T</kbd>
      </button>
      <button
        type="button"
        class="rounded-2xl border border-border px-3 py-1.5 text-xs transition hover:bg-surface-muted"
        onclick={openSettings}
      >
        ⚙ Réglages
        <kbd class="ml-1 rounded border border-border px-1 text-[10px]">Ctrl+,</kbd>
      </button>
      <button
        type="button"
        class="rounded-2xl border border-border px-3 py-1.5 text-xs transition hover:bg-surface-muted"
        onclick={handleThemeToggle}
      >
        {theme === "light" ? "☾ Sombre" : "☀ Clair"}
      </button>
    </div>
  </header>

  <div class="flex min-h-0 flex-1">
    <Sidebar
      {entries}
      {vaultPath}
      {selectedPath}
      onSelect={loadNote}
      onRefresh={refreshVault}
      onCreateNote={handleCreateNote}
      onCreateFolder={handleCreateFolder}
      onDelete={handleDelete}
      onMove={handleMove}
    />

    {#if selectedPath}
      <MarkdownEditor
        {content}
        {title}
        notePath={selectedPath}
        {vaultPath}
        {dirty}
        {saving}
        ollamaAvailable={ollamaStatus.available}
        {aiLoading}
        companionOpen={companionOpen}
        onChange={handleContentChange}
        onSave={() => selectedPath && persistNote(selectedPath, content)}
        onAiAction={handleAiAction}
        onInsertImage={handleInsertImage}
        onImportImages={importImagesFromPaths}
        onPasteImageBytes={importPastedImage}
        onExport={handleExport}
        onToggleCompanion={toggleCompanion}
        onSelectionChange={(sel) => {
          editorSelection = sel;
          if (sel) lastCaretOffset = sel.end;
        }}
        onCaretChange={(offset) => {
          lastCaretOffset = offset;
        }}
        onEditingIdle={handleEditingIdle}
        onAutoTypoFix={handleAutoTypoFix}
        {autoTypoFixEnabled}
        highlightRange={editorHighlight}
        {editorCursor}
        onCursorRestored={() => (editorCursor = null)}
        onOpenWikilink={handleOpenWikilink}
        insertImageMarkdown={pendingImageMarkdown}
        onImageMarkdownConsumed={() => (pendingImageMarkdown = null)}
        dictationInsert={pendingDictation}
        onDictationConsumed={() => (pendingDictation = null)}
      />
    {:else}
      <section class="flex flex-1 flex-col items-center justify-center gap-4 bg-bg text-center">
        <PixelIcon name="note" size={24} class="text-accent-lavender" />
        <div>
          <h2 class="text-xl font-semibold">Sélectionnez ou créez une note</h2>
          <p class="mt-1 text-sm text-text-muted">
            Votre vault est dans Documents/CyberScribeNote/vault
          </p>
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            class="rounded-2xl bg-accent-lavender/50 px-4 py-2 text-sm font-medium transition hover:bg-accent-lavender/70"
            onclick={() => handleCreateNote("")}
          >
            + Nouvelle note
          </button>
          {#if !ollamaStatus.available}
            <button
              type="button"
              class="rounded-2xl border border-border px-4 py-2 text-sm transition hover:bg-surface-muted"
              onclick={openSettings}
            >
              Configurer Ollama
            </button>
          {/if}
        </div>
      </section>
    {/if}
  </div>
</div>

<SearchPanel
  open={searchOpen}
  query={searchQuery}
  results={searchResults}
  loading={searchLoading}
  onQueryChange={runSearch}
  onSelect={selectFromSearch}
  onClose={closeSearch}
/>

<SettingsPanel
  open={settingsOpen}
  onClose={closeSettings}
  onOllamaUpdated={(s) => (ollamaStatus = s)}
/>

<VoiceOverlay
  recording={voiceStatus.recording}
  transcribing={voiceStatus.transcribing}
  modelLoading={voiceStatus.modelLoading}
  hotkey={voiceStatus.hotkey}
/>

<AiCompanionPanel
  open={companionOpen && !!selectedPath}
  {voiceStatus}
  onToggleRecord={handleVoiceToggle}
  {noteContext}
  notePath={selectedPath}
  suggestions={aiSuggestions.filter((s) => !s.notePath || s.notePath === selectedPath)}
  {aiLoading}
  {proactiveLoading}
  {proactiveEnabled}
  {autoTypoFixEnabled}
  {autoSummarizeEnabled}
  {proactiveStatus}
  customTargetLabel={customPromptTargetLabel}
  onContextChange={handleNoteContextChange}
  onProactiveToggle={handleProactiveToggle}
  onAutoTypoToggle={handleAutoTypoToggle}
  onAutoSummarizeToggle={handleAutoSummarizeToggle}
  onCustomPrompt={handleCustomPrompt}
  onApply={applySuggestion}
  onDismiss={dismissSuggestion}
  onDismissAll={() => (aiSuggestions = [])}
  onClose={() => (companionOpen = false)}
/>
