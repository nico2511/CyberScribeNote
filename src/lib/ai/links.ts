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

/** Lien avec titre optionnel (favoris navigateur / Markdown). */
export type ExtractedLink = { url: string; title?: string };

/**
 * Extrais les liens (Markdown `[titre](url)` + HREF HTML Netscape, ou URLs brutes).
 * Utile pour un export de favoris collé dans une note.
 */
export function extractLinksWithTitles(text: string): ExtractedLink[] {
  const out: ExtractedLink[] = [];
  const seen = new Set<string>();

  const push = (url: string, title?: string) => {
    let clean = url.trim().replace(/[.,;:!?)]+$/g, "");
    if (clean.length < 12 || seen.has(clean)) return;
    seen.add(clean);
    const t = title?.replace(/\s+/g, " ").trim();
    out.push(t ? { url: clean, title: t } : { url: clean });
  };

  // Markdown links first (keeps titles).
  const mdRe = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi;
  for (const m of text.matchAll(mdRe)) {
    push(m[2], m[1]);
  }

  // Netscape / HTML bookmarks: <A HREF="…">Title</A>
  const hrefRe = /<a\b[^>]*\bhref\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of text.matchAll(hrefRe)) {
    const title = m[2].replace(/<[^>]+>/g, "").trim();
    push(m[1], title || undefined);
  }

  // Remaining bare URLs (deduped).
  for (const url of extractUrls(text)) {
    push(url);
  }

  return out;
}

/** Liste Markdown `- [titre](url)` ou `- url` à partir du texte source. */
export function formatExtractedLinksList(text: string): string | null {
  const links = extractLinksWithTitles(text);
  if (!links.length) return null;
  return links
    .map((l) => (l.title ? `- [${l.title}](${l.url})` : `- ${l.url}`))
    .join("\n");
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
