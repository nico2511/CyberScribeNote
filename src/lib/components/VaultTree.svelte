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
  import { getActiveVaultDrag, setActiveVaultDrag } from "$lib/vault/activeDrag";

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
  let draggedPath = $state<string | null>(null);

  function toggle(path: string) {
    expanded[path] = expanded[path] === false;
  }

  function isExpanded(path: string) {
    return expanded[path] !== false;
  }

  function dragPayload(entry: VaultEntry): VaultDragPayload {
    return { path: entry.path, isDir: entry.isDir };
  }

  function currentDrag(): VaultDragPayload | null {
    return draggingItem ?? getActiveVaultDrag();
  }

  function handleDragStart(e: DragEvent, entry: VaultEntry) {
    const payload = dragPayload(entry);
    setVaultDragData(e, payload);
    setActiveVaultDrag(payload);
    draggedPath = entry.path;
    onDragStart?.(payload);
  }

  function handleDragEnd() {
    setActiveVaultDrag(null);
    draggedPath = null;
    onDragEnd?.();
  }

  function handleFolderDragOver(e: DragEvent, folderPath: string) {
    const source = currentDrag();
    if (!source || !canMoveVaultItem(source, folderPath)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    onDropTargetChange?.(folderPath);
  }

  async function handleFolderDrop(e: DragEvent, folderPath: string) {
    e.preventDefault();
    e.stopPropagation();
    const source = readVaultDragData(e) ?? currentDrag();
    onDropTargetChange?.(null);
    setActiveVaultDrag(null);
    draggedPath = null;
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
          class="rounded-xl transition {dropTarget === entry.path
            ? 'bg-accent-lavender/30 ring-1 ring-accent-lavender'
            : ''} {draggedPath === entry.path ? 'opacity-50' : ''}"
          ondragover={(e) => handleFolderDragOver(e, entry.path)}
          ondragleave={(e) => {
            const related = e.relatedTarget as Node | null;
            if (related && (e.currentTarget as HTMLElement).contains(related)) return;
            if (dropTarget === entry.path) onDropTargetChange?.(null);
          }}
          ondrop={(e) => handleFolderDrop(e, entry.path)}
        >
          <div class="group flex items-center gap-1">
            <span
              class="vault-drag-handle shrink-0 cursor-grab px-0.5 text-[11px] leading-none text-text select-none active:cursor-grabbing"
              title="Glisser pour déplacer"
              draggable="true"
              role="button"
              tabindex="-1"
              aria-label="Poignée de déplacement — {entry.name}"
              ondragstart={(e) => handleDragStart(e, entry)}
              ondragend={handleDragEnd}
            >⠿</span>
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1.5 py-1.5 text-left text-sm transition hover:bg-surface-muted"
              title="Ouvrir / fermer le dossier"
              onclick={() => toggle(entry.path)}
            >
              <PixelIcon name="chevron" size={16} class="sidebar-icon text-text {isExpanded(entry.path) ? 'rotate-90' : ''}" />
              <PixelIcon name="folder" size={16} class="sidebar-icon text-text" />
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
            <div
              role="group"
              aria-label="Contenu du dossier {entry.name}"
              class="mt-0.5 min-h-[4px] rounded-lg {dropTarget === entry.path ? 'bg-accent-lavender/15' : ''}"
              ondragover={(e) => handleFolderDragOver(e, entry.path)}
              ondrop={(e) => handleFolderDrop(e, entry.path)}
            >
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
            </div>
          {/if}
        </div>
      {:else}
        <div
          class="group flex items-center gap-1 rounded-xl {draggedPath === entry.path ? 'opacity-50' : ''} {selectedPath === entry.path
            ? 'bg-accent-lavender/25'
            : ''}"
        >
          <span
            class="vault-drag-handle shrink-0 cursor-grab px-0.5 text-[11px] leading-none text-text select-none active:cursor-grabbing"
            title="Glisser pour déplacer la note"
            draggable="true"
            role="button"
            tabindex="-1"
            aria-label="Poignée de déplacement — {entry.name}"
            ondragstart={(e) => handleDragStart(e, entry)}
            ondragend={handleDragEnd}
          >⠿</span>
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1.5 py-1.5 text-left text-sm transition hover:bg-surface-muted"
            onclick={() => onSelect(entry.path)}
          >
            <PixelIcon name="note" size={16} class="sidebar-icon text-text" />
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
