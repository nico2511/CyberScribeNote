/** Bloc contexte visible en tête de note : `> **Contexte** · …` */

const CONTEXT_BLOCK_RE = /^>\s*\*\*Contexte\*\*\s*[·:\-–—]\s*(.+)$/im;

export function parseNoteContext(content: string): string {
  const body = noteBody(content);

  const visible = body.match(CONTEXT_BLOCK_RE);
  if (visible?.[1]) return visible[1].trim();

  if (!content.startsWith("---")) return "";
  const end = content.indexOf("---", 3);
  if (end === -1) return "";
  const frontmatter = content.slice(3, end);
  for (const line of frontmatter.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("context:")) {
      return stripYamlValue(trimmed.slice("context:".length));
    }
    if (trimmed.startsWith("objectif:")) {
      return stripYamlValue(trimmed.slice("objectif:".length));
    }
  }
  return "";
}

/** Assure un bloc contexte visible (migration depuis le YAML seul). */
export function ensureVisibleContextBlock(content: string): string {
  const ctx = parseNoteContext(content);
  if (!ctx) return content;
  const body = noteBody(content);
  if (CONTEXT_BLOCK_RE.test(body)) return stripLegacyYamlContext(content);
  return setNoteContext(content, ctx);
}

export function setNoteContext(content: string, context: string): string {
  const trimmedContext = context.trim();
  const { prefix, body } = splitNoteParts(content);
  let nextBody = body.replace(/^>\s*\*\*Contexte\*\*\s*[·:\-–—]\s*.+\n*/im, "");

  if (trimmedContext) {
    nextBody = `> **Contexte** · ${trimmedContext}\n\n${nextBody}`.replace(/^\n+/, "");
  }

  nextBody = nextBody.replace(/^\n+/, "");
  return prefix + nextBody;
}

export function formatContextBlock(context: string): string {
  const trimmed = context.trim();
  if (!trimmed) return "";
  return `> **Contexte** · ${trimmed}`;
}

export function noteBody(content: string): string {
  return noteBodyRange(content).body;
}

/** Offset exact du début du corps (après frontmatter YAML). */
export function noteBodyRange(content: string): { body: string; start: number } {
  if (!content.startsWith("---")) {
    return { body: content, start: 0 };
  }
  const end = content.indexOf("---", 3);
  if (end === -1) return { body: content, start: 0 };
  let start = end + 3;
  while (start < content.length && content[start] === "\n") start++;
  return { body: content.slice(start), start };
}

function splitNoteParts(content: string): { prefix: string; body: string } {
  if (!content.startsWith("---")) return { prefix: "", body: content };
  const end = content.indexOf("---", 3);
  if (end === -1) return { prefix: "", body: content };
  return {
    prefix: content.slice(0, end + 3) + "\n\n",
    body: content.slice(end + 3).replace(/^\n+/, ""),
  };
}

function stripLegacyYamlContext(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("---", 3);
  if (end === -1) return content;

  const frontmatter = content.slice(3, end);
  const body = content.slice(end + 3).replace(/^\n+/, "");
  const lines = frontmatter
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("context:") && !t.startsWith("objectif:");
    })
    .filter(Boolean);

  if (!lines.length) return body;
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

function stripYamlValue(raw: string): string {
  const v = raw.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}
