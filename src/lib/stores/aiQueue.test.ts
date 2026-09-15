import { beforeEach, describe, expect, it } from "vitest";
import {
  aiQueue,
  clearSuggestionsForNote,
  dismissSuggestion,
  editorHighlightFromSuggestions,
  isAiQuiet,
  pushSuggestion,
  resetAiQueue,
  silenceAiHelpers,
  stillCurrentAiRequest,
} from "./aiQueue.svelte";
import { noteSession } from "./noteSession.svelte";

describe("aiQueue", () => {
  beforeEach(() => {
    resetAiQueue();
    noteSession.selectedPath = "a.md";
    noteSession.aiEpoch = 1;
  });

  it("pushSuggestion assigns id and note path", () => {
    pushSuggestion({
      action: "correct",
      label: "Correction",
      scope: "note",
      proposedText: "fixed",
      originalText: "fix",
      source: "manual",
    });
    expect(aiQueue.aiSuggestions.length).toBe(1);
    expect(aiQueue.aiSuggestions[0].notePath).toBe("a.md");
    expect(aiQueue.aiSuggestions[0].id).toBeTruthy();
  });

  it("dismissSuggestion removes by id", () => {
    pushSuggestion({
      action: "correct",
      label: "x",
      scope: "note",
      proposedText: "a",
      originalText: "b",
      source: "manual",
      id: "test-id",
    });
    dismissSuggestion("test-id");
    expect(aiQueue.aiSuggestions).toHaveLength(0);
  });

  it("stillCurrentAiRequest tracks epoch and path", () => {
    expect(stillCurrentAiRequest(1, "a.md")).toBe(true);
    noteSession.aiEpoch = 2;
    expect(stillCurrentAiRequest(1, "a.md")).toBe(false);
  });

  it("silenceAiHelpers blocks proactive window", () => {
    silenceAiHelpers(5000);
    expect(isAiQuiet()).toBe(true);
  });

  it("editorHighlightFromSuggestions returns latest selection", () => {
    pushSuggestion({
      action: "correct",
      label: "x",
      scope: "sel",
      proposedText: "a",
      originalText: "b",
      source: "manual",
      selection: { start: 2, end: 5, text: "foo" },
    });
    expect(editorHighlightFromSuggestions()).toEqual({ start: 2, end: 5 });
  });

  it("clearSuggestionsForNote filters by path", () => {
    pushSuggestion({
      action: "correct",
      label: "x",
      scope: "note",
      proposedText: "a",
      originalText: "b",
      source: "manual",
      notePath: "a.md",
    });
    pushSuggestion({
      action: "correct",
      label: "y",
      scope: "note",
      proposedText: "c",
      originalText: "d",
      source: "manual",
      notePath: "b.md",
    });
    clearSuggestionsForNote("a.md");
    expect(aiQueue.aiSuggestions).toHaveLength(1);
    expect(aiQueue.aiSuggestions[0].notePath).toBe("b.md");
  });
});
