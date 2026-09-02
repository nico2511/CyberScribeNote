<script lang="ts">
  import { marked, Renderer } from "marked";
  import SelectionAiToolbar from "./SelectionAiToolbar.svelte";
  import EditorContextMenu from "./EditorContextMenu.svelte";
  import type { AiAction } from "$lib/types";
  import type { AiActionRequest, TextSelection } from "$lib/voice/commands";
  import {
    insertSnippet,
    prefixLines,
    TABLE_TEMPLATE,
    wrapSelection,
    type TextRange,
  } from "$lib/markdown/format";
  import { escapeHtml, resolveMediaUrl } from "$lib/vault/media";

  interface Props {
    content: string;
    title: string;
    notePath: string;
    vaultPath: string;
    dirty: boolean;
    saving: boolean;
    preview: boolean;
    ollamaAvailable: boolean;
    aiLoading: boolean;
    onChange: (value: string) => void;
    onSave: () => void;
    onTogglePreview: () => void;
    onAiAction: (request: AiActionRequest) => void;
    onInsertImage: () => void;
    onImportImages: (paths: string[]) => void | Promise<void>;
    onPasteImageBytes: (base64: string, extension: string) => void | Promise<void>;
    onExport: () => void;
    onToggleCompanion?: () => void;
    companionOpen?: boolean;
  }

  let {
    content,
    title,
    notePath,
    vaultPath,
    dirty,
    saving,
    preview,
    ollamaAvailable,
    aiLoading,
    onChange,
    onSave,
    onTogglePreview,
    onAiAction,
    onInsertImage,
    onImportImages,
    onPasteImageBytes,
    onExport,
    onToggleCompanion,
    companionOpen = false,
  }: Props = $props();

  let aiMenuOpen = $state(false);
  let aiMenuRef = $state<HTMLDivElement | null>(null);
  let textareaRef = $state<HTMLTextAreaElement | null>(null);
  let selection = $state<TextSelection | null>(null);
  let selectionPinned = $state(false);
  let editorMenuOpen = $state(false);
  let editorMenuPos = $state({ x: 0, y: 0 });
  let editorMenuHasSelection = $state(false);

  let html = $derived.by(() => {
    if (!preview || !vaultPath) {
      return marked.parse(content || "", { async: false }) as string;
    }

    const renderer = new Renderer();
    renderer.image = ({ href, title, text }) => {
      if (!href) return "";
      const src = resolveMediaUrl(href, notePath, vaultPath);
      const alt = escapeHtml(text || "");
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<img src="${src}" alt="${alt}"${titleAttr} loading="lazy" />`;
    };

    return marked.parse(content || "", { async: false, renderer }) as string;
  });

  const aiActions: { id: AiAction; label: string; desc: string }[] = [
    { id: "summarize", label: "Résumer", desc: "Synthèse (note ou sélection)" },
    { id: "reformulate", label: "Reformuler", desc: "Suggestion (panneau Compagnon)" },
    { id: "correct", label: "Corriger", desc: "Orthographe & grammaire" },
    { id: "translate_en", label: "Traduire (EN)", desc: "Vers l'anglais" },
  ];

  function readSelection() {
    const el = textareaRef;
    if (!el || preview) {
      selection = null;
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start === end) {
      if (!selectionPinned) selection = null;
      return;
    }
    const text = content.slice(start, end);
    if (!text.trim()) {
      selection = null;
      return;
    }
    selection = { start, end, text };
    selectionPinned = false;
  }

  function toggleAiMenu(e: MouseEvent) {
    e.stopPropagation();
    readSelection();
    aiMenuOpen = !aiMenuOpen;
  }

  function runAi(e: MouseEvent, action: AiAction) {
    e.stopPropagation();
    aiMenuOpen = false;
    readSelection();
    onAiAction({ action, selection: selection ?? undefined });
    selection = null;
  }

  function handleSelectionAction(action: AiAction, sel: TextSelection) {
    onAiAction({ action, selection: sel });
    selection = null;
    selectionPinned = false;
  }

  function handleWindowClick(e: MouseEvent) {
    if (aiMenuRef && !aiMenuRef.contains(e.target as Node)) {
      aiMenuOpen = false;
    }
  }

  function currentRange(): TextRange {
    const el = textareaRef!;
    return { start: el.selectionStart, end: el.selectionEnd };
  }

  function applyEdit(result: { value: string; cursor: number }) {
    onChange(result.value);
    queueMicrotask(() => {
      const el = textareaRef;
      if (!el) return;
      el.focus();
      el.setSelectionRange(result.cursor, result.cursor);
    });
  }

  function applyFormat(build: (content: string, range: TextRange) => { value: string; cursor: number }) {
    if (!textareaRef || preview) return;
    applyEdit(build(content, currentRange()));
  }

  const toolbarButtons: {
    label: string;
    title: string;
    action: () => void;
  }[] = [
    { label: "B", title: "Gras", action: () => applyFormat((c, r) => wrapSelection(c, r, "**", "**", "gras")) },
    { label: "I", title: "Italique", action: () => applyFormat((c, r) => wrapSelection(c, r, "*", "*", "italique")) },
    { label: "H2", title: "Titre", action: () => applyFormat((c, r) => prefixLines(c, r, "## ", "Titre")) },
    { label: "•", title: "Liste à puces", action: () => applyFormat((c, r) => prefixLines(c, r, "- ", "élément")) },
    { label: "1.", title: "Liste numérotée", action: () => applyFormat((c, r) => prefixLines(c, r, "1. ", "élément")) },
    { label: "<>", title: "Code", action: () => applyFormat((c, r) => wrapSelection(c, r, "`", "`", "code")) },
    {
      label: "{ }",
      title: "Bloc de code",
      action: () => applyFormat((c, r) => wrapSelection(c, r, "```\n", "\n```", "code")),
    },
    { label: "❝", title: "Citation", action: () => applyFormat((c, r) => prefixLines(c, r, "> ", "citation")) },
    {
      label: "🔗",
      title: "Lien",
      action: () => applyFormat((c, r) => wrapSelection(c, r, "[", "](url)", "texte")),
    },
    {
      label: "⊞",
      title: "Tableau",
      action: () => applyFormat((c, r) => insertSnippet(c, r, `\n${TABLE_TEMPLATE}\n`)),
    },
  ];

  function openEditorContextMenu(e: MouseEvent) {
    if (preview) return;
    e.preventDefault();
    readSelection();
    editorMenuHasSelection = !!selection;
    if (selection) selectionPinned = true;
    editorMenuPos = { x: e.clientX, y: e.clientY };
    editorMenuOpen = true;
  }

  function closeEditorContextMenu() {
    editorMenuOpen = false;
    selectionPinned = false;
  }

  function handleEditorMenuAction(action: AiAction) {
    editorMenuOpen = false;
    onAiAction({ action, selection: selection ?? undefined });
    selectionPinned = false;
  }

  function pathsFromDataTransfer(dataTransfer: DataTransfer | null): string[] {
    const paths: string[] = [];
    for (const file of dataTransfer?.files ?? []) {
      const path = (file as File & { path?: string }).path;
      if (path) paths.push(path);
    }
    return paths;
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    const paths = pathsFromDataTransfer(e.dataTransfer);
    if (paths.length) await onImportImages(paths);
  }

  async function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.kind !== "file" || !item.type.startsWith("image/")) continue;

      e.preventDefault();
      const file = item.getAsFile();
      if (!file) continue;

      const path = (file as File & { path?: string }).path;
      if (path) {
        await onImportImages([path]);
        return;
      }

      const extension = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result;
          if (typeof result !== "string") {
            reject(new Error("Lecture image impossible"));
            return;
          }
          const payload = result.includes(",") ? result.split(",")[1] : result;
          resolve(payload);
        };
        reader.onerror = () => reject(reader.error ?? new Error("Lecture image impossible"));
        reader.readAsDataURL(file);
      });

      await onPasteImageBytes(base64, extension);
      return;
    }
  }
</script>

<section class="flex h-full min-w-0 flex-1 flex-col bg-bg">
  <header class="flex items-center justify-between border-b border-border px-4 py-3">
    <div class="min-w-0">
      <h2 class="truncate text-lg font-semibold">{title || "Sans titre"}</h2>
      <p class="text-xs text-text-muted">
        {#if saving}
          Sauvegarde…
        {:else if dirty}
          Modifications non sauvegardées
        {:else}
          Sauvegardé
        {/if}
        {#if selection && !preview}
          · <span class="text-accent-lavender">sélection active</span>
        {/if}
      </p>
    </div>

    <div class="flex items-center gap-2">
      <button
        type="button"
        class="rounded-2xl border border-border bg-surface px-3 py-1.5 text-xs transition hover:bg-surface-muted"
        onclick={onTogglePreview}
      >
        {preview ? "Éditer" : "Aperçu"}
      </button>

      <button
        type="button"
        class="rounded-2xl border border-border bg-surface px-3 py-1.5 text-xs transition hover:bg-surface-muted"
        onclick={onInsertImage}
        title="Copier une image dans _media/ (note) ou media/ (global)"
      >
        🖼 Image
      </button>

      <div class="relative flex items-center gap-2" bind:this={aiMenuRef}>
        {#if onToggleCompanion}
          <button
            type="button"
            class="rounded-2xl border border-border px-3 py-1.5 text-xs transition hover:bg-surface-muted {companionOpen
              ? 'bg-accent-lavender/30'
              : 'bg-surface'}"
            onclick={onToggleCompanion}
            title="Panneau suggestions IA"
          >
            ◈ Compagnon
          </button>
        {/if}
        <button
          type="button"
          class="rounded-2xl border border-border bg-surface px-3 py-1.5 text-xs transition hover:bg-surface-muted disabled:opacity-40"
          disabled={aiLoading}
          title={ollamaAvailable ? "Actions IA via Ollama" : "Configurez Ollama dans les réglages"}
          onclick={toggleAiMenu}
        >
          {aiLoading ? "IA…" : "✦ IA ▾"}
        </button>
        {#if aiMenuOpen}
          <div
            class="absolute right-0 top-full z-50 mt-1 min-w-[12rem] overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lg"
            style:box-shadow="var(--shadow)"
          >
            {#if !ollamaAvailable}
              <p class="px-3 py-2 text-xs text-text-muted">Ollama hors ligne — ouvrez les Réglages</p>
            {/if}
            {#if selection}
              <p class="border-b border-border px-3 py-1.5 text-[10px] text-accent-lavender">
                Cible : sélection ({selection.text.length} car.) → suggestion
              </p>
            {:else}
              <p class="border-b border-border px-3 py-1.5 text-[10px] text-text-muted">
                Cible : note entière → suggestion
              </p>
            {/if}
            {#each aiActions as action (action.id)}
              <button
                type="button"
                class="block w-full px-3 py-2 text-left transition hover:bg-surface-muted disabled:opacity-40"
                disabled={!ollamaAvailable || aiLoading}
                onclick={(e) => runAi(e, action.id)}
              >
                <span class="block text-xs font-medium">{action.label}</span>
                <span class="block text-[10px] text-text-muted">{action.desc}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <button
        type="button"
        class="rounded-2xl border border-border bg-surface px-3 py-1.5 text-xs transition hover:bg-surface-muted"
        onclick={onExport}
      >
        Exporter
      </button>

      <button
        type="button"
        class="rounded-2xl bg-accent-lavender/50 px-3 py-1.5 text-xs font-medium transition hover:bg-accent-lavender/70 disabled:opacity-40"
        disabled={!dirty || saving}
        onclick={onSave}
      >
        Sauver
      </button>
    </div>
  </header>

  {#if selection && !preview}
    <SelectionAiToolbar
      {selection}
      {ollamaAvailable}
      {aiLoading}
      onAction={handleSelectionAction}
      onClear={() => {
        selection = null;
        selectionPinned = false;
      }}
    />
  {/if}

  {#if !preview}
    <div
      class="flex flex-wrap items-center gap-1 border-b border-border bg-surface-muted/50 px-4 py-1.5"
      role="toolbar"
      aria-label="Formatage Markdown"
    >
      {#each toolbarButtons as btn (btn.title)}
        <button
          type="button"
          class="rounded-lg border border-border bg-surface px-2 py-0.5 font-mono text-[11px] transition hover:bg-accent-blue/20"
          title={btn.title}
          onclick={btn.action}
        >
          {btn.label}
        </button>
      {/each}
    </div>
  {/if}

  <div
    class="flex min-h-0 flex-1"
    role="region"
    aria-label="Zone d'édition"
    ondragover={(e) => e.preventDefault()}
    ondrop={handleDrop}
  >
    {#if preview}
      <article class="prose-note flex-1 overflow-y-auto px-6 py-4">
        {@html html}
      </article>
    {:else}
      <textarea
        bind:this={textareaRef}
        class="flex-1 resize-none bg-transparent px-6 py-4 font-mono text-sm leading-relaxed outline-none"
        value={content}
        oninput={(e) => onChange(e.currentTarget.value)}
        onselect={readSelection}
        onmouseup={readSelection}
        onkeyup={readSelection}
        onpaste={handlePaste}
        oncontextmenu={openEditorContextMenu}
        placeholder="Écrivez en Markdown… Clic droit pour l'IA · glisser une image pour l'insérer."
        spellcheck="true"
      ></textarea>
    {/if}
  </div>

  <EditorContextMenu
    open={editorMenuOpen}
    x={editorMenuPos.x}
    y={editorMenuPos.y}
    hasSelection={editorMenuHasSelection}
    {ollamaAvailable}
    {aiLoading}
    onAction={handleEditorMenuAction}
    onClose={closeEditorContextMenu}
  />
</section>

<svelte:window onclick={handleWindowClick} />
