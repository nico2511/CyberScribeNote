import { noteSession } from "$lib/stores/noteSession.svelte";
import {
  pickImageFile,
  importImageFromPath as importImagePath,
  importPastedImageBytes,
  imageMarkdownForRelative,
  imageImportStatusMessage,
} from "$lib/app/noteImages";

export type NoteImageDeps = {
  setStatus: (msg: string) => void;
  queueMarkdown: (markdown: string, statusMsg: string) => void;
};

async function queueRelativeImage(relative: string, deps: NoteImageDeps): Promise<void> {
  deps.queueMarkdown(imageMarkdownForRelative(relative), imageImportStatusMessage(relative));
}

export async function importImageFromPathForNote(
  sourcePath: string,
  useGlobalMedia: boolean,
  deps: NoteImageDeps,
): Promise<void> {
  const relative = await importImagePath(sourcePath, noteSession.selectedPath, useGlobalMedia);
  await queueRelativeImage(relative, deps);
}

export async function importImagesFromPaths(paths: string[], deps: NoteImageDeps): Promise<void> {
  if (!noteSession.selectedPath) {
    deps.setStatus("Ouvrez une note pour y insérer une image.");
    return;
  }
  for (const sourcePath of paths) {
    await importImageFromPathForNote(sourcePath, false, deps);
  }
}

export async function importPastedImageForNote(
  base64: string,
  extension: string,
  deps: NoteImageDeps,
): Promise<void> {
  if (!noteSession.selectedPath) {
    deps.setStatus("Ouvrez une note pour y coller une image.");
    return;
  }
  const relative = await importPastedImageBytes(base64, extension, noteSession.selectedPath);
  await queueRelativeImage(relative, deps);
}

export async function insertImageFromPicker(deps: NoteImageDeps): Promise<void> {
  if (!noteSession.selectedPath) {
    deps.setStatus("Ouvrez une note pour y insérer une image.");
    return;
  }
  const sourcePath = await pickImageFile();
  if (!sourcePath) return;
  try {
    await importImageFromPathForNote(sourcePath, false, deps);
  } catch (e) {
    deps.setStatus(`Erreur image : ${e}`);
  }
}
