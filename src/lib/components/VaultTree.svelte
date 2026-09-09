<script lang="ts">
  import Self from "./VaultTree.svelte";
  import PixelIcon from "./PixelIcon.svelte";
  import type { VaultEntry } from "$lib/types";
  import {
    canMoveVaultItem,
    countNotesInFolder,
    isFolderEmpty,
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
    onRename?: (path: string) => void | Promise<void>;
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
    onRename,
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
    expanded[path] = !isExpanded(path);
  }

  /** Par défaut replié — meilleure lisibilité quand il y a beaucoup de dossiers. */
  function isExpanded(path: string) {
    return expanded[path] === true;
  }

  function dragPayload(entry: VaultEntry): VaultDragPayload {
    return { path: entry.path, isDir: entry.isDir };
  }

  function currentDrag(): VaultDragPayload | null {
    return draggingItem ?? getActiveVaultDrag();
  }

  /** DnD pointer (WebView2 / Tauri) — HTML5 drag est trop fragile. */
  function startPointerDrag(e: PointerEvent, entry: VaultEntry) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const payload = dragPayload(entry);
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    setActiveVaultDrag(payload);
    draggedPath = entry.path;
    onDragStart?.(payload);

    const onMovePtr = (ev: PointerEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const zone = el?.closest?.("[data-drop-folder]") as HTMLElement | null;
      const folder = zone?.dataset.dropFolder ?? null;
      if (folder != null && canMoveVaultItem(payload, folder)) {
        onDropTargetChange?.(folder);
      } else if (zone?.dataset.dropRoot === "1" && canMoveVaultItem(payload, "")) {
        onDropTargetChange?.("");
      } else {
        onDropTargetChange?.(null);
      }
    };

    const finish = async (ev: PointerEvent) => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener("pointermove", onMovePtr);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);

      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const zone = el?.closest?.("[data-drop-folder]") as HTMLElement | null;
      let dest: string | null = null;
      if (zone?.dataset.dropFolder != null) dest = zone.dataset.dropFolder;
      else if (zone?.dataset.dropRoot === "1") dest = "";

      const source = currentDrag();
      onDropTargetChange?.(null);
      setActiveVaultDrag(null);
      draggedPath = null;
      onDragEnd?.();

      if (source && dest != null && canMoveVaultItem(source, dest)) {
        await onMove(source.path, dest);
      }
    };

    handle.addEventListener("pointermove", onMovePtr);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }
</script>

<ul class="space-y-0.5" style:padding-left={depth > 0 ? "0.75rem" : "0"}>
  {#each entries as entry (entry.path)}
    <li>
      {#if entry.isDir}
        {@const noteCount = countNotesInFolder(entry)}
        <div
          role="group"
          aria-label="Dossier {entry.name}, {noteCount} notes, zone de dépôt"
          tabindex="-1"
          data-drop-folder={entry.path}
          class="transition {draggedPath === entry.path ? 'opacity-50' : ''}"
        >
          <div
            class="group flex items-center gap-0.5 rounded-xl px-0.5 transition {dropTarget === entry.path
              ? 'bg-accent-lavender/30 ring-1 ring-accent-lavender'
              : 'hover:bg-surface-muted/80'}"
          >
            <span
              class="vault-drag-handle shrink-0 touch-none select-none px-1 py-1.5 text-[12px] leading-none text-text-muted"
              class:cursor-grabbing={draggedPath === entry.path}
              class:cursor-grab={draggedPath !== entry.path}
              title="Maintenir et glisser vers un dossier"
              role="button"
              tabindex="-1"
              aria-label="Déplacer {entry.name}"
              onpointerdown={(e) => startPointerDrag(e, entry)}
            >⠿</span>
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1.5 text-left text-sm"
              title="Ouvrir / fermer le dossier · {noteCount} note{noteCount === 1 ? '' : 's'}"
              onclick={() => toggle(entry.path)}
            >
              <PixelIcon name="chevron" size={16} class="sidebar-icon text-text {isExpanded(entry.path) ? 'rotate-90' : ''}" />
              <PixelIcon name="folder" size={16} class="sidebar-icon text-text" />
              <span class="min-w-0 truncate">{entry.name}</span>
              <span
                class="ml-auto shrink-0 rounded-full bg-accent-blue/30 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none text-text"
              >{noteCount}</span>
            </button>
            <div class="hidden shrink-0 gap-0.5 group-hover:flex">
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
              {#if isFolderEmpty(entry)}
                <button
                  type="button"
                  class="rounded-lg px-1.5 py-0.5 text-xs text-danger hover:bg-danger/20"
                  title="Supprimer le dossier vide"
                  onclick={() => onDelete(entry.path)}
                >✕</button>
              {/if}
            </div>
          </div>
          {#if isExpanded(entry.path) && entry.children}
            <div class="mt-0.5 min-h-[4px] rounded-lg {dropTarget === entry.path ? 'bg-accent-lavender/15' : ''}">
              <Self
                entries={entry.children}
                {selectedPath}
                {onSelect}
                {onCreateNote}
                {onCreateFolder}
                {onDelete}
                {onMove}
                {onRename}
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
          class="group flex items-center gap-0.5 rounded-xl px-0.5 transition {draggedPath === entry.path
            ? 'opacity-50'
            : ''} {selectedPath === entry.path
            ? 'bg-accent-lavender/30'
            : 'hover:bg-surface-muted/80'}"
        >
          <span
            class="vault-drag-handle shrink-0 touch-none select-none px-1 py-1.5 text-[12px] leading-none text-text-muted"
            class:cursor-grabbing={draggedPath === entry.path}
            class:cursor-grab={draggedPath !== entry.path}
            title="Maintenir et glisser vers un dossier"
            role="button"
            tabindex="-1"
            aria-label="Déplacer {entry.name}"
            onpointerdown={(e) => startPointerDrag(e, entry)}
          >⠿</span>
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1.5 text-left text-sm"
            onclick={() => onSelect(entry.path)}
          >
            <PixelIcon name="note" size={16} class="sidebar-icon text-text" />
            <span class="truncate">{entry.name.replace(/\.md$/, "")}</span>
          </button>
          <button
            type="button"
            class="hidden rounded-lg px-1.5 py-0.5 text-xs text-text-muted hover:bg-accent-blue/30 group-hover:block"
            title="Renommer"
            onclick={() => onRename?.(entry.path)}
          >✎</button>
          <button
            type="button"
            class="mr-0.5 hidden rounded-lg px-1.5 py-0.5 text-xs text-danger hover:bg-danger/20 group-hover:block"
            title="Supprimer"
            onclick={() => onDelete(entry.path)}
          >✕</button>
        </div>
      {/if}
    </li>
  {/each}
</ul>
