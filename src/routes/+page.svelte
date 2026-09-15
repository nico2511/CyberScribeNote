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
  } from "$lib/stores/companion";
  import { type AiActionRequest, type TextSelection } from "$lib/voice/commands";
  import { mapCaretThroughReplace, locateSelectionInContent } from "$lib/note/caret";
  import { resolveWikilink, flattenNotes, noteStem } from "$lib/vault/wikilinks";
  import { type SkillId } from "$lib/ai/skills";
  import type { BuddyAction } from "$lib/ai/scribeBuddy";
  import {
    buddySession,
    initBuddyFromStorage,
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
  import {
    pickImageFile,
    importImageFromPath as importImagePath,
    importPastedImageBytes,
    imageMarkdownForRelative,
    imageImportStatusMessage,
  } from "$lib/app/noteImages";
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
  import type { ThemeMode, VoiceTranscript } from "$lib/types";

  let theme = $state<ThemeMode>("light");
  let settingsOpen = $state(false);
  let splashOpen = $state(false);
  let setupOpen = $state(false);
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

  let voiceCrashRestarts = 0;
  let voiceCrashWindowStart = 0;
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
    };
  }

  async function handleVoiceTranscript(text: string) {
    const chain = enqueueVoiceTranscript(() => processVoiceTranscript(voiceDeps(), text));
    await chain;
  }

  async function openNoteByQuery(query: string) {
    const match = resolveWikilink(query, vaultStore.entries);
    if (!match) {
      const msg = `Aucune note trouvée pour « ${query} ».`;
      statusMessage = msg;
      notify({ kind: "warning", title: "Scribe · ouvrir", message: msg, key: "voice-cmd" });
      openSearchPanel();
      await runVaultSearch(query);
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
    });
  }

  let buddyMood = $derived(resolveBuddyMood());

  async function queueImageMarkdown(relative: string) {
    pendingImageMarkdown = imageMarkdownForRelative(relative);
    statusMessage = imageImportStatusMessage(relative);
  }

  async function importImageFromPath(sourcePath: string, useGlobalMedia = false) {
    const relative = await importImagePath(
      sourcePath,
      noteSession.selectedPath,
      useGlobalMedia,
    );
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
    const relative = await importPastedImageBytes(base64, extension, noteSession.selectedPath);
    await queueImageMarkdown(relative);
  }

  async function handleInsertImage() {
    if (!noteSession.selectedPath) {
      statusMessage = "Ouvrez une note pour y insérer une image.";
      return;
    }
    const sourcePath = await pickImageFile();
    if (!sourcePath) return;
    try {
      await importImageFromPath(sourcePath, false);
    } catch (e) {
      statusMessage = `Erreur image : ${e}`;
    }
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
    theme = loadTheme();
    applyTheme(theme);
    proactiveEnabled = loadProactiveEnabled();
    autoTypoFixEnabled = loadAutoTypoFixEnabled();
    autoSummarizeEnabled = loadAutoSummarizeEnabled();
    initBuddyFromStorage();
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
