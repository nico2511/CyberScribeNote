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
