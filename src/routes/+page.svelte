<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { UnlistenFn } from "@tauri-apps/api/event";
  import { registerVoiceListeners, type VoiceCrashState } from "$lib/app/voiceListeners";
  import { resolveFirstRunUi } from "$lib/app/appBootstrap";
  import { runAppStartup } from "$lib/app/appStartup";
  import { runStartupUpdateCheck } from "$lib/app/updateCheck";
  import {
    createNoteWithPrompt,
    createFolderWithPrompt,
    deleteVaultPath,
    renameVaultPath,
    moveVaultPath,
  } from "$lib/app/vaultUiActions";
  import { exportCurrentNote, importDocumentsAsNotes, importTextFilesAsNotes } from "$lib/app/noteImportExport";
  import { openNoteByWikilinkQuery } from "$lib/app/openWikilinkNote";
  import {
    importImagesFromPaths,
    importPastedImageForNote,
    insertImageFromPicker,
  } from "$lib/app/noteImageActions";
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
  import { saveTheme, toggleTheme } from "$lib/stores/theme";
  import type { ParagraphSpan } from "$lib/note/paragraph";
  import {
    loadProactiveEnabled,
    saveProactiveEnabled,
    loadAutoTypoFixEnabled,
    saveAutoTypoFixEnabled,
    loadAutoSummarizeEnabled,
    saveAutoSummarizeEnabled,
  } from "$lib/stores/companion";
  import { type AiActionRequest, type TextSelection } from "$lib/voice/commands";
  import { type SkillId } from "$lib/ai/skills";
  import type { SkillRouteInput } from "$lib/ai/skillRouter";
  import { runSkillSequence } from "$lib/app/skillPlan";
  import type { BuddyAction } from "$lib/ai/scribeBuddy";
  import {
    buddySession,
    resolveBuddyMood,
    refreshBuddyTip,
    bumpBuddyTyping,
    setBuddyEnabled,
    dismissBuddyTip,
    handleBuddyAction as handleBuddyActionCore,
    clearBuddyTimers,
  } from "$lib/stores/buddySession.svelte";
  import {
    searchSession,
    openSearchPanel,
    closeSearchPanel,
    runVaultSearch,
  } from "$lib/stores/searchSession.svelte";
  import { applySuggestion as applyAiSuggestion } from "$lib/app/applySuggestion";
  import { processVoiceTranscript } from "$lib/app/voiceTranscriptHandler";
  import {
    scanNoteForSuggestions,
    handleEditingIdle as handleEditingIdleProactive,
    type ProactiveScanDeps,
  } from "$lib/app/proactiveScan";
  import { maybeAutoSummarize } from "$lib/app/autoSummarize";
  import { createAutoTypoNotice, runBatchAutoTypoFix } from "$lib/app/autoTypoFlow";
  import { parseNoteContext, setNoteContext } from "$lib/note/frontmatter";
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
    dismissSuggestion,
    clearSuggestionsForNote,
    editorHighlightFromSuggestions,
    resetAiQueue,
  } from "$lib/stores/aiQueue.svelte";
  import {
    ollamaSession,
    ensureOllamaRunning as ensureOllamaCore,
    activeOllamaModel,
  } from "$lib/stores/ollamaSession.svelte";
  import { vaultStore, refreshVault } from "$lib/stores/vaultStore.svelte";
  import {
    runAiAction,
    runSkill,
    runCustomPrompt,
    aiOrchestratorDepsFromPage,
  } from "$lib/app/aiOrchestrator";
  import type { ThemeMode } from "$lib/types";

  let theme = $state<ThemeMode>("light");
  let settingsOpen = $state(false);
  let splashOpen = $state(false);
  let setupOpen = $state(false);
  let startupReady = $state(false);
  let historyOpen = $state(false);
  $effect(() => {
    noteSession.selectedPath;
    historyOpen = false;
  });

  let proactiveEnabled = $state(false);
  let autoTypoFixEnabled = $state(true);
  let autoSummarizeEnabled = $state(false);
  let customPromptFocused = $state(false);
  let editorCursor = $state<number | null>(null);
  let editorSelection = $state<TextSelection | null>(null);
  /** Dernière position curseur connue (pour insérer la dictée au bon endroit). */
  let lastCaretOffset = 0;
  let pendingImageMarkdown = $state<string | null>(null);
  let proactiveStatus = $state("");
  let statusMessage = $state("");
  let autoSummaryTimer: ReturnType<typeof setTimeout> | null = null;
  let unlisteners: UnlistenFn[] = [];

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

  const voiceCrash: VoiceCrashState = { restarts: 0, windowStart: 0 };
  let noteScanTimer: ReturnType<typeof setTimeout> | null = null;
  let fullTypoScanTimer: ReturnType<typeof setTimeout> | null = null;

  const proactiveStatusRef = { value: "" };
  $effect(() => {
    proactiveStatusRef.value = proactiveStatus;
  });

  const showAutoTypoNotice = createAutoTypoNotice(
    (msg) => {
      statusMessage = msg;
    },
    () => statusMessage,
  );

  function autoTypoDeps() {
    return {
      enabled: autoTypoFixEnabled,
      activeModel,
      ollamaAvailable: ollamaSession.status.available,
      ensureOllamaRunning,
      getLastCaret: () => lastCaretOffset,
      setLastCaret: (n: number) => {
        lastCaretOffset = n;
      },
      setEditorCursor: (n: number | null) => {
        editorCursor = n;
      },
      scheduleAutoSave,
      scheduleFullTypoScan,
      scheduleNoteScan,
      showNotice: showAutoTypoNotice,
      proactiveStatus: proactiveStatusRef,
    };
  }

  function proactiveDeps(): ProactiveScanDeps {
    return {
      proactiveEnabled,
      autoTypoFixEnabled,
      noteContext,
      activeModel,
      ollamaAvailable: ollamaSession.status.available,
      proactiveStatus: proactiveStatusRef,
      setStatus: (msg) => {
        statusMessage = msg;
        proactiveStatus = proactiveStatusRef.value;
      },
      runBatchAutoTypoFix: () => runBatchAutoTypoFix(autoTypoDeps()),
      scheduleNoteScan,
    };
  }

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

  async function handleAutoTypoFix(_span: ParagraphSpan) {
    if (!autoTypoFixEnabled || isVoiceBusy()) return;
    await runBatchAutoTypoFix(autoTypoDeps());
  }

  function handleAutoTypoToggle(enabled: boolean) {
    autoTypoFixEnabled = enabled;
    saveAutoTypoFixEnabled(enabled);
    if (enabled) void runBatchAutoTypoFix(autoTypoDeps());
  }

  function appendTranscript(fragment: string) {
    appendTranscriptStore(fragment, (ms) => silenceAiHelpers(ms));
    if (autoTypoFixEnabled) {
      setTimeout(() => {
        if (!isVoiceBusy()) void runBatchAutoTypoFix(autoTypoDeps());
      }, 5000);
    }
  }

  function voiceDeps() {
    return {
      setStatus: (msg: string) => {
        statusMessage = msg;
      },
      silenceAiHelpers,
      openSearch: () => openSearchPanel(),
      runSearch: runVaultSearch,
      openNoteByQuery,
      ensureOllamaRunning,
      openSettings,
      ollamaAvailable: ollamaSession.status.available,
      customPromptFocused,
      companionOpen: aiQueue.companionOpen,
      appendTranscript,
      handleAiAction,
      handleSkill,
      handleSkillPlan,
    };
  }

  async function handleVoiceTranscript(text: string) {
    const chain = enqueueVoiceTranscript(() => processVoiceTranscript(voiceDeps(), text));
    await chain;
  }

  function vaultUiDeps() {
    return {
      setStatus: (msg: string) => {
        statusMessage = msg;
      },
      openNote: loadNote,
      openSettings,
    };
  }

  function noteImageDeps() {
    return {
      setStatus: (msg: string) => {
        statusMessage = msg;
      },
      queueMarkdown: (markdown: string, statusMsg: string) => {
        pendingImageMarkdown = markdown;
        statusMessage = statusMsg;
      },
    };
  }

  async function openNoteByQuery(query: string) {
    await openNoteByWikilinkQuery(query, {
      entries: vaultStore.entries,
      setStatus: (msg) => {
        statusMessage = msg;
      },
      openNote: loadNote,
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
        proactiveStatus = "";
        proactiveStatusRef.value = "";
        aiQueue.companionOpen = true;
        scheduleNoteScan(4000);
        scheduleAutoSummary(45000);
        buddySession.typing = false;
        buddySession.dismissedId = null;
        buddySession.hasRelated = false;
        refreshBuddyTip();
        if (autoTypoFixEnabled) queueMicrotask(() => void runBatchAutoTypoFix(autoTypoDeps()));
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
      void runBatchAutoTypoFix(autoTypoDeps());
    }, delayMs);
  }

  function handleContentChange(value: string) {
    noteContentChange(value, () => scheduleAutoSave());
    scheduleFullTypoScan(1200);
    if (!isAiQuiet()) {
      scheduleNoteScan(8000);
    }
    scheduleAutoSummary(40000);
    bumpBuddyTyping(() => refreshBuddyTip(editorSelection?.text));
  }

  function summarizeDeps() {
    return {
      enabled: autoSummarizeEnabled,
      activeModel,
      setStatus: (msg: string) => {
        statusMessage = msg;
      },
      ensureOllamaRunning,
      ollamaAvailable: ollamaSession.status.available,
    };
  }

  function scheduleAutoSummary(delayMs = 40000) {
    if (!autoSummarizeEnabled || !noteSession.selectedPath) return;
    const sinceOpen = Date.now() - noteSession.noteOpenedAt;
    const wait = Math.max(delayMs, 45000 - sinceOpen);
    if (autoSummaryTimer) clearTimeout(autoSummaryTimer);
    autoSummaryTimer = setTimeout(() => {
      void maybeAutoSummarize(
        summarizeDeps(),
        noteSession.selectedPath!,
        noteSession.content,
      );
    }, wait);
  }

  function handleAutoSummarizeToggle(enabled: boolean) {
    autoSummarizeEnabled = enabled;
    saveAutoSummarizeEnabled(enabled);
    if (enabled) scheduleAutoSummary(5000);
  }

  async function handleCreateNote(parentPath: string) {
    await createNoteWithPrompt(parentPath, vaultUiDeps());
  }

  async function handleCreateFolder(parentPath: string) {
    await createFolderWithPrompt(parentPath);
  }

  async function handleDelete(path: string) {
    await deleteVaultPath(path, vaultUiDeps());
  }

  async function handleRename(path: string) {
    await renameVaultPath(path, vaultUiDeps());
  }

  async function handleMove(sourcePath: string, destinationParent: string) {
    await moveVaultPath(sourcePath, destinationParent, vaultUiDeps());
  }

  async function handleAiAction(request: AiActionRequest) {
    await runAiAction(aiDeps(), request);
  }

  async function handleSkill(id: SkillId) {
    await runSkill(aiDeps(), id);
  }

  async function handleSkillPlan(ids: SkillId[]) {
    aiQueue.companionOpen = true;
    await runSkillSequence(ids, handleSkill, (msg) => {
      statusMessage = msg;
    });
  }

  let skillRouteContext = $derived<Omit<SkillRouteInput, "text">>({
    noteExcerpt: noteSession.content.slice(0, 1200),
    hasSelection: !!editorSelection?.text,
    hasUrl: !!editorSelection?.text && /https?:\/\//i.test(editorSelection.text),
    hasRelated: buddySession.hasRelated,
  });

  async function handleCustomPrompt(instruction: string) {
    await runCustomPrompt(aiDeps(), instruction);
  }


  function toggleCompanion() {
    aiQueue.companionOpen = !aiQueue.companionOpen;
    if (aiQueue.companionOpen) {
      if (autoTypoFixEnabled) void runBatchAutoTypoFix(autoTypoDeps());
      scheduleNoteScan(5000);
    }
  }

  function scheduleNoteScan(delayMs = 5000) {
    if (!noteSession.selectedPath) return;
    if (isAiQuiet()) return;
    if (!proactiveEnabled && !autoTypoFixEnabled) return;
    if (noteScanTimer) clearTimeout(noteScanTimer);
    noteScanTimer = setTimeout(async () => {
      await scanNoteForSuggestions(proactiveDeps());
      proactiveStatus = proactiveStatusRef.value;
    }, delayMs);
  }

  function applySuggestion(id: string) {
    applyAiSuggestion(
      {
        onContentChange: handleContentChange,
        setEditorCursor: (n) => {
          editorCursor = n;
        },
        silenceAiHelpers,
        setStatus: (msg) => {
          statusMessage = msg;
        },
        buddyEnabled: buddySession.enabled,
        onBuddyApplied: (tip) => {
          buddySession.tip = tip;
        },
        refreshBuddyTip: () => refreshBuddyTip(editorSelection?.text),
      },
      id,
    );
  }

  async function handleEditingIdle(span: ParagraphSpan) {
    await handleEditingIdleProactive(proactiveDeps(), span);
    proactiveStatus = proactiveStatusRef.value;
  }

  function handleBuddyToggle(enabled: boolean) {
    setBuddyEnabled(enabled);
  }

  function handleBuddyAction(action: BuddyAction) {
    handleBuddyActionCore(action, {
      openCompanion: () => {
        aiQueue.companionOpen = true;
      },
      runSkill: (id) => void handleSkill(id),
      runSkillPlan: (ids) => void handleSkillPlan(ids),
    });
  }

  let buddyMood = $derived(resolveBuddyMood());

  async function handleInsertImage() {
    await insertImageFromPicker(noteImageDeps());
  }

  async function importPastedImage(base64: string, extension: string) {
    await importPastedImageForNote(base64, extension, noteImageDeps());
  }

  function handleImportImages(paths: string[]) {
    void importImagesFromPaths(paths, noteImageDeps());
  }

  function openSettings() {
    settingsOpen = true;
  }

  function closeSettings() {
    settingsOpen = false;
  }

  async function selectFromSearch(path: string) {
    closeSearchPanel();
    await loadNote(path);
  }

  function handleProactiveToggle(enabled: boolean) {
    proactiveEnabled = enabled;
    saveProactiveEnabled(enabled);
  }

  function handleNoteContextChange(value: string) {
    const next = setNoteContext(noteSession.content, value);
    handleContentChange(next);
  }

  async function handleExport() {
    await exportCurrentNote(vaultUiDeps());
  }

  async function handleImportText() {
    await importTextFilesAsNotes(vaultUiDeps());
  }

  async function handleImportDocuments() {
    await importDocumentsAsNotes(vaultUiDeps());
  }

  function handleThemeToggle() {
    theme = toggleTheme(theme);
    saveTheme(theme);
  }

  function onGlobalKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "t") {
      e.preventDefault();
      if (searchSession.open) closeSearchPanel();
      else openSearchPanel();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === ",") {
      e.preventDefault();
      if (settingsOpen) closeSettings();
      else openSettings();
    }
  }

  onMount(async () => {
    const startup = await runAppStartup((msg) => {
      statusMessage = msg;
    });
    theme = startup.theme;
    proactiveEnabled = startup.proactiveEnabled;
    autoTypoFixEnabled = startup.autoTypoFixEnabled;
    autoSummarizeEnabled = startup.autoSummarizeEnabled;

    unlisteners.push(
      ...(await registerVoiceListeners(
        {
          onTranscript: handleVoiceTranscript,
          setStatus: (msg) => {
            statusMessage = msg;
          },
          refreshVoice,
        },
        voiceCrash,
      )),
    );

    const firstRun = resolveFirstRunUi();
    setupOpen = firstRun.setupOpen;
    splashOpen = firstRun.splashOpen;
    startupReady = true;
  });

  $effect(() => {
    if (!startupReady || setupOpen || splashOpen) return;
    void runStartupUpdateCheck();
  });

  onDestroy(() => {
    for (const u of unlisteners) u();
    clearBuddyTimers();
  });

  $effect(() => {
    void aiQueue.aiLoading;
    void aiQueue.proactiveLoading;
    void aiQueue.aiSuggestions.length;
    void noteSession.selectedPath;
    if (buddySession.enabled) refreshBuddyTip(editorSelection?.text);
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
        onclick={openSearchPanel}
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
      onImportDocuments={handleImportDocuments}
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
        onImportImages={handleImportImages}
        onPasteImageBytes={importPastedImage}
        onExport={handleExport}
        onOpenHistory={() => (historyOpen = true)}
        onToggleCompanion={toggleCompanion}
        onSelectionChange={(sel) => {
          editorSelection = sel;
          if (sel) lastCaretOffset = sel.end;
          if (buddySession.enabled) {
            setTimeout(() => refreshBuddyTip(sel?.text), sel?.text.trim() ? 350 : 200);
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
  open={searchSession.open}
  query={searchSession.query}
  results={searchSession.results}
  loading={searchSession.loading}
  onQueryChange={runVaultSearch}
  onSelect={selectFromSearch}
  onClose={closeSearchPanel}
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
  buddyEnabled={buddySession.enabled}
  {proactiveStatus}
  customTargetLabel={customPromptTargetLabel}
  onContextChange={handleNoteContextChange}
  onProactiveToggle={handleProactiveToggle}
  onAutoTypoToggle={handleAutoTypoToggle}
  onAutoSummarizeToggle={handleAutoSummarizeToggle}
  onBuddyToggle={handleBuddyToggle}
  onCustomPrompt={handleCustomPrompt}
  onSkill={handleSkill}
  {skillRouteContext}
  onSkillPlan={(ids) => void handleSkillPlan(ids)}
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
    visible={buddySession.enabled}
    mood={buddyMood}
    tip={buddySession.tip}
    panelOpen={aiQueue.companionOpen}
    onAction={handleBuddyAction}
    onOpenCompanion={() => (aiQueue.companionOpen = true)}
    onDismissTip={dismissBuddyTip}
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
