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
  import { parseNoteContext, setNoteContext, ensureVisibleContextBlock } from "$lib/note/frontmatter";
  import type { ParagraphSpan } from "$lib/note/paragraph";
  import { loadProactiveEnabled, saveProactiveEnabled, loadAutoTypoFixEnabled, saveAutoTypoFixEnabled } from "$lib/stores/companion";
  import { autoFixAllTypoLines, tryAutoFixSpan, lineNeedsAiTypoFix } from "$lib/ai/autoTypo";
  import { sanitizeAiOutput } from "$lib/ai/sanitize";
  import { hasMeaningfulDiff } from "$lib/ai/textDiff";
import { buildAiProposal, buildLocalCorrection } from "$lib/ai/buildProposal";
import { finalizeCorrection } from "$lib/ai/localCorrect";
import { isFaithfulCorrection } from "$lib/ai/faithful";
import { likelyNeedsCorrection } from "$lib/ai/typoHints";
import { scanBodyTypoLines, scanBodyCleanLines, bodyHasTypoLines } from "$lib/note/scanTypos";
  import { insertTranscript, parseVoiceTranscript } from "$lib/voice/keywords";
  import { replaceTextRange, type AiActionRequest, type TextSelection } from "$lib/voice/commands";
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
  let preview = $state(false);
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
  let proactiveEnabled = $state(true);
  let autoTypoFixEnabled = $state(true);
  let proactiveLoading = $state(false);
  let editorCursor = $state<number | null>(null);
  let editorSelection = $state<TextSelection | null>(null);
  let autoTypoNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  let aiTypoFixBusy = false;
  let proactiveStatus = $state("");
  let statusMessage = $state("");
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
  let noteScanTimer: ReturnType<typeof setTimeout> | null = null;
  let fullTypoScanTimer: ReturnType<typeof setTimeout> | null = null;
  let autoTypoFixBusy = false;

  async function refreshVoice() {
    voiceStatus = await invoke<VoiceStatus>("voice_get_status");
  }

  async function handleVoiceToggle() {
    if (voiceStatus.transcribing) {
      statusMessage = "Transcription en cours — patientez quelques secondes.";
      return;
    }
    try {
      await invoke("voice_toggle");
      await refreshVoice();
    } catch (e) {
      statusMessage = String(e);
      try {
        await invoke("voice_restart");
        await refreshVoice();
        statusMessage = "Worker vocal relancé.";
      } catch {
        /* keep original error */
      }
    }
  }

  async function tryAiAutoTypoFix(span: ParagraphSpan, baseContent?: string): Promise<boolean> {
    if (aiTypoFixBusy || !autoTypoFixEnabled || preview) return false;

    const body = baseContent ?? content;
    const lineText = body.slice(span.start, span.end);
    if (!lineNeedsAiTypoFix(lineText)) return false;

    aiTypoFixBusy = true;
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

      applyAutoTypoResult(next, span.start + proposal.length, "✓ Fautes corrigées (analyse de la phrase)");
      return true;
    } catch {
      return false;
    } finally {
      aiTypoFixBusy = false;
    }
  }

  async function runAiTypoFixPass(baseContent?: string) {
    if (!autoTypoFixEnabled || !selectedPath || preview) return;

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

  function applyAutoTypoResult(next: string, cursor: number, message: string) {
    content = next;
    editorCursor = cursor;
    dirty = next !== savedContent;
    scheduleAutoSave();
    if (selectedPath && dirty) void persistNote(selectedPath, next);
    scheduleFullTypoScan(800);
    scheduleNoteScan(8000);
    showAutoTypoNotice(message);
  }

  async function handleAutoTypoFix(_span: ParagraphSpan) {
    if (!autoTypoFixEnabled || preview || voiceStatus.recording || voiceStatus.transcribing) return;
    await runBatchAutoTypoFix();
  }

  async function runBatchAutoTypoFix() {
    if (!autoTypoFixEnabled || !selectedPath || preview || autoTypoFixBusy) return;
    autoTypoFixBusy = true;

    try {
      aiSuggestions = aiSuggestions.filter(
        (s) => !(s.action === "correct" && s.source === "proactive"),
      );

      const before = content;
      const { content: next, count } = autoFixAllTypoLines(content);
      let working = content;
      if (count > 0 && next !== before) {
        working = next;
        content = next;
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
    content = insertTranscript(content, fragment);
    handleContentChange(content);
    if (autoTypoFixEnabled) {
      queueMicrotask(() => runBatchAutoTypoFix());
    }
  }

  async function handleVoiceTranscript(text: string) {
    voiceTranscriptChain = voiceTranscriptChain.then(async () => {
      if (!text.trim()) {
        statusMessage = "Aucune parole détectée — parlez un peu plus fort ou plus longtemps.";
        return;
      }

      const parsed = parseVoiceTranscript(text);

      if (parsed.kind === "search") {
        openSearch();
        await runSearch(parsed.query);
        statusMessage = `Recherche vocale : ${parsed.query}`;
        return;
      }

      if (parsed.kind === "ai") {
        if (!selectedPath) {
          statusMessage = "Ouvrez une note pour les commandes IA vocales.";
          return;
        }
        await handleAiAction({ action: parsed.action });
        return;
      }

      if (!selectedPath) {
        statusMessage = "Ouvrez une note pour insérer la transcription.";
        return;
      }

      appendTranscript(parsed.text);
      statusMessage = "Transcription insérée.";
    });

    await voiceTranscriptChain;
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
    if (dirty && selectedPath) {
      await persistNote(selectedPath, content);
    }
    selectedPath = path;
    const raw = await invoke<string>("read_note", { relativePath: path });
    content = ensureVisibleContextBlock(raw);
    savedContent = content;
    dirty = false;
    preview = false;
    aiSuggestions = [];
    editorSelection = null;
    lastProactiveKey = "";
    companionOpen = true;
    if (content !== raw) {
      await persistNote(path, content);
    }
    scheduleNoteScan(4000);
    if (autoTypoFixEnabled) {
      queueMicrotask(() => void runBatchAutoTypoFix());
    }
  }

  async function persistNote(path: string, body: string) {
    saving = true;
    try {
      await invoke("write_note", { relativePath: path, content: body });
      savedContent = body;
      dirty = false;
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
    if (!autoTypoFixEnabled || !selectedPath || preview) return;
    if (fullTypoScanTimer) clearTimeout(fullTypoScanTimer);
    fullTypoScanTimer = setTimeout(() => {
      void runBatchAutoTypoFix();
    }, delayMs);
  }

  function handleContentChange(value: string) {
    content = value;
    dirty = value !== savedContent;
    scheduleAutoSave();
    scheduleFullTypoScan(1200);
    scheduleNoteScan(8000);
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
    const { action, selection: sel } = request;
    const targetText = sel?.text ?? content;
    if (!targetText.trim()) return;

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
    const labels: Record<AiAction, string> = {
      summarize: "Résumé",
      reformulate: "Reformulation",
      correct: "Correction",
      translate_en: "Traduction",
      custom: "Prompt custom",
    };
    const scope = sel ? "sélection" : "note";
    statusMessage = `${labels[action]} (${scope}) — suggestion en cours…`;

    try {
      let result = "";
      const ctx = noteContext.trim() || null;

      if (action === "correct" && !ollamaStatus.available) {
        result = "";
      } else if (action === "summarize") {
        result = await invoke<string>("ollama_summarize_note", {
          content: targetText,
          model: activeModel,
          noteContext: ctx,
        });
      } else {
        result = await invoke<string>("ollama_transform_note", {
          action,
          content: targetText,
          model: activeModel,
          noteContext: action === "correct" ? null : ctx,
        });
      }

      const proposal = buildAiProposal(action, targetText, result);
      if (!proposal && action === "correct") {
        const localOnly = buildLocalCorrection(targetText);
        if (localOnly && hasMeaningfulDiff(targetText, localOnly)) {
          aiSuggestions = [
            {
              id: crypto.randomUUID(),
              action,
              label: labels[action],
              scope,
              proposedText: localOnly,
              originalText: targetText,
              source: "manual" as const,
              selection: sel ? { start: sel.start, end: sel.end, text: sel.text } : undefined,
            },
            ...aiSuggestions,
          ].slice(0, 12);
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

      aiSuggestions = [
        {
          id: crypto.randomUUID(),
          action,
          label: labels[action],
          scope,
          proposedText: proposal,
          originalText: targetText,
          source: "manual" as const,
          selection: sel ? { start: sel.start, end: sel.end, text: sel.text } : undefined,
        },
        ...aiSuggestions,
      ].slice(0, 12);
      statusMessage = `Suggestion « ${labels[action]} » prête — appliquez ou ignorez.`;
    } catch (e) {
      if (action === "correct") {
        const proposal = buildAiProposal("correct", targetText, "");
        if (proposal) {
          aiSuggestions = [
            {
              id: crypto.randomUUID(),
              action,
              label: labels[action],
              scope,
              proposedText: proposal,
              originalText: targetText,
              source: "manual" as const,
              selection: sel ? { start: sel.start, end: sel.end, text: sel.text } : undefined,
            },
            ...aiSuggestions,
          ].slice(0, 12);
          statusMessage = "Correction locale proposée.";
          return;
        }
      }
      statusMessage = `Erreur IA : ${e}`;
    } finally {
      aiLoading = false;
    }
  }

  async function handleCustomPrompt(instruction: string) {
    if (!instruction.trim() || !selectedPath || preview) return;

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
      });

      const proposal = buildAiProposal("custom", targetText, result);
      if (!proposal) {
        statusMessage = "Réponse IA vide — modifiez le prompt ou réessayez.";
        return;
      }

      const label =
        instruction.trim().length > 42
          ? `Custom : ${instruction.trim().slice(0, 39)}…`
          : `Custom : ${instruction.trim()}`;

      aiSuggestions = [
        {
          id: crypto.randomUUID(),
          action: "custom" as const,
          label,
          scope,
          proposedText: proposal,
          originalText: targetText,
          source: "manual" as const,
          reason: instruction.trim(),
          selection: sel ? { start: sel.start, end: sel.end, text: sel.text } : undefined,
        },
        ...aiSuggestions,
      ].slice(0, 12);
      statusMessage = "Suggestion custom prête — appliquez ou ignorez.";
    } catch (e) {
      statusMessage = `Erreur IA : ${e}`;
    } finally {
      aiLoading = false;
    }
  }

  function applySuggestion(id: string) {
    const suggestion = aiSuggestions.find((s) => s.id === id);
    if (!suggestion) return;

    if (suggestion.action === "summarize" && !suggestion.selection) {
      const block = `\n\n---\n**${suggestion.label} IA**\n\n${suggestion.proposedText}\n`;
      handleContentChange(content + block);
    } else if (suggestion.selection) {
      handleContentChange(
        replaceTextRange(
          content,
          suggestion.selection.start,
          suggestion.selection.end,
          suggestion.proposedText,
        ),
      );
    } else {
      handleContentChange(suggestion.proposedText);
    }

    aiSuggestions = aiSuggestions.filter((s) => s.id !== id);
    statusMessage = "Suggestion appliquée.";
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
    if (!selectedPath || preview) return;
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
    if (!selectedPath || preview) return;

    if (autoTypoFixEnabled && !aiLoading) {
      await runBatchAutoTypoFix();
    }

    if (proactiveLoading || aiLoading || !proactiveEnabled) return;
    if (bodyHasTypoLines(content)) {
      proactiveStatus = "Correction des fautes…";
      return;
    }

    const lines = scanBodyCleanLines(content);
    const target = lines.find((line) => !hasSuggestionForSpan(line));
    if (!target) return;

    await processProactiveSpan(target, "passage repéré");
  }

  async function processProactiveSpan(span: ParagraphSpan, scopeLabel = "passage en cours") {
    if (!proactiveEnabled || !selectedPath || preview) return;
    if (likelyNeedsCorrection(span.text)) return;
    if (bodyHasTypoLines(content)) return;

    const minLen = likelyNeedsCorrection(span.text) ? 12 : 25;
    if (span.text.trim().length < minLen) return;
    if (aiLoading || proactiveLoading) return;

    const now = Date.now();
    const cooldown = likelyNeedsCorrection(span.text) ? 8000 : 20000;
    const key = `${selectedPath}:${span.start}:${span.end}:${span.text.trim()}`;
    if (now - lastProactiveAt < cooldown && key === lastProactiveKey) return;
    if (key === lastProactiveKey && hasSuggestionForSpan(span)) return;

    if (hasSuggestionForSpan(span)) return;

    proactiveLoading = true;
    companionOpen = true;
    proactiveStatus = "Analyse du passage en cours…";
    statusMessage = proactiveStatus;

    const addSuggestion = (
      action: AiAction,
      label: string,
      proposed: string,
      reason?: string,
      scopeLabel = "passage en cours",
    ) => {
      aiSuggestions = [
        {
          id: crypto.randomUUID(),
          action,
          label,
          scope: scopeLabel,
          source: "proactive" as const,
          reason,
          proposedText: proposed,
          originalText: span.text,
          selection: { start: span.start, end: span.end, text: span.text },
        },
        ...aiSuggestions,
      ].slice(0, 12);
      lastProactiveKey = key;
      lastProactiveAt = now;
      proactiveStatus = "";
      statusMessage = "Suggestion proactive prête — appliquez ou ignorez.";
    };

    try {
      // Pas de fautes évidentes → reformulation proactive (contexte note autorisé)
      if (ollamaStatus.available) {
        const result = await invoke<ProactiveSuggestionResponse>("ollama_proactive_suggest", {
          paragraph: span.text,
          noteExcerpt: content.slice(0, 1500),
          noteContext: noteContext.trim() || null,
          model: activeModel,
        });

        if (result.suggest && result.proposed?.trim()) {
          const isCorrection = result.label?.toLowerCase().includes("correction");
          const proposed = sanitizeAiOutput(
            result.proposed,
            isCorrection ? "correct" : "reformulate",
          );
          const action = isCorrection ? ("correct" as const) : ("reformulate" as const);
          const faithful = isCorrection ? isFaithfulCorrection(span.text, proposed) : true;

          if (proposed.trim() && hasMeaningfulDiff(span.text, proposed) && faithful) {
            addSuggestion(
              action,
              result.label?.trim() || (isCorrection ? "Correction" : "Suggestion"),
              proposed,
              result.reason?.trim(),
              scopeLabel,
            );
            return;
          }
        }
      }

      proactiveStatus = bodyHasTypoLines(content)
        ? "Certaines fautes nécessitent une correction manuelle."
        : "Aucune reformulation proposée pour ce passage.";
      statusMessage = proactiveStatus;
      lastProactiveAt = now;
    } catch (e) {
      proactiveStatus = `Analyse indisponible : ${e}`;
      statusMessage = proactiveStatus;
    } finally {
      proactiveLoading = false;
      scheduleNoteScan(12000);
    }
  }

  async function handleEditingIdle(span: ParagraphSpan) {
    if (!selectedPath || preview) return;

    if (autoTypoFixEnabled && bodyHasTypoLines(content)) {
      await runBatchAutoTypoFix();
      return;
    }

    if (!proactiveEnabled) return;
    scheduleNoteScan(8000);
    if (!likelyNeedsCorrection(span.text)) {
      await processProactiveSpan(span);
    }
  }

  function handleProactiveToggle(enabled: boolean) {
    proactiveEnabled = enabled;
    saveProactiveEnabled(enabled);
  }

  function handleNoteContextChange(value: string) {
    const next = setNoteContext(content, value);
    handleContentChange(next);
  }

  async function insertImageMarkdown(relative: string) {
    const alt = relative.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "image";
    const snippet = `\n\n![${alt}](${relative})\n`;
    handleContentChange(content + snippet);
    statusMessage = `Image copiée dans ${relative.includes("/_media/") || relative.startsWith("_media/") ? "le dossier de la note" : "media/"}.`;
  }

  async function importImageFromPath(sourcePath: string, useGlobalMedia = false) {
    const relative = await invoke<string>("import_image", {
      sourcePath,
      notePath: selectedPath,
      useGlobalMedia,
    });
    await insertImageMarkdown(relative);
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
    await insertImageMarkdown(relative);
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
    await refreshVault();
    await ensureOllamaRunning(true);
    await refreshVoice();

    unlisteners.push(
      await listen<VoiceTranscript>("voice-transcript", (event) => {
        handleVoiceTranscript(event.payload.text);
      }),
      await listen("voice-event", async () => {
        await refreshVoice();
      }),
      await listen("voice-worker-stopped", async () => {
        try {
          await invoke("voice_restart");
          statusMessage = "Worker vocal relancé automatiquement.";
        } catch {
          statusMessage = "Worker vocal arrêté. Réglages → Voix pour relancer.";
        }
        await refreshVoice();
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
        title="Dictée ({voiceStatus.hotkey}) · commandes dans la bulle en bas à gauche"
      >
        🎙 {voiceStatus.recording ? "REC…" : voiceStatus.hotkey}
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
        {preview}
        ollamaAvailable={ollamaStatus.available}
        {aiLoading}
        companionOpen={companionOpen}
        onChange={handleContentChange}
        onSave={() => selectedPath && persistNote(selectedPath, content)}
        onTogglePreview={() => (preview = !preview)}
        onAiAction={handleAiAction}
        onInsertImage={handleInsertImage}
        onImportImages={importImagesFromPaths}
        onPasteImageBytes={importPastedImage}
        onExport={handleExport}
        onToggleCompanion={toggleCompanion}
        onSelectionChange={(sel) => (editorSelection = sel)}
        onEditingIdle={handleEditingIdle}
        onAutoTypoFix={handleAutoTypoFix}
        {autoTypoFixEnabled}
        highlightRange={editorHighlight}
        {editorCursor}
        onCursorRestored={() => (editorCursor = null)}
      />
    {:else}
      <section class="flex flex-1 flex-col items-center justify-center gap-4 bg-bg text-center">
        <span class="pixel-icon text-4xl">📓</span>
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
  suggestions={aiSuggestions}
  {aiLoading}
  {proactiveLoading}
  {proactiveEnabled}
  {autoTypoFixEnabled}
  {proactiveStatus}
  customTargetLabel={customPromptTargetLabel}
  onContextChange={handleNoteContextChange}
  onProactiveToggle={handleProactiveToggle}
  onAutoTypoToggle={handleAutoTypoToggle}
  onCustomPrompt={handleCustomPrompt}
  onApply={applySuggestion}
  onDismiss={dismissSuggestion}
  onDismissAll={() => (aiSuggestions = [])}
  onClose={() => (companionOpen = false)}
/>
