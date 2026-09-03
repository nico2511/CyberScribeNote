/** Helpers résumés en fin de note. */

const SUMMARY_SECTION_RE =
  /\n---\s*\n+\s*##\s+(Résumé(?:\s+auto)?|Summary)\s*\n+([\s\S]*?)(?=\n---\s*\n|\n##\s+|$)/i;

export function extractExistingSummary(markdown: string): string | null {
  const m = markdown.match(SUMMARY_SECTION_RE);
  if (!m?.[2]) return null;
  return m[2].trim() || null;
}

export function normalizeSummaryText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True si la proposition est (quasi) identique au résumé déjà présent. */
export function isDuplicateSummary(existing: string | null, proposed: string): boolean {
  if (!existing) return false;
  const a = normalizeSummaryText(existing);
  const b = normalizeSummaryText(proposed);
  if (!a || !b) return false;
  if (a === b) return true;
  // Similarité grossière : l'un contient l'autre ou chevauchement fort
  if (a.includes(b) || b.includes(a)) return true;
  const wa = new Set(a.split(" ").filter((w) => w.length > 3));
  const wb = b.split(" ").filter((w) => w.length > 3);
  if (wb.length === 0) return false;
  const overlap = wb.filter((w) => wa.has(w)).length;
  return overlap / wb.length >= 0.85;
}

/** Bloc résumé ajouté en fin de note (jamais un remplacement). */
export function formatSummaryAppendix(summary: string, title = "Résumé"): string {
  const body = summary.trim();
  if (!body) return "";
  return `\n\n---\n\n## ${title}\n\n${body}\n`;
}
