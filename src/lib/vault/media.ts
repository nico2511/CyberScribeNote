import { convertFileSrc } from "@tauri-apps/api/core";

/** Résout un href Markdown vers une URL affichable dans le webview Tauri. */
export function resolveMediaUrl(href: string, notePath: string, vaultPath: string): string {
  const trimmed = href.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("data:") || trimmed.startsWith("asset://")) {
    return trimmed;
  }

  let relative = trimmed.replace(/^\.\//, "");

  if (/^[a-zA-Z]:[\\/]/.test(relative) || relative.startsWith("\\\\")) {
    return convertFileSrc(relative.replace(/\\/g, "/"));
  }

  const noteDir = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";
  const vaultRelative =
    relative.startsWith("media/") ||
    relative.startsWith("assets/") ||
    relative.includes("/_media/") ||
    relative.startsWith("_media/");

  if (!vaultRelative) {
    relative = noteDir ? `${noteDir}/${relative}` : relative;
  } else if (relative.startsWith("_media/") && noteDir) {
    relative = `${noteDir}/${relative}`;
  }

  const absolute = `${vaultPath.replace(/\\/g, "/")}/${relative.replace(/\\/g, "/")}`;
  return convertFileSrc(absolute);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
