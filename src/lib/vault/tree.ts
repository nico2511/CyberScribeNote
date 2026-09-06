export const VAULT_DRAG_MIME = "application/x-cyberscribe-vault-path";

export interface VaultDragPayload {
  path: string;
  isDir: boolean;
}

export function setVaultDragData(e: DragEvent, payload: VaultDragPayload) {
  const json = JSON.stringify(payload);
  e.dataTransfer?.setData(VAULT_DRAG_MIME, json);
  // Fallbacks WebView2 / Chromium : custom MIME seul est parfois ignoré
  e.dataTransfer?.setData("text/plain", payload.path);
  e.dataTransfer?.setData("text/uri-list", `vault://${payload.path}`);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}

export function readVaultDragData(e: DragEvent): VaultDragPayload | null {
  const raw = e.dataTransfer?.getData(VAULT_DRAG_MIME);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as VaultDragPayload;
      if (parsed.path && typeof parsed.isDir === "boolean") return parsed;
    } catch {
      /* fall through */
    }
  }
  const plain = e.dataTransfer?.getData("text/plain")?.trim();
  if (plain && !plain.includes("\n") && plain.length < 500) {
    return { path: plain.replace(/\\/g, "/"), isDir: false };
  }
  return null;
}

export function parentPath(relativePath: string): string {
  const idx = relativePath.lastIndexOf("/");
  return idx === -1 ? "" : relativePath.slice(0, idx);
}

export function canMoveVaultItem(source: VaultDragPayload, destinationParent: string): boolean {
  if (parentPath(source.path) === destinationParent) return false;
  if (source.isDir) {
    if (destinationParent === source.path || destinationParent.startsWith(`${source.path}/`)) {
      return false;
    }
  }
  return true;
}
