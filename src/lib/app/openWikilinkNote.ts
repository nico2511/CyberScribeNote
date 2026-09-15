import { notify } from "$lib/stores/notifications";
import { resolveWikilink } from "$lib/vault/wikilinks";
import type { VaultEntry } from "$lib/types";
import { openSearchPanel, runVaultSearch } from "$lib/stores/searchSession.svelte";

export type OpenNoteDeps = {
  entries: VaultEntry[];
  setStatus: (msg: string) => void;
  openNote: (path: string) => Promise<void>;
};

export async function openNoteByWikilinkQuery(query: string, deps: OpenNoteDeps): Promise<void> {
  const match = resolveWikilink(query, deps.entries);
  if (!match) {
    const msg = `Aucune note trouvée pour « ${query} ».`;
    deps.setStatus(msg);
    notify({ kind: "warning", title: "Scribe · ouvrir", message: msg, key: "voice-cmd" });
    openSearchPanel();
    await runVaultSearch(query);
    return;
  }
  await deps.openNote(match.path);
  deps.setStatus(`Note ouverte : ${match.title}`);
  notify({
    kind: "success",
    title: "Scribe · ouvrir",
    message: `Note ouverte : ${match.title}`,
    key: "voice-cmd",
  });
}
