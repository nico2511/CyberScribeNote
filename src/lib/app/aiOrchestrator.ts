import { invoke } from "$lib/tauri/api";
import { buildAiProposal, buildLocalCorrection } from "$lib/ai/buildProposal";
import { fetchRagContext } from "$lib/ai/rag";
import {
  instructionIsDerivedOutput,
  instructionWantsVaultContext,
  isGroundedAppendix,
  isGroundedTransform,
} from "$lib/ai/grounding";
import {
  extractExistingSummary,
  formatSummaryAppendix,
  isDuplicateSummary,
  translateLangLabel,
} from "$lib/ai/languages";
import { formatExtractedLinksList, isLinkOnlyNote } from "$lib/ai/links";
import { sanitizeAiOutput } from "$lib/ai/sanitize";
import {
  CLARIFY_SELECTION_MAX,
  extractUrls,
  formatEnrichContext,
  getSkill,
  hasMarkdownSection,
  isEmptyLlmAppendix,
  parseTagsProposal,
  parseTitleProposal,
  runSkillLocal,
  titleIsSolid,
  titleStaysOnTopic,
  withProposedTitle,
  wrapNamedSection,
  type SkillId,
} from "$lib/ai/skills";
import { hasMeaningfulDiff } from "$lib/ai/textDiff";
import { repairMarkdownProposal } from "$lib/markdown/repair";
import { mergeBodyMarkdown } from "$lib/markdown/bridge";
import { noteBody } from "$lib/note/frontmatter";
import { locateSelectionInContent } from "$lib/note/caret";
import { flattenNotes, noteStem } from "$lib/vault/wikilinks";
import { aiQueue, pushSuggestion, stillCurrentAiRequest } from "$lib/stores/aiQueue.svelte";
import { noteSession } from "$lib/stores/noteSession.svelte";
import { notify } from "$lib/stores/notifications";
import type { AiAction, VaultEntry } from "$lib/types";
import { replaceTextRange, type AiActionRequest, type TextSelection } from "$lib/voice/commands";
import { formatRelatedAppendix } from "$lib/app/relatedAppendix";
import { runFolderIndexSkill } from "$lib/app/folderIndexSkill";

export type AiOrchestratorDeps = {
  content: string;
  selectedPath: string | null;
  noteContext: string;
  editorSelection: TextSelection | null;
  ollamaAvailable: boolean;
  activeModel: string;
  entries: VaultEntry[];
  ensureOllamaRunning: (silent?: boolean) => Promise<boolean>;
  openSettings: () => void;
  setStatus: (msg: string) => void;
  onContentChange: (next: string) => void;
  setEditorCursor: (n: number | null) => void;
  setLastCaretOffset: (n: number) => void;
  silenceAiHelpers: (ms: number) => void;
};

export async function runAiAction(deps: AiOrchestratorDeps, request: AiActionRequest): Promise<void> {
  const { action, selection: rawSel, translateTo } = request;
  const located = rawSel ? locateSelectionInContent(deps.content, rawSel) : null;
  const sel =
    rawSel && located
      ? { ...rawSel, start: located.start, end: located.end }
      : rawSel && rawSel.text
        ? rawSel
        : undefined;
  if (
    rawSel?.text &&
    !located &&
    (action === "translate" || action === "reformulate" || action === "correct")
  ) {
    const msg =
      "Sélection introuvable dans la note — resélectionnez le passage puis relancez l'action.";
    deps.setStatus(msg);
    notify({ kind: "warning", title: "Sélection", message: msg, key: "ai-sel" });
    return;
  }
  const fullNote = !sel;
  const targetText = sel?.text ?? noteBody(deps.content);
  if (!targetText.trim()) {
    const msg = "La note est vide — rien à transformer.";
    deps.setStatus(msg);
    notify({ kind: "warning", title: "IA", message: msg, key: "ai-empty" });
    return;
  }

  const epoch = noteSession.aiEpoch;
  const pathAtStart = deps.selectedPath;

  if (!deps.ollamaAvailable && action !== "correct") {
    const started = await deps.ensureOllamaRunning(true);
    if (!started) {
      deps.openSettings();
      deps.setStatus("Configurez ou démarrez Ollama dans les réglages.");
      return;
    }
  }

  aiQueue.aiLoading = true;
  aiQueue.companionOpen = true;
  const lang = translateTo ?? "en";
  const labels: Record<AiAction, string> = {
    summarize: "Résumé",
    reformulate: "Reformulation",
    correct: "Correction",
    translate: `Traduction (${translateLangLabel(lang)})`,
    custom: "Prompt custom",
  };
  const scope =
    action === "summarize" ? "à ajouter en fin de note" : sel ? "sélection" : "note";
  deps.setStatus(`${labels[action]} (${scope}) — suggestion en cours…`);

  const stillCurrent = () => stillCurrentAiRequest(epoch, pathAtStart);

  try {
    let result = "";
    const ctx = deps.noteContext.trim() || null;
    const wantsRag = action === "summarize";
    const ragContext = wantsRag
      ? await fetchRagContext(targetText.slice(0, 800), pathAtStart)
      : "";

    if (!stillCurrent()) return;

    if (action === "correct" && !deps.ollamaAvailable) {
      result = "";
    } else if (action === "summarize") {
      result = await invoke<string>("ollama_summarize_note", {
        content: targetText,
        model: deps.activeModel,
        noteContext: ctx,
        ragContext: ragContext || null,
      });
    } else if (action === "translate") {
      result = await invoke<string>("ollama_transform_note", {
        action: "translate",
        content: targetText,
        model: deps.activeModel,
        noteContext: ctx,
        targetLanguage: translateLangLabel(lang).toLowerCase(),
        ragContext: null,
      });
    } else {
      result = await invoke<string>("ollama_transform_note", {
        action,
        content: targetText,
        model: deps.activeModel,
        noteContext: action === "correct" ? null : ctx,
        targetLanguage: null,
        ragContext: null,
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
        deps.setStatus("Correction locale proposée.");
        return;
      }
    }

    if (!proposal) {
      deps.setStatus(
        action === "correct"
          ? "Aucune correction trouvée pour ce passage."
          : action === "reformulate"
            ? "L'IA a dérivé du contenu — proposition rejetée. Réessayez."
            : "Réponse IA vide — réessayez.",
      );
      return;
    }

    if (action === "summarize") {
      if (isDuplicateSummary(extractExistingSummary(deps.content), proposal)) {
        deps.setStatus("Ce résumé est déjà présent dans la note.");
        return;
      }
    }

    if (
      (action === "translate" || action === "reformulate") &&
      !hasMeaningfulDiff(targetText, proposal)
    ) {
      deps.setStatus("La proposition est identique au texte actuel.");
      return;
    }

    const isSummary = action === "summarize";

    if (!isSummary && action === "translate" && sel) {
      const range = locateSelectionInContent(deps.content, sel) ?? {
        start: sel.start,
        end: sel.end,
      };
      const next = replaceTextRange(deps.content, range.start, range.end, proposal);
      deps.silenceAiHelpers(120000);
      deps.onContentChange(next);
      deps.setEditorCursor(range.start + proposal.length);
      deps.setLastCaretOffset(range.start + proposal.length);
      aiQueue.companionOpen = true;
      deps.setStatus(`${labels[action]} appliquée à la sélection.`);
      notify({
        kind: "success",
        title: "Traduction",
        message: `Sélection traduite (${proposal.length} car.)`,
        key: "ai-translate",
      });
      return;
    }

    if (
      fullNote &&
      !isSummary &&
      (action === "translate" || action === "reformulate" || action === "correct")
    ) {
      const next = mergeBodyMarkdown(deps.content, proposal.trim() + "\n");
      deps.silenceAiHelpers(action === "translate" ? 120000 : 90000);
      deps.onContentChange(next);
      deps.setEditorCursor(Math.min(next.length, Math.max(1, proposal.length)));
      aiQueue.companionOpen = true;
      deps.setStatus(`${labels[action]} appliquée à la note.`);
      return;
    }

    if (!isSummary && (action === "reformulate" || action === "correct") && sel) {
      deps.silenceAiHelpers(60000);
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
      reason: isSummary ? "Sera ajouté en fin de note (complément)" : undefined,
      selection:
        isSummary || !sel ? undefined : { start: sel.start, end: sel.end, text: sel.text },
    });
    deps.setStatus(
      isSummary
        ? "Résumé prêt — appliquez pour l'ajouter en fin de note."
        : `Suggestion « ${labels[action]} » prête — cliquez « Appliquer » dans le Compagnon.`,
    );
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
        deps.setStatus("Correction locale proposée.");
        return;
      }
    }
    deps.setStatus(`Erreur IA : ${e}`);
  } finally {
    aiQueue.aiLoading = false;
  }
}

export async function runSkill(deps: AiOrchestratorDeps, id: SkillId): Promise<void> {
  if (id === "folderIndex") {
    await runFolderIndexSkill(deps);
    return;
  }
  if (!deps.selectedPath) return;
  const skill = getSkill(id);
  const pathAtStart = deps.selectedPath;
  const epoch = noteSession.aiEpoch;
  const targetText = deps.editorSelection?.text ?? noteBody(deps.content);
  if (!targetText.trim() && !skill.allowEmpty) {
    deps.setStatus("La note est vide — rien à concevoir.");
    return;
  }

  aiQueue.companionOpen = true;
  const titles = flattenNotes(deps.entries).map((e) => noteStem(e.path));

  if (id === "related") {
    aiQueue.aiLoading = true;
    deps.setStatus("Notes liées — recherche…");
    try {
      const rag = await fetchRagContext(
        targetText.slice(0, 800) || titles.join(" "),
        pathAtStart,
      );
      if (!stillCurrentAiRequest(epoch, pathAtStart)) return;
      const local = runSkillLocal("related", targetText, { ragBlock: formatRelatedAppendix(rag) });
      if (!local) {
        deps.setStatus(skill.emptyMessage);
        return;
      }
      pushSuggestion({
        action: "custom",
        skillId: id,
        label: skill.label,
        scope: "à ajouter en fin de note",
        proposedText: local.proposed,
        originalText: "",
        source: "manual",
        notePath: pathAtStart,
        applyMode: "append",
        reason: local.reason,
      });
      deps.setStatus(`${skill.label} prêt — appliquez ou ignorez.`);
    } catch (e) {
      deps.setStatus(`Notes liées indisponibles : ${e}`);
    } finally {
      aiQueue.aiLoading = false;
    }
    return;
  }

  const localCtx = {
    titles,
    currentTitle: noteStem(pathAtStart),
    noteContext: deps.noteContext.trim(),
  };
  // Structurer et Relire : le filet local ne remplace le modèle que si Ollama est down.
  const skipLocal =
    (skill.id === "structure" || skill.id === "proofread") && deps.ollamaAvailable;
  const local = skipLocal ? null : runSkillLocal(id, targetText, localCtx);
  if (local) {
    const mode = local.applyMode ?? skill.applyMode;
    pushSuggestion({
      action: "custom",
      skillId: id,
      label: skill.label,
      scope:
        mode === "append" ? "à ajouter en fin de note" : deps.editorSelection?.text ? "sélection" : "note",
      proposedText: local.proposed,
      originalText: mode === "append" || mode === "tags" ? "" : targetText,
      source: "manual",
      notePath: pathAtStart,
      applyMode: mode === "tags" ? "tags" : mode,
      reason: local.reason,
      selection:
        mode === "replace" && deps.editorSelection
          ? {
              start: deps.editorSelection.start,
              end: deps.editorSelection.end,
              text: deps.editorSelection.text,
            }
          : undefined,
    });
    deps.setStatus(`${skill.label} prêt — appliquez ou ignorez.`);
    return;
  }

  if (id === "title" && titleIsSolid(deps.content)) {
    deps.setStatus(skill.emptyMessage);
    return;
  }

  if (id === "decisions" && hasMarkdownSection(targetText, "Décisions")) {
    deps.setStatus(skill.emptyMessage);
    return;
  }

  if (!skill.needsLlm || !skill.llmInstruction) {
    deps.setStatus(skill.emptyMessage);
    return;
  }

  if (!deps.ollamaAvailable) {
    const started = await deps.ensureOllamaRunning(true);
    if (!started) {
      deps.openSettings();
      deps.setStatus("Configurez ou démarrez Ollama dans les réglages.");
      return;
    }
  }

  aiQueue.aiLoading = true;
  deps.setStatus(`${skill.label} — en cours…`);
  try {
    let promptContent = targetText;
    if (skill.needsUrlFetch) {
      const urls = extractUrls(targetText);
      if (!urls.length) {
        deps.setStatus(skill.emptyMessage);
        return;
      }
      const meta = await invoke<{
        url: string;
        title: string;
        description: string;
        siteName?: string | null;
        excerpt?: string | null;
      }>("fetch_page_meta", { url: urls[0] });
      if (!stillCurrentAiRequest(epoch, pathAtStart)) return;
      promptContent = formatEnrichContext(meta);
    }

    const ragContext =
      skill.wantsRag ? (await fetchRagContext(targetText.slice(0, 800), pathAtStart)) || null : null;

    const result = await invoke<string>("ollama_custom_prompt", {
      instruction: skill.llmInstruction,
      content: promptContent,
      model: deps.activeModel,
      noteContext: deps.noteContext.trim() || null,
      ragContext,
    });
    if (!stillCurrentAiRequest(epoch, pathAtStart)) return;

    let cleaned = sanitizeAiOutput(result, "custom");
    if (skill.id === "title") {
      const title = parseTitleProposal(cleaned);
      const noteForTitle = noteBody(deps.content) || targetText;
      if (!title || !titleStaysOnTopic(noteForTitle, title)) {
        deps.setStatus(skill.emptyMessage);
        return;
      }
      const proposed = withProposedTitle(deps.content, title);
      if (!hasMeaningfulDiff(deps.content, proposed)) {
        deps.setStatus(skill.emptyMessage);
        return;
      }
      pushSuggestion({
        action: "custom",
        skillId: id,
        label: skill.label,
        scope: "titre",
        proposedText: proposed,
        originalText: deps.content,
        source: "manual",
        notePath: pathAtStart,
        applyMode: "replace",
        reason: `Titre proposé : ${title}`,
      });
      deps.setStatus(`${skill.label} prêt — appliquez ou ignorez.`);
      return;
    }

    if (skill.id === "clarify") {
      const sel = deps.editorSelection;
      const selText = sel?.text.trim() ?? "";
      const shortSel = selText.length >= 8 && selText.length <= CLARIFY_SELECTION_MAX;
      if (shortSel && sel) {
        const proposed = cleaned.trim();
        if (!proposed || isEmptyLlmAppendix(proposed) || !isGroundedTransform(selText, proposed)) {
          deps.setStatus(skill.emptyMessage);
          return;
        }
        pushSuggestion({
          action: "custom",
          skillId: id,
          label: skill.label,
          scope: "sélection",
          proposedText: proposed,
          originalText: selText,
          source: "manual",
          notePath: pathAtStart,
          applyMode: "replace",
          reason: skill.hint,
          selection: { start: sel.start, end: sel.end, text: sel.text },
        });
        deps.setStatus(`${skill.label} prêt — la sélection sera remplacée.`);
        return;
      }
      cleaned = wrapNamedSection("Version claire", cleaned);
    }

    if (skill.id === "shorten") {
      cleaned = wrapNamedSection("Version courte", cleaned);
    }

    if (skill.applyMode === "tags") {
      const tags = parseTagsProposal(cleaned);
      if (!tags.length) {
        deps.setStatus(skill.emptyMessage);
        return;
      }
      pushSuggestion({
        action: "custom",
        skillId: id,
        label: skill.label,
        scope: "frontmatter",
        proposedText: `tags: ${tags.join(", ")}`,
        originalText: "",
        source: "manual",
        notePath: pathAtStart,
        applyMode: "tags",
        reason: `Tags proposés : ${tags.join(", ")}`,
      });
      deps.setStatus(`${skill.label} prêt — appliquez ou ignorez.`);
      return;
    }

    if (skill.id === "enrich") {
      const fullBody = noteBody(deps.content);
      const linkOnly = isLinkOnlyNote(fullBody) && !deps.editorSelection;
      const mode = linkOnly ? "replace" : "append";
      const proposed =
        mode === "append" && !/^##\s+/.test(cleaned.trim())
          ? `## Lien enrichi\n\n${cleaned.trim()}`
          : cleaned.trim();
      pushSuggestion({
        action: "custom",
        skillId: id,
        label: skill.label,
        scope: mode === "append" ? "à ajouter en fin de note" : "note (lien seul)",
        proposedText: proposed,
        originalText: mode === "append" ? "" : fullBody,
        source: "manual",
        notePath: pathAtStart,
        applyMode: mode,
        reason: skill.hint,
      });
      deps.setStatus(
        `${skill.label} prêt — ${mode === "append" ? "sera ajouté en fin" : "remplacera le lien seul"}.`,
      );
      return;
    }

    if (skill.applyMode === "replace") {
      cleaned = repairMarkdownProposal(cleaned);
      if (!cleaned.trim() || !isGroundedTransform(targetText, cleaned)) {
        deps.setStatus(
          "L'IA a dérivé du contenu — proposition rejetée. Réessayez ou utilisez une skill locale.",
        );
        return;
      }
    } else {
      if (isEmptyLlmAppendix(cleaned) || !isGroundedAppendix(targetText, cleaned)) {
        deps.setStatus(skill.emptyMessage);
        return;
      }
      if (skill.id === "brief") {
        cleaned = cleaned.trim();
      }
    }

    pushSuggestion({
      action: "custom",
      skillId: id,
      label: skill.label,
      scope: skill.applyMode === "append" ? "à ajouter en fin de note" : "note",
      proposedText: cleaned,
      originalText: skill.applyMode === "append" ? "" : targetText,
      source: "manual",
      notePath: pathAtStart,
      applyMode: skill.applyMode,
      reason: skill.hint,
    });
    deps.setStatus(`${skill.label} prêt — appliquez ou ignorez.`);
  } catch (e) {
    if (stillCurrentAiRequest(epoch, pathAtStart)) {
      deps.setStatus(`Erreur IA : ${e}`);
    }
  } finally {
    aiQueue.aiLoading = false;
  }
}

export async function runCustomPrompt(deps: AiOrchestratorDeps, instruction: string): Promise<void> {
  if (!instruction.trim() || !deps.selectedPath) return;

  const epoch = noteSession.aiEpoch;
  const pathAtStart = deps.selectedPath;
  const sel = deps.editorSelection;
  const targetText = sel?.text ?? noteBody(deps.content);
  if (!targetText.trim()) {
    deps.setStatus("Rien à traiter — sélectionnez du texte ou écrivez dans la note.");
    return;
  }

  const trimmedInstruction = instruction.trim();
  const scope = sel ? "sélection" : "note";
  const label =
    trimmedInstruction.length > 42
      ? `Custom : ${trimmedInstruction.slice(0, 39)}…`
      : `Custom : ${trimmedInstruction}`;

  // Favoris HTML / dumps de liens : extraction locale fiable (sans LLM / timeout / filtre).
  if (/\b(lien|liens|urls?|http)\b/i.test(trimmedInstruction) && instructionIsDerivedOutput(trimmedInstruction)) {
    const localList = formatExtractedLinksList(targetText);
    if (localList) {
      aiQueue.companionOpen = true;
      pushSuggestion({
        action: "custom",
        label,
        scope,
        proposedText: localList,
        originalText: targetText,
        source: "manual",
        notePath: pathAtStart,
        reason: `${trimmedInstruction} (extraction locale)`,
        selection: sel ? { start: sel.start, end: sel.end, text: sel.text } : undefined,
      });
      deps.setStatus(
        `Liste de liens prête (${localList.split("\n").length} entrées) — appliquez ou ignorez.`,
      );
      return;
    }
  }

  if (!deps.ollamaAvailable) {
    const started = await deps.ensureOllamaRunning(true);
    if (!started) {
      deps.openSettings();
      deps.setStatus("Configurez ou démarrez Ollama dans les réglages.");
      return;
    }
  }

  aiQueue.aiLoading = true;
  aiQueue.companionOpen = true;
  deps.setStatus(`Prompt custom (${scope}) — en cours…`);

  try {
    const wantsRag = instructionWantsVaultContext(trimmedInstruction);
    const result = await invoke<string>("ollama_custom_prompt", {
      instruction: trimmedInstruction,
      content: targetText,
      model: deps.activeModel,
      noteContext: deps.noteContext.trim() || null,
      ragContext: wantsRag
        ? (await fetchRagContext(targetText.slice(0, 800), pathAtStart)) || null
        : null,
    });

    if (!stillCurrentAiRequest(epoch, pathAtStart)) return;

    const proposal = buildAiProposal("custom", targetText, result, trimmedInstruction);
    if (!proposal) {
      deps.setStatus(
        result.trim()
          ? "L'IA a changé de sujet — proposition rejetée. Le contenu source est conservé, réessayez."
          : "Réponse IA vide — modifiez le prompt ou réessayez.",
      );
      return;
    }

    pushSuggestion({
      action: "custom",
      label,
      scope,
      proposedText: proposal,
      originalText: targetText,
      source: "manual",
      notePath: pathAtStart,
      reason: trimmedInstruction,
      selection: sel ? { start: sel.start, end: sel.end, text: sel.text } : undefined,
    });
    deps.setStatus("Suggestion custom prête — appliquez ou ignorez.");
  } catch (e) {
    if (stillCurrentAiRequest(epoch, pathAtStart)) {
      deps.setStatus(`Erreur IA : ${e}`);
    }
  } finally {
    aiQueue.aiLoading = false;
  }
}

export function aiOrchestratorDepsFromPage(state: {
  content: string;
  selectedPath: string | null;
  noteContext: string;
  editorSelection: TextSelection | null;
  ollamaAvailable: boolean;
  activeModel: string;
  entries: VaultEntry[];
  ensureOllamaRunning: (silent?: boolean) => Promise<boolean>;
  openSettings: () => void;
  setStatus: (msg: string) => void;
  onContentChange: (next: string) => void;
  setEditorCursor: (n: number | null) => void;
  setLastCaretOffset: (n: number) => void;
  silenceAiHelpers: (ms: number) => void;
}): AiOrchestratorDeps {
  return state;
}
