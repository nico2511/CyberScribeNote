/** Extrait le champ `context` ou `objectif` du frontmatter YAML. */
export function parseNoteContext(content: string): string {
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

/** Met à jour ou ajoute `context:` dans le frontmatter. */
export function setNoteContext(content: string, context: string): string {
  const trimmedContext = context.trim();
  if (!content.startsWith("---")) {
    if (!trimmedContext) return content;
    return `---\ncontext: ${quoteYaml(trimmedContext)}\n---\n\n${content}`;
  }

  const end = content.indexOf("---", 3);
  if (end === -1) {
    if (!trimmedContext) return content;
    return `---\ncontext: ${quoteYaml(trimmedContext)}\n---\n\n${content}`;
  }

  const frontmatter = content.slice(3, end);
  const body = content.slice(end + 3).replace(/^\n/, "");
  const lines = frontmatter.split("\n");
  let found = false;
  const nextLines = lines.map((line) => {
    const t = line.trim();
    if (t.startsWith("context:") || t.startsWith("objectif:")) {
      found = true;
      return trimmedContext
        ? `context: ${quoteYaml(trimmedContext)}`
        : "";
    }
    return line;
  }).filter(Boolean);

  if (!found && trimmedContext) {
    nextLines.push(`context: ${quoteYaml(trimmedContext)}`);
  }

  const fm = nextLines.join("\n");
  return fm ? `---\n${fm}\n---\n\n${body}` : body;
}

function quoteYaml(value: string): string {
  if (/[:#\n"]/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}
