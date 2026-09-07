<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";

  export interface NoteHistoryEntry {
    id: string;
    label: string;
    bytes: number;
  }

  interface Props {
    open: boolean;
    notePath: string;
    currentContent: string;
    onClose: () => void;
    onRestored: (content: string) => void;
  }

  let { open, notePath, currentContent, onClose, onRestored }: Props = $props();

  let versions = $state<NoteHistoryEntry[]>([]);
  let selectedId = $state<string | null>(null);
  let preview = $state("");
  let loading = $state(false);
  let error = $state("");
  let restoring = $state(false);

  async function loadList() {
    loading = true;
    error = "";
    try {
      versions = await invoke<NoteHistoryEntry[]>("list_note_history", {
        relativePath: notePath,
      });
      if (versions[0] && !selectedId) {
        await selectVersion(versions[0].id);
      } else if (!versions.length) {
        selectedId = null;
        preview = "";
      }
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  async function selectVersion(id: string) {
    selectedId = id;
    try {
      preview = await invoke<string>("read_note_version", {
        relativePath: notePath,
        versionId: id,
      });
    } catch (e) {
      preview = "";
      error = String(e);
    }
  }

  async function restore() {
    if (!selectedId) return;
    if (!confirm("Restaurer cette version ? La version actuelle sera archivée dans l'historique.")) {
      return;
    }
    restoring = true;
    error = "";
    try {
      const content = await invoke<string>("restore_note_version", {
        relativePath: notePath,
        versionId: selectedId,
      });
      onRestored(content);
      onClose();
    } catch (e) {
      error = String(e);
    } finally {
      restoring = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  $effect(() => {
    if (open && notePath) {
      selectedId = null;
      preview = "";
      void loadList();
    }
  });
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4"
    role="presentation"
    onclick={onClose}
  >
    <div
      class="flex h-[min(85vh,720px)] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-2xl"
      style:box-shadow="var(--shadow)"
      role="dialog"
      aria-modal="true"
      aria-label="Historique de la note"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={handleKeydown}
    >
      <header class="flex items-center justify-between border-b border-border px-4 py-3">
        <div class="min-w-0">
          <h2 class="text-sm font-semibold">Historique</h2>
          <p class="truncate text-[11px] text-text-muted" title={notePath}>{notePath}</p>
        </div>
        <button type="button" class="btn-ghost px-2 py-1 text-sm" onclick={onClose}>✕</button>
      </header>

      {#if error}
        <p class="border-b border-border bg-danger/10 px-4 py-2 text-xs text-danger">{error}</p>
      {/if}

      <div class="flex min-h-0 flex-1">
        <aside class="flex w-52 shrink-0 flex-col border-r border-border bg-surface-muted/50">
          <p class="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            Versions
          </p>
          <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {#if loading}
              <p class="px-2 text-xs text-text-muted">Chargement…</p>
            {:else if versions.length === 0}
              <p class="px-2 text-xs text-text-muted">
                Aucune version encore. Elles apparaissent après les prochaines sauvegardes.
              </p>
            {:else}
              {#each versions as v (v.id)}
                <button
                  type="button"
                  class="mb-0.5 w-full rounded-xl px-2 py-1.5 text-left text-xs transition {selectedId === v.id
                    ? 'bg-accent-lavender/35 font-medium'
                    : 'hover:bg-surface'}"
                  onclick={() => selectVersion(v.id)}
                >
                  <span class="block">{v.label}</span>
                  <span class="text-[10px] text-text-muted">{Math.round(v.bytes / 1024)} Ko</span>
                </button>
              {/each}
            {/if}
          </div>
        </aside>

        <div class="grid min-h-0 min-w-0 flex-1 grid-cols-2 gap-0">
          <section class="flex min-h-0 flex-col border-r border-border">
            <p class="border-b border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-accent-mint">
              Actuel
            </p>
            <pre
              class="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-relaxed text-text"
            >{currentContent}</pre>
          </section>
          <section class="flex min-h-0 flex-col">
            <p class="border-b border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-accent-blue">
              Version sélectionnée
            </p>
            <pre
              class="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-relaxed text-text"
            >{preview || "—"}</pre>
          </section>
        </div>
      </div>

      <footer class="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        <button type="button" class="btn-ghost border border-border px-3 py-1.5 text-xs" onclick={onClose}>
          Fermer
        </button>
        <button
          type="button"
          class="btn-primary px-4 py-1.5 text-xs disabled:opacity-40"
          disabled={!selectedId || restoring}
          onclick={restore}
        >
          {restoring ? "Restauration…" : "Restaurer cette version"}
        </button>
      </footer>
    </div>
  </div>
{/if}
