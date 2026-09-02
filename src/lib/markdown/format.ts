export interface TextRange {
  start: number;
  end: number;
}

export function wrapSelection(
  content: string,
  range: TextRange,
  before: string,
  after: string,
  placeholder = "texte",
): { value: string; cursor: number } {
  const selected = content.slice(range.start, range.end);
  const inner = selected || placeholder;
  const insertion = `${before}${inner}${after}`;
  const value = content.slice(0, range.start) + insertion + content.slice(range.end);
  const cursor = selected
    ? range.start + insertion.length
    : range.start + before.length + placeholder.length;
  return { value, cursor };
}

export function prefixLines(
  content: string,
  range: TextRange,
  prefix: string,
  placeholder = "élément",
): { value: string; cursor: number } {
  const selected = content.slice(range.start, range.end);
  const block = selected || placeholder;
  const lines = block.split("\n").map((line) => (line ? `${prefix}${line}` : prefix.trimEnd()));
  const insertion = lines.join("\n");
  const value = content.slice(0, range.start) + insertion + content.slice(range.end);
  return { value, cursor: range.start + insertion.length };
}

export function insertSnippet(
  content: string,
  range: TextRange,
  snippet: string,
): { value: string; cursor: number } {
  const value = content.slice(0, range.start) + snippet + content.slice(range.end);
  return { value, cursor: range.start + snippet.length };
}

export const TABLE_TEMPLATE = `| Colonne 1 | Colonne 2 |\n| --- | --- |\n| | |\n`;
