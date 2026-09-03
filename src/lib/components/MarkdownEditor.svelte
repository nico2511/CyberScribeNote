<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { Editor } from "@tiptap/core";
  import StarterKit from "@tiptap/starter-kit";
  import Link from "@tiptap/extension-link";
  import Placeholder from "@tiptap/extension-placeholder";
  import Underline from "@tiptap/extension-underline";
  import TextAlign from "@tiptap/extension-text-align";
  import Highlight from "@tiptap/extension-highlight";
  import TaskList from "@tiptap/extension-task-list";
  import TaskItem from "@tiptap/extension-task-item";
  import EditorContextMenu from "./EditorContextMenu.svelte";
  import OutlinePanel from "./OutlinePanel.svelte";
  import type { AiAction } from "$lib/types";
  import type { AiActionRequest, TextSelection } from "$lib/voice/commands";
  import { TRANSLATE_LANGUAGES, type TranslateLang } from "$lib/ai/languages";
  import {
    extractOutline,
    htmlToMarkdown,
    markdownToHtml,
    mergeBodyMarkdown,
  } from "$lib/markdown/bridge";
  import type { OutlineItem } from "$lib/markdown/outline";
  import { editingTargetAtCursor, lineAtCursor } from "$lib/note/paragraph";
  import type { ParagraphSpan } from "$lib/note/paragraph";
  import { ResizableImage } from "$lib/tiptap/resizableImage";
  import { WikiLink } from "$lib/tiptap/wikiLink";
  import { resolveMediaUrl } from "$lib/vault/media";

  interface Props {
    content: string;
    title: string;
    notePath: string;
    vaultPath: string;
    dirty: boolean;
    saving: boolean;
    ollamaAvailable: boolean;
    aiLoading: boolean;
    onChange: (value: string) => void;
    onSave: () => void;
    onAiAction: (request: AiActionRequest) => void;
    onInsertImage: () => void;
    onImportImages: (paths: string[]) => void | Promise<void>;
    onPasteImageBytes: (base64: string, extension: string) => void | Promise<void>;
    onExport: () => void;
    onToggleCompanion?: () => void;
    companionOpen?: boolean;
    onSelectionChange?: (selection: TextSelection | null) => void;
    onCaretChange?: (offset: number) => void;
    onEditingIdle?: (span: ParagraphSpan) => void;
    onAutoTypoFix?: (span: ParagraphSpan) => void;
    autoTypoFixEnabled?: boolean;
    highlightRange?: { start: number; end: number } | null;
    editorCursor?: number | null;
    onCursorRestored?: () => void;
    onOpenWikilink?: (title: string) => void;
    insertImageMarkdown?: string | null;
    onImageMarkdownConsumed?: () => void;
  }

  let {
    content,
    title,
    notePath,
    vaultPath,
    dirty,
    saving,
    ollamaAvailable,
    aiLoading,
    onChange,
    onSave,
    onAiAction,
    onInsertImage,
    onImportImages,
    onPasteImageBytes,
    onExport,
    onToggleCompanion,
    companionOpen = false,
    onSelectionChange,
    onCaretChange,
    onEditingIdle,
    onAutoTypoFix,
    autoTypoFixEnabled = true,
    highlightRange = null,
    editorCursor = null,
    onCursorRestored,
    onOpenWikilink,
    insertImageMarkdown = null,
    onImageMarkdownConsumed,
  }: Props = $props();

  let editorHost = $state<HTMLDivElement | null>(null);
  let editor: Editor | null = null;
  let applyingExternal = false;
  let lastEmitted = "";
  let aiMenuOpen = $state(false);
  let translateMenuOpen = $state(false);
  let aiMenuRef = $state<HTMLDivElement | null>(null);
  let selection = $state<TextSelection | null>(null);
  let selectionPinned = $state(false);
  let editorMenuOpen = $state(false);
  let editorMenuPos = $state({ x: 0, y: 0 });
  let editorMenuHasSelection = $state(false);
  let outlineItems = $state<OutlineItem[]>([]);
  let imageMenuOpen = $state(false);
  let proactiveTimer: ReturnType<typeof setTimeout> | null = null;
  let autoTypoTimer: ReturnType<typeof setTimeout> | null = null;

  const aiActions: { id: AiAction; label: string; desc: string }[] = [
    { id: "summarize", label: "Résumer", desc: "Ajoute un résumé en fin de note" },
    { id: "reformulate", label: "Reformuler", desc: "Suggestion (panneau Compagnon)" },
    { id: "correct", label: "Corriger", desc: "Orthographe & grammaire" },
  ];

  function fullMarkdownFromEditor(): string {
    if (!editor) return content;
    const body = htmlToMarkdown(editor.getHTML());
    return mergeBodyMarkdown(content, body);
  }

  function emitChange() {
    if (!editor || applyingExternal) return;
    const next = fullMarkdownFromEditor();
    if (next === lastEmitted) return;
    lastEmitted = next;
    outlineItems = extractOutline(next);
    onChange(next);
    onCaretChange?.(cursorMdOffset());
    scheduleAutoTypoCheck();
    scheduleProactiveCheck();
  }

  function mdOffsetToPos(md: string, offset: number): number {
    if (!editor) return 1;
    const bodyStart = md.startsWith("---")
      ? (() => {
          const end = md.indexOf("---", 3);
          if (end === -1) return 0;
          let s = end + 3;
          while (s < md.length && md[s] === "\n") s++;
          return s;
        })()
      : 0;
    const bodyOffset = Math.max(0, offset - bodyStart);
    const body = md.slice(bodyStart);
    // Target text: the snippet at the offset we want to reach
    const targetSnippet = body.slice(Math.max(0, bodyOffset - 20), bodyOffset + 20);
    // Walk the ProseMirror doc to match character count
    let counted = 0;
    let found = 1;
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return true;
      const next = counted + node.text.length;
      if (counted + node.text.length >= bodyOffset) {
        found = pos + Math.min(node.text.length, Math.max(0, bodyOffset - counted));
        return false;
      }
      counted = next;
      return true;
    });
    return Math.max(1, found);
  }

  function readSelectionFromEditor() {
    if (!editor) {
      selection = null;
      onSelectionChange?.(null);
      return;
    }
    onCaretChange?.(cursorMdOffset());
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      if (!selectionPinned) {
        selection = null;
        onSelectionChange?.(null);
      }
      return;
    }
    const text = editor.state.doc.textBetween(from, to, "\n");
    if (!text.trim()) {
      selection = null;
      onSelectionChange?.(null);
      return;
    }
    // Map ProseMirror positions to markdown offsets
    const md = fullMarkdownFromEditor();
    const startOffset = prosePosToMdOffset(from);
    const endOffset = prosePosToMdOffset(to);
    selection = { start: startOffset, end: endOffset, text };
    selectionPinned = false;
    onSelectionChange?.(selection);
  }

  /** Convert a ProseMirror position to an approximate markdown body offset. */
  function prosePosToMdOffset(pos: number): number {
    if (!editor) return pos;
    const md = fullMarkdownFromEditor();
    const bodyStart = (() => {
      if (!md.startsWith("---")) return 0;
      const end = md.indexOf("---", 3);
      if (end === -1) return 0;
      let s = end + 3;
      while (s < md.length && md[s] === "\n") s++;
      return s;
    })();
    const textBefore = editor.state.doc.textBetween(0, pos, "\n", "\n");
    const body = md.slice(bodyStart);
    // Search for the textBefore substring in the body for precise mapping
    const idx = body.indexOf(textBefore);
    if (idx >= 0) return bodyStart + idx + textBefore.length;
    // Fallback: approximate by length
    return bodyStart + Math.min(body.length, textBefore.length);
  }

  function cursorMdOffset(): number {
    if (!editor) return fullMarkdownFromEditor().length;
    const { from } = editor.state.selection;
    return prosePosToMdOffset(from);
  }

  function scheduleAutoTypoCheck() {
    if (!onAutoTypoFix || !autoTypoFixEnabled) return;
    if (autoTypoTimer) clearTimeout(autoTypoTimer);
    autoTypoTimer = setTimeout(() => {
      const md = fullMarkdownFromEditor();
      const cursor = cursorMdOffset();
      const span = lineAtCursor(md, cursor);
      if (span) onAutoTypoFix(span);
    }, 1200);
  }

  function scheduleProactiveCheck() {
    if (!onEditingIdle) return;
    if (proactiveTimer) clearTimeout(proactiveTimer);
    proactiveTimer = setTimeout(() => {
      const md = fullMarkdownFromEditor();
      const cursor = cursorMdOffset();
      const span = editingTargetAtCursor(md, cursor);
      if (span) onEditingIdle(span);
    }, 4000);
  }

  function setEditorFromMarkdown(md: string) {
    if (!editor) return;
    applyingExternal = true;
    const prevFrom = editor.state.selection.from;
    const html = markdownToHtml(md, notePath, vaultPath);
    editor.commands.setContent(html || "<p></p>", { emitUpdate: false });
    lastEmitted = md;
    outlineItems = extractOutline(md);
    const size = editor.state.doc.content.size;
    const restore = Math.min(Math.max(1, prevFrom), Math.max(1, size));
    try {
      editor.commands.setTextSelection(restore);
    } catch {
      /* ignore */
    }
    applyingExternal = false;
  }

  function insertImageAtCursor(relativePath: string, alt = "image") {
    if (!editor) return;
    const src = vaultPath ? resolveMediaUrl(relativePath, notePath, vaultPath) : relativePath;
    editor
      .chain()
      .focus()
      .insertContent({
        type: "image",
        attrs: {
          src,
          alt,
          "data-md-src": relativePath,
        },
      })
      .run();
    emitChange();
  }

  function setImageWidth(width: string) {
    if (!editor) return;
    editor.chain().focus().updateAttributes("image", { width }).run();
    emitChange();
    imageMenuOpen = false;
  }

  function toggleAiMenu(e: MouseEvent) {
    e.stopPropagation();
    readSelectionFromEditor();
    aiMenuOpen = !aiMenuOpen;
  }

  function runAi(e: MouseEvent, action: AiAction, translateTo?: TranslateLang) {
    e.stopPropagation();
    aiMenuOpen = false;
    translateMenuOpen = false;
    readSelectionFromEditor();
    onAiAction({ action, selection: selection ?? undefined, translateTo });
    selection = null;
  }

  function handleWindowClick(e: MouseEvent) {
    if (aiMenuRef && !aiMenuRef.contains(e.target as Node)) {
      aiMenuOpen = false;
      translateMenuOpen = false;
    }
    const target = e.target as HTMLElement;
    if (target.closest?.(".wikilink")) {
      const title = target.closest(".wikilink")?.getAttribute("data-wikilink");
      if (title) {
        e.preventDefault();
        onOpenWikilink?.(title);
      }
    }
  }

  function openEditorContextMenu(e: MouseEvent) {
    e.preventDefault();
    readSelectionFromEditor();
    editorMenuHasSelection = !!selection;
    selectionPinned = !!selection;
    editorMenuPos = { x: e.clientX, y: e.clientY };
    editorMenuOpen = true;
  }

  function closeEditorContextMenu() {
    editorMenuOpen = false;
    selectionPinned = false;
  }

  function handleEditorMenuAction(request: AiActionRequest) {
    closeEditorContextMenu();
    onAiAction({
      ...request,
      selection: selection ?? request.selection,
    });
    selection = null;
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

  function navigateOutline(offset: number) {
    if (!editor) return;
    const pos = mdOffsetToPos(content, offset);
    editor.chain().focus().setTextSelection(pos).run();
    const dom = editor.view.domAtPos(pos);
    (dom.node as HTMLElement).parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  const toolbarButtons: { label: string; title: string; action: () => void }[] = [
    {
      label: "B",
      title: "Gras",
      action: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      label: "I",
      title: "Italique",
      action: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      label: "U",
      title: "Souligné",
      action: () => editor?.chain().focus().toggleUnderline().run(),
    },
    {
      label: "S",
      title: "Barré",
      action: () => editor?.chain().focus().toggleStrike().run(),
    },
    {
      label: "H1",
      title: "Titre 1",
      action: () => editor?.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      label: "H2",
      title: "Titre 2",
      action: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "H3",
      title: "Titre 3",
      action: () => editor?.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      label: "H4",
      title: "Titre 4",
      action: () => editor?.chain().focus().toggleHeading({ level: 4 }).run(),
    },
    {
      label: "⟸",
      title: "Aligner à gauche",
      action: () => editor?.chain().focus().setTextAlign("left").run(),
    },
    {
      label: "≡",
      title: "Centrer",
      action: () => editor?.chain().focus().setTextAlign("center").run(),
    },
    {
      label: "⟹",
      title: "Aligner à droite",
      action: () => editor?.chain().focus().setTextAlign("right").run(),
    },
    {
      label: "⇔",
      title: "Justifier",
      action: () => editor?.chain().focus().setTextAlign("justify").run(),
    },
    {
      label: "•",
      title: "Liste à puces",
      action: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      label: "1.",
      title: "Liste numérotée",
      action: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "☑",
      title: "Liste de tâches",
      action: () => editor?.chain().focus().toggleTaskList().run(),
    },
    {
      label: "<>",
      title: "Code",
      action: () => editor?.chain().focus().toggleCode().run(),
    },
    {
      label: "{ }",
      title: "Bloc code",
      action: () => editor?.chain().focus().toggleCodeBlock().run(),
    },
    {
      label: "❝",
      title: "Citation",
      action: () => editor?.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "—",
      title: "Ligne horizontale",
      action: () => editor?.chain().focus().setHorizontalRule().run(),
    },
    {
      label: "🖍",
      title: "Surlignage",
      action: () => editor?.chain().focus().toggleHighlight().run(),
    },
    {
      label: "🔗",
      title: "Lien",
      action: () => {
        const url = prompt("URL du lien :");
        if (!url) return;
        editor?.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
      },
    },
    {
      label: "[[ ]]",
      title: "Wikilink",
      action: () => {
        const name = prompt("Titre de la note :");
        if (!name?.trim()) return;
        editor?.commands.setWikiLink(name.trim());
        emitChange();
      },
    },
    {
      label: "⌫",
      title: "Effacer le formatage",
      action: () => editor?.chain().focus().unsetAllMarks().clearNodes().run(),
    },
  ];

  onMount(() => {
    if (!editorHost) return;

    editor = new Editor({
      element: editorHost,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3, 4] },
        }),
        Underline,
        Highlight.configure({ multicolor: false }),
        TextAlign.configure({
          types: ["heading", "paragraph"],
          alignments: ["left", "center", "right", "justify"],
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Link.configure({ openOnClick: false, autolink: true }),
        Placeholder.configure({
          placeholder: "Écrivez… Clic droit pour l'IA · [[Note]] pour un wikilink · glisser une image.",
        }),
        ResizableImage.configure({
          inline: false,
          allowBase64: false,
        }),
        WikiLink.configure({
          onOpen: (t) => onOpenWikilink?.(t),
        }),
      ],
      content: markdownToHtml(content, notePath, vaultPath) || "<p></p>",
      editorProps: {
        attributes: {
          class: "tiptap-editor prose-note focus:outline-none",
        },
        handleDOMEvents: {
          contextmenu: (_view, event) => {
            openEditorContextMenu(event as MouseEvent);
            return true;
          },
          paste: (_view, event) => {
            const ce = event as ClipboardEvent;
            const items = ce.clipboardData?.items;
            if (items) {
              for (const item of items) {
                if (item.kind === "file" && item.type.startsWith("image/")) {
                  void handlePaste(ce);
                  return true; // Prevent ProseMirror default paste for images
                }
              }
            }
            return false;
          },
        },
      },
      onUpdate: () => emitChange(),
      onSelectionUpdate: () => readSelectionFromEditor(),
    });

    lastEmitted = content;
    outlineItems = extractOutline(content);
  });

  onDestroy(() => {
    if (proactiveTimer) clearTimeout(proactiveTimer);
    if (autoTypoTimer) clearTimeout(autoTypoTimer);
    editor?.destroy();
    editor = null;
  });

  // Sync external content + restore caret (même tick : évite le saut au titre)
  $effect(() => {
    const md = content;
    const cursor = editorCursor;
    const range = highlightRange;
    if (!editor) return;

    if (md !== lastEmitted) {
      setEditorFromMarkdown(md);
    }

    if (cursor != null) {
      const pos = mdOffsetToPos(md, cursor);
      try {
        editor.chain().focus().setTextSelection(pos).run();
      } catch {
        /* ignore */
      }
      onCursorRestored?.();
    } else if (range) {
      const from = mdOffsetToPos(md, range.start);
      const to = mdOffsetToPos(md, range.end);
      try {
        editor.chain().focus().setTextSelection({ from, to }).run();
      } catch {
        /* ignore */
      }
    }
  });

  $effect(() => {
    const snippet = insertImageMarkdown;
    if (!snippet || !editor) return;
    const m = /!\[([^\]]*)\]\(([^)]+)\)/.exec(snippet);
    if (m) {
      insertImageAtCursor(m[2], m[1].replace(/\|w:.*$/, "") || "image");
    }
    onImageMarkdownConsumed?.();
  });
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
      </p>
    </div>

    <div class="flex items-center gap-2">
      <button
        type="button"
        class="rounded-2xl border border-border bg-surface px-3 py-1.5 text-xs transition hover:bg-surface-muted"
        onclick={onInsertImage}
        title="Insérer une image à la position du curseur"
      >
        Image
      </button>

      <div class="relative">
        <button
          type="button"
          class="rounded-2xl border border-border bg-surface px-3 py-1.5 text-xs transition hover:bg-surface-muted"
          onclick={() => (imageMenuOpen = !imageMenuOpen)}
          title="Redimensionner l'image sélectionnée"
        >
          Taille
        </button>
        {#if imageMenuOpen}
          <div
            class="absolute right-0 top-full z-50 mt-1 min-w-[8rem] overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lg"
            style:box-shadow="var(--shadow)"
          >
            {#each [["280", "S"], ["420", "M"], ["640", "L"], ["100%", "100%"]] as [w, label]}
              <button
                type="button"
                class="block w-full px-3 py-1.5 text-left text-xs hover:bg-surface-muted"
                onclick={() => setImageWidth(w)}
              >
                {label}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <div class="relative flex items-stretch overflow-hidden rounded-2xl border border-border" bind:this={aiMenuRef}>
        {#if onToggleCompanion}
          <button
            type="button"
            class="bg-surface px-3 py-1.5 text-xs transition hover:bg-surface-muted {companionOpen
              ? 'bg-accent-lavender/30'
              : ''}"
            onclick={onToggleCompanion}
            title="Afficher / masquer le panneau suggestions"
          >
            Compagnon IA
          </button>
        {/if}
        <button
          type="button"
          class="border-l border-border bg-surface px-2 py-1.5 text-xs transition hover:bg-surface-muted disabled:opacity-40"
          disabled={aiLoading}
          title={ollamaAvailable ? "Actions IA" : "Configurez Ollama dans les réglages"}
          onclick={toggleAiMenu}
          aria-label="Menu actions IA"
        >
          {aiLoading ? "…" : "▾"}
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
                Cible : sélection ({selection.text.length} car.)
              </p>
            {:else}
              <p class="border-b border-border px-3 py-1.5 text-[10px] text-text-muted">
                Cible : note entière
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
            <button
              type="button"
              class="block w-full px-3 py-2 text-left transition hover:bg-surface-muted disabled:opacity-40"
              disabled={!ollamaAvailable || aiLoading}
              onclick={(e) => {
                e.stopPropagation();
                translateMenuOpen = !translateMenuOpen;
              }}
            >
              <span class="block text-xs font-medium">Traduire ▾</span>
              <span class="block text-[10px] text-text-muted">EN · DE · ES · IT · PT · NL</span>
            </button>
            {#if translateMenuOpen}
              <div class="border-t border-border bg-surface-muted/50 py-1">
                {#each TRANSLATE_LANGUAGES as lang (lang.id)}
                  <button
                    type="button"
                    class="block w-full px-4 py-1.5 text-left text-xs transition hover:bg-accent-blue/20 disabled:opacity-40"
                    disabled={!ollamaAvailable || aiLoading}
                    onclick={(e) => runAi(e, "translate", lang.id)}
                  >
                    {lang.label}
                    <span class="text-text-muted"> · {lang.native}</span>
                  </button>
                {/each}
              </div>
            {/if}
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

  <div
    class="flex flex-wrap items-center gap-1 border-b border-border bg-surface-muted/50 px-4 py-1.5"
    role="toolbar"
    aria-label="Formatage"
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

  <OutlinePanel items={outlineItems} onNavigate={navigateOutline} />

  <div
    class="flex min-h-0 flex-1 overflow-y-auto"
    role="region"
    aria-label="Zone d'édition TipTap"
    ondragover={(e) => e.preventDefault()}
    ondrop={handleDrop}
  >
    <div bind:this={editorHost} class="tiptap-host flex-1 px-6 py-4"></div>
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
