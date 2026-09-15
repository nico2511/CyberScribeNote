import type { VaultEntry } from "$lib/types";
import { countNotesInFolder, vaultItemName } from "$lib/vault/tree";
import { noteStem } from "$lib/vault/wikilinks";

export const FOLDER_SOMMAIRE_FILE = "sommaire.md";

export function sommairePathForFolder(folderPath: string): string {
  return folderPath ? `${folderPath}/${FOLDER_SOMMAIRE_FILE}` : FOLDER_SOMMAIRE_FILE;
}

/** Cherche une entrée par chemin relatif dans l'arbre vault. */
export function findVaultEntry(entries: VaultEntry[], relativePath: string): VaultEntry | null {
  for (const e of entries) {
    if (e.path === relativePath) return e;
    if (e.isDir && e.children?.length) {
      const found = findVaultEntry(e.children, relativePath);
      if (found) return found;
    }
  }
  return null;
}

/** Wikilink relatif (chemin sans `.md`). */
export function wikilinkPath(noteRelativePath: string): string {
  return noteRelativePath.replace(/\.md$/i, "");
}

/**
 * Génère le Markdown de `sommaire.md` pour un dossier (enfants directs).
 * Retourne null si le dossier ne contient ni note (hors sommaire) ni sous-dossier.
 */
export function buildFolderSommaireMarkdown(folderPath: string, entry: VaultEntry): string | null {
  const folderLabel = folderPath ? vaultItemName(folderPath) : "Racine";
  const sommairePath = sommairePathForFolder(folderPath);
  const children = entry.children ?? [];

  const notes: string[] = [];
  const subdirs: { path: string; label: string; count: number }[] = [];

  for (const child of children) {
    if (child.isDir) {
      subdirs.push({
        path: child.path,
        label: vaultItemName(child.path),
        count: countNotesInFolder(child),
      });
    } else if (child.path.toLowerCase().endsWith(".md") && child.path !== sommairePath) {
      notes.push(child.path);
    }
  }

  if (notes.length === 0 && subdirs.length === 0) {
    return buildEmptyFolderSommaire(folderPath);
  }

  notes.sort((a, b) => noteStem(a).localeCompare(noteStem(b), "fr"));
  subdirs.sort((a, b) => a.label.localeCompare(b.label, "fr"));

  const lines: string[] = [
    `# Sommaire · ${folderLabel}`,
    "",
    "> Index des notes de ce dossier (généré par CyberScribe).",
    "",
  ];

  if (notes.length) {
    lines.push("## Notes", "");
    for (const p of notes) {
      lines.push(`- [[${wikilinkPath(p)}]]`);
    }
    lines.push("");
  }

  if (subdirs.length) {
    lines.push("## Sous-dossiers", "");
    for (const d of subdirs) {
      const subSommaire = wikilinkPath(sommairePathForFolder(d.path));
      const countLabel = `${d.count} note${d.count === 1 ? "" : "s"}`;
      lines.push(`- [[${subSommaire}]] — ${countLabel}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

/** Sommaire minimal quand le dossier n'a plus de notes indexables. */
export function buildEmptyFolderSommaire(folderPath: string): string {
  const folderLabel = folderPath ? vaultItemName(folderPath) : "Racine";
  return `# Sommaire · ${folderLabel}\n\n> Aucune note dans ce dossier (index CyberScribe).\n\n`;
}
