import type { ParagraphSpan } from "$lib/note/paragraph";
import { isMarkdownLine } from "$lib/note/paragraph";
import { likelyNeedsCorrection } from "$lib/ai/typoHints";
import { noteBodyRange } from "$lib/note/frontmatter";

/** Parcourt les lignes avec offsets exacts (gère \r\n). */
function iterateLines(
  text: string,
  baseOffset: number,
  onLine: (line: string, rawLine: string, start: number, end: number) => void,
) {
  let pos = 0;
  while (pos <= text.length) {
    const breakAt = text.indexOf("\n", pos);
    const end = breakAt === -1 ? text.length : breakAt;
    const rawLine = text.slice(pos, end);
    const line = rawLine.replace(/\r$/, "");
    onLine(line, rawLine, baseOffset + pos, baseOffset + end);
    if (breakAt === -1) break;
    pos = breakAt + 1;
  }
}

function scanLines(text: string, baseOffset = 0): ParagraphSpan[] {
  const spans: ParagraphSpan[] = [];

  iterateLines(text, baseOffset, (line, _raw, start, end) => {
    if (!isMarkdownLine(line) && line.trim().length >= 8 && likelyNeedsCorrection(line)) {
      spans.push({ start, end, text: line });
    }
  });

  return spans;
}

function bodyScan(content: string) {
  const { body, start } = noteBodyRange(content);
  return { body, start };
}

/** Scan du corps (hors frontmatter YAML). */
export function scanBodyTypoLines(content: string): ParagraphSpan[] {
  const { body, start } = bodyScan(content);
  return scanLines(body, start);
}

/** Indique s'il reste des fautes repérables dans le corps de la note. */
export function bodyHasTypoLines(content: string): boolean {
  return scanBodyTypoLines(content).length > 0;
}
