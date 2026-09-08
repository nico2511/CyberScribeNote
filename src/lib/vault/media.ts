import { convertFileSrc } from "@tauri-apps/api/core";

/** Chemins absolus / UNC interdits — lecture hors vault via asset://. */
function isAbsoluteOrUnc(href: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(href) || href.startsWith("\\\\") || href.startsWith("//");
}

/** Résout un href Markdown vers une URL affichable dans le webview Tauri (vault uniquement). */
export function resolveMediaUrl(href: string, notePath: string, vaultPath: string): string {
  const trimmed = href.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("asset://")) {
    return trimmed;
  }
  // data: URLs peuvent exfiltrer — refusées dans les notes
  if (trimmed.startsWith("data:")) {
    return "";
  }
  if (isAbsoluteOrUnc(trimmed)) {
    return "";
  }

  let relative = trimmed.replace(/^\.\//, "");

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

  if (relative.includes("..")) {
    return "";
  }

  const vaultNorm = vaultPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const absolute = `${vaultNorm}/${relative.replace(/\\/g, "/")}`;
  return convertFileSrc(absolute);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
