import { invoke } from "$lib/tauri/api";
import {
  buildFolderSommaireMarkdown,
  findVaultEntry,
  sommairePathForFolder,
} from "$lib/vault/folderIndex";
import { parentPath } from "$lib/vault/tree";
import { refreshVault } from "$lib/stores/vaultStore.svelte";
import { loadNote } from "$lib/stores/noteSession.svelte";
import type { AiOrchestratorDeps } from "$lib/app/aiOrchestrator";
import type { VaultEntry } from "$lib/types";

function folderEntryForPath(entries: VaultEntry[], folderPath: string): VaultEntry | null {
  if (!folderPath) {
    return { name: "", path: "", isDir: true, children: entries };
  }
  const found = findVaultEntry(entries, folderPath);
  return found?.isDir ? found : null;
}

/** Crée ou met à jour `sommaire.md` dans le dossier de la note courante. */
export async function runFolderIndexSkill(deps: AiOrchestratorDeps): Promise<void> {
  if (!deps.selectedPath) {
    deps.setStatus("Ouvrez une note pour indexer son dossier.");
    return;
  }

  const folderPath = parentPath(deps.selectedPath);
  const entry = folderEntryForPath(deps.entries, folderPath);
  if (!entry) {
    deps.setStatus("Dossier introuvable dans le vault.");
    return;
  }

  const markdown = buildFolderSommaireMarkdown(folderPath, entry);

  const targetPath = sommairePathForFolder(folderPath);
  deps.setStatus("Indexation du dossier…");
  try {
    await invoke("write_note", { relativePath: targetPath, content: markdown });
    await refreshVault();
    if (deps.selectedPath === targetPath) {
      await loadNote(targetPath);
    }
    deps.setStatus(`Sommaire enregistré : ${targetPath}`);
  } catch (e) {
    deps.setStatus(`Indexation impossible : ${e}`);
  }
}
