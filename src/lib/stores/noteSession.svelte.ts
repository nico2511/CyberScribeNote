import { invoke } from "@tauri-apps/api/core";
import { ensureVisibleContextBlock, touchUpdatedDate } from "$lib/note/frontmatter";

export const noteSession = $state({
  selectedPath: null as string | null,
  content: "",
  savedContent: "",
  dirty: false,
  saving: false,
  aiEpoch: 0,
  noteOpenedAt: 0,
});

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export async function persistNote(path: string, body: string): Promise<void> {
  noteSession.saving = true;
  try {
    const stamped = touchUpdatedDate(body);
    await invoke("write_note", { relativePath: path, content: stamped });
    noteSession.savedContent = stamped;
    noteSession.dirty = false;
    if (noteSession.selectedPath === path && stamped !== noteSession.content) {
      noteSession.content = stamped;
    }
  } finally {
    noteSession.saving = false;
  }
}

export async function loadNote(
  path: string,
  hooks?: {
    onBeforeSwitch?: () => void | Promise<void>;
    onLoaded?: () => void | Promise<void>;
  },
): Promise<void> {
  if (noteSession.selectedPath && noteSession.selectedPath !== path && noteSession.dirty) {
    await persistNote(noteSession.selectedPath, noteSession.content);
  }
  await hooks?.onBeforeSwitch?.();

  noteSession.aiEpoch += 1;
  noteSession.noteOpenedAt = Date.now();

  noteSession.selectedPath = path;
  const raw = await invoke<string>("read_note", { relativePath: path });
  noteSession.content = ensureVisibleContextBlock(raw);
  noteSession.savedContent = noteSession.content;
  noteSession.dirty = false;

  if (noteSession.content !== raw) {
    await persistNote(path, noteSession.content);
  }

  await hooks?.onLoaded?.();
}

export function scheduleNoteAutoSave(onSave: () => void, delayMs = 1200): void {
  if (!noteSession.selectedPath) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (noteSession.dirty && noteSession.selectedPath) onSave();
  }, delayMs);
}

export function noteContentChange(value: string, onDirty: () => void): void {
  noteSession.content = value;
  noteSession.dirty = value !== noteSession.savedContent;
  onDirty();
}

export function resetNoteSession(): void {
  noteSession.selectedPath = null;
  noteSession.content = "";
  noteSession.savedContent = "";
  noteSession.dirty = false;
  noteSession.saving = false;
}
