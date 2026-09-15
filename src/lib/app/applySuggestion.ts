import { formatSummaryAppendix } from "$lib/ai/languages";
import { parseTagsProposal } from "$lib/ai/skills";
import { repairCorruptedWikilinkMarkdown, mergeBodyMarkdown } from "$lib/markdown/bridge";
import { setFrontmatterTags } from "$lib/note/frontmatter";
import { replaceTextRange } from "$lib/voice/commands";
import { aiQueue } from "$lib/stores/aiQueue.svelte";
import { noteSession } from "$lib/stores/noteSession.svelte";
import type { BuddyTip } from "$lib/ai/scribeBuddy";

export type ApplySuggestionDeps = {
  onContentChange: (next: string) => void;
  setEditorCursor: (n: number | null) => void;
  silenceAiHelpers: (ms: number) => void;
  setStatus: (msg: string) => void;
  buddyEnabled: boolean;
  onBuddyApplied: (tip: BuddyTip) => void;
  refreshBuddyTip: () => void;
};

export function applySuggestion(deps: ApplySuggestionDeps, id: string): void {
  const suggestion = aiQueue.aiSuggestions.find((s) => s.id === id);
  if (!suggestion) return;
  if (
    suggestion.notePath &&
    noteSession.selectedPath &&
    suggestion.notePath !== noteSession.selectedPath
  ) {
    aiQueue.aiSuggestions = aiQueue.aiSuggestions.filter((s) => s.id !== id);
    deps.setStatus("Suggestion d'une autre note — ignorée.");
    return;
  }

  deps.silenceAiHelpers(
    suggestion.action === "translate" ||
      suggestion.action === "reformulate" ||
      suggestion.action === "custom"
      ? 120000
      : 60000,
  );

  if (suggestion.applyMode === "tags" || suggestion.skillId === "tags") {
    const tags = parseTagsProposal(suggestion.proposedText);
    if (!tags.length) {
      deps.setStatus("Aucun tag valide à appliquer.");
      return;
    }
    deps.onContentChange(setFrontmatterTags(noteSession.content, tags));
    aiQueue.aiSuggestions = aiQueue.aiSuggestions.filter((s) => s.id !== id);
    if (deps.buddyEnabled) {
      deps.onBuddyApplied({
        id: "applied",
        mood: "ok",
        message: `Tags : ${tags.join(", ")}`,
        priority: 95,
      });
      setTimeout(() => deps.refreshBuddyTip(), 1800);
    }
    deps.setStatus("Tags appliqués au frontmatter.");
    return;
  }

  if (suggestion.applyMode === "append" || suggestion.action === "summarize") {
    const raw = repairCorruptedWikilinkMarkdown(suggestion.proposedText.trim());
    const block = /^##\s+/.test(raw)
      ? `\n\n---\n\n${raw}\n`
      : formatSummaryAppendix(raw, suggestion.label || "Résumé");
    deps.setEditorCursor(noteSession.content.length + block.length);
    deps.onContentChange(noteSession.content + block);
  } else if (suggestion.selection) {
    const start = suggestion.selection.start;
    const proposed = suggestion.proposedText;
    deps.onContentChange(
      replaceTextRange(noteSession.content, start, suggestion.selection.end, proposed),
    );
    deps.setEditorCursor(start + proposed.length);
  } else if (
    suggestion.action === "translate" ||
    suggestion.action === "reformulate" ||
    suggestion.action === "correct" ||
    suggestion.action === "custom"
  ) {
    const next = mergeBodyMarkdown(noteSession.content, suggestion.proposedText.trim() + "\n");
    deps.setEditorCursor(Math.min(next.length, Math.max(1, suggestion.proposedText.length)));
    deps.onContentChange(next);
  } else {
    deps.onContentChange(suggestion.proposedText);
    deps.setEditorCursor(Math.min(suggestion.proposedText.length, noteSession.content.length));
  }

  aiQueue.aiSuggestions = aiQueue.aiSuggestions.filter((s) => s.id !== id);
  if (deps.buddyEnabled) {
    deps.onBuddyApplied({
      id: "applied",
      mood: "ok",
      message: "C'est noté.",
      priority: 95,
    });
    setTimeout(() => deps.refreshBuddyTip(), 1800);
  }
  deps.setStatus(
    suggestion.action === "summarize" ? "Résumé ajouté en fin de note." : "Suggestion appliquée.",
  );
}
