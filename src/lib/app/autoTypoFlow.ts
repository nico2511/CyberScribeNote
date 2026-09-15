import { invoke } from "$lib/tauri/api";
import { autoFixAllTypoLines, lineNeedsAiTypoFix } from "$lib/ai/autoTypo";
import { buildAiProposal } from "$lib/ai/buildProposal";
import { finalizeCorrection } from "$lib/ai/localCorrect";
import { isFaithfulCorrection } from "$lib/ai/faithful";
import { hasMeaningfulDiff } from "$lib/ai/textDiff";
import { scanBodyTypoLines, bodyHasTypoLines } from "$lib/note/scanTypos";
import { mapCaretThroughReplace } from "$lib/note/caret";
import { replaceTextRange } from "$lib/voice/commands";
import type { ParagraphSpan } from "$lib/note/paragraph";
import { aiQueue } from "$lib/stores/aiQueue.svelte";
import { noteSession, persistNote } from "$lib/stores/noteSession.svelte";
import { voiceSession } from "$lib/stores/voiceSession.svelte";

export type AutoTypoFlowDeps = {
  enabled: boolean;
  activeModel: string;
  ollamaAvailable: boolean;
  ensureOllamaRunning: (silent?: boolean) => Promise<boolean>;
  getLastCaret: () => number;
  setLastCaret: (n: number) => void;
  setEditorCursor: (n: number | null) => void;
  scheduleAutoSave: () => void;
  scheduleFullTypoScan: (delayMs?: number) => void;
  scheduleNoteScan: (delayMs?: number) => void;
  showNotice: (detail: string) => void;
  proactiveStatus: { value: string };
};

let busy = false;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

export function createAutoTypoNotice(showStatus: (msg: string) => void, getStatus: () => string) {
  return (detail: string) => {
    showStatus(detail);
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      if (getStatus() === detail) showStatus("");
    }, 3500);
  };
}

function applyResult(
  deps: AutoTypoFlowDeps,
  next: string,
  editStart: number,
  editEnd: number,
  replacementLen: number,
  message: string,
) {
  const caret = mapCaretThroughReplace(deps.getLastCaret(), editStart, editEnd, replacementLen);
  noteSession.content = next;
  deps.setLastCaret(caret);
  deps.setEditorCursor(caret);
  noteSession.dirty = next !== noteSession.savedContent;
  deps.scheduleAutoSave();
  if (noteSession.selectedPath && noteSession.dirty) void persistNote(noteSession.selectedPath, next);
  deps.scheduleFullTypoScan(800);
  deps.scheduleNoteScan(8000);
  deps.showNotice(message);
}

async function tryAiAutoTypoFix(
  deps: AutoTypoFlowDeps,
  span: ParagraphSpan,
  baseContent?: string,
): Promise<boolean> {
  if (busy || !deps.enabled) return false;

  const body = baseContent ?? noteSession.content;
  const lineText = body.slice(span.start, span.end);
  if (!lineNeedsAiTypoFix(lineText)) return false;

  busy = true;
  try {
    if (!deps.ollamaAvailable) {
      const ok = await deps.ensureOllamaRunning(true);
      if (!ok) return false;
    }

    deps.showNotice("Analyse de la phrase pour corriger les fautes…");
    const corrected = await invoke<string>("ollama_transform_note", {
      action: "correct",
      content: lineText,
      model: deps.activeModel,
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

    applyResult(deps, next, span.start, span.end, proposal.length, "✓ Fautes corrigées (analyse de la phrase)");
    return true;
  } catch {
    return false;
  } finally {
    busy = false;
  }
}

async function runAiTypoFixPass(deps: AutoTypoFlowDeps, baseContent?: string): Promise<void> {
  if (!deps.enabled || !noteSession.selectedPath) return;

  for (let attempt = 0; attempt < 5; attempt++) {
    const body = baseContent ?? noteSession.content;
    const lines = scanBodyTypoLines(body).filter((line) => {
      const text = body.slice(line.start, line.end);
      return lineNeedsAiTypoFix(text);
    });
    if (!lines.length) break;

    const line = lines[0];
    const text = body.slice(line.start, line.end);
    const applied = await tryAiAutoTypoFix(deps, { ...line, text }, body);
    if (!applied) break;
    baseContent = noteSession.content;
  }
}

export async function runBatchAutoTypoFix(deps: AutoTypoFlowDeps): Promise<void> {
  if (!deps.enabled || !noteSession.selectedPath || busy) return;
  if (voiceSession.status.recording || voiceSession.status.transcribing) return;
  busy = true;

  try {
    aiQueue.aiSuggestions = aiQueue.aiSuggestions.filter(
      (s) => !(s.action === "correct" && s.source === "proactive"),
    );

    const before = noteSession.content;
    const caretBefore = deps.getLastCaret();
    const { content: next, count, caret } = autoFixAllTypoLines(noteSession.content, caretBefore);
    let working = noteSession.content;
    if (count > 0 && next !== before) {
      working = next;
      noteSession.content = next;
      deps.setLastCaret(caret);
      deps.setEditorCursor(caret);
      noteSession.dirty = next !== noteSession.savedContent;
      deps.scheduleAutoSave();
      if (noteSession.selectedPath) await persistNote(noteSession.selectedPath, next);
      deps.showNotice(
        `✓ ${count} faute${count > 1 ? "s" : ""} corrigée${count > 1 ? "s" : ""} automatiquement`,
      );
    }
    await runAiTypoFixPass(deps, working);
    deps.proactiveStatus.value = bodyHasTypoLines(noteSession.content)
      ? "Certaines fautes nécessitent une correction manuelle."
      : count > 0
        ? "Fautes corrigées."
        : "";
  } finally {
    busy = false;
  }
}

export function isAutoTypoBusy(): boolean {
  return busy;
}
