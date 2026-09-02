/** Heuristiques locales pour repérer des fautes probables (sans dictionnaire externe). */

const COMMON_FR_WORDS = new Set([
  "je",
  "tu",
  "il",
  "elle",
  "nous",
  "vous",
  "ils",
  "elles",
  "ai",
  "as",
  "a",
  "avons",
  "avez",
  "ont",
  "été",
  "etre",
  "être",
  "est",
  "sont",
  "dans",
  "pour",
  "que",
  "qui",
  "avec",
  "sans",
  "pas",
  "plus",
  "très",
  "tres",
  "faire",
  "fait",
  "faites",
  "phrase",
  "faute",
  "fautes",
  "corriger",
  "corrigé",
  "corrige",
  "essayé",
  "essaye",
  "espère",
  "esperer",
  "espérer",
  "de",
  "des",
  "du",
  "la",
  "le",
  "les",
  "un",
  "une",
  "mon",
  "ma",
  "mes",
  "ton",
  "ta",
  "tes",
  "ce",
  "cette",
  "ces",
  "boeuf",
  "bœuf",
  "poulet",
  "recette",
  "recettes",
  "viande",
  "comprends",
  "comprend",
  "pourquoi",
  "comme",
  "peut",
  "bonjour",
  "application",
  "notes",
  "note",
  "assistant",
  "assistante",
  "assistée",
  "assistées",
  "créer",
  "creer",
  "contexte",
  "reformulation",
  "proposition",
  "idées",
  "idees",
  "correction",
  "orthographe",
  "transcription",
  "fonctionne",
  "correctement",
  "encore",
  "toutes",
  "tous",
  "salut",
  "bien",
  "vas",
  "vais",
  "allez",
  "coucou",
]);

/** Mots invalides ou parasites (souvent dictée vocale). */
const INVALID_WORDS = new Set([
  "bijour",
  "bjour",
  "bonjou",
  "bonjours",
  "bonjourr",
  "scrib",
  "scribe",
  "salu",
  "bieng",
  "bienk",
]);

/** Fautes connues (orthographe ou sens contextuel). */
const KNOWN_MISSPELLINGS: Record<string, string> = {
  beuf: "boeuf",
  partle: "parle",
  bijour: "",
  bjour: "",
  bonjou: "bonjour",
  salu: "Salut",
  bieng: "bien",
  bienk: "bien",
};

const SUSPICIOUS_TOKENS =
  /\b(fotes?|fotés?|frase|f[àâaèéeêë]re|fere|fêre|vé|vè|titro|apart|malgrés|defaut|courage-moi|corige-moi|scrib|beuf|partle|bijour|bjour|bonjou|salu|bieng|bienk)\b/i;

/** Mots mal orthographiés qui « sonnent » français mais n'ont pas de sens dans la phrase. */
const CONTEXTUAL_TYPO =
  /\bencore\s+f[èeêë]re\b|\b(je|tu|il|elle)\s+f[èeê]re\b|\bcourage-moi\b|\btoutes les faute\b|\brecette\s+de\s+beuf\b|\bse faire qu'une recette de beuf\b|\bparle\s+ed\b|\bpartle\s+ed\b|\bboeuf\s+bijour\b|\bbœuf\s+bijour\b|\brecette\s+de\s+boeuf\s+bijour\b|\b(je|tu)\s+va\b|\bsalu\s+tu\b/i;

export interface TypoHint {
  token: string;
  start: number;
  end: number;
  reason: string;
}

export function findTypoHints(text: string): TypoHint[] {
  const hints: TypoHint[] = [];
  const wordRe = /[^\s\d\p{P}\p{S}]+/gu;
  let match: RegExpExecArray | null;

  while ((match = wordRe.exec(text)) !== null) {
    const token = match[0];
    const lower = token.toLowerCase();
    const start = match.index;
    const end = start + token.length;

    if (SUSPICIOUS_TOKENS.test(token)) {
      hints.push({ token, start, end, reason: "Mot probablement incorrect" });
      continue;
    }

    const normalizedToken = token
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase();
    if (KNOWN_MISSPELLINGS[normalizedToken] !== undefined) {
      hints.push({ token, start, end, reason: "Orthographe connue à corriger" });
      continue;
    }

    if (INVALID_WORDS.has(normalizedToken)) {
      hints.push({ token, start, end, reason: "Mot parasite ou faute connue" });
      continue;
    }

    if (token.length >= 4 && !looksPlausibleFrench(lower)) {
      hints.push({ token, start, end, reason: "Orthographe douteuse" });
    }
  }

  return dedupeHints(hints);
}

export function likelyNeedsCorrection(text: string): boolean {
  return findTypoHints(text).length > 0 || suspiciousPatterns(text) || hasContextualTypo(text);
}

export function hasContextualTypo(text: string): boolean {
  return CONTEXTUAL_TYPO.test(text);
}

function suspiciousPatterns(text: string): boolean {
  if (text.length < 8) return false;
  if (/\b(je|tu)\s+va\b/i.test(text)) return true;
  if (/\b(je|tu|il|elle)\s+\w{1,3}\s+(essay|essai|fais|fait)/i.test(text)) return true;
  if (/\b(je|tu)\s+v[èeé]\s+essay/i.test(text)) return true;
  return findTypoHints(text).length >= 1;
}

function looksPlausibleFrench(word: string): boolean {
  const normalized = word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

  if (COMMON_FR_WORDS.has(normalized)) return true;
  if (INVALID_WORDS.has(normalized)) return false;
  if (/^\d+$/.test(normalized)) return true;
  if (normalized.length <= 3) return true;

  // voyelles françaises plausibles
  if (!/[aeiouyàâäéèêëïîôùûüœ]/i.test(normalized)) return false;

  // séquences improbables
  if (/([bcdfghjklmnpqrstvwxz])\1{2,}/i.test(normalized)) return false;
  if (/^[bcdfghjklmnpqrstvwxz]{4,}$/i.test(normalized)) return false;

  // Terminaisons / accents typiques du français
  if (/(tion|ment|ique|able|ible|euse|eux|aux|elle|aine|eur|oir|ais|ait|ons|ez|ent|ant|ée|ées|és|è|ê|ë|à|â|ù|û|ï|î|ô|œ)/.test(normalized)) {
    return true;
  }

  // Mot court inconnu → souvent une faute (ex. « salu »)
  if (normalized.length === 4 && !COMMON_FR_WORDS.has(normalized)) return false;

  // Mot long inconnu sans marqueur français → suspect (ex. « bijour »)
  if (normalized.length >= 5) return false;

  return true;
}

function dedupeHints(hints: TypoHint[]): TypoHint[] {
  const seen = new Set<number>();
  return hints.filter((h) => {
    if (seen.has(h.start)) return false;
    seen.add(h.start);
    return true;
  });
}
