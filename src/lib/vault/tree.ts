export const VAULT_DRAG_MIME = "application/x-cyberscribe-vault-path";

export interface VaultDragPayload {
  path: string;
  isDir: boolean;
}

export function setVaultDragData(e: DragEvent, payload: VaultDragPayload) {
  e.dataTransfer?.setData(VAULT_DRAG_MIME, JSON.stringify(payload));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}

export function readVaultDragData(e: DragEvent): VaultDragPayload | null {
  const raw = e.dataTransfer?.getData(VAULT_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as VaultDragPayload;
    if (!parsed.path || typeof parsed.isDir !== "boolean") return null;
    return parsed;
  } catch {
    return null;
  }
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
