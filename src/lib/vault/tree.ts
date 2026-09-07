import type { VaultEntry } from "$lib/types";

export interface VaultDragPayload {
  path: string;
  isDir: boolean;
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

/** Nom fichier seul, pour libellés UI. */
export function vaultItemName(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "");
}

/** Nombre de notes (.md) sous une entrée dossier (récursif). */
export function countNotesInFolder(entry: VaultEntry): number {
  if (!entry.isDir) return 0;
  let n = 0;
  for (const child of entry.children ?? []) {
    if (child.isDir) n += countNotesInFolder(child);
    else n += 1;
  }
  return n;
}
