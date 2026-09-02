<script lang="ts">
  import type { AiSuggestion, VoiceStatus } from "$lib/types";
  import SuggestionDiff from "$lib/components/SuggestionDiff.svelte";
  import {
    VOICE_CATEGORY_LABELS,
    VOICE_COMMANDS,
    type VoiceCommandInfo,
  } from "$lib/voice/commands";
  import {
    loadCompanionPanelPos,
    saveCompanionPanelPos,
    loadCompanionPanelSize,
    saveCompanionPanelSize,
    COMPANION_SIZE_PRESETS,
    companionPanelWidth,
    companionPanelMaxHeight,
    loadCustomPrompt,
    saveCustomPrompt,
    defaultCompanionPanelPos,
    type CompanionPanelPos,
    type CompanionPanelSize,
  } from "$lib/stores/companion";

  interface Props {
    open: boolean;
    voiceStatus: VoiceStatus;
    noteContext: string;
    suggestions: AiSuggestion[];
    aiLoading: boolean;
    proactiveLoading: boolean;
    proactiveEnabled: boolean;
    autoTypoFixEnabled: boolean;
    proactiveStatus?: string;
    customTargetLabel?: string;
    notePath?: string | null;
    onToggleRecord: () => void;
    onContextChange: (value: string) => void;
    onProactiveToggle: (enabled: boolean) => void;
    onAutoTypoToggle: (enabled: boolean) => void;
    onCustomPrompt: (prompt: string) => void;
    onApply: (id: string) => void;
    onDismiss: (id: string) => void;
    onDismissAll: () => void;
    onClose: () => void;
  }

  let {
    open,
    voiceStatus,
    noteContext,
    suggestions,
    aiLoading,
    proactiveLoading,
    proactiveEnabled,
    autoTypoFixEnabled,
    proactiveStatus = "",
    customTargetLabel = "note entière",
    notePath = null,
    onToggleRecord,
    onContextChange,
    onProactiveToggle,
    onAutoTypoToggle,
    onCustomPrompt,
    onApply,
    onDismiss,
    onDismissAll,
    onClose,
  }: Props = $props();

  let contextExpanded = $state(false);
  let voiceCommandsOpen = $state(false);
  let customPrompt = $state("");
  let panelSize = $state<CompanionPanelSize>("m");
  let panelRef = $state<HTMLDivElement | null>(null);
  let pos = $state<CompanionPanelPos>({ x: 16, y: 16 });
  let dragging = $state(false);
  let dragOffset = $state({ x: 0, y: 0 });

  const voiceCategories = ["dictée", "ia", "navigation"] as const;

  const voiceStateLabel = $derived.by(() => {
    if (voiceStatus.error) return "Erreur voix";
    if (!voiceStatus.running) return "Voix inactive";
    if (voiceStatus.recording) return "Enregistrement…";
    if (voiceStatus.transcribing) return "Transcription…";
    if (voiceStatus.modelLoading) return "Chargement…";
    return "Dictée prête";
  });

  const recordBtnClass = $derived.by(() => {
    if (voiceStatus.error || !voiceStatus.running) return "border-danger/40 bg-danger/10";
    if (voiceStatus.recording) return "border-danger bg-danger/15";
    if (voiceStatus.transcribing || voiceStatus.modelLoading) return "border-accent-blue/50 bg-accent-blue/10";
    return "border-border bg-surface-muted";
  });

  function commandsFor(cat: VoiceCommandInfo["category"]) {
    return VOICE_COMMANDS.filter((c) => c.category === cat);
  }

  $effect(() => {
    if (notePath) contextExpanded = false;
  });

  $effect(() => {
    if (open && typeof window !== "undefined") {
      panelSize = loadCompanionPanelSize();
      pos = loadCompanionPanelPos() ?? defaultCompanionPanelPos(panelSize);
      customPrompt = loadCustomPrompt();
    }
  });

  function setPanelSize(size: CompanionPanelSize) {
    if (panelSize === size) return;
    panelSize = size;
    saveCompanionPanelSize(size);
    pos = clampPos(pos);
    saveCompanionPanelPos(pos);
  }

  function submitCustomPrompt() {
    const trimmed = customPrompt.trim();
    if (!trimmed || aiLoading) return;
    saveCustomPrompt(customPrompt);
    onCustomPrompt(trimmed);
  }

  function onCustomPromptKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submitCustomPrompt();
    }
  }

  function panelWidth() {
    return companionPanelWidth(panelSize);
  }

  function panelMaxH() {
    return companionPanelMaxHeight(panelSize);
  }

  function clampPos(next: CompanionPanelPos): CompanionPanelPos {
    if (typeof window === "undefined") return next;
    const w = panelRef?.offsetWidth ?? panelWidth();
    const h = panelRef?.offsetHeight ?? 320;
    return {
      x: Math.min(Math.max(8, next.x), Math.max(8, window.innerWidth - w - 8)),
      y: Math.min(Math.max(8, next.y), Math.max(8, window.innerHeight - h - 8)),
    };
  }

  function onHeaderPointerDown(e: PointerEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    dragging = true;
    dragOffset = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onHeaderPointerMove(e: PointerEvent) {
    if (!dragging) return;
    pos = clampPos({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
  }

  function onHeaderPointerUp(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    saveCompanionPanelPos(pos);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }
</script>

{#if open}
  <div
    bind:this={panelRef}
    class="fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl {dragging
      ? 'select-none'
      : ''}"
    style:left="{pos.x}px"
    style:top="{pos.y}px"
    style:width="{panelWidth()}px"
    style:max-height="{panelMaxH()}px"
    style:box-shadow="var(--shadow)"
    aria-label="Compagnon IA — suggestions"
  >
    <header
      role="toolbar"
      tabindex="0"
      aria-label="Déplacer le panneau compagnon IA"
      class="flex cursor-grab items-center justify-between border-b border-border bg-surface-muted px-3 py-2 active:cursor-grabbing"
      onpointerdown={onHeaderPointerDown}
      onpointermove={onHeaderPointerMove}
      onpointerup={onHeaderPointerUp}
      onpointercancel={onHeaderPointerUp}
    >
      <div class="min-w-0 pr-2">
        <h3 class="text-sm font-semibold">◈ Compagnon IA</h3>
        <p class="text-[10px] text-text-muted">Dictée · corrections · prompt · suggestions</p>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <div
          class="flex rounded-lg border border-border bg-surface p-0.5"
          role="group"
          aria-label="Taille du panneau"
        >
          {#each (["s", "m", "l"] as const) as size (size)}
            <button
              type="button"
              class="rounded-md px-2 py-0.5 text-[10px] font-semibold transition {panelSize === size
                ? 'bg-accent-lavender/35 text-text'
                : 'text-text-muted hover:bg-surface-muted hover:text-text'}"
              title={COMPANION_SIZE_PRESETS[size].title}
              aria-pressed={panelSize === size}
              onclick={() => setPanelSize(size)}
            >
              {COMPANION_SIZE_PRESETS[size].label}
            </button>
          {/each}
        </div>
        <button
          type="button"
          class="rounded-lg px-2 py-1 text-xs text-text-muted hover:bg-surface"
          onclick={onClose}
          aria-label="Fermer"
        >
          ✕
        </button>
      </div>
    </header>

    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <section class="border-b border-border bg-accent-lavender/10 px-3 py-2.5">
        <p class="text-[10px] font-semibold uppercase tracking-wide text-accent-lavender">Prompt personnalisé</p>
        <textarea
          class="mt-1.5 w-full resize-none rounded-xl border border-accent-lavender/40 bg-surface px-2 py-1.5 text-xs leading-relaxed outline-none focus:ring-2 focus:ring-accent-lavender"
          rows="3"
          placeholder="Ex. : Raccourcis en 2 phrases · Mets au formel · Extrais les tâches…"
          bind:value={customPrompt}
          oninput={() => saveCustomPrompt(customPrompt)}
          onkeydown={onCustomPromptKeydown}
        ></textarea>
        <div class="mt-1.5 flex items-center justify-between gap-2">
          <p class="min-w-0 text-[10px] text-text-muted">
            Cible : <span class="font-medium text-text">{customTargetLabel}</span>
            <span class="block text-[9px]">Ctrl+Entrée pour lancer</span>
          </p>
          <button
            type="button"
            class="shrink-0 rounded-xl border border-accent-lavender bg-accent-lavender/25 px-3 py-1.5 text-[10px] font-semibold transition hover:bg-accent-lavender/40 disabled:opacity-40"
            disabled={!customPrompt.trim() || aiLoading || proactiveLoading}
            onclick={submitCustomPrompt}
          >
            Lancer →
          </button>
        </div>
      </section>

      <section class="border-b border-border bg-surface-muted/40 px-3 py-2.5" aria-live="polite">
      <p class="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Dictée & commandes vocales</p>
      <div class="mt-2 flex items-center gap-2">
        <button
          type="button"
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition hover:scale-[1.02] {recordBtnClass}"
          onclick={onToggleRecord}
          title="Dictée · {voiceStatus.hotkey} · {voiceStateLabel}"
          aria-label="{voiceStateLabel}. Appuyez sur {voiceStatus.hotkey} pour dicter."
        >
          <span class="text-xl" class:animate-pulse={voiceStatus.recording}>🎙</span>
        </button>
        <div class="min-w-0 flex-1">
          <p class="text-xs font-medium text-text">{voiceStateLabel}</p>
          <p class="text-[10px] text-text-muted">
            {#if voiceStatus.running}
              {voiceStatus.hotkey} pour dicter · « Scribe, corrige »…
            {:else}
              Réglages → Voix pour activer le worker
            {/if}
          </p>
          {#if voiceStatus.error}
            <p class="mt-0.5 text-[10px] text-danger">{voiceStatus.error}</p>
          {/if}
        </div>
        <button
          type="button"
          class="shrink-0 rounded-xl border px-2.5 py-1.5 text-[10px] font-medium transition {voiceCommandsOpen
            ? 'border-accent-lavender bg-accent-lavender/25 text-text'
            : 'border-border bg-surface hover:bg-accent-lavender/15'}"
          onclick={() => (voiceCommandsOpen = !voiceCommandsOpen)}
          aria-expanded={voiceCommandsOpen}
        >
          🗣 Commandes
        </button>
      </div>
      {#if voiceCommandsOpen}
        <div class="mt-2 max-h-44 overflow-y-auto rounded-xl border border-border bg-surface py-1">
          {#each voiceCategories as cat (cat)}
            <div class="px-1 py-0.5">
              <p class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                {VOICE_CATEGORY_LABELS[cat]}
              </p>
              {#each commandsFor(cat) as cmd (cmd.phrase)}
                <div class="mx-1 rounded-md px-2 py-1">
                  <p class="font-mono text-[10px] text-accent-blue">{cmd.phrase}</p>
                  <p class="text-[9px] leading-snug text-text-muted">{cmd.description}</p>
                </div>
              {/each}
            </div>
            {#if cat !== "navigation"}
              <div class="my-1 border-t border-border/70"></div>
            {/if}
          {/each}
        </div>
      {/if}
    </section>

    <section class="border-b border-border px-3 py-2">
      <p class="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Contexte (dans la note)</p>
      {#key notePath}
        {#if noteContext.trim()}
          <blockquote class="note-context note-context-inline mt-1 rounded-xl px-2 py-1.5 text-[11px] leading-relaxed">
            {noteContext.trim()}
          </blockquote>
        {:else}
          <p class="mt-1 text-[10px] text-text-muted">Aucun contexte — modifiable en tête de note.</p>
        {/if}
        <button
          type="button"
          class="mt-1 text-[10px] font-medium text-accent-blue hover:underline"
          onclick={() => (contextExpanded = !contextExpanded)}
        >
          {contextExpanded ? "Masquer le contexte" : "Modifier le contexte"}
        </button>
        {#if contextExpanded}
          <textarea
            id="note-context-field"
            class="mt-1 w-full resize-none rounded-xl border border-border bg-surface px-2 py-1.5 text-xs leading-relaxed outline-none focus:ring-1 focus:ring-accent-lavender"
            rows="2"
            placeholder="Ex. : journal, recette, compte-rendu…"
            value={noteContext}
            oninput={(e) => onContextChange(e.currentTarget.value)}
          ></textarea>
        {/if}
      {/key}

      <label class="mt-2 flex cursor-pointer items-start gap-2 text-[11px] text-text-muted">
        <input
          type="checkbox"
          class="mt-0.5"
          checked={autoTypoFixEnabled}
          onchange={(e) => onAutoTypoToggle(e.currentTarget.checked)}
        />
        <span>
          <strong class="text-text">Correction auto des fautes</strong> — orthographe corrigée au fil de l'écriture
        </span>
      </label>
      <label class="mt-2 flex cursor-pointer items-start gap-2 text-[11px] text-text-muted">
        <input
          type="checkbox"
          class="mt-0.5"
          checked={proactiveEnabled}
          onchange={(e) => onProactiveToggle(e.currentTarget.checked)}
        />
        <span>
          <strong class="text-text">Suggestions contextuelles</strong> — reformulation / idées (pause ~4 s)
        </span>
      </label>
    </section>

    <div class="flex items-center justify-between border-b border-border px-3 py-1.5">
      <span class="text-[10px] font-medium text-text-muted">
        {suggestions.length} suggestion{suggestions.length === 1 ? "" : "s"}
      </span>
      {#if suggestions.length}
        <button type="button" class="text-[10px] text-text-muted hover:text-text" onclick={onDismissAll}>
          Tout ignorer
        </button>
      {/if}
    </div>

    <div class="space-y-2 px-3 py-2">
      {#if aiLoading || proactiveLoading}
        <p class="text-xs text-accent-blue">
          {proactiveLoading ? "Analyse contextuelle…" : "Réflexion en cours…"}
        </p>
      {:else if proactiveStatus}
        <p class="text-xs text-text-muted">{proactiveStatus}</p>
      {/if}

      {#if suggestions.length === 0 && !aiLoading && !proactiveLoading && !proactiveStatus}
        <p class="text-xs text-text-muted">
          Fautes corrigées automatiquement si l'option est active. Ici : suggestions de fond à valider.
        </p>
      {/if}

      {#each suggestions as s (s.id)}
        <article class="rounded-xl border border-border bg-surface-muted/80 p-2.5">
          <div class="mb-1 flex items-center justify-between gap-2">
            <span class="text-[10px] font-semibold text-accent-lavender">{s.label}</span>
            <span class="text-[9px] text-text-muted">
              {s.source === "proactive" ? "auto · " : ""}{s.scope}
            </span>
          </div>
          {#if s.reason}
            <p class="mb-1.5 text-[10px] leading-snug text-text-muted italic">{s.reason}</p>
          {/if}
          {#if s.proposedText.trim() || s.originalText.trim()}
            <SuggestionDiff originalText={s.originalText} proposedText={s.proposedText} />
          {:else}
            <p class="mb-2 text-[10px] text-danger">Proposition vide — relancez ou ignorez.</p>
          {/if}
          <div class="flex gap-1">
            <button
              type="button"
              class="flex-1 rounded-lg bg-accent-mint/40 px-2 py-1 text-[10px] font-medium hover:bg-accent-mint/60 disabled:opacity-40"
              disabled={!s.proposedText.trim()}
              onclick={() => onApply(s.id)}
            >
              Appliquer
            </button>
            <button
              type="button"
              class="rounded-lg border border-border px-2 py-1 text-[10px] hover:bg-surface"
              onclick={() => onDismiss(s.id)}
            >
              Ignorer
            </button>
          </div>
        </article>
      {/each}
    </div>
    </div>
  </div>
{/if}
