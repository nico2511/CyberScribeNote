<script lang="ts">
  import VaultTree from "./VaultTree.svelte";
  import PixelIcon from "./PixelIcon.svelte";
  import type { VaultEntry } from "$lib/types";
  import { APP_VERSION } from "$lib/version";
  import { canMoveVaultItem, readVaultDragData, type VaultDragPayload } from "$lib/vault/tree";
  import { getActiveVaultDrag } from "$lib/vault/activeDrag";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { APP_REPO_URL } from "$lib/version";

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
  }: Props = $props();

  let dragActive = $state(false);
  let draggingItem = $state<VaultDragPayload | null>(null);
  let dropTarget = $state<string | null>(null);

  function handleDragStart(payload: VaultDragPayload) {
    draggingItem = payload;
    dragActive = true;
  }

  function handleDragEnd() {
    draggingItem = null;
    dragActive = false;
    dropTarget = null;
  }

  function handleRootDragOver(e: DragEvent) {
    const source = draggingItem ?? getActiveVaultDrag();
    if (!source || !canMoveVaultItem(source, "")) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    dropTarget = "";
  }

  async function handleRootDrop(e: DragEvent) {
    e.preventDefault();
    const source = readVaultDragData(e) ?? draggingItem ?? getActiveVaultDrag();
    handleDragEnd();
    if (!source || !canMoveVaultItem(source, "")) return;
    await onMove(source.path, "");
  }

  async function openRepo() {
    try {
      await openUrl(APP_REPO_URL);
    } catch {
      /* ignore */
    }
  }
</script>

<aside class="flex h-full w-64 shrink-0 flex-col border-r border-border bg-surface-muted">
  <div class="flex items-center justify-between border-b border-border px-4 py-3">
    <div>
      <h1 class="text-sm font-semibold tracking-tight">CyberScribeNote</h1>
      <p class="text-xs text-text-muted">Vault local · v{APP_VERSION}</p>
    </div>
    <PixelIcon name="note" size={16} class="sidebar-icon rounded-lg bg-surface p-1 text-text" />
  </div>

  <div class="flex gap-1 border-b border-border px-3 py-2">
    <button
      type="button"
      class="flex-1 rounded-xl bg-accent-mint/40 px-2 py-1.5 text-xs font-medium transition hover:bg-accent-mint/60"
      onclick={() => onCreateNote("")}
    >
      + Note
    </button>
    <button
      type="button"
      class="flex-1 rounded-xl bg-accent-blue/30 px-2 py-1.5 text-xs font-medium transition hover:bg-accent-blue/50"
      onclick={() => onCreateFolder("")}
    >
      + Dossier
    </button>
    <button
      type="button"
      class="rounded-xl px-2 py-1.5 text-xs text-text-muted transition hover:bg-surface"
      title="Actualiser"
      onclick={onRefresh}
    >
      ↻
    </button>
  </div>

  <div class="flex-1 overflow-y-auto px-2 py-2">
    {#if dragActive}
      <div
        role="button"
        tabindex="-1"
        aria-label="Déposer à la racine du vault"
        class="mb-2 rounded-xl border border-dashed px-3 py-2 text-center text-[11px] transition {dropTarget === ''
          ? 'border-accent-lavender bg-accent-lavender/20 text-text'
          : 'border-border text-text-muted'}"
        ondragover={handleRootDragOver}
        ondragleave={() => {
          if (dropTarget === "") dropTarget = null;
        }}
        ondrop={handleRootDrop}
      >
        Déposer à la racine du vault
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

  <div class="border-t border-border px-3 py-2 space-y-1">
    <p class="truncate text-[10px] text-text-muted" title={vaultPath}>{vaultPath}</p>
    <button
      type="button"
      class="w-full truncate rounded-lg px-1 py-0.5 text-left text-[10px] text-accent-blue underline-offset-2 hover:underline"
      title={APP_REPO_URL}
      onclick={openRepo}
    >
      GitHub · CyberScribeNote
    </button>
  </div>
</aside>
