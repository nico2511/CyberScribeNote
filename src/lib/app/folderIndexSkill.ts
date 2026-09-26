import { invoke } from "$lib/tauri/api";
import { getSkill } from "$lib/ai/skills";
import { sanitizeAiOutput } from "$lib/ai/sanitize";
import {
  collectFolderInventory,
  findVaultEntry,
  formatFolderInventoryContext,
  sommaireMentionsInventory,
  sommairePathForFolder,
} from "$lib/vault/folderIndex";
import { parentPath } from "$lib/vault/tree";
import { refreshVault } from "$lib/stores/vaultStore.svelte";
import { loadNote } from "$lib/stores/noteSession.svelte";
import { aiQueue } from "$lib/stores/aiQueue.svelte";
import type { AiOrchestratorDeps } from "$lib/app/aiOrchestrator";
import type { VaultEntry } from "$lib/types";

function folderEntryForPath(entries: VaultEntry[], folderPath: string): VaultEntry | null {
  if (!folderPath) {
    return { name: "", path: "", isDir: true, children: entries };
  }
  const found = findVaultEntry(entries, folderPath);
  return found?.isDir ? found : null;
}

/**
 * Collecte l'inventaire du dossier en local, puis fait rédiger `sommaire.md` par Ollama.
 * Le Markdown mécanique n'est jamais enregistré à la place de la rédaction.
 */
export async function runFolderIndexSkill(deps: AiOrchestratorDeps): Promise<void> {
  const skill = getSkill("folderIndex");
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

  const inventory = collectFolderInventory(folderPath, entry);
  if (!inventory) {
    deps.setStatus(skill.emptyMessage);
    return;
  }

  if (!deps.ollamaAvailable) {
    const started = await deps.ensureOllamaRunning(true);
    if (!started) {
      deps.openSettings();
      deps.setStatus("Configurez ou démarrez Ollama dans les réglages.");
      return;
    }
  }

  if (!skill.llmInstruction) {
    deps.setStatus(skill.emptyMessage);
    return;
  }

  const targetPath = sommairePathForFolder(folderPath);
  aiQueue.aiLoading = true;
  deps.setStatus("Indexation du dossier — rédaction…");
  try {
    const result = await invoke<string>("ollama_custom_prompt", {
      instruction: skill.llmInstruction,
      content: formatFolderInventoryContext(inventory),
      model: deps.activeModel,
      noteContext: deps.noteContext.trim() || null,
      ragContext: null,
    });
    const markdown = sanitizeAiOutput(result, "custom").trim();
    if (!sommaireMentionsInventory(markdown, inventory)) {
      deps.setStatus("L'IA a dérivé — sommaire non enregistré.");
      return;
    }
    await invoke("write_note", { relativePath: targetPath, content: `${markdown}\n` });
    await refreshVault();
    if (deps.selectedPath === targetPath) {
      await loadNote(targetPath);
    }
    deps.setStatus(`Sommaire enregistré : ${targetPath}`);
  } catch (e) {
    deps.setStatus(`Erreur IA : ${e}`);
  } finally {
    aiQueue.aiLoading = false;
  }
}
