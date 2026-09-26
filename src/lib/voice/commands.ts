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
    phrase: "Scribe, indexe dossier",
    description: "Génère ou met à jour sommaire.md dans le dossier de la note",
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
    phrase: "Scribe, actions",
    description: "Checklist des tâches déjà mentionnées",
    category: "ia",
    requiresNote: true,
    requiresOllama: true,
  },
  {
    phrase: "Scribe, questions",
    description: "Questions ouvertes déjà visibles dans la note",
    category: "ia",
    requiresNote: true,
    requiresOllama: true,
  },
  {
    phrase: "Scribe, décisions",
    description: "Décisions déjà posées, ou le dit s'il n'y en a pas",
    category: "ia",
    requiresNote: true,
    requiresOllama: true,
  },
  {
    phrase: "Scribe, clarifie",
    description: "Réécrit plus clairement, mêmes faits",
    category: "ia",
    requiresNote: true,
    requiresOllama: true,
  },
  {
    phrase: "Scribe, raccourcis",
    description: "Version plus courte, mêmes faits",
    category: "ia",
    requiresNote: true,
    requiresOllama: true,
  },
  {
    phrase: "Scribe, titre",
    description: "Propose un titre d'après le contenu",
    category: "ia",
    requiresNote: true,
    requiresOllama: true,
  },
  {
    phrase: "Scribe, relis",
    description: "Orthographe et ponctuation, sans changer le fond",
    category: "ia",
    requiresNote: true,
    requiresOllama: true,
  },
  {
    phrase: "Scribe, sources",
    description: "Liste les URL déjà présentes (sans aller les chercher)",
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
