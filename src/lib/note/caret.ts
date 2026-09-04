/** Recalcule un offset caret après un replace [start, end) → newLen chars. */
export function mapCaretThroughReplace(
  caret: number,
  start: number,
  end: number,
  newLen: number,
): number {
  if (caret < start) return caret;
  if (caret <= end) {
    const rel = caret - start;
    return start + Math.min(rel, newLen);
  }
  return caret + (newLen - (end - start));
}

/**
 * Retrouve une sélection dans le markdown (offsets TipTap parfois décalés).
 * Préfère le range exact, sinon cherche le texte autour de l'offset signalé.
 */
export function locateSelectionInContent(
  content: string,
  sel: { start: number; end: number; text: string },
): { start: number; end: number } | null {
  const text = sel.text;
  if (!text) return null;

  if (
    sel.start >= 0 &&
    sel.end <= content.length &&
    content.slice(sel.start, sel.end) === text
  ) {
    return { start: sel.start, end: sel.end };
  }

  const windowStart = Math.max(0, sel.start - 120);
  const near = content.indexOf(text, windowStart);
  if (near >= 0 && near < sel.start + text.length + 200) {
    return { start: near, end: near + text.length };
  }

  const last = content.lastIndexOf(text);
  if (last >= 0) return { start: last, end: last + text.length };

  return null;
}
