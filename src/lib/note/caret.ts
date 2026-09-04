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
