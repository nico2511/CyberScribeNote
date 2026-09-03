/** Vérifie qu'une « correction » ne remplace pas le sens (pas de reformulation déguisée). */

function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['']/g, "'");
}

export function isFaithfulCorrection(original: string, proposed: string): boolean {
  const oTrim = original.trim();
  const pTrim = proposed.trim();
  if (!oTrim || !pTrim) return false;

  const oWords = oTrim.split(/\s+/).filter(Boolean);
  const pWords = pTrim.split(/\s+/).filter(Boolean);

  if (pWords.length > oWords.length + 2) return false;
  if (pWords.length > Math.max(oWords.length * 1.35, oWords.length + 1)) return false;
  if (pTrim.length > oTrim.length * 1.4 + 8) return false;

  const pNorm = pWords.map(normalizeWord);
  let matched = 0;

  for (const word of oWords) {
    const nw = normalizeWord(word);
    if (pNorm.includes(nw)) {
      matched++;
      continue;
    }
    const fuzzy = pNorm.some((pw) => pw.startsWith(nw.slice(0, 2)) && Math.abs(pw.length - nw.length) <= 3);
    if (fuzzy) matched++;
  }

  return matched / oWords.length >= 0.45;
}

