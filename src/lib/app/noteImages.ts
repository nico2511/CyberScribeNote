import { invoke } from "$lib/tauri/api";
import { open } from "@tauri-apps/plugin-dialog";

export function imageMarkdownForRelative(relative: string): string {
  const alt = relative.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "image";
  return `![${alt}](${relative})`;
}

export function imageImportStatusMessage(relative: string): string {
  return `Image copiée dans ${relative.includes("/_media/") || relative.startsWith("_media/") ? "le dossier de la note" : "media/"}.`;
}

export async function importImageFromPath(
  sourcePath: string,
  notePath: string | null,
  useGlobalMedia = false,
): Promise<string> {
  return invoke<string>("import_image", {
    sourcePath,
    notePath,
    useGlobalMedia,
  });
}

export async function importPastedImageBytes(
  base64: string,
  extension: string,
  notePath: string,
): Promise<string> {
  return invoke<string>("import_image_bytes", {
    dataBase64: base64,
    extension,
    notePath,
    useGlobalMedia: false,
  });
}

export async function pickImageFile(): Promise<string | null> {
  const picked = await open({
    multiple: false,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }],
  });
  if (!picked) return null;
  return typeof picked === "string" ? picked : picked;
}
