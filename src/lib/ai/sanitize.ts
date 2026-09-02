/** Nettoie une réponse Ollama pour ne garder que le texte utile. */
export function sanitizeAiOutput(raw: string, action?: string): string {
  let text = raw.trim();

  if (text.startsWith("```")) {
    const lines = text.split("\n");
    const inner: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim().startsWith("```")) break;
      inner.push(lines[i]);
    }
    text = inner.join("\n").trim();
  }

  const lower = text.toLowerCase();
  const metaMarkers = [
    "voici le texte corrigé",
    "voici le texte reformulé",
    "voici la traduction",
    "voici le résumé",
    "texte corrigé :",
    "texte reformulé :",
    "je vais essayer",
  ];

  for (const marker of metaMarkers) {
    const idx = lower.indexOf(marker);
    if (idx !== -1) {
      const afterColon = text.slice(idx).split(":").slice(1).join(":").trim();
      if (afterColon.length > 8) {
        text = afterColon;
        break;
      }
    }
  }

  text = text.replace(/^["'«»]+|["'«»]+$/g, "").trim();

  // Si le modèle a mis la vraie réponse entre guillemets sur une ligne suivante
  if (action === "correct" || action === "reformulate" || action === "translate_en") {
    const quoted = text.match(/["«]([^"»]{12,})["»]/);
    if (quoted && quoted[1].trim().length > text.length * 0.4) {
      text = quoted[1].trim();
    }
  }

  if (action === "correct" || action === "reformulate" || action === "translate_en") {
    text = text.replace(/^(voici[^:\n]*:\s*)/i, "").trim();
  }

  return text.trim();
}

export function suggestionPreview(text: string, max = 800): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}
