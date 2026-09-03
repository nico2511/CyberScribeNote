/** Langues majeures Europe (+ anglais) pour la traduction. */
export type TranslateLang = "en" | "de" | "es" | "it" | "pt" | "nl";

export interface TranslateLangOption {
  id: TranslateLang;
  label: string;
  native: string;
  voiceHint: string;
}

export const TRANSLATE_LANGUAGES: TranslateLangOption[] = [
  { id: "en", label: "Anglais", native: "English", voiceHint: "anglais" },
  { id: "de", label: "Allemand", native: "Deutsch", voiceHint: "allemand" },
  { id: "es", label: "Espagnol", native: "Español", voiceHint: "espagnol" },
  { id: "it", label: "Italien", native: "Italiano", voiceHint: "italien" },
  { id: "pt", label: "Portugais", native: "Português", voiceHint: "portugais" },
  { id: "nl", label: "Néerlandais", native: "Nederlands", voiceHint: "neerlandais" },
];

export function translateLangLabel(id: TranslateLang): string {
  return TRANSLATE_LANGUAGES.find((l) => l.id === id)?.label ?? id;
}

export function parseTranslateVoiceLang(fragment: string): TranslateLang | null {
  const t = fragment
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  if (/^(anglais|english|en)\b/.test(t)) return "en";
  if (/^(allemand|deutsch|german|de)\b/.test(t)) return "de";
  if (/^(espagnol|espanol|spanish|es)\b/.test(t)) return "es";
  if (/^(italien|italiano|italian|it)\b/.test(t)) return "it";
  if (/^(portugais|portugues|portuguese|pt)\b/.test(t)) return "pt";
  if (/^(neerlandais|hollandais|dutch|nl)\b/.test(t)) return "nl";
  return null;
}

export {
  extractExistingSummary,
  formatSummaryAppendix,
  isDuplicateSummary,
  normalizeSummaryText,
} from "$lib/ai/summary";
