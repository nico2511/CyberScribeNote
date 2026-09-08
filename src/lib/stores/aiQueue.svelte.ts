import type { AiSuggestion } from "$lib/types";
import { noteSession } from "$lib/stores/noteSession.svelte";

export const aiQueue = $state({
  aiLoading: false,
  aiSuggestions: [] as AiSuggestion[],
  proactiveLoading: false,
  companionOpen: false,
});

let aiQuietUntil = 0;

export function silenceAiHelpers(ms = 90000): void {
  aiQuietUntil = Date.now() + ms;
}

export function isAiQuiet(): boolean {
  return Date.now() < aiQuietUntil;
}

export function pushSuggestion(
  partial: Omit<AiSuggestion, "id"> & { id?: string },
): void {
  const path = partial.notePath ?? noteSession.selectedPath ?? undefined;
  const suggestion: AiSuggestion = {
    id: partial.id ?? crypto.randomUUID(),
    ...partial,
    notePath: path,
  };
  aiQueue.aiSuggestions = [
    suggestion,
    ...aiQueue.aiSuggestions.filter((s) => !s.notePath || s.notePath === path),
  ].slice(0, 12);
}

export function dismissSuggestion(id: string): void {
  aiQueue.aiSuggestions = aiQueue.aiSuggestions.filter((s) => s.id !== id);
}

export function clearSuggestionsForNote(path: string | null): void {
  if (!path) {
    aiQueue.aiSuggestions = [];
    return;
  }
  aiQueue.aiSuggestions = aiQueue.aiSuggestions.filter((s) => s.notePath && s.notePath !== path);
}

export function editorHighlightFromSuggestions(): { start: number; end: number } | null {
  const latest = aiQueue.aiSuggestions.find((s) => s.selection);
  if (!latest?.selection) return null;
  return { start: latest.selection.start, end: latest.selection.end };
}

export function stillCurrentAiRequest(epoch: number, pathAtStart: string | null): boolean {
  return epoch === noteSession.aiEpoch && noteSession.selectedPath === pathAtStart;
}

export function resetAiQueue(): void {
  aiQueue.aiSuggestions = [];
  aiQueue.aiLoading = false;
  aiQueue.proactiveLoading = false;
  aiQuietUntil = 0;
}
