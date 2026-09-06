import { unwrapOuterMarkdownFence } from "$lib/markdown/repair";

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

  return text.trim();
}
