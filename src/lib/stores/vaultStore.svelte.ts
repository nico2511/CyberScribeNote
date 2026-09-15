import { invoke } from "$lib/tauri/api";
import { notify } from "$lib/stores/notifications";
import { noteSession } from "$lib/stores/noteSession.svelte";
import type { VaultEntry } from "$lib/types";

export const vaultStore = $state({
  entries: [] as VaultEntry[],
  vaultPath: "",
  txtSyncEnabled: true,
});

export async function refreshVault(): Promise<void> {
  vaultStore.vaultPath = await invoke<string>("init_vault");
  try {
    const cfg = await invoke<{ txtSyncEnabled?: boolean }>("get_app_config");
    vaultStore.txtSyncEnabled = cfg.txtSyncEnabled !== false;
    if (vaultStore.txtSyncEnabled) {
      const created = await invoke<string[]>("sync_txt_notes");
      if (created.length) {
        notify({
          kind: "info",
          title: "TXT → Markdown",
          message:
            created.length === 1
              ? `Converti en .md (source .txt supprimée) : ${created[0]}`
              : `${created.length} fichiers .txt convertis en .md (sources .txt supprimées)`,
          key: "txt-sync",
        });
      }
    }
  } catch {
    /* sync optionnel */
  }
  vaultStore.entries = await invoke<VaultEntry[]>("list_vault");
}

export async function createNote(parentPath: string, name: string): Promise<string> {
  const path = await invoke<string>("create_note", { parentPath, name });
  await refreshVault();
  return path;
}

export async function createFolder(parentPath: string, name: string): Promise<void> {
  await invoke("create_folder", { parentPath, name });
  await refreshVault();
}

export async function deleteVaultItem(path: string): Promise<{ isNote: boolean; label: string }> {
  const isNote = path.toLowerCase().endsWith(".md");
  const label = path.split("/").pop() ?? path;
  await invoke("delete_item", { relativePath: path });
  if (noteSession.selectedPath === path) {
    noteSession.selectedPath = null;
    noteSession.content = "";
    noteSession.savedContent = "";
    noteSession.dirty = false;
  }
  await refreshVault();
  return { isNote, label };
}

export async function renameVaultNote(path: string, newName: string): Promise<string> {
  const newPath = await invoke<string>("rename_note", {
    relativePath: path,
    newName,
  });
  if (noteSession.selectedPath === path) {
    noteSession.selectedPath = newPath;
  }
  await refreshVault();
  return newPath;
}

export async function moveVaultItem(
  sourcePath: string,
  destinationParent: string,
): Promise<string> {
  const newPath = await invoke<string>("move_vault_item", {
    relativePath: sourcePath,
    destinationParent,
  });

  if (noteSession.selectedPath === sourcePath) {
    noteSession.selectedPath = newPath;
  } else if (noteSession.selectedPath?.startsWith(`${sourcePath}/`)) {
    noteSession.selectedPath = `${newPath}${noteSession.selectedPath.slice(sourcePath.length)}`;
  }

  await refreshVault();
  return newPath;
}
