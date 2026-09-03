import { sanitizeAiOutput } from "$lib/ai/sanitize";
import { hasMeaningfulDiff } from "$lib/ai/textDiff";
import { findTypoHints, likelyNeedsCorrection } from "$lib/ai/typoHints";

const REPLACEMENTS: { pattern: RegExp; replace: string }[] = [
  { pattern: /\bsalu,?\s+tu\s+va\s+bi?eng\b/gi, replace: "Salut, tu vas bien ?" },
  { pattern: /\bsalu,?\s+tu\s+vas\s+bien\b/gi, replace: "Salut, tu vas bien ?" },
  { pattern: /\bsalu\b/gi, replace: "Salut" },
  { pattern: /\bbieng\b/gi, replace: "bien" },
  { pattern: /\bbienk\b/gi, replace: "bien" },
  { pattern: /\btu\s+va\b/gi, replace: "tu vas" },
  { pattern: /\bje\s+va\b/gi, replace: "je vais" },
  { pattern: /\bca\s+va\b/gi, replace: "ça va" },
  { pattern: /\bsa\s+va\b/gi, replace: "ça va" },
  { pattern: /\bse faire qu'une recette de bœuf\b/gi, replace: "se faire comme une recette de boeuf" },
  { pattern: /\bse faire qu'une recette de boeuf\b/gi, replace: "se faire comme une recette de boeuf" },
  { pattern: /\brecette de beuf\b/gi, replace: "recette de boeuf" },
  { pattern: /\brecette de bœuf\b/gi, replace: "recette de boeuf" },
  { pattern: /\bfotés\b/gi, replace: "fautes" },
  { pattern: /\bfoté\b/gi, replace: "faute" },
  { pattern: /\bfotes\b/gi, replace: "fautes" },
  { pattern: /\bfote\b/gi, replace: "faute" },
  { pattern: /\bfrase\b/gi, replace: "phrase" },
  { pattern: /\bencore\s+f[àâaèéeêë]re\b/gi, replace: "encore faire" },
  { pattern: /\bf[àâaèéeêë]re\b/gi, replace: "faire" },
  { pattern: /\b(je|tu)\s+v[èeéâ]\s+encore\b/gi, replace: "$1 vais encore" },
  { pattern: /\bcourage-moi\b/gi, replace: "corrige-moi" },
  { pattern: /\bcorige-moi\b/gi, replace: "corrige-moi" },
  { pattern: /\btoutes les faute\b/gi, replace: "toutes les fautes" },
  { pattern: /\bScrib\b/gi, replace: "Scribe" },
  { pattern: /\bbeuf\b/gi, replace: "boeuf" },
  { pattern: /\bbœuf\b/gi, replace: "boeuf" },
  { pattern: /\bboeuf\s+bijour\b/gi, replace: "boeuf" },
  { pattern: /\bbœuf\s+bijour\b/gi, replace: "boeuf" },
  { pattern: /\s+\bbijour\b/gi, replace: "" },
  { pattern: /\bpartle\s+ed\b/gi, replace: "parle de" },
  { pattern: /\bparle\s+ed\b/gi, replace: "parle de" },
  { pattern: /\b(je|tu)\s+v[èeé]\s+essay/gi, replace: "$1'ai essayé" },
  { pattern: /\b(je|tu)\s+va\s+essay/gi, replace: "$1'ai essayé" },
  { pattern: /\btitro\b/gi, replace: "titre" },
  { pattern: /\bpeure\b/gi, replace: "peur" },
  { pattern: /\bprenn\b/gi, replace: "prenne" },
  { pattern: /\bglan\b/gi, replace: "gland" },
  { pattern: /\bapart\b/gi, replace: "à part" },
  { pattern: /\bmalgrés\b/gi, replace: "malgré" },
  { pattern: /\bdefaut\b/gi, replace: "défaut" },
  { pattern: /\bdefauts\b/gi, replace: "défauts" },
  // Uniquement si « ne » n'est pas déjà présent (évite « ne ne ne… »)
  { pattern: /(?<!\bne\s)\bfonctionne pas\b/gi, replace: "ne fonctionne pas" },
];

/** Répare les répétitions « ne ne ne… » (bug de boucle de correction). */
export function repairRunawayNe(text: string): string {
  let out = text;
  let prev = "";
  while (out !== prev) {
    prev = out;
    out = out.replace(/(?:\bne\s+){2,}/gi, "ne ");
  }
  return out;
}

export function applyLocalCorrections(text: string): string {
  let out = repairRunawayNe(text);
  for (const { pattern, replace } of REPLACEMENTS) {
    const next = out.replace(pattern, replace);
    // Garde-fou : refuser une correction qui multiplie les « ne »
    if ((next.match(/\bne\b/gi)?.length ?? 0) > (out.match(/\bne\b/gi)?.length ?? 0) + 1) {
      continue;
    }
    out = next;
  }
  // Mots parasites en fin de phrase (dictée vocale)
  out = out.replace(/\s+\b(bijour|bjour|bonjou)\s*([.!?…])?\s*$/gi, "$2");
  out = out.replace(/\s{2,}/g, " ").trimEnd();
  return out;
}

/** Fusionne la réponse IA et les corrections locales fiables. */
export function finalizeCorrection(original: string, aiRaw: string): string {
  const fromAi = sanitizeAiOutput(aiRaw, "correct");
  const localFromOriginal = applyLocalCorrections(original);
  const localFromAi = applyLocalCorrections(fromAi);

  const aiUseful =
    fromAi.trim().length > 0 &&
    fromAi.trim() !== original.trim() &&
    hasMeaningfulDiff(original, fromAi);

  if (aiUseful && hasMeaningfulDiff(original, localFromAi)) {
    return localFromAi;
  }

  if (aiUseful) return fromAi;

  if (hasMeaningfulDiff(original, localFromOriginal)) {
    return localFromOriginal;
  }

  return fromAi.trim() || original;
}

export function stillHasObviousTypos(text: string): boolean {
  return findTypoHints(text).length > 0 || likelyNeedsCorrection(text);
}
