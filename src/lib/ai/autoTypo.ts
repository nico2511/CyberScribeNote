import { buildLocalCorrection } from "$lib/ai/buildProposal";
import { applyLocalCorrections, repairRunawayNe } from "$lib/ai/localCorrect";
import { hasContextualTypo, likelyNeedsCorrection } from "$lib/ai/typoHints";
import { stillHasObviousTypos } from "$lib/ai/localCorrect";
import { replaceTextRange } from "$lib/voice/commands";
import { mapCaretThroughReplace } from "$lib/note/caret";
import type { ParagraphSpan } from "$lib/note/paragraph";
import { scanBodyTypoLines } from "$lib/note/scanTypos";

export function lineNeedsTypoFix(text: string): boolean {
  return likelyNeedsCorrection(text) || hasContextualTypo(text);
}

export function lineNeedsAiTypoFix(text: string): boolean {
  const local = buildLocalCorrection(text);
  const afterLocal = local ?? text;
  return lineNeedsTypoFix(text) && (local === null || stillHasObviousTypos(afterLocal) || hasContextualTypo(afterLocal));
}

export function tryAutoFixSpan(
  content: string,
  span: ParagraphSpan,
  caret = span.end,
): {
  content: string;
  cursor: number;
  fixed: boolean;
} | null {
  if (!lineNeedsTypoFix(span.text)) return null;

  const fixed = buildLocalCorrection(span.text);
  if (!fixed) return null;

  const next = replaceTextRange(content, span.start, span.end, fixed);
  if (next === content) return null;

  return {
    content: next,
    cursor: mapCaretThroughReplace(caret, span.start, span.end, fixed.length),
    fixed: true,
  };
}

/** Corrige silencieusement toutes les lignes repérées dans la note. */
export function autoFixAllTypoLines(
  content: string,
  caret = 0,
): { content: string; count: number; caret: number } {
  let next = repairRunawayNe(content);
  let count = next !== content ? 1 : 0;
  let caretOut = caret;
  if (next !== content) {
    // repairRunawayNe is whole-doc; keep caret clamped
    caretOut = Math.min(caretOut, next.length);
  }

  for (let pass = 0; pass < 3; pass++) {
    const lines = [...scanBodyTypoLines(next)].sort((a, b) => b.start - a.start);
    if (!lines.length) break;

    let changed = false;
    for (const line of lines) {
      const rawLine = next.slice(line.start, line.end);
      const lineText = rawLine.replace(/\r$/, "");
      const fixed =
        buildLocalCorrection(lineText) ??
        (applyLocalCorrections(lineText) !== lineText ? applyLocalCorrections(lineText) : null);
      if (!fixed || fixed.length > lineText.length * 1.15 + 4) continue;

      const replacement = rawLine.endsWith("\r") ? fixed + "\r" : fixed;
      const updated = replaceTextRange(next, line.start, line.end, replacement);
      if (updated !== next) {
        caretOut = mapCaretThroughReplace(
          caretOut,
          line.start,
          line.end,
          replacement.length,
        );
        next = updated;
        count++;
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }

  return { content: next, count, caret: caretOut };
}
