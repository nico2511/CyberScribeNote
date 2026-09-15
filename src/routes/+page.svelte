<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "$lib/tauri/api";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { save, open } from "@tauri-apps/plugin-dialog";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import MarkdownEditor from "$lib/components/MarkdownEditor.svelte";
  import SearchPanel from "$lib/components/SearchPanel.svelte";
  import SettingsPanel from "$lib/components/SettingsPanel.svelte";
  import VoiceOverlay from "$lib/components/VoiceOverlay.svelte";
  import AiCompanionPanel from "$lib/components/AiCompanionPanel.svelte";
  import ScribeBuddy from "$lib/components/ScribeBuddy.svelte";
  import WelcomeSplash from "$lib/components/WelcomeSplash.svelte";
  import SetupWizard from "$lib/components/SetupWizard.svelte";
  import NoteHistoryPanel from "$lib/components/NoteHistoryPanel.svelte";
  import { applyTheme, loadTheme, saveTheme, toggleTheme } from "$lib/stores/theme";
  import type { ParagraphSpan } from "$lib/note/paragraph";
  import {
    loadProactiveEnabled,
    saveProactiveEnabled,
    loadAutoTypoFixEnabled,
    saveAutoTypoFixEnabled,
    loadAutoSummarizeEnabled,
    saveAutoSummarizeEnabled,
    loadBuddyEnabled,
    saveBuddyEnabled,
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
  import { resolveWikilink, flattenNotes, noteStem } from "$lib/vault/wikilinks";
  import {
    extractExistingSummary,
    formatSummaryAppendix,
    isDuplicateSummary,
    translateLangLabel,
  } from "$lib/ai/languages";
  import { fetchRagContext } from "$lib/ai/rag";
  import { getSkill, parseTagsProposal, type SkillId } from "$lib/ai/skills";
  import {
    scanBuddyTip,
    moodFromActivity,
    type BuddyMood,
    type BuddyTip,
    type BuddyAction,
  } from "$lib/ai/scribeBuddy";
  import { noteBody, parseNoteContext, setNoteContext, setFrontmatterTags } from "$lib/note/frontmatter";
  import { mergeBodyMarkdown } from "$lib/markdown/bridge";
  import PixelIcon from "$lib/components/PixelIcon.svelte";
  import { dismissToast, notify } from "$lib/stores/notifications";
  import {
    noteSession,
    loadNote as loadNoteFromStore,
    persistNote,
    scheduleNoteAutoSave,
    noteContentChange,
    resetNoteSession,
    repairCurrentNoteWikilinks,
  } from "$lib/stores/noteSession.svelte";
  import { repairCorruptedWikilinkMarkdown } from "$lib/markdown/bridge";
  import {
    voiceSession,
    refreshVoice,
    handleVoiceToggle as handleVoiceToggleStore,
    appendTranscript as appendTranscriptStore,
    enqueueVoiceTranscript,
    getVoiceLoadingToastId,
    setVoiceLoadingToastId,
    isVoiceBusy,
  } from "$lib/stores/voiceSession.svelte";
  import {
    aiQueue,
    silenceAiHelpers as markAiQuiet,
    isAiQuiet,
    pushSuggestion,
    dismissSuggestion,
    clearSuggestionsForNote,
    editorHighlightFromSuggestions,
    stillCurrentAiRequest,
    resetAiQueue,
  } from "$lib/stores/aiQueue.svelte";
  import {
    ollamaSession,
    ensureOllamaRunning as ensureOllamaCore,
    activeOllamaModel,
  } from "$lib/stores/ollamaSession.svelte";
  import {
    vaultStore,
    refreshVault,
    createNote as createVaultNote,
    createFolder as createVaultFolder,
    deleteVaultItem,
    renameVaultNote,
    moveVaultItem,
  } from "$lib/stores/vaultStore.svelte";
  import {
    runAiAction,
    runSkill,
    runCustomPrompt,
    aiOrchestratorDepsFromPage,
  } from "$lib/app/aiOrchestrator";
  import type {
    AiAction,
    SearchResult,
    ThemeMode,
    VoiceTranscript,
    AiSuggestion,
    ProactiveSuggestionResponse,
  } from "$lib/types";

  let theme = $state<ThemeMode>("light");
  let searchOpen = $state(false);
  let settingsOpen = $state(false);
  let splashOpen = $state(false);
  let setupOpen = $state(false);
  let historyOpen = $state(false);
  $effect(() => {
    noteSession.selectedPath;
    historyOpen = false;
  });

  let searchQuery = $state("");
  let searchResults = $state<SearchResult[]>([]);
  let searchLoading = $state(false);
  let proactiveEnabled = $state(false);
  let autoTypoFixEnabled = $state(true);
  let autoSummarizeEnabled = $state(false);
  let buddyEnabled = $state(true);
  let buddyTyping = $state(false);
  let buddyTip = $state<BuddyTip | null>(null);
  let buddyDismissedId = $state<string | null>(null);
  let buddyHasRelated = $state(false);
  let buddyTypingTimer: ReturnType<typeof setTimeout> | null = null;
  let buddyScanTimer: ReturnType<typeof setTimeout> | null = null;
  let buddyRelatedTimer: ReturnType<typeof setTimeout> | null = null;
  let customPromptFocused = $state(false);
  let editorCursor = $state<number | null>(null);
  let editorSelection = $state<TextSelection | null>(null);
  /** Dernière position curseur connue (pour insérer la dictée au bon endroit). */
  let lastCaretOffset = 0;
  let pendingImageMarkdown = $state<string | null>(null);
  let autoTypoNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  let autoTypoFixBusy = false;
  let proactiveStatus = $state("");
  let statusMessage = $state("");
  let autoSummaryTimer: ReturnType<typeof setTimeout> | null = null;
  let lastAutoSummaryKey = "";

  let unlisteners: UnlistenFn[] = [];

  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  let title = $derived.by(() => {
    if (!noteSession.selectedPath) return "Aucune note sélectionnée";
    const name = noteSession.selectedPath.split("/").pop() ?? noteSession.selectedPath;
    return name.replace(/\.md$/, "");
  });

  let activeModel = $derived(activeOllamaModel());
  let noteContext = $derived(parseNoteContext(noteSession.content));
  let customPromptTargetLabel = $derived.by(() =>
    editorSelection
      ? `sélection (${editorSelection.text.length} car.)`
      : "note entière",
  );
  let editorHighlight = $derived(editorHighlightFromSuggestions());

  let lastProactiveAt = 0;
  let lastProactiveKey = "";
  let voiceCrashRestarts = 0;
  let voiceCrashWindowStart = 0;
  let noteScanTimer: ReturnType<typeof setTimeout> | null = null;
  let fullTypoScanTimer: ReturnType<typeof setTimeout> | null = null;

  function silenceAiHelpers(ms = 90000) {
    markAiQuiet(ms);
    if (noteScanTimer) {
      clearTimeout(noteScanTimer);
      noteScanTimer = null;
    }
  }

  async function handleVoiceToggle() {
    await handleVoiceToggleStore((msg) => {
      statusMessage = msg;
    });
  }

  $effect(() => {
    if (voiceSession.status.modelLoading && !getVoiceLoadingToastId()) {
      setVoiceLoadingToastId(
        notify({
          kind: "info",
          title: "Chargement du modèle Whisper…",
          message: "La dictée sera disponible une fois le chargement terminé.",
          durationMs: 0,
          key: "voice-loading",
        }),
      );
      return;
    }
    if (!voiceSession.status.modelLoading && getVoiceLoadingToastId()) {
      dismissToast(getVoiceLoadingToastId()!);
      setVoiceLoadingToastId(null);
      if (voiceSession.status.modelLoaded && voiceSession.status.running) {
        notify({
          kind: "success",
          title: "Dictée prête",
          message: `Appuyez sur ${voiceSession.status.hotkey} pour parler, rappuyez pour transcrire.`,
          key: "voice-ready",
        });
      } else if (voiceSession.status.running && !voiceSession.status.modelLoaded) {
        notify({
          kind: "warning",
          title: "Modèle Whisper non chargé",
          message:
            voiceSession.status.error ??
            "Réglages → Voix → « Appliquer la config voix », puis réessayez.",
          key: "voice-not-loaded",
        });
      }
    }
  });

  async function tryAiAutoTypoFix(span: ParagraphSpan, baseContent?: string): Promise<boolean> {
    if (autoTypoFixBusy || !autoTypoFixEnabled) return false;

    const body = baseContent ?? noteSession.content;
    const lineText = body.slice(span.start, span.end);
    if (!lineNeedsAiTypoFix(lineText)) return false;

    autoTypoFixBusy = true;
    try {
      if (!ollamaSession.status.available) {
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
    if (!autoTypoFixEnabled || !noteSession.selectedPath) return;

    for (let attempt = 0; attempt < 5; attempt++) {
      const body = baseContent ?? noteSession.content;
      const lines = scanBodyTypoLines(body).filter((line) => {
        const text = body.slice(line.start, line.end);
        return lineNeedsAiTypoFix(text);
      });
      if (!lines.length) break;

      const line = lines[0];
      const text = body.slice(line.start, line.end);
      const applied = await tryAiAutoTypoFix({ ...line, text }, body);
      if (!applied) break;
      baseContent = noteSession.content;
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
    noteSession.content = next;
    lastCaretOffset = caret;
    editorCursor = caret;
    noteSession.dirty = next !== noteSession.savedContent;
    scheduleAutoSave();
    if (noteSession.selectedPath && noteSession.dirty) void persistNote(noteSession.selectedPath, next);
    scheduleFullTypoScan(800);
    scheduleNoteScan(8000);
    showAutoTypoNotice(message);
  }

  async function handleAutoTypoFix(_span: ParagraphSpan) {
    if (!autoTypoFixEnabled || voiceSession.status.recording || voiceSession.status.transcribing) return;
    await runBatchAutoTypoFix();
  }

  async function runBatchAutoTypoFix() {
    if (!autoTypoFixEnabled || !noteSession.selectedPath || autoTypoFixBusy) return;
    if (voiceSession.status.recording || voiceSession.status.transcribing) return;
    autoTypoFixBusy = true;

    try {
      aiQueue.aiSuggestions = aiQueue.aiSuggestions.filter(
        (s) => !(s.action === "correct" && s.source === "proactive"),
      );

      const before = noteSession.content;
      const caretBefore = lastCaretOffset;
      const { content: next, count, caret } = autoFixAllTypoLines(noteSession.content, caretBefore);
      let working = noteSession.content;
      if (count > 0 && next !== before) {
        working = next;
        noteSession.content = next;
        lastCaretOffset = caret;
        editorCursor = caret;
        noteSession.dirty = next !== noteSession.savedContent;
        scheduleAutoSave();
        if (noteSession.selectedPath) await persistNote(noteSession.selectedPath, next);
        showAutoTypoNotice(`✓ ${count} faute${count > 1 ? "s" : ""} corrigée${count > 1 ? "s" : ""} automatiquement`);
      }
      await runAiTypoFixPass(working);
      proactiveStatus = bodyHasTypoLines(noteSession.content)
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
    appendTranscriptStore(fragment, (ms) => silenceAiHelpers(ms));
    if (autoTypoFixEnabled) {
      setTimeout(() => {
        if (!isVoiceBusy()) void runBatchAutoTypoFix();
      }, 5000);
    }
  }

  async function handleVoiceTranscript(text: string) {
    const chain = enqueueVoiceTranscript(async () => {
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
        if (!noteSession.selectedPath) {
          const msg = "Ouvrez une note pour les commandes IA vocales (PTT).";
          statusMessage = msg;
          notify({ kind: "warning", title: "Scribe", message: msg, key: "voice-cmd" });
          return;
        }
        if (!noteBody(noteSession.content).trim()) {
          const msg = "La note est vide — rien à transformer. Dictez d'abord du texte.";
          statusMessage = msg;
          notify({ kind: "warning", title: "Scribe", message: msg, key: "voice-cmd" });
          return;
        }
        if (!ollamaSession.status.available && parsed.action !== "correct") {
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

      if (parsed.kind === "skill") {
        if (!noteSession.selectedPath) {
          const msg = "Ouvrez une note pour les commandes de conception (PTT).";
          statusMessage = msg;
          notify({ kind: "warning", title: "Scribe", message: msg, key: "voice-cmd" });
          return;
        }
        statusMessage = `Commande vocale : ${getSkill(parsed.skillId).label}…`;
        notify({
          kind: "info",
          title: "Scribe",
          message: `Skill « ${getSkill(parsed.skillId).label} » — traitement…`,
          key: "voice-cmd",
        });
        await handleSkill(parsed.skillId);
        return;
      }

      if (!noteSession.selectedPath) {
        const msg = "Ouvrez une note pour insérer la dictée (PTT).";
        statusMessage = msg;
        notify({ kind: "warning", title: "Note requise", message: msg });
        return;
      }

      if (customPromptFocused && aiQueue.companionOpen) {
        voiceSession.pendingPromptDictation = { text: parsed.text, id: Date.now() };
        const preview = `« ${parsed.text.slice(0, 60)}${parsed.text.length > 60 ? "…" : ""} »`;
        statusMessage = `Dictée → prompt custom : ${preview}`;
        notify({ kind: "success", title: "Dictée (prompt)", message: preview, key: "voice-prompt" });
        return;
      }

      appendTranscript(parsed.text);
      const preview = `« ${parsed.text.slice(0, 60)}${parsed.text.length > 60 ? "…" : ""} »`;
      statusMessage = `Dictée insérée : ${preview}`;
      notify({ kind: "success", title: "Dictée insérée", message: preview });
    });
    await chain;
  }

  async function openNoteByQuery(query: string) {
    const match = resolveWikilink(query, vaultStore.entries);
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

  async function ensureOllamaRunning(silent = false) {
    return ensureOllamaCore(silent, (msg) => {
      statusMessage = msg;
    });
  }

  function aiDeps() {
    return aiOrchestratorDepsFromPage({
      content: noteSession.content,
      selectedPath: noteSession.selectedPath,
      noteContext: noteContext,
      editorSelection,
      ollamaAvailable: ollamaSession.status.available,
      activeModel,
      entries: vaultStore.entries,
      ensureOllamaRunning,
      openSettings,
      setStatus: (msg) => {
        statusMessage = msg;
      },
      onContentChange: handleContentChange,
      setEditorCursor: (n) => {
        editorCursor = n;
      },
      setLastCaretOffset: (n) => {
        lastCaretOffset = n;
      },
      silenceAiHelpers,
    });
  }

  async function handleOllamaHeaderClick() {
    if (ollamaSession.status.available) {
      openSettings();
      return;
    }
    const ok = await ensureOllamaRunning();
    if (!ok) {
      openSettings();
      statusMessage = "Ollama hors ligne — lancez-le ou installez-le dans Réglages.";
    }
  }

  async function loadNote(path: string) {
    await loadNoteFromStore(path, {
      onBeforeSwitch: () => {
        if (autoSummaryTimer) clearTimeout(autoSummaryTimer);
        if (noteScanTimer) clearTimeout(noteScanTimer);
        if (fullTypoScanTimer) clearTimeout(fullTypoScanTimer);
      },
      onLoaded: () => {
        clearSuggestionsForNote(null);
        editorSelection = null;
        lastProactiveKey = "";
        lastAutoSummaryKey = "";
        proactiveStatus = "";
        aiQueue.companionOpen = true;
        scheduleNoteScan(4000);
        scheduleAutoSummary(45000);
        buddyTyping = false;
        buddyDismissedId = null;
        buddyHasRelated = false;
        refreshBuddyTip();
        scheduleRelatedCheck();
        if (autoTypoFixEnabled) queueMicrotask(() => void runBatchAutoTypoFix());
        void repairCurrentNoteWikilinks();
      },
    });
  }

  function scheduleAutoSave() {
    scheduleNoteAutoSave(() => {
      if (noteSession.selectedPath) void persistNote(noteSession.selectedPath, noteSession.content);
    });
  }

  function scheduleFullTypoScan(delayMs = 1200) {
    if (!autoTypoFixEnabled || !noteSession.selectedPath) return;
    if (fullTypoScanTimer) clearTimeout(fullTypoScanTimer);
    fullTypoScanTimer = setTimeout(() => {
      if (voiceSession.status.recording || voiceSession.status.transcribing) return;
      void runBatchAutoTypoFix();
    }, delayMs);
  }

  function handleContentChange(value: string) {
    noteContentChange(value, () => scheduleAutoSave());
    scheduleFullTypoScan(1200);
    if (!isAiQuiet()) {
      scheduleNoteScan(8000);
    }
    scheduleAutoSummary(40000);
    bumpBuddyTyping();
  }

  function bumpBuddyTyping() {
    if (!buddyEnabled) return;
    buddyTyping = true;
    if (buddyTypingTimer) clearTimeout(buddyTypingTimer);
    buddyTypingTimer = setTimeout(() => {
      buddyTyping = false;
      refreshBuddyTip();
    }, 1100);
    // Pendant la frappe : mood listen immédiat, tip allégée
    refreshBuddyTip();
  }

  function refreshBuddyTip() {
    if (!buddyEnabled || !noteSession.selectedPath) {
      buddyTip = null;
      return;
    }
    if (buddyScanTimer) clearTimeout(buddyScanTimer);
    const run = () => {
      const tip = scanBuddyTip({
        markdown: noteBody(noteSession.content),
        typing: buddyTyping,
        busy: aiQueue.aiLoading || aiQueue.proactiveLoading,
        hasSuggestions: aiQueue.aiSuggestions.some((s) => !s.notePath || s.notePath === noteSession.selectedPath),
        noteOpen: !!noteSession.selectedPath,
        hasRelated: buddyHasRelated,
        selectionText: editorSelection?.text,
      });
      if (tip && tip.id === buddyDismissedId && tip.id !== "typing" && tip.id !== "busy") {
        buddyTip = { ...tip, message: tip.mood === "listen" ? tip.message : "" };
        return;
      }
      if (tip && tip.id !== buddyDismissedId) {
        buddyDismissedId = null;
      }
      buddyTip = tip;
    };
    // Tips structure après une courte pause ; listen/busy immédiats
    if (buddyTyping || aiQueue.aiLoading || aiQueue.proactiveLoading) run();
    else {
      buddyScanTimer = setTimeout(run, 450);
      scheduleRelatedCheck();
    }
  }

  function scheduleRelatedCheck() {
    if (!buddyEnabled || !noteSession.selectedPath) return;
    const body = noteBody(noteSession.content).trim();
    if (body.length < 120) {
      buddyHasRelated = false;
      return;
    }
    if (buddyRelatedTimer) clearTimeout(buddyRelatedTimer);
    const path = noteSession.selectedPath;
    buddyRelatedTimer = setTimeout(async () => {
      try {
        const rag = await fetchRagContext(body.slice(0, 800), path);
        if (noteSession.selectedPath !== path) return;
        const next = rag.length > 80;
        if (next !== buddyHasRelated) {
          buddyHasRelated = next;
          refreshBuddyTip();
        }
      } catch {
        buddyHasRelated = false;
      }
    }, 2800);
  }

  let buddyMood = $derived.by((): BuddyMood => {
    if (!buddyEnabled) return "idle";
    if (buddyTip && !buddyTyping && !(aiQueue.aiLoading || aiQueue.proactiveLoading)) return buddyTip.mood;
    return moodFromActivity(buddyTyping, aiQueue.aiLoading || aiQueue.proactiveLoading);
  });

  function handleBuddyToggle(enabled: boolean) {
    buddyEnabled = enabled;
    saveBuddyEnabled(enabled);
    if (!enabled) {
      buddyTip = null;
      buddyTyping = false;
    } else {
      refreshBuddyTip();
    }
  }

  function handleBuddyAction(action: BuddyAction) {
    if (action.kind === "dismiss") {
      if (buddyTip) buddyDismissedId = buddyTip.id;
      buddyTip = null;
      return;
    }
    if (action.kind === "open_companion") {
      aiQueue.companionOpen = true;
      return;
    }
    if (action.kind === "skill") {
      aiQueue.companionOpen = true;
      void handleSkill(action.skillId);
    }
  }

  function scheduleAutoSummary(delayMs = 40000) {
    if (!autoSummarizeEnabled || !noteSession.selectedPath) return;
    // Après ouverture, attendre au moins 45 s avant le premier résumé auto
    const sinceOpen = Date.now() - noteSession.noteOpenedAt;
    const wait = Math.max(delayMs, 45000 - sinceOpen);
    if (autoSummaryTimer) clearTimeout(autoSummaryTimer);
    autoSummaryTimer = setTimeout(() => {
      void maybeAutoSummarize(noteSession.selectedPath!, noteSession.content);
    }, wait);
  }

  async function maybeAutoSummarize(path: string, body: string) {
    if (!autoSummarizeEnabled) return;
    // Pas de résumé auto juste après ouverture (évite le spam à chaud)
    if (Date.now() - noteSession.noteOpenedAt < 20000) return;

    const epoch = noteSession.aiEpoch;
    const text = noteBody(body).trim();
    if (text.length < 280) return;
    if (text.split(/\s+/).length < 40) return;

    const existing = extractExistingSummary(body);
    const key = `${path}:${text.length}:${text.slice(0, 80)}`;
    if (key === lastAutoSummaryKey) return;
    if (aiQueue.aiLoading || aiQueue.proactiveLoading) return;

    if (!ollamaSession.status.available) {
      const ok = await ensureOllamaRunning(true);
      if (!ok) return;
    }

    const already = aiQueue.aiSuggestions.some(
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
      if (!stillCurrentAiRequest(epoch, path)) return;

      const result = await invoke<string>("ollama_summarize_note", {
        content: text,
        model: activeModel,
        noteContext: parseNoteContext(body).trim() || null,
        ragContext: ragContext || null,
      });
      if (!stillCurrentAiRequest(epoch, path)) return;

      const proposal = buildAiProposal("summarize", text, result);
      if (!proposal) return;
      if (isDuplicateSummary(existing, proposal)) {
        lastAutoSummaryKey = key;
        statusMessage = "Résumé déjà à jour — aucune proposition.";
        return;
      }

      lastAutoSummaryKey = key;
      aiQueue.companionOpen = true;
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
      aiQueue.aiSuggestions = [suggestion, ...aiQueue.aiSuggestions.filter((s) => s.notePath === path)].slice(0, 12);
      statusMessage = "Résumé prêt (ajout en fin de note) — appliquez ou ignorez.";
    } catch (e) {
      if (stillCurrentAiRequest(epoch, path)) {
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
    const path = await createVaultNote(parentPath, name.trim());
    await loadNote(path);
  }

  async function handleCreateFolder(parentPath: string) {
    const name = prompt("Nom du dossier :");
    if (!name?.trim()) return;
    await createVaultFolder(parentPath, name.trim());
  }

  async function handleDelete(path: string) {
    const isNote = path.toLowerCase().endsWith(".md");
    const label = path.split("/").pop() ?? path;
    if (isNote) {
      if (
        !confirm(
          `Supprimer « ${label} » ?\n\nSi un fichier .txt / .text jumeau existe encore, il sera aussi supprimé.`,
        )
      ) {
        return;
      }
    } else if (!confirm(`Supprimer le dossier vide « ${label} » ?`)) {
      return;
    }
    try {
      const result = await deleteVaultItem(path);
      statusMessage = result.isNote ? `Note « ${result.label} » supprimée` : `Dossier « ${result.label} » supprimé`;
    } catch (e) {
      statusMessage = String(e);
      notify({ kind: "error", title: "Suppression impossible", message: String(e), key: "vault-delete" });
    }
  }

  async function handleRename(path: string) {
    const current = path.split("/").pop()?.replace(/\.md$/, "") ?? "";
    const name = prompt("Nouveau nom de la note :", current);
    if (!name?.trim() || name.trim() === current) return;
    try {
      await renameVaultNote(path, name.trim());
      statusMessage = `Note renommée : ${name.trim()}`;
      notify({ kind: "success", title: "Renommage", message: statusMessage, key: "vault-rename" });
    } catch (e) {
      statusMessage = String(e);
      notify({ kind: "error", title: "Renommage impossible", message: String(e), key: "vault-rename" });
    }
  }

  async function handleMove(sourcePath: string, destinationParent: string) {
    try {
      await moveVaultItem(sourcePath, destinationParent);
      const msg = destinationParent
        ? `Déplacé dans « ${destinationParent} »`
        : "Déplacé à la racine du vault";
      statusMessage = msg;
      notify({ kind: "success", title: "Déplacement", message: msg, key: "vault-move" });
    } catch (e) {
      statusMessage = String(e);
      notify({ kind: "error", title: "Déplacement impossible", message: String(e), key: "vault-move" });
    }
  }

  async function handleAiAction(request: AiActionRequest) {
    await runAiAction(aiDeps(), request);
  }

  async function handleSkill(id: SkillId) {
    await runSkill(aiDeps(), id);
  }

  async function handleCustomPrompt(instruction: string) {
    await runCustomPrompt(aiDeps(), instruction);
  }


  function applySuggestion(id: string) {
    const suggestion = aiQueue.aiSuggestions.find((s) => s.id === id);
    if (!suggestion) return;
    if (suggestion.notePath && noteSession.selectedPath && suggestion.notePath !== noteSession.selectedPath) {
      aiQueue.aiSuggestions = aiQueue.aiSuggestions.filter((s) => s.id !== id);
      statusMessage = "Suggestion d'une autre note — ignorée.";
      return;
    }

    // Ne jamais laisser le proactif / typo-IA / résumé auto réécrire juste après une applique
    silenceAiHelpers(
      suggestion.action === "translate" ||
        suggestion.action === "reformulate" ||
        suggestion.action === "custom"
        ? 120000
        : 60000,
    );

    if (suggestion.applyMode === "tags" || suggestion.skillId === "tags") {
      const tags = parseTagsProposal(suggestion.proposedText);
      if (!tags.length) {
        statusMessage = "Aucun tag valide à appliquer.";
        return;
      }
      handleContentChange(setFrontmatterTags(noteSession.content, tags));
      aiQueue.aiSuggestions = aiQueue.aiSuggestions.filter((s) => s.id !== id);
      if (buddyEnabled) {
        buddyTip = {
          id: "applied",
          mood: "ok",
          message: `Tags : ${tags.join(", ")}`,
          priority: 95,
        };
        setTimeout(() => refreshBuddyTip(), 1800);
      }
      statusMessage = "Tags appliqués au frontmatter.";
      return;
    }

    if (suggestion.applyMode === "append" || suggestion.action === "summarize") {
      const raw = repairCorruptedWikilinkMarkdown(suggestion.proposedText.trim());
      const block = /^##\s+/.test(raw)
        ? `\n\n---\n\n${raw}\n`
        : formatSummaryAppendix(raw, suggestion.label || "Résumé");
      editorCursor = noteSession.content.length + block.length;
      handleContentChange(noteSession.content + block);
    } else if (suggestion.selection) {
      const start = suggestion.selection.start;
      const proposed = suggestion.proposedText;
      handleContentChange(
        replaceTextRange(noteSession.content, start, suggestion.selection.end, proposed),
      );
      editorCursor = start + proposed.length;
    } else if (
      suggestion.action === "translate" ||
      suggestion.action === "reformulate" ||
      suggestion.action === "correct" ||
      suggestion.action === "custom"
    ) {
      const next = mergeBodyMarkdown(noteSession.content, suggestion.proposedText.trim() + "\n");
      editorCursor = Math.min(next.length, Math.max(1, suggestion.proposedText.length));
      handleContentChange(next);
    } else {
      handleContentChange(suggestion.proposedText);
      editorCursor = Math.min(suggestion.proposedText.length, noteSession.content.length);
    }

    aiQueue.aiSuggestions = aiQueue.aiSuggestions.filter((s) => s.id !== id);
    if (buddyEnabled) {
      buddyTip = {
        id: "applied",
        mood: "ok",
        message: "C'est noté.",
        priority: 95,
      };
      setTimeout(() => refreshBuddyTip(), 1800);
    }
    statusMessage =
      suggestion.action === "summarize"
        ? "Résumé ajouté en fin de note."
        : "Suggestion appliquée.";
  }

  function toggleCompanion() {
    aiQueue.companionOpen = !aiQueue.companionOpen;
    if (aiQueue.companionOpen) {
      if (autoTypoFixEnabled) void runBatchAutoTypoFix();
      scheduleNoteScan(5000);
    }
  }

  function scheduleNoteScan(delayMs = 5000) {
    if (!noteSession.selectedPath) return;
    if (isAiQuiet()) return;
    if (!proactiveEnabled && !autoTypoFixEnabled) return;
    if (noteScanTimer) clearTimeout(noteScanTimer);
    noteScanTimer = setTimeout(() => {
      void scanNoteForSuggestions();
    }, delayMs);
  }

  function hasSuggestionForSpan(span: { start: number; end: number }) {
    return aiQueue.aiSuggestions.some((s) => s.selection?.start === span.start && s.selection?.end === span.end);
  }

  async function scanNoteForSuggestions() {
    if (!noteSession.selectedPath) return;

    if (autoTypoFixEnabled && !aiQueue.aiLoading) {
      await runBatchAutoTypoFix();
    }

    if (aiQueue.proactiveLoading || aiQueue.aiLoading || !proactiveEnabled || isAiQuiet()) return;

    const typoLines = scanBodyTypoLines(noteSession.content);
    if (typoLines.length) {
      const target = typoLines.find((line) => !hasSuggestionForSpan(line));
      if (target) {
        await processProactiveSpan(
          { ...target, text: noteSession.content.slice(target.start, target.end) },
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
    if (!proactiveEnabled || !noteSession.selectedPath || isAiQuiet()) return;
    if (bodyHasTypoLines(noteSession.content) && !likelyNeedsCorrection(span.text)) return;

    const minLen = 12;
    if (span.text.trim().length < minLen) return;
    if (!likelyNeedsCorrection(span.text)) return;
    if (aiQueue.aiLoading || aiQueue.proactiveLoading) return;

    const now = Date.now();
    const cooldown = 30000;
    const key = `${noteSession.selectedPath}:${span.start}:${span.end}:${span.text.trim()}`;
    if (now - lastProactiveAt < cooldown && key === lastProactiveKey) return;
    if (key === lastProactiveKey && hasSuggestionForSpan(span)) return;

    if (hasSuggestionForSpan(span)) return;

    aiQueue.proactiveLoading = true;
    aiQueue.companionOpen = true;
    proactiveStatus = "Vérification orthographique…";
    statusMessage = proactiveStatus;
    const epoch = noteSession.aiEpoch;
    const pathAtStart = noteSession.selectedPath;

    const addSuggestion = (
      action: AiAction,
      label: string,
      proposed: string,
      reason?: string,
      scopeLabel = "passage en cours",
    ) => {
      if (!stillCurrentAiRequest(epoch, pathAtStart)) return;
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
      if (ollamaSession.status.available) {
        const result = await invoke<ProactiveSuggestionResponse>("ollama_proactive_suggest", {
          paragraph: span.text,
          noteExcerpt: noteSession.content.slice(0, 1500),
          noteContext: noteContext.trim() || null,
          model: activeModel,
        });

        if (!stillCurrentAiRequest(epoch, pathAtStart) || isAiQuiet()) return;

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

      if (!stillCurrentAiRequest(epoch, pathAtStart)) return;

      proactiveStatus = bodyHasTypoLines(noteSession.content)
        ? "Certaines fautes nécessitent une correction manuelle."
        : "";
      statusMessage = proactiveStatus;
      lastProactiveAt = now;
    } catch (e) {
      proactiveStatus = `Analyse indisponible : ${e}`;
      statusMessage = proactiveStatus;
    } finally {
      aiQueue.proactiveLoading = false;
      if (!isAiQuiet()) scheduleNoteScan(20000);
    }
  }

  async function handleEditingIdle(span: ParagraphSpan) {
    if (!noteSession.selectedPath) return;

    if (autoTypoFixEnabled && bodyHasTypoLines(noteSession.content)) {
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
    const next = setNoteContext(noteSession.content, value);
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
      notePath: noteSession.selectedPath,
      useGlobalMedia,
    });
    await queueImageMarkdown(relative);
  }

  async function importImagesFromPaths(paths: string[]) {
    if (!noteSession.selectedPath) {
      statusMessage = "Ouvrez une note pour y insérer une image.";
      return;
    }
    for (const sourcePath of paths) {
      await importImageFromPath(sourcePath, false);
    }
  }

  async function importPastedImage(base64: string, extension: string) {
    if (!noteSession.selectedPath) {
      statusMessage = "Ouvrez une note pour y coller une image.";
      return;
    }
    const relative = await invoke<string>("import_image_bytes", {
      dataBase64: base64,
      extension,
      notePath: noteSession.selectedPath,
      useGlobalMedia: false,
    });
    await queueImageMarkdown(relative);
  }

  async function handleInsertImage() {
    if (!noteSession.selectedPath) {
      statusMessage = "Ouvrez une note pour y insérer une image.";
      return;
    }

    const picked = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }],
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
    if (!noteSession.selectedPath) return;
    const dest = await save({
      defaultPath: noteSession.selectedPath.split("/").pop() ?? "note.md",
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!dest) return;
    await invoke("export_note", { relativePath: noteSession.selectedPath, destination: dest });
    statusMessage = "Note exportée.";
  }

  async function handleImportText() {
    const picked = await open({
      multiple: true,
      filters: [{ name: "Texte / Markdown", extensions: ["txt", "text", "md"] }],
      title: "Importer des notes (.txt → .md)",
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    const ok = confirm(
      "Les fichiers sélectionnés seront importés comme notes Markdown (.md) dans le vault.\n\n" +
        "Les fichiers .txt déjà présents dans le vault sont convertis en .md puis le .txt source est supprimé automatiquement (Sync TXT).\n\n" +
        "Les fichiers externes choisis ici restent intacts hors du vault — seule une copie .md est créée.\n\nContinuer ?",
    );
    if (!ok) return;
    try {
      const created = await invoke<string[]>("import_text_files", {
        paths,
        parentPath: "",
      });
      await refreshVault();
      const msg =
        created.length === 1
          ? `Importé en Markdown : ${created[0]}`
          : `${created.length} notes importées en .md`;
      statusMessage = msg;
      notify({ kind: "success", title: "Import TXT → MD", message: msg, key: "import-txt" });
      if (created[0]) await loadNote(created[0]);
    } catch (e) {
      statusMessage = String(e);
      notify({ kind: "error", title: "Import", message: String(e), key: "import-txt" });
    }
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
    buddyEnabled = loadBuddyEnabled();
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

    // Premier lancement : check-up Ollama. Les utilisateurs existants (splash déjà
    // dismissé) ne sont pas ré-interrogés.
    try {
      const setupDone = localStorage.getItem("csn-setup-done") === "1";
      const splashDismissed = localStorage.getItem("csn-splash-dismissed") === "1";
      if (!setupDone && !splashDismissed) {
        setupOpen = true;
        splashOpen = false;
      } else {
        if (!setupDone) localStorage.setItem("csn-setup-done", "1");
        splashOpen = !splashDismissed;
      }
    } catch {
      setupOpen = true;
    }
  });

  onDestroy(() => {
    for (const u of unlisteners) u();
    if (buddyTypingTimer) clearTimeout(buddyTypingTimer);
    if (buddyScanTimer) clearTimeout(buddyScanTimer);
    if (buddyRelatedTimer) clearTimeout(buddyRelatedTimer);
  });

  $effect(() => {
    // Recalcule le mood quand charge / suggestions changent
    void aiQueue.aiLoading;
    void aiQueue.proactiveLoading;
    void aiQueue.aiSuggestions.length;
    void noteSession.selectedPath;
    if (buddyEnabled) refreshBuddyTip();
  });
</script>

<svelte:window onkeydown={onGlobalKeydown} />

<div class="flex h-screen flex-col overflow-hidden bg-bg">
  <header class="flex shrink-0 items-center justify-between px-4 py-2">
    <div class="flex items-center gap-3 text-xs text-text-muted">
      <button
        type="button"
        class="rounded-lg px-2 py-0.5 transition hover:bg-surface-muted {voiceSession.status.recording ? 'bg-danger/20' : ''}"
        onclick={handleVoiceToggle}
        title="Push-to-talk ({voiceSession.status.hotkey}) — appuyez pour parler, rappuyez pour arrêter"
      >
        <span class="inline-flex items-center gap-1">
          <PixelIcon name="mic" size={16} class={voiceSession.status.recording ? "text-danger" : ""} />
          {voiceSession.status.recording ? "REC…" : voiceSession.status.hotkey}
        </span>
      </button>
      <button
        type="button"
        class="rounded-lg px-1 transition hover:bg-surface-muted {ollamaSession.status.available ? '' : 'text-accent-blue'}"
        onclick={handleOllamaHeaderClick}
        title={ollamaSession.status.available ? "Ollama connecté — réglages" : "Cliquer pour démarrer Ollama"}
      >
        Ollama : {ollamaSession.status.available ? "connecté" : "hors ligne"}
        {#if ollamaSession.status.available}
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

  <!-- Léger inset : les arrondis ne collent plus aux bords de la fenêtre -->
  <div class="flex min-h-0 flex-1 gap-2.5 px-2.5 pb-2.5">
    <Sidebar
      entries={vaultStore.entries}
      vaultPath={vaultStore.vaultPath}
      selectedPath={noteSession.selectedPath}
      onSelect={loadNote}
      onRefresh={refreshVault}
      onCreateNote={handleCreateNote}
      onCreateFolder={handleCreateFolder}
      onDelete={handleDelete}
      onMove={handleMove}
      onRename={handleRename}
      onImportText={handleImportText}
    />

    {#if noteSession.selectedPath}
      <MarkdownEditor
        content={noteSession.content}
        {title}
        notePath={noteSession.selectedPath}
        vaultPath={vaultStore.vaultPath}
        dirty={noteSession.dirty}
        saving={noteSession.saving}
        ollamaAvailable={ollamaSession.status.available}
        aiLoading={aiQueue.aiLoading}
        companionOpen={aiQueue.companionOpen}
        companionBusy={aiQueue.aiLoading || aiQueue.proactiveLoading}
        companionBusyLabel={aiQueue.aiLoading ? "Scribe travaille…" : aiQueue.proactiveLoading ? "Analyse…" : ""}
        onChange={handleContentChange}
        onSave={() => noteSession.selectedPath && persistNote(noteSession.selectedPath, noteSession.content)}
        onAiAction={handleAiAction}
        onInsertImage={handleInsertImage}
        onImportImages={importImagesFromPaths}
        onPasteImageBytes={importPastedImage}
        onExport={handleExport}
        onOpenHistory={() => (historyOpen = true)}
        onToggleCompanion={toggleCompanion}
        onSelectionChange={(sel) => {
          editorSelection = sel;
          if (sel) lastCaretOffset = sel.end;
          if (buddyEnabled) {
            if (buddyScanTimer) clearTimeout(buddyScanTimer);
            buddyScanTimer = setTimeout(() => refreshBuddyTip(), sel?.text.trim() ? 350 : 200);
          }
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
        dictationInsert={voiceSession.pendingDictation}
        onDictationConsumed={() => (voiceSession.pendingDictation = null)}
      />
    {:else}
      <section
        class="flex flex-1 flex-col items-center justify-center gap-4 rounded-3xl border border-border bg-surface text-center shadow-sm"
      >
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
            class="btn-accent px-4 py-2 text-sm"
            onclick={() => handleCreateNote("")}
          >
            + Nouvelle note
          </button>
          {#if !ollamaSession.status.available}
            <button
              type="button"
              class="btn-ghost border border-border px-4 py-2 text-sm"
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
  vaultPath={vaultStore.vaultPath}
  onClose={closeSettings}
  onOllamaUpdated={(s) => (ollamaSession.status = s)}
  onVaultChanged={async (path) => {
    vaultStore.vaultPath = path;
    resetNoteSession();
    resetAiQueue();
    historyOpen = false;
    await refreshVault();
    statusMessage = `Vault : ${path}`;
  }}
/>

<VoiceOverlay
  recording={voiceSession.status.recording}
  transcribing={voiceSession.status.transcribing}
  modelLoading={voiceSession.status.modelLoading}
  hotkey={voiceSession.status.hotkey}
/>

<AiCompanionPanel
  open={aiQueue.companionOpen && !!noteSession.selectedPath}
  voiceStatus={voiceSession.status}
  onToggleRecord={handleVoiceToggle}
  {noteContext}
  notePath={noteSession.selectedPath}
  suggestions={aiQueue.aiSuggestions.filter((s) => !s.notePath || s.notePath === noteSession.selectedPath)}
  aiLoading={aiQueue.aiLoading}
  proactiveLoading={aiQueue.proactiveLoading}
  {proactiveEnabled}
  {autoTypoFixEnabled}
  {autoSummarizeEnabled}
  buddyEnabled={buddyEnabled}
  {proactiveStatus}
  customTargetLabel={customPromptTargetLabel}
  onContextChange={handleNoteContextChange}
  onProactiveToggle={handleProactiveToggle}
  onAutoTypoToggle={handleAutoTypoToggle}
  onAutoSummarizeToggle={handleAutoSummarizeToggle}
  onBuddyToggle={handleBuddyToggle}
  onCustomPrompt={handleCustomPrompt}
  onSkill={handleSkill}
  ollamaAvailable={ollamaSession.status.available}
  onApply={applySuggestion}
  onDismiss={dismissSuggestion}
  onDismissAll={() => (aiQueue.aiSuggestions = [])}
  onClose={() => (aiQueue.companionOpen = false)}
  onCustomPromptFocusChange={(focused) => (customPromptFocused = focused)}
  dictationToPrompt={voiceSession.pendingPromptDictation}
  onDictationToPromptConsumed={() => (voiceSession.pendingPromptDictation = null)}
/>

{#if noteSession.selectedPath}
  <ScribeBuddy
    visible={buddyEnabled}
    mood={buddyMood}
    tip={buddyTip}
    panelOpen={aiQueue.companionOpen}
    onAction={handleBuddyAction}
    onOpenCompanion={() => (aiQueue.companionOpen = true)}
    onDismissTip={() => {
      if (buddyTip) buddyDismissedId = buddyTip.id;
      buddyTip = null;
    }}
  />
{/if}

<SetupWizard
  open={setupOpen}
  onOllamaUpdated={(s) => (ollamaSession.status = s)}
  onComplete={() => {
    setupOpen = false;
    try {
      localStorage.setItem("csn-setup-done", "1");
      localStorage.setItem("csn-splash-dismissed", "1");
    } catch {
      /* ignore */
    }
  }}
/>

<WelcomeSplash
  open={splashOpen && !setupOpen}
  onDismiss={(dontShowAgain) => {
    splashOpen = false;
    if (dontShowAgain) {
      try {
        localStorage.setItem("csn-splash-dismissed", "1");
      } catch {
        /* ignore */
      }
    }
  }}
/>

{#if noteSession.selectedPath}
  <NoteHistoryPanel
    open={historyOpen}
    notePath={noteSession.selectedPath}
    currentContent={noteSession.content}
    onClose={() => (historyOpen = false)}
    onRestored={(next) => {
      noteSession.content = next;
      noteSession.savedContent = next;
      noteSession.dirty = false;
      statusMessage = "Version restaurée.";
      notify({
        kind: "success",
        title: "Historique",
        message: "Ancienne version restaurée.",
        key: "history-restore",
      });
    }}
  />
{/if}
