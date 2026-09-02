<script lang="ts">
  import { diffWords } from "$lib/ai/textDiff";
  import { findTypoHints } from "$lib/ai/typoHints";

  interface Props {
    originalText: string;
    proposedText?: string;
    showOriginal?: boolean;
    showProposed?: boolean;
  }

  let {
    originalText,
    proposedText = "",
    showOriginal = true,
    showProposed = true,
  }: Props = $props();

  let diff = $derived(diffWords(originalText, proposedText));
  let hints = $derived(findTypoHints(originalText));
  let hasProposed = $derived(!!proposedText.trim());

  function renderOriginalWithHints(text: string): Array<{ text: string; hint?: (typeof hints)[number] }> {
    if (!hints.length) return [{ text }];
    const parts: Array<{ text: string; hint?: (typeof hints)[number] }> = [];
    let cursor = 0;
    for (const hint of hints) {
      if (hint.start > cursor) parts.push({ text: text.slice(cursor, hint.start) });
      parts.push({ text: text.slice(hint.start, hint.end), hint });
      cursor = hint.end;
    }
    if (cursor < text.length) parts.push({ text: text.slice(cursor) });
    return parts;
  }

  let originalParts = $derived(renderOriginalWithHints(originalText));
</script>

{#if showOriginal}
  <div class="mb-2">
    <p class="mb-1 text-[9px] font-semibold uppercase tracking-wide text-text-muted">Passage concerné</p>
    <p class="whitespace-pre-wrap rounded-lg border border-danger/30 bg-danger/10 px-2 py-1.5 font-mono text-[10px] leading-relaxed">
      {#if hasProposed}
        {#each diff as seg, i (i)}
          {#if seg.kind === "same"}
            {seg.text}
          {:else if seg.kind === "removed"}
            <mark class="rounded bg-danger/35 px-0.5 text-text" title="À corriger">{seg.text}</mark>
          {/if}
        {/each}
      {:else}
        {#each originalParts as part, i (i)}
          {#if part.hint}
            <mark class="rounded bg-danger/35 px-0.5 text-text" title={part.hint.reason}>{part.text}</mark>
          {:else}
            {part.text}
          {/if}
        {/each}
      {/if}
    </p>
  </div>
{/if}

{#if showProposed && hasProposed}
  <div class="mb-2">
    <p class="mb-1 text-[9px] font-semibold uppercase tracking-wide text-text-muted">Proposition</p>
    <p class="whitespace-pre-wrap rounded-lg border border-accent-mint/40 bg-accent-mint/15 px-2 py-1.5 font-mono text-[10px] leading-relaxed">
      {#each diff as seg, i (i)}
        {#if seg.kind === "same"}
          {seg.text}
        {:else if seg.kind === "added"}
          <mark class="rounded bg-accent-mint/45 px-0.5">{seg.text}</mark>
        {/if}
      {/each}
    </p>
  </div>
{/if}
