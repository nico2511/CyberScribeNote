import { open, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "$lib/tauri/api";
import { notify } from "$lib/stores/notifications";
import { refreshVault } from "$lib/stores/vaultStore.svelte";
import { noteSession } from "$lib/stores/noteSession.svelte";

export type NoteIoDeps = {
  setStatus: (msg: string) => void;
  openNote: (path: string) => Promise<void>;
};

export async function exportCurrentNote(deps: NoteIoDeps): Promise<void> {
  if (!noteSession.selectedPath) return;
  const dest = await save({
    defaultPath: noteSession.selectedPath.split("/").pop() ?? "note.md",
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!dest) return;
  await invoke("export_note", { relativePath: noteSession.selectedPath, destination: dest });
  deps.setStatus("Note exportée.");
}

const IMPORT_CONFIRM =
  "Les fichiers sélectionnés seront importés comme notes Markdown (.md) dans le vault.\n\n" +
  "Les fichiers .txt déjà présents dans le vault sont convertis en .md puis le .txt source est supprimé automatiquement (Sync TXT).\n\n" +
  "Les fichiers externes choisis ici restent intacts hors du vault — seule une copie .md est créée.\n\nContinuer ?";

export async function importTextFilesAsNotes(deps: NoteIoDeps): Promise<void> {
  const picked = await open({
    multiple: true,
    filters: [{ name: "Texte / Markdown", extensions: ["txt", "text", "md"] }],
    title: "Importer des notes (.txt → .md)",
  });
  if (!picked) return;
  const paths = Array.isArray(picked) ? picked : [picked];
  if (!confirm(IMPORT_CONFIRM)) return;
  try {
    const created = await invoke<string[]>("import_text_files", {
      paths,
      parentPath: "",
    });
    await refreshVault();
    const msg =
      created.length === 1
        ? `Importé en Markdown : ${created[0]}`
        : `${created.length} notes importées en .md`;
    deps.setStatus(msg);
    notify({ kind: "success", title: "Import TXT → MD", message: msg, key: "import-txt" });
    if (created[0]) await deps.openNote(created[0]);
  } catch (e) {
    deps.setStatus(String(e));
    notify({ kind: "error", title: "Import", message: String(e), key: "import-txt" });
  }
}
