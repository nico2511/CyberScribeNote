<script lang="ts">
  import VaultTree from "./VaultTree.svelte";
  import PixelIcon from "./PixelIcon.svelte";
  import type { VaultEntry } from "$lib/types";
  import { APP_VERSION } from "$lib/version";
  import { canMoveVaultItem, type VaultDragPayload } from "$lib/vault/tree";
  import { openUrl } from "@tauri-apps/plugin-opener";

  interface Props {
    entries: VaultEntry[];
    vaultPath: string;
    selectedPath: string | null;
    onSelect: (path: string) => void;
    onRefresh: () => void;
    onCreateNote: (parentPath: string) => void;
    onCreateFolder: (parentPath: string) => void;
    onDelete: (path: string) => void;
    onMove: (sourcePath: string, destinationParent: string) => void | Promise<void>;
    onImportText?: () => void | Promise<void>;
  }

  let {
    entries,
    vaultPath,
    selectedPath,
    onSelect,
    onRefresh,
    onCreateNote,
    onCreateFolder,
    onDelete,
    onMove,
    onImportText,
  }: Props = $props();

  let dragActive = $state(false);
  let draggingItem = $state<VaultDragPayload | null>(null);
  let dropTarget = $state<string | null>(null);

  const REPO_URL = "https://github.com/nico2511/CyberScribeNote";

  function handleDragStart(payload: VaultDragPayload) {
    draggingItem = payload;
    dragActive = true;
  }

  function handleDragEnd() {
    draggingItem = null;
    dragActive = false;
    dropTarget = null;
  }
</script>

<aside class="flex h-full w-64 shrink-0 flex-col overflow-hidden rounded-3xl border border-border bg-surface-muted shadow-sm">
  <div class="flex items-center justify-between border-b border-border px-4 py-3">
    <div>
      <h1 class="text-sm font-semibold tracking-tight">CyberScribeNote</h1>
      <p class="text-xs text-text-muted">Vault local · v{APP_VERSION}</p>
    </div>
    <PixelIcon name="note" size={16} class="rounded-lg bg-accent-lavender/30 p-1 text-text" />
  </div>

  <div class="flex flex-wrap gap-1 border-b border-border px-3 py-2">
    <button
      type="button"
      class="btn-primary flex-1 px-2 py-1.5 text-xs font-semibold"
      onclick={() => onCreateNote("")}
    >
      + Note
    </button>
    <button
      type="button"
      class="btn-secondary flex-1 px-2 py-1.5 text-xs font-medium"
      onclick={() => onCreateFolder("")}
    >
      + Dossier
    </button>
    {#if onImportText}
      <button
        type="button"
        class="btn-ghost rounded-2xl px-2 py-1.5 text-xs"
        title="Importer des .txt (ex. Nextcloud) → .md"
        onclick={() => onImportText()}
      >
        .txt
      </button>
    {/if}
    <button
      type="button"
      class="btn-ghost rounded-2xl px-2 py-1.5 text-xs"
      title="Actualiser"
      onclick={onRefresh}
    >
      ↻
    </button>
  </div>

  <div class="flex-1 overflow-y-auto px-2 py-2">
    {#if dragActive}
      <div
        role="status"
        data-drop-root="1"
        aria-label="Déposer à la racine du vault"
        class="mb-2 rounded-xl border border-dashed px-3 py-2 text-center text-[11px] transition {dropTarget === ''
          ? 'border-accent-lavender bg-accent-lavender/20 text-text'
          : 'border-border text-text-muted'}"
      >
        Déposer à la racine
      </div>
    {/if}

    {#if entries.length === 0}
      <p class="px-2 py-4 text-center text-xs text-text-muted">Aucune note. Créez-en une !</p>
    {:else}
      <VaultTree
        {entries}
        {selectedPath}
        {onSelect}
        {onCreateNote}
        {onCreateFolder}
        {onDelete}
        {onMove}
        {draggingItem}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        {dropTarget}
        onDropTargetChange={(target) => (dropTarget = target)}
      />
    {/if}
  </div>

  <div class="space-y-1 border-t border-border px-3 py-2">
    <p class="truncate text-[10px] text-text-muted" title={vaultPath}>{vaultPath}</p>
    <button
      type="button"
      class="text-[10px] text-accent-blue underline-offset-2 hover:underline"
      onclick={() => openUrl(REPO_URL)}
    >
      GitHub · dépôt
    </button>
  </div>
</aside>
