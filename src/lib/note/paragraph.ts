export interface ParagraphSpan {
  start: number;
  end: number;
  text: string;
}

/** Retourne le paragraphe (bloc séparé par une ligne vide) contenant le curseur. */
export function paragraphAtCursor(content: string, cursor: number): ParagraphSpan | null {
  if (!content.trim()) return null;

  const pos = Math.min(Math.max(0, cursor), content.length);

  let start = content.lastIndexOf("\n\n", Math.max(0, pos - 1));
  start = start === -1 ? 0 : start + 2;

  let end = content.indexOf("\n\n", pos);
  if (end === -1) end = content.length;

  const text = content.slice(start, end);
  if (!text.trim()) return null;

  return { start, end, text };
}

function isMarkdownLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  return (
    t.startsWith("#") ||
    t.startsWith("|") ||
    t.startsWith("```") ||
    t.startsWith(">") ||
    t.startsWith("- ") ||
    t.startsWith("* ") ||
    /^\d+\.\s/.test(t) ||
    t === "---"
  );
}

/** Ligne courante (plus précise pour les suggestions proactives). */
export function lineAtCursor(content: string, cursor: number): ParagraphSpan | null {
  if (!content.trim()) return null;

  const pos = Math.min(Math.max(0, cursor), content.length);
  let start = content.lastIndexOf("\n", Math.max(0, pos - 1));
  start = start === -1 ? 0 : start + 1;
  let end = content.indexOf("\n", pos);
  if (end === -1) end = content.length;

  const text = content.slice(start, end);
  if (!text.trim() || isMarkdownLine(text)) return null;

  return { start, end, text };
}

/** Cible proactive : ligne si possible, sinon paragraphe court. */
export function editingTargetAtCursor(content: string, cursor: number): ParagraphSpan | null {
  const line = lineAtCursor(content, cursor);
  if (line && line.text.trim().length >= 12) return line;

  const paragraph = paragraphAtCursor(content, cursor);
  if (!paragraph) return line;

  if (paragraph.text.length <= 320) return paragraph;
  return line ?? paragraph;
}
