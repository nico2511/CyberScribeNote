const STOP = new Set([
  "avec",
  "dans",
  "pour",
  "cette",
  "cela",
  "plus",
  "moins",
  "aussi",
  "comme",
  "alors",
  "donc",
  "mais",
  "puis",
  "entre",
  "sous",
  "sans",
  "dont",
  "leur",
  "leurs",
  "vous",
  "nous",
  "elle",
  "elles",
  "être",
  "avoir",
  "fait",
  "faire",
  "tout",
  "tous",
  "toute",
  "toutes",
  "your",
  "this",
  "that",
  "with",
  "from",
  "have",
  "will",
  "would",
  "could",
  "should",
  "about",
  "into",
  "then",
  "than",
  "them",
  "they",
  "their",
  "note",
  "notes",
  "texte",
  "title",
  "titre",
]);

const CREATIVE_RE =
  /\b(invente|imagine|histoire|po[eè]me|blague|fiction|r[eé]dige une recette)\b/i;

const HIJACK_RE =
  /\b(ingr[eé]dients?|pr[eé]paration\b|cuisson|pr[eé]chauffe|faire revenir|sel et poivre|lorem ipsum)\b/i;

function normalizeToken(word: string): string {
  return word
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function significantTokens(text: string): string[] {
  const words = text.match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    const n = normalizeToken(w);
    if (n.length < 4 || STOP.has(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export function instructionRequiresFidelity(instruction: string): boolean {
  return !CREATIVE_RE.test(instruction);
}

export function instructionWantsVaultContext(instruction: string): boolean {
  const t = instruction
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  return /\b(vault|coffre|autres? notes?|dans mes notes|recherche semantique|croise|compare avec)\b/.test(
    t,
  );
}

/**
 * True si la proposition reste ancrée dans le texte source.
 * Rejette les substitutions de sujet (ex. recette à la place d'un compose Docker).
 */
export function isGroundedTransform(original: string, proposed: string): boolean {
  const o = original.trim();
  const p = proposed.trim();
  if (!o || !p) return false;

  const origTokens = significantTokens(o);
  if (origTokens.length < 8) return true;

  const proposedSet = new Set(significantTokens(p));
  const matched = origTokens.filter((t) => proposedSet.has(t)).length;
  const overlap = matched / origTokens.length;

  const rewrite = p.length >= o.length * 0.3;
  const minOverlap = rewrite ? 0.35 : 0.18;

  if (overlap < minOverlap) return false;

  if (HIJACK_RE.test(p) && !HIJACK_RE.test(o)) return false;

  return true;
}

/** Annexe courte (plan, pistes, tâches) : refuse un changement de sujet, pas un recouvrement fort. */
export function isGroundedAppendix(original: string, proposed: string): boolean {
  const o = original.trim();
  const p = proposed.trim();
  if (!o || !p) return false;
  if (HIJACK_RE.test(p) && !HIJACK_RE.test(o)) return false;

  const orig = significantTokens(o);
  if (orig.length < 8) return true;
  const proposedSet = new Set(significantTokens(p));
  const matched = orig.filter((t) => proposedSet.has(t)).length;
  if (matched >= 1) return true;
  return proposedSet.size < 5;
}
