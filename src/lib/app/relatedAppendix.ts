/** Les `[[titres]]` proposés doivent déjà apparaître dans le contexte RAG. */
export function relatedProposalStaysOnContext(proposed: string, context: string): boolean {
  const links = [...proposed.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim().toLowerCase());
  if (!links.length) return false;
  const ctx = context.toLowerCase();
  return links.every((title) => ctx.includes(title));
}

/** Transforme un bloc RAG en liste de wikilinks pour injecter le contexte, pas pour l'écrire tel quel. */
export function formatRelatedAppendix(ragBlock: string): string {
  if (!ragBlock.trim()) return "";
  const lines: string[] = [];
  const re = /\[(\d+)\]\s+(.+?)\s+\(([^)]+)\)\n([\s\S]*?)(?=\n\[\d+\]\s+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ragBlock)) !== null) {
    const title = m[2].trim();
    const excerpt = m[4].trim().slice(0, 180).replace(/\s+/g, " ");
    lines.push(`- [[${title}]] — ${excerpt}${excerpt.length >= 180 ? "…" : ""}`);
  }
  if (lines.length) return lines.join("\n");
  return ragBlock
    .replace(/^Contexte récupéré[\s\S]*?:\n+/i, "")
    .trim()
    .slice(0, 1200);
}
