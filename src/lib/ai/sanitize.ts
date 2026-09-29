import { unwrapOuterMarkdownFence } from "$lib/markdown/repair";

/**
 * Coupe une génération Ollama qui répète le même bloc (boucle token).
 * 1) Répétition de blocs de lignes en fin de texte
 * 2) Fenêtre de caractères exacte (fallback)
 */
export function truncateRepetitiveOutput(text: string): string {
  const t = text;
  if (t.length < 160) return t;

  const lines = t.split("\n");
  if (lines.length >= 6) {
    const maxBlock = Math.min(24, Math.floor(lines.length / 3));
    for (let blockLines = 1; blockLines <= maxBlock; blockLines++) {
      const block = lines.slice(-blockLines).join("\n");
      if (block.trim().length < 16) continue;
      const unique = new Set(block.replace(/\s+/g, "")).size;
      if (unique < 4) continue;

      let count = 0;
      let end = lines.length;
      while (end >= blockLines) {
        const slice = lines.slice(end - blockLines, end).join("\n");
        if (slice !== block) break;
        count += 1;
        end -= blockLines;
      }
      if (count >= 3) {
        return lines.slice(0, end + blockLines).join("\n").trimEnd();
      }
    }
  }

  const maxSize = Math.min(180, Math.floor(t.length / 3));
  for (let size = maxSize; size >= 40; size -= 1) {
    const needle = t.slice(-size);
    if (!needle.trim()) continue;
    const unique = new Set(needle.replace(/\s+/g, "")).size;
    if (unique < 4) continue;

    let count = 0;
    let idx = t.length;
    while (idx >= size && t.slice(idx - size, idx) === needle) {
      count += 1;
      idx -= size;
    }
    if (count >= 3) {
      return t.slice(0, idx + size).trimEnd();
    }
  }
  return t;
}

/** Nettoie une réponse Ollama pour ne garder que le texte utile. */
export function sanitizeAiOutput(raw: string, action?: string): string {
  let text = unwrapOuterMarkdownFence(raw);

  // Méta du type « Voici un résumé en français de 3 à 5 phrases… »
  text = text.replace(
    /^(voici\s+(un\s+|le\s+)?(résumé|texte|traduction|proposition)[^\n]*\n+)/i,
    "",
  );
  text = text.replace(
    /^voici\s+(un\s+|le\s+)?(résumé|texte|traduction)[^\n.:]*[:.\s]+/i,
    "",
  );

  const lower = text.toLowerCase();
  const metaMarkers = [
    "voici le texte corrigé",
    "voici le texte reformulé",
    "voici la traduction",
    "voici le résumé",
    "voici un résumé",
    "texte corrigé :",
    "texte reformulé :",
    "je vais essayer",
  ];

  for (const marker of metaMarkers) {
    const idx = lower.indexOf(marker);
    if (idx !== -1 && idx < 80) {
      const afterColon = text.slice(idx).split(":").slice(1).join(":").trim();
      if (afterColon.length > 8) {
        text = afterColon;
        break;
      }
      // Pas de « : » — coupe la première phrase méta
      const rest = text.slice(idx).replace(/^[^\n.!?]+[.!?]?\s*/i, "").trim();
      if (rest.length > 8) {
        text = rest;
        break;
      }
    }
  }

  if (action !== "custom") {
    text = text.replace(/^["'«»]+|["'«»]+$/g, "").trim();
  }

  if (action === "correct" || action === "reformulate" || action === "translate" || action === "summarize") {
    const quoted = text.match(/["«]([^"»]{12,})["»]/);
    if (quoted && quoted[1].trim().length > text.length * 0.4) {
      text = quoted[1].trim();
    }
  }

  if (action === "correct" || action === "reformulate" || action === "translate" || action === "summarize") {
    text = text.replace(/^(voici[^:\n]*:\s*)/i, "").trim();
  }

  text = truncateRepetitiveOutput(text.trim());
  return text.trim();
}
