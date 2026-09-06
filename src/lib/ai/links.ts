/** Extraction d'URLs http(s) hors blocs de code. */

const URL_RE = /https?:\/\/[^\s<>\)\]\"']+/gi;

export function extractUrls(markdown: string): string[] {
  const lines = markdown.split("\n");
  const found: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^(`{3,}|~{3,})/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const matches = line.match(URL_RE) ?? [];
    for (let raw of matches) {
      raw = raw.replace(/[.,;:!?)]+$/g, "");
      if (raw.length > 12 && !found.includes(raw)) found.push(raw);
    }
  }
  return found;
}

/** True si la note est essentiellement un/des lien(s) (peu de texte hors URL). */
export function isLinkOnlyNote(markdown: string): boolean {
  const body = markdown.trim();
  if (!body) return false;
  const urls = extractUrls(body);
  if (!urls.length) return false;
  let remainder = body;
  for (const u of urls) {
    remainder = remainder.split(u).join(" ");
  }
  const words = remainder
    .replace(/[#>*\-\[\]\(\)`]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
  return words.length <= 4;
}
