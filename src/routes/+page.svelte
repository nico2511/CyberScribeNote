<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { save, open } from "@tauri-apps/plugin-dialog";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import MarkdownEditor from "$lib/components/MarkdownEditor.svelte";
  import SearchPanel from "$lib/components/SearchPanel.svelte";
  import SettingsPanel from "$lib/components/SettingsPanel.svelte";
  import VoiceOverlay from "$lib/components/VoiceOverlay.svelte";
  import VoiceCommandsWidget from "$lib/components/VoiceCommandsWidget.svelte";
  import AiCompanionPanel from "$lib/components/AiCompanionPanel.svelte";
  import { applyTheme, loadTheme, saveTheme, toggleTheme } from "$lib/stores/theme";
  import { parseNoteContext, setNoteContext } from "$lib/note/frontmatter";
  import { insertTranscript, parseVoiceTranscript } from "$lib/voice/keywords";
  import { replaceTextRange, type AiActionRequest } from "$lib/voice/commands";
  import type {
    AiAction,
    OllamaStatus,
    SearchResult,
    ThemeMode,
    VaultEntry,
    VoiceStatus,
    VoiceTranscript,
    AiSuggestion,
  } from "$lib/types";

  let entries = $state<VaultEntry[]>([]);
  let vaultPath = $state("");
  let selectedPath = $state<string | null>(null);
  let content = $state("");
  let savedContent = $state("");
  let dirty = $state(false);
  let saving = $state(false);
  let preview = $state(false);
  let theme = $state<ThemeMode>("light");
  let searchOpen = $state(false);
  let settingsOpen = $state(false);
  let voiceMenuOpen = $state(false);
  let voiceMenuPos = $state({ x: 0, y: 0 });
  let searchQuery = $state("");
  let searchResults = $state<SearchResult[]>([]);
  let searchLoading = $state(false);
  let ollamaStatus = $state<OllamaStatus>({
    available: false,
    models: [],
    host: "http://127.0.0.1:11434",
    selectedModel: "llama3.2",
    networkMode: "local",
    isLocalhost: true,
  });
  let aiLoading = $state(false);
  let companionOpen = $state(false);
  let aiSuggestions = $state<AiSuggestion[]>([]);
  let statusMessage = $state("");
  let voiceStatus = $state<VoiceStatus>({
    running: false,
    recording: false,
    transcribing: false,
    modelLoaded: false,
    modelLoading: false,
    depsOk: false,
    hotkey: "F8",
  });

  let unlisteners: UnlistenFn[] = [];

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  let title = $derived.by(() => {
    if (!selectedPath) return "Aucune note sélectionnée";
    const name = selectedPath.split("/").pop() ?? selectedPath;
    return name.replace(/\.md$/, "");
  });

  let activeModel = $derived(ollamaStatus.selectedModel || ollamaStatus.models[0] || "llama3.2");
  let noteContext = $derived(parseNoteContext(content));

  let contextSaveTimer: ReturnType<typeof setTimeout> | null = null;

  async function refreshVoice() {
    voiceStatus = await invoke<VoiceStatus>("voice_get_status");
  }

  async function handleVoiceToggle() {
    try {
      await invoke("voice_toggle");
      await refreshVoice();
    } catch (e) {
      statusMessage = String(e);
      try {
        await invoke("voice_restart");
        await refreshVoice();
        statusMessage = "Worker vocal relancé.";
      } catch {
        /* keep original error */
      }
    }
  }

  function openVoiceMenu(e: MouseEvent) {
    e.preventDefault();
    voiceMenuPos = { x: e.clientX, y: e.clientY };
    voiceMenuOpen = true;
  }

  function closeVoiceMenu() {
    voiceMenuOpen = false;
  }

  async function handleVoiceTranscript(text: string) {
    if (!text.trim()) {
      statusMessage = "Aucune parole détectée.";
      return;
    }

    const parsed = parseVoiceTranscript(text);

    if (parsed.kind === "search") {
      openSearch();
      await runSearch(parsed.query);
      statusMessage = `Recherche vocale : ${parsed.query}`;
      return;
    }

    if (parsed.kind === "ai") {
      if (!selectedPath) {
        statusMessage = "Ouvrez une note pour les commandes IA vocales.";
        return;
      }
      await handleAiAction({ action: parsed.action });
      return;
    }

    if (!selectedPath) {
      statusMessage = "Ouvrez une note pour insérer la transcription.";
      return;
    }

    handleContentChange(insertTranscript(content, parsed.text));
    statusMessage = "Transcription insérée.";
  }

  async function refreshOllama() {
    ollamaStatus = await invoke<OllamaStatus>("ollama_status");
  }

  async function refreshVault() {
    vaultPath = await invoke<string>("init_vault");
    entries = await invoke<VaultEntry[]>("list_vault");
  }

  async function loadNote(path: string) {
    if (dirty && selectedPath) {
      await persistNote(selectedPath, content);
    }
    selectedPath = path;
    content = await invoke<string>("read_note", { relativePath: path });
    savedContent = content;
    dirty = false;
    preview = false;
    aiSuggestions = [];
  }

  async function persistNote(path: string, body: string) {
    saving = true;
    try {
      await invoke("write_note", { relativePath: path, content: body });
      savedContent = body;
      dirty = false;
    } finally {
      saving = false;
    }
  }

  function scheduleAutoSave() {
    if (!selectedPath) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (dirty && selectedPath) persistNote(selectedPath, content);
    }, 1200);
  }

  function handleContentChange(value: string) {
    content = value;
    dirty = value !== savedContent;
    scheduleAutoSave();
  }

  async function handleCreateNote(parentPath: string) {
    const name = prompt("Nom de la note :");
    if (!name?.trim()) return;
    const path = await invoke<string>("create_note", { parentPath, name: name.trim() });
    await refreshVault();
    await loadNote(path);
  }

  async function handleCreateFolder(parentPath: string) {
    const name = prompt("Nom du dossier :");
    if (!name?.trim()) return;
    await invoke("create_folder", { parentPath, name: name.trim() });
    await refreshVault();
  }

  async function handleDelete(path: string) {
    if (!confirm(`Supprimer « ${path} » ?`)) return;
    await invoke("delete_item", { relativePath: path });
    if (selectedPath === path) {
      selectedPath = null;
      content = "";
      savedContent = "";
      dirty = false;
    }
    await refreshVault();
  }

  async function handleMove(sourcePath: string, destinationParent: string) {
    try {
      const newPath = await invoke<string>("move_vault_item", {
        relativePath: sourcePath,
        destinationParent,
      });

      if (selectedPath === sourcePath) {
        selectedPath = newPath;
      } else if (selectedPath?.startsWith(`${sourcePath}/`)) {
        selectedPath = `${newPath}${selectedPath.slice(sourcePath.length)}`;
      }

      await refreshVault();
      statusMessage = destinationParent
        ? `Déplacé dans « ${destinationParent} »`
        : "Déplacé à la racine du vault";
    } catch (e) {
      statusMessage = String(e);
    }
  }

  async function handleAiAction(request: AiActionRequest) {
    const { action, selection: sel } = request;
    const targetText = sel?.text ?? content;
    if (!targetText.trim()) return;

    if (!ollamaStatus.available) {
      settingsOpen = true;
      statusMessage = "Configurez Ollama dans les réglages.";
      return;
    }

    aiLoading = true;
    companionOpen = true;
    const labels: Record<AiAction, string> = {
      summarize: "Résumé",
      reformulate: "Reformulation",
      correct: "Correction",
      translate_en: "Traduction",
    };
    const scope = sel ? "sélection" : "note";
    statusMessage = `${labels[action]} (${scope}) — suggestion en cours…`;

    try {
      let result: string;
      const ctx = noteContext.trim() || null;
      if (action === "summarize") {
        result = await invoke<string>("ollama_summarize_note", {
          content: targetText,
          model: activeModel,
          noteContext: ctx,
        });
      } else {
        result = await invoke<string>("ollama_transform_note", {
          action,
          content: targetText,
          model: activeModel,
          noteContext: ctx,
        });
      }

      aiSuggestions = [
        {
          id: crypto.randomUUID(),
          action,
          label: labels[action],
          scope,
          proposedText: result.trim(),
          originalText: targetText,
          selection: sel ? { start: sel.start, end: sel.end, text: sel.text } : undefined,
        },
        ...aiSuggestions,
      ].slice(0, 12);
      statusMessage = `Suggestion « ${labels[action]} » prête — appliquez ou ignorez.`;
    } catch (e) {
      statusMessage = `Erreur IA : ${e}`;
    } finally {
      aiLoading = false;
    }
  }

  function applySuggestion(id: string) {
    const suggestion = aiSuggestions.find((s) => s.id === id);
    if (!suggestion) return;

    if (suggestion.action === "summarize" && !suggestion.selection) {
      const block = `\n\n---\n**${suggestion.label} IA**\n\n${suggestion.proposedText}\n`;
      handleContentChange(content + block);
    } else if (suggestion.selection) {
      handleContentChange(
        replaceTextRange(
          content,
          suggestion.selection.start,
          suggestion.selection.end,
          suggestion.proposedText,
        ),
      );
    } else {
      handleContentChange(suggestion.proposedText);
    }

    aiSuggestions = aiSuggestions.filter((s) => s.id !== id);
    statusMessage = "Suggestion appliquée.";
  }

  function dismissSuggestion(id: string) {
    aiSuggestions = aiSuggestions.filter((s) => s.id !== id);
  }

  function handleNoteContextChange(value: string) {
    const next = setNoteContext(content, value);
    handleContentChange(next);
    if (!selectedPath) return;
    if (contextSaveTimer) clearTimeout(contextSaveTimer);
    contextSaveTimer = setTimeout(() => {
      persistNote(selectedPath!, next);
    }, 800);
  }

  async function insertImageMarkdown(relative: string) {
    const alt = relative.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "image";
    const snippet = `\n\n![${alt}](${relative})\n`;
    handleContentChange(content + snippet);
    statusMessage = `Image copiée dans ${relative.includes("/_media/") || relative.startsWith("_media/") ? "le dossier de la note" : "media/"}.`;
  }

  async function importImageFromPath(sourcePath: string, useGlobalMedia = false) {
    const relative = await invoke<string>("import_image", {
      sourcePath,
      notePath: selectedPath,
      useGlobalMedia,
    });
    await insertImageMarkdown(relative);
  }

  async function importImagesFromPaths(paths: string[]) {
    if (!selectedPath) {
      statusMessage = "Ouvrez une note pour y insérer une image.";
      return;
    }
    for (const sourcePath of paths) {
      await importImageFromPath(sourcePath, false);
    }
  }

  async function importPastedImage(base64: string, extension: string) {
    if (!selectedPath) {
      statusMessage = "Ouvrez une note pour y coller une image.";
      return;
    }
    const relative = await invoke<string>("import_image_bytes", {
      dataBase64: base64,
      extension,
      notePath: selectedPath,
      useGlobalMedia: false,
    });
    await insertImageMarkdown(relative);
  }

  async function handleInsertImage() {
    if (!selectedPath) {
      statusMessage = "Ouvrez une note pour y insérer une image.";
      return;
    }

    const picked = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"] }],
    });
    if (!picked) return;

    const sourcePath = typeof picked === "string" ? picked : picked;
    try {
      await importImageFromPath(sourcePath, false);
    } catch (e) {
      statusMessage = `Erreur image : ${e}`;
    }
  }

  async function handleExport() {
    if (!selectedPath) return;
    const dest = await save({
      defaultPath: selectedPath.split("/").pop() ?? "note.md",
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!dest) return;
    await invoke("export_note", { relativePath: selectedPath, destination: dest });
    statusMessage = "Note exportée.";
  }

  function handleThemeToggle() {
    theme = toggleTheme(theme);
    saveTheme(theme);
  }

  async function runSearch(q: string) {
    searchQuery = q;
    if (searchTimer) clearTimeout(searchTimer);
    if (!q.trim()) {
      searchResults = [];
      return;
    }
    searchLoading = true;
    searchTimer = setTimeout(async () => {
      try {
        searchResults = await invoke<SearchResult[]>("search_vault", { query: q });
      } finally {
        searchLoading = false;
      }
    }, 200);
  }

  function openSearch() {
    searchOpen = true;
    searchQuery = "";
    searchResults = [];
  }

  function closeSearch() {
    searchOpen = false;
  }

  function openSettings() {
    settingsOpen = true;
  }

  function closeSettings() {
    settingsOpen = false;
  }

  async function selectFromSearch(path: string) {
    closeSearch();
    await loadNote(path);
  }

  function onGlobalKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "t") {
      e.preventDefault();
      if (searchOpen) closeSearch();
      else openSearch();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === ",") {
      e.preventDefault();
      if (settingsOpen) closeSettings();
      else openSettings();
    }
  }

  onMount(async () => {
    theme = loadTheme();
    applyTheme(theme);
    await refreshVault();
    await refreshOllama();
    await refreshVoice();

    unlisteners.push(
      await listen<VoiceTranscript>("voice-transcript", (event) => {
        handleVoiceTranscript(event.payload.text);
      }),
      await listen("voice-event", async () => {
        await refreshVoice();
      }),
      await listen("voice-worker-stopped", async () => {
        await refreshVoice();
        statusMessage = "Worker vocal arrêté. Appuyez sur la touche dictée ou Réglages → Voix.";
      }),
    );

    const welcome = entries.find((e) => !e.isDir && e.path === "Bienvenue.md");
    if (welcome) await loadNote(welcome.path);
  });

  onDestroy(() => {
    for (const u of unlisteners) u();
  });
</script>

<svelte:window onkeydown={onGlobalKeydown} />

<div class="flex h-screen flex-col overflow-hidden">
  <header class="flex items-center justify-between border-b border-border bg-surface px-4 py-2">
    <div class="flex items-center gap-3 text-xs text-text-muted">
      <span
        class="pixel-icon cursor-context-menu rounded-lg bg-accent-mint/30 px-2 py-1"
        title="Commandes vocales (clic droit)"
        oncontextmenu={openVoiceMenu}
        role="button"
        tabindex="0"
      >
        ◈ Local
      </span>
      <button
        type="button"
        class="rounded-lg px-2 py-0.5 transition hover:bg-surface-muted {voiceStatus.recording ? 'bg-danger/20' : ''}"
        onclick={handleVoiceToggle}
        oncontextmenu={openVoiceMenu}
        title="Dictée vocale ({voiceStatus.hotkey}) · clic droit : commandes"
      >
        🎙 {voiceStatus.recording ? "REC…" : voiceStatus.hotkey}
      </button>
      <button
        type="button"
        class="rounded-lg px-1 transition hover:bg-surface-muted"
        onclick={openSettings}
        title="Réglages (Ctrl+,)"
      >
        Ollama : {ollamaStatus.available ? "connecté" : "hors ligne"}
        {#if ollamaStatus.available}
          · {activeModel}
        {/if}
      </button>
      {#if statusMessage}
        <span class="text-accent-blue">· {statusMessage}</span>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="rounded-2xl border border-border px-3 py-1.5 text-xs transition hover:bg-surface-muted"
        onclick={openSearch}
      >
        ⌕ Recherche
        <kbd class="ml-1 rounded border border-border px-1 text-[10px]">Ctrl+T</kbd>
      </button>
      <button
        type="button"
        class="rounded-2xl border border-border px-3 py-1.5 text-xs transition hover:bg-surface-muted"
        onclick={openSettings}
      >
        ⚙ Réglages
        <kbd class="ml-1 rounded border border-border px-1 text-[10px]">Ctrl+,</kbd>
      </button>
      <button
        type="button"
        class="rounded-2xl border border-border px-3 py-1.5 text-xs transition hover:bg-surface-muted"
        onclick={handleThemeToggle}
      >
        {theme === "light" ? "☾ Sombre" : "☀ Clair"}
      </button>
    </div>
  </header>

  <div class="flex min-h-0 flex-1">
    <Sidebar
      {entries}
      {vaultPath}
      {selectedPath}
      onSelect={loadNote}
      onRefresh={refreshVault}
      onCreateNote={handleCreateNote}
      onCreateFolder={handleCreateFolder}
      onDelete={handleDelete}
      onMove={handleMove}
    />

    {#if selectedPath}
      <div class="flex min-h-0 min-w-0 flex-1">
        <MarkdownEditor
          {content}
          {title}
          notePath={selectedPath}
          {vaultPath}
          {dirty}
          {saving}
          {preview}
          ollamaAvailable={ollamaStatus.available}
          {aiLoading}
          companionOpen={companionOpen}
          onChange={handleContentChange}
          onSave={() => selectedPath && persistNote(selectedPath, content)}
          onTogglePreview={() => (preview = !preview)}
          onAiAction={handleAiAction}
          onInsertImage={handleInsertImage}
          onImportImages={importImagesFromPaths}
          onPasteImageBytes={importPastedImage}
          onExport={handleExport}
          onToggleCompanion={() => (companionOpen = !companionOpen)}
        />
        <AiCompanionPanel
          open={companionOpen}
          {noteContext}
          suggestions={aiSuggestions}
          {aiLoading}
          onContextChange={handleNoteContextChange}
          onApply={applySuggestion}
          onDismiss={dismissSuggestion}
          onDismissAll={() => (aiSuggestions = [])}
          onClose={() => (companionOpen = false)}
        />
      </div>
    {:else}
      <section class="flex flex-1 flex-col items-center justify-center gap-4 bg-bg text-center">
        <span class="pixel-icon text-4xl">📓</span>
        <div>
          <h2 class="text-xl font-semibold">Sélectionnez ou créez une note</h2>
          <p class="mt-1 text-sm text-text-muted">
            Votre vault est dans Documents/CyberScribeNote/vault
          </p>
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            class="rounded-2xl bg-accent-lavender/50 px-4 py-2 text-sm font-medium transition hover:bg-accent-lavender/70"
            onclick={() => handleCreateNote("")}
          >
            + Nouvelle note
          </button>
          {#if !ollamaStatus.available}
            <button
              type="button"
              class="rounded-2xl border border-border px-4 py-2 text-sm transition hover:bg-surface-muted"
              onclick={openSettings}
            >
              Configurer Ollama
            </button>
          {/if}
        </div>
      </section>
    {/if}
  </div>
</div>

<SearchPanel
  open={searchOpen}
  query={searchQuery}
  results={searchResults}
  loading={searchLoading}
  onQueryChange={runSearch}
  onSelect={selectFromSearch}
  onClose={closeSearch}
/>

<SettingsPanel
  open={settingsOpen}
  onClose={closeSettings}
  onOllamaUpdated={(s) => (ollamaStatus = s)}
/>

<VoiceOverlay
  recording={voiceStatus.recording}
  transcribing={voiceStatus.transcribing}
  modelLoading={voiceStatus.modelLoading}
  hotkey={voiceStatus.hotkey}
/>

<VoiceCommandsWidget
  hotkey={voiceStatus.hotkey}
  open={voiceMenuOpen}
  x={voiceMenuPos.x}
  y={voiceMenuPos.y}
  onClose={closeVoiceMenu}
/>
