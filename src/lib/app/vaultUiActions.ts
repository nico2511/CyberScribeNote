import { notify } from "$lib/stores/notifications";
import {
  createFolder as createVaultFolder,
  createNote as createVaultNote,
  deleteVaultItem,
  moveVaultItem,
  renameVaultNote,
} from "$lib/stores/vaultStore.svelte";

export type VaultUiDeps = {
  setStatus: (msg: string) => void;
  openNote: (path: string) => Promise<void>;
};

export async function createNoteWithPrompt(
  parentPath: string,
  deps: VaultUiDeps,
): Promise<void> {
  const name = prompt("Nom de la note :");
  if (!name?.trim()) return;
  const path = await createVaultNote(parentPath, name.trim());
  await deps.openNote(path);
}

export async function createFolderWithPrompt(parentPath: string): Promise<void> {
  const name = prompt("Nom du dossier :");
  if (!name?.trim()) return;
  await createVaultFolder(parentPath, name.trim());
}

export async function deleteVaultPath(path: string, deps: VaultUiDeps): Promise<void> {
  const isNote = path.toLowerCase().endsWith(".md");
  const label = path.split("/").pop() ?? path;
  if (isNote) {
    if (
      !confirm(
        `Supprimer « ${label} » ?\n\nSi un fichier .txt / .text jumeau existe encore, il sera aussi supprimé.`,
      )
    ) {
      return;
    }
  } else if (!confirm(`Supprimer le dossier vide « ${label} » ?`)) {
    return;
  }
  try {
    const result = await deleteVaultItem(path);
    deps.setStatus(
      result.isNote ? `Note « ${result.label} » supprimée` : `Dossier « ${result.label} » supprimé`,
    );
  } catch (e) {
    deps.setStatus(String(e));
    notify({ kind: "error", title: "Suppression impossible", message: String(e), key: "vault-delete" });
  }
}

export async function renameVaultPath(path: string, deps: VaultUiDeps): Promise<void> {
  const current = path.split("/").pop()?.replace(/\.md$/, "") ?? "";
  const name = prompt("Nouveau nom de la note :", current);
  if (!name?.trim() || name.trim() === current) return;
  try {
    await renameVaultNote(path, name.trim());
    const msg = `Note renommée : ${name.trim()}`;
    deps.setStatus(msg);
    notify({ kind: "success", title: "Renommage", message: msg, key: "vault-rename" });
  } catch (e) {
    deps.setStatus(String(e));
    notify({ kind: "error", title: "Renommage impossible", message: String(e), key: "vault-rename" });
  }
}

export async function moveVaultPath(
  sourcePath: string,
  destinationParent: string,
  deps: VaultUiDeps,
): Promise<void> {
  try {
    await moveVaultItem(sourcePath, destinationParent);
    const msg = destinationParent
      ? `Déplacé dans « ${destinationParent} »`
      : "Déplacé à la racine du vault";
    deps.setStatus(msg);
    notify({ kind: "success", title: "Déplacement", message: msg, key: "vault-move" });
  } catch (e) {
    deps.setStatus(String(e));
    notify({ kind: "error", title: "Déplacement impossible", message: String(e), key: "vault-move" });
  }
}
