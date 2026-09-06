import type { AiAction } from "$lib/types";
import type { TranslateLang } from "$lib/ai/languages";

export interface VoiceCommandInfo {
  phrase: string;
  description: string;
  category: "dictée" | "ia" | "navigation";
  requiresNote?: boolean;
  requiresOllama?: boolean;
}

/** Catalogue des commandes vocales reconnues (préfixe « Scribe, … »). */
export const VOICE_COMMANDS: VoiceCommandInfo[] = [
  {
    phrase: "Scribe, structure",
    description: "Répare le Markdown (titres, blocs de code) sans changer le fond",
    category: "ia",
    requiresNote: true,
    requiresOllama: false,
  },
  {
    phrase: "Scribe, sommaire",
    description: "Insère une table des matières depuis les titres",
    category: "ia",
    requiresNote: true,
  },
  {
    phrase: "Scribe, plan",
    description: "Propose un plan de conception en fin de note (n'écrase rien)",
    category: "ia",
    requiresNote: true,
    requiresOllama: true,
  },
  {
    phrase: "Scribe, lien",
    description: "Enrichit une URL de la note en brouillon (titre / description)",
    category: "ia",
    requiresNote: true,
    requiresOllama: true,
  },
  {
    phrase: "Scribe, points clés",
    description: "Extrait idées essentielles et tâches déjà présentes",
    category: "ia",
    requiresNote: true,
    requiresOllama: true,
  },
  {
    phrase: "Scribe, tags",
    description: "Propose des tags YAML pour le frontmatter",
    category: "ia",
    requiresNote: true,
    requiresOllama: true,
  },
  {
    phrase: "Scribe, template",
    description: "Propose un modèle (daily, CR, lecture, projet)",
    category: "ia",
    requiresNote: true,
  },
  {
    phrase: "Scribe, brief",
    description: "Résumé ultra-court (2–3 phrases) en fin de note",
    category: "ia",
    requiresNote: true,
    requiresOllama: true,
  },
  {
    phrase: "Scribe, liées",
    description: "Liste des notes du vault proches (RAG)",
    category: "ia",
    requiresNote: true,
  },
  {
    phrase: "Scribe, résume",
    description: "Ajoute un résumé en fin de note via Ollama",
    category: "ia",
    requiresNote: true,
    requiresOllama: true,
  },
  {
    phrase: "Scribe, reformule",
    description: "Reformule le texte (note entière)",
    category: "ia",
    requiresNote: true,
    requiresOllama: true,
  },
  {
    phrase: "Scribe, corrige",
    description: "Corrige orthographe et grammaire",
    category: "ia",
    requiresNote: true,
    requiresOllama: true,
  },
  {
    phrase: "Scribe, traduis en …",
    description: "Traduit (anglais, allemand, espagnol, italien, portugais, néerlandais)",
    category: "ia",
    requiresNote: true,
    requiresOllama: true,
  },
  {
    phrase: "Scribe, cherche …",
    description: "Ouvre la recherche rapide (Ctrl+T) avec vos mots-clés",
    category: "navigation",
  },
  {
    phrase: "Scribe, ouvre …",
    description: "Ouvre la note correspondante dans le vault (PTT)",
    category: "navigation",
  },
  {
    phrase: "(dictée libre)",
    description: "Pendant le PTT : transcrit et insère dans la note active (parler puis rappuyer)",
    category: "dictée",
    requiresNote: true,
  },
];

export const VOICE_CATEGORY_LABELS: Record<VoiceCommandInfo["category"], string> = {
  dictée: "Dictée",
  ia: "Intelligence artificielle",
  navigation: "Navigation",
};

export interface TextSelection {
  start: number;
  end: number;
  text: string;
}

export interface AiActionRequest {
  action: AiAction;
  selection?: TextSelection;
  translateTo?: TranslateLang;
}

export function replaceTextRange(
  content: string,
  start: number,
  end: number,
  replacement: string,
): string {
  return content.slice(0, start) + replacement + content.slice(end);
}
