import { fetchRagContext } from "$lib/ai/rag";
import {
  moodFromActivity,
  scanBuddyTip,
  type BuddyAction,
  type BuddyMood,
  type BuddyTip,
} from "$lib/ai/scribeBuddy";
import { noteBody } from "$lib/note/frontmatter";
import { aiQueue } from "$lib/stores/aiQueue.svelte";
import { noteSession } from "$lib/stores/noteSession.svelte";
import { saveBuddyEnabled, loadBuddyEnabled } from "$lib/stores/companion";
import type { SkillId } from "$lib/ai/skills";

export const buddySession = $state({
  enabled: true,
  typing: false,
  tip: null as BuddyTip | null,
  dismissedId: null as string | null,
  hasRelated: false,
});

let typingTimer: ReturnType<typeof setTimeout> | null = null;
let scanTimer: ReturnType<typeof setTimeout> | null = null;
let relatedTimer: ReturnType<typeof setTimeout> | null = null;

export function initBuddyFromStorage(): void {
  buddySession.enabled = loadBuddyEnabled();
}

export function resolveBuddyMood(): BuddyMood {
  if (!buddySession.enabled) return "idle";
  if (
    buddySession.tip &&
    !buddySession.typing &&
    !(aiQueue.aiLoading || aiQueue.proactiveLoading)
  ) {
    return buddySession.tip.mood;
  }
  return moodFromActivity(
    buddySession.typing,
    aiQueue.aiLoading || aiQueue.proactiveLoading,
  );
}

export function refreshBuddyTip(selectionText?: string | null): void {
  if (!buddySession.enabled || !noteSession.selectedPath) {
    buddySession.tip = null;
    return;
  }
  if (scanTimer) clearTimeout(scanTimer);
  const run = () => {
    const tip = scanBuddyTip({
      markdown: noteBody(noteSession.content),
      typing: buddySession.typing,
      busy: aiQueue.aiLoading || aiQueue.proactiveLoading,
      hasSuggestions: aiQueue.aiSuggestions.some(
        (s) => !s.notePath || s.notePath === noteSession.selectedPath,
      ),
      noteOpen: !!noteSession.selectedPath,
      hasRelated: buddySession.hasRelated,
      selectionText: selectionText ?? undefined,
    });
    if (
      tip &&
      tip.id === buddySession.dismissedId &&
      tip.id !== "typing" &&
      tip.id !== "busy"
    ) {
      buddySession.tip = { ...tip, message: tip.mood === "listen" ? tip.message : "" };
      return;
    }
    if (tip && tip.id !== buddySession.dismissedId) {
      buddySession.dismissedId = null;
    }
    buddySession.tip = tip;
  };
  if (buddySession.typing || aiQueue.aiLoading || aiQueue.proactiveLoading) run();
  else {
    scanTimer = setTimeout(run, 450);
    scheduleBuddyRelatedCheck();
  }
}

export function bumpBuddyTyping(onRefresh: () => void): void {
  if (!buddySession.enabled) return;
  buddySession.typing = true;
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    buddySession.typing = false;
    onRefresh();
  }, 1100);
  onRefresh();
}

export function scheduleBuddyRelatedCheck(): void {
  if (!buddySession.enabled || !noteSession.selectedPath) return;
  const body = noteBody(noteSession.content).trim();
  if (body.length < 120) {
    buddySession.hasRelated = false;
    return;
  }
  if (relatedTimer) clearTimeout(relatedTimer);
  const path = noteSession.selectedPath;
  relatedTimer = setTimeout(async () => {
    try {
      const rag = await fetchRagContext(body.slice(0, 800), path);
      if (noteSession.selectedPath !== path) return;
      const next = rag.length > 80;
      if (next !== buddySession.hasRelated) {
        buddySession.hasRelated = next;
        refreshBuddyTip();
      }
    } catch {
      buddySession.hasRelated = false;
    }
  }, 2800);
}

export function setBuddyEnabled(enabled: boolean): void {
  buddySession.enabled = enabled;
  saveBuddyEnabled(enabled);
  if (!enabled) {
    buddySession.tip = null;
    buddySession.typing = false;
  } else {
    refreshBuddyTip();
  }
}

export function dismissBuddyTip(): void {
  if (buddySession.tip) buddySession.dismissedId = buddySession.tip.id;
  buddySession.tip = null;
}

export function handleBuddyAction(
  action: BuddyAction,
  hooks: {
    openCompanion: () => void;
    runSkill: (id: SkillId) => void;
    /** Plan multi-skills. Sans ce hook, seule la première skill part. */
    runSkillPlan?: (ids: SkillId[]) => void;
  },
): void {
  if (action.kind === "dismiss") {
    dismissBuddyTip();
    return;
  }
  if (action.kind === "open_companion") {
    hooks.openCompanion();
    return;
  }
  if (action.kind === "skill_plan") {
    hooks.openCompanion();
    if (hooks.runSkillPlan) hooks.runSkillPlan(action.skillIds);
    else if (action.skillIds[0]) hooks.runSkill(action.skillIds[0]);
    return;
  }
  if (action.kind === "skill") {
    hooks.openCompanion();
    hooks.runSkill(action.skillId);
  }
}

export function clearBuddyTimers(): void {
  if (typingTimer) clearTimeout(typingTimer);
  if (scanTimer) clearTimeout(scanTimer);
  if (relatedTimer) clearTimeout(relatedTimer);
}
