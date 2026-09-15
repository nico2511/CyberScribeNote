import { invoke } from "$lib/tauri/api";
import { sanitizeAiOutput } from "$lib/ai/sanitize";
import { isFaithfulCorrection } from "$lib/ai/faithful";
import { hasMeaningfulDiff } from "$lib/ai/textDiff";
import { likelyNeedsCorrection } from "$lib/ai/typoHints";
import { scanBodyTypoLines, bodyHasTypoLines } from "$lib/note/scanTypos";
import type { ParagraphSpan } from "$lib/note/paragraph";
import { aiQueue, isAiQuiet, pushSuggestion, stillCurrentAiRequest } from "$lib/stores/aiQueue.svelte";
import { noteSession } from "$lib/stores/noteSession.svelte";
import type { AiAction, ProactiveSuggestionResponse } from "$lib/types";

const memory = { lastAt: 0, lastKey: "" };

export type ProactiveScanDeps = {
  proactiveEnabled: boolean;
  autoTypoFixEnabled: boolean;
  noteContext: string;
  activeModel: string;
  ollamaAvailable: boolean;
  proactiveStatus: { value: string };
  setStatus: (msg: string) => void;
  runBatchAutoTypoFix: () => Promise<void>;
  scheduleNoteScan: (delayMs?: number) => void;
};

function hasSuggestionForSpan(span: { start: number; end: number }): boolean {
  return aiQueue.aiSuggestions.some(
    (s) => s.selection?.start === span.start && s.selection?.end === span.end,
  );
}

export async function scanNoteForSuggestions(deps: ProactiveScanDeps): Promise<void> {
  if (!noteSession.selectedPath) return;

  if (deps.autoTypoFixEnabled && !aiQueue.aiLoading) {
    await deps.runBatchAutoTypoFix();
  }

  if (aiQueue.proactiveLoading || aiQueue.aiLoading || !deps.proactiveEnabled || isAiQuiet()) {
    return;
  }

  const typoLines = scanBodyTypoLines(noteSession.content);
  if (typoLines.length) {
    const target = typoLines.find((line) => !hasSuggestionForSpan(line));
    if (target) {
      await processProactiveSpan(
        deps,
        { ...target, text: noteSession.content.slice(target.start, target.end) },
        "passage fautif",
      );
    } else if (!deps.proactiveStatus.value) {
      deps.proactiveStatus.value =
        "Des fautes restent — utilisez Corriger (clic droit) si besoin.";
    }
    return;
  }

  deps.proactiveStatus.value = "";
}

export async function processProactiveSpan(
  deps: ProactiveScanDeps,
  span: ParagraphSpan,
  scopeLabel = "passage en cours",
): Promise<void> {
  if (!deps.proactiveEnabled || !noteSession.selectedPath || isAiQuiet()) return;
  if (bodyHasTypoLines(noteSession.content) && !likelyNeedsCorrection(span.text)) return;

  const minLen = 12;
  if (span.text.trim().length < minLen) return;
  if (!likelyNeedsCorrection(span.text)) return;
  if (aiQueue.aiLoading || aiQueue.proactiveLoading) return;

  const now = Date.now();
  const cooldown = 30000;
  const key = `${noteSession.selectedPath}:${span.start}:${span.end}:${span.text.trim()}`;
  if (now - memory.lastAt < cooldown && key === memory.lastKey) return;
  if (key === memory.lastKey && hasSuggestionForSpan(span)) return;
  if (hasSuggestionForSpan(span)) return;

  aiQueue.proactiveLoading = true;
  aiQueue.companionOpen = true;
  deps.proactiveStatus.value = "Vérification orthographique…";
  deps.setStatus(deps.proactiveStatus.value);
  const epoch = noteSession.aiEpoch;
  const pathAtStart = noteSession.selectedPath;

  const addSuggestion = (
    action: AiAction,
    label: string,
    proposed: string,
    reason?: string,
    scope = "passage en cours",
  ) => {
    if (!stillCurrentAiRequest(epoch, pathAtStart)) return;
    if (action !== "correct") return;
    if (!isFaithfulCorrection(span.text, proposed)) return;
    pushSuggestion({
      action: "correct",
      label,
      scope,
      source: "proactive",
      reason,
      proposedText: proposed,
      originalText: span.text,
      notePath: pathAtStart ?? undefined,
      selection: { start: span.start, end: span.end, text: span.text },
    });
    memory.lastKey = key;
    memory.lastAt = now;
    deps.proactiveStatus.value = "";
    deps.setStatus("Correction proposée — appliquez ou ignorez.");
  };

  try {
    if (deps.ollamaAvailable) {
      const result = await invoke<ProactiveSuggestionResponse>("ollama_proactive_suggest", {
        paragraph: span.text,
        noteExcerpt: noteSession.content.slice(0, 1500),
        noteContext: deps.noteContext.trim() || null,
        model: deps.activeModel,
      });

      if (!stillCurrentAiRequest(epoch, pathAtStart) || isAiQuiet()) return;

      if (result.suggest && result.proposed?.trim()) {
        const label = result.label?.toLowerCase() ?? "";
        if (label.includes("reform")) {
          memory.lastAt = now;
          deps.proactiveStatus.value = "";
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

    deps.proactiveStatus.value = bodyHasTypoLines(noteSession.content)
      ? "Certaines fautes nécessitent une correction manuelle."
      : "";
    deps.setStatus(deps.proactiveStatus.value);
    memory.lastAt = now;
  } catch (e) {
    deps.proactiveStatus.value = `Analyse indisponible : ${e}`;
    deps.setStatus(deps.proactiveStatus.value);
  } finally {
    aiQueue.proactiveLoading = false;
    if (!isAiQuiet()) deps.scheduleNoteScan(20000);
  }
}

export async function handleEditingIdle(
  deps: ProactiveScanDeps,
  span: ParagraphSpan,
): Promise<void> {
  if (!noteSession.selectedPath) return;

  if (deps.autoTypoFixEnabled && bodyHasTypoLines(noteSession.content)) {
    await deps.runBatchAutoTypoFix();
    return;
  }

  if (!deps.proactiveEnabled || isAiQuiet()) return;
  if (!likelyNeedsCorrection(span.text)) return;
  await processProactiveSpan(deps, span);
}
