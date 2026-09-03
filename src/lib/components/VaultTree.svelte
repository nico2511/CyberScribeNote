<script lang="ts">
  import Self from "./VaultTree.svelte";
  import PixelIcon from "./PixelIcon.svelte";
  import type { VaultEntry } from "$lib/types";
  import {
    canMoveVaultItem,
    readVaultDragData,
    setVaultDragData,
    type VaultDragPayload,
  } from "$lib/vault/tree";

  interface Props {
    entries: VaultEntry[];
    selectedPath: string | null;
    onSelect: (path: string) => void;
    onCreateNote: (parentPath: string) => void;
    onCreateFolder: (parentPath: string) => void;
    onDelete: (path: string) => void;
    onMove: (sourcePath: string, destinationParent: string) => void | Promise<void>;
    draggingItem?: VaultDragPayload | null;
    onDragStart?: (payload: VaultDragPayload) => void;
    onDragEnd?: () => void;
    dropTarget?: string | null;
    onDropTargetChange?: (target: string | null) => void;
    depth?: number;
  }

  let {
    entries,
    selectedPath,
    onSelect,
    onCreateNote,
    onCreateFolder,
    onDelete,
    onMove,
    draggingItem = null,
    onDragStart,
    onDragEnd,
    dropTarget = null,
    onDropTargetChange,
    depth = 0,
  }: Props = $props();

  let expanded = $state<Record<string, boolean>>({});

  function toggle(path: string) {
    expanded[path] = expanded[path] === false;
  }

  function isExpanded(path: string) {
    return expanded[path] !== false;
  }

  function dragPayload(entry: VaultEntry): VaultDragPayload {
    return { path: entry.path, isDir: entry.isDir };
  }

  function handleDragStart(e: DragEvent, entry: VaultEntry) {
    const payload = dragPayload(entry);
    setVaultDragData(e, payload);
    onDragStart?.(payload);
  }

  function handleDragEnd() {
    onDragEnd?.();
  }

  function handleFolderDragOver(e: DragEvent, folderPath: string) {
    if (!draggingItem || !canMoveVaultItem(draggingItem, folderPath)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    onDropTargetChange?.(folderPath);
  }

  async function handleFolderDrop(e: DragEvent, folderPath: string) {
    e.preventDefault();
    e.stopPropagation();
    const source = readVaultDragData(e) ?? draggingItem;
    onDropTargetChange?.(null);
    onDragEnd?.();
    if (!source || !canMoveVaultItem(source, folderPath)) return;
    await onMove(source.path, folderPath);
  }
</script>

<ul class="space-y-0.5" style:padding-left={depth > 0 ? "0.75rem" : "0"}>
  {#each entries as entry (entry.path)}
    <li>
      {#if entry.isDir}
        <div
          role="group"
          aria-label="Dossier {entry.name}, zone de dépôt"
          tabindex="-1"
          class="group flex items-center gap-1 rounded-xl transition {dropTarget === entry.path
            ? 'bg-accent-lavender/30 ring-1 ring-accent-lavender'
            : ''}"
          ondragover={(e) => handleFolderDragOver(e, entry.path)}
          ondragleave={() => {
            if (dropTarget === entry.path) onDropTargetChange?.(null);
          }}
          ondrop={(e) => handleFolderDrop(e, entry.path)}
        >
          <button
            type="button"
            draggable="true"
            class="flex min-w-0 flex-1 cursor-grab items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm transition hover:bg-surface-muted active:cursor-grabbing"
            title="Glisser pour déplacer le dossier"
            onclick={() => toggle(entry.path)}
            ondragstart={(e) => handleDragStart(e, entry)}
            ondragend={handleDragEnd}
          >
            <PixelIcon name="chevron" size={16} class="text-accent-mint {isExpanded(entry.path) ? 'rotate-90' : ''}" />
            <PixelIcon name="folder" size={16} class="text-accent-lavender" />
            <span class="truncate">{entry.name}</span>
          </button>
          <div class="hidden gap-0.5 group-hover:flex">
            <button
              type="button"
              class="rounded-lg px-1.5 py-0.5 text-xs text-text-muted hover:bg-accent-mint/30"
              title="Nouvelle note"
              onclick={() => onCreateNote(entry.path)}
            >+</button>
            <button
              type="button"
              class="rounded-lg px-1.5 py-0.5 text-xs text-text-muted hover:bg-accent-blue/30"
              title="Nouveau dossier"
              onclick={() => onCreateFolder(entry.path)}
            >📁</button>
          </div>
        </div>
        {#if isExpanded(entry.path) && entry.children}
          <Self
            entries={entry.children}
            {selectedPath}
            {onSelect}
            {onCreateNote}
            {onCreateFolder}
            {onDelete}
            {onMove}
            {draggingItem}
            {onDragStart}
            {onDragEnd}
            {dropTarget}
            {onDropTargetChange}
            depth={depth + 1}
          />
        {/if}
      {:else}
        <div class="group flex items-center gap-1">
          <button
            type="button"
            draggable="true"
            class="flex min-w-0 flex-1 cursor-grab items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm transition hover:bg-surface-muted active:cursor-grabbing {selectedPath === entry.path ? 'bg-accent-lavender/25' : ''}"
            title="Glisser pour déplacer la note"
            onclick={() => onSelect(entry.path)}
            ondragstart={(e) => handleDragStart(e, entry)}
            ondragend={handleDragEnd}
          >
            <PixelIcon name="note" size={16} class="text-accent-blue" />
            <span class="truncate">{entry.name.replace(/\.md$/, "")}</span>
          </button>
          <button
            type="button"
            class="hidden rounded-lg px-1.5 py-0.5 text-xs text-danger hover:bg-danger/20 group-hover:block"
            title="Supprimer"
            onclick={() => onDelete(entry.path)}
          >✕</button>
        </div>
      {/if}
    </li>
  {/each}
</ul>
