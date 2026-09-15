import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { resetInvokeImpl, setInvokeImpl } from "$lib/tauri/api";
import {
  noteSession,
  noteContentChange,
  resetNoteSession,
  scheduleNoteAutoSave,
} from "./noteSession.svelte";

describe("noteSession", () => {
  beforeEach(() => {
    resetInvokeImpl();
    resetNoteSession();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("noteContentChange marks dirty when content differs from saved", () => {
    noteSession.savedContent = "hello";
    noteContentChange("hello world", () => {});
    expect(noteSession.dirty).toBe(true);
    expect(noteSession.content).toBe("hello world");
  });

  it("scheduleNoteAutoSave fires when dirty", async () => {
    noteSession.selectedPath = "a.md";
    noteSession.content = "x";
    noteSession.savedContent = "";
    noteSession.dirty = true;
    const onSave = vi.fn();
    scheduleNoteAutoSave(onSave, 100);
    vi.advanceTimersByTime(150);
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("loadNote invokes read_note and sets content", async () => {
    setInvokeImpl(
      (async (cmd, args) => {
        if (cmd === "read_note") {
          expect(args).toEqual({ relativePath: "notes/x.md" });
          return "# Title\n\nBody";
        }
        if (cmd === "write_note") return undefined;
        throw new Error(cmd);
      }) as typeof tauriInvoke,
    );
    const { loadNote } = await import("./noteSession.svelte");
    await loadNote("notes/x.md");
    expect(noteSession.selectedPath).toBe("notes/x.md");
    expect(noteSession.content).toContain("Body");
    expect(noteSession.dirty).toBe(false);
  });
});
