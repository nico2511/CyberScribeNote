import type { AiAction } from "$lib/types";
import type { TranslateLang } from "$lib/ai/languages";
import { parseTranslateVoiceLang } from "$lib/ai/languages";

export interface VoiceCommand {
  kind: "ai";
  action: AiAction;
  translateTo?: TranslateLang;
}

export interface VoiceSearch {
  kind: "search";
  query: string;
}

export interface VoiceOpen {
  kind: "open";
  query: string;
}

export interface VoiceInsert {
  kind: "insert";
  text: string;
}

export type ParsedVoice = VoiceCommand | VoiceSearch | VoiceOpen | VoiceInsert;

/** Normalise accents / ponctuation pour le matching vocal. */
export function normalizeVoiceText(raw: string): string {
  return raw
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,;:!?…]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const AI_PATTERNS: { pattern: RegExp; action: AiAction }[] = [
  { pattern: /^scribe,?\s*r[eé]sum[eé]/i, action: "summarize" },
  { pattern: /^scribe,?\s*reformule/i, action: "reformulate" },
  { pattern: /^scribe,?\s*corrige/i, action: "correct" },
];

const TRANSLATE_PATTERN = /^scribe,?\s*traduis(\s+en\s+(.+))?/i;
const SEARCH_PATTERN = /^scribe,?\s*cherche\s+(.+)/i;
const OPEN_PATTERN =
  /^scribe,?\s*ouvre(\s+la\s+note|\s+le\s+fichier)?\s+(.+)/i;

export function parseVoiceTranscript(raw: string): ParsedVoice {
  const text = raw.trim();
  if (!text) return { kind: "insert", text: "" };

  const normalized = normalizeVoiceText(text);

  for (const { pattern, action } of AI_PATTERNS) {
    if (pattern.test(normalized) || pattern.test(text)) {
      return { kind: "ai", action };
    }
  }

  const translate = text.match(TRANSLATE_PATTERN) ?? normalized.match(/^scribe,?\s*traduis(\s+en\s+(.+))?/i);
  if (translate) {
    const langRaw = (translate[2] ?? "anglais").trim();
    const translateTo = parseTranslateVoiceLang(langRaw) ?? "en";
    return { kind: "ai", action: "translate", translateTo };
  }

  const search = text.match(SEARCH_PATTERN) ?? normalized.match(/^scribe,?\s*cherche\s+(.+)/i);
  if (search) {
    return { kind: "search", query: search[1].trim() };
  }

  const open = text.match(OPEN_PATTERN) ?? normalized.match(/^scribe,?\s*ouvre(\s+la\s+note|\s+le\s+fichier)?\s+(.+)/i);
  if (open) {
    const query = (open[2] ?? open[1] ?? "").trim();
    if (query) return { kind: "open", query };
  }

  return { kind: "insert", text };
}

