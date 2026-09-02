import type { AiAction } from "$lib/types";

export interface VoiceCommand {
  kind: "ai";
  action: AiAction;
}

export interface VoiceSearch {
  kind: "search";
  query: string;
}

export interface VoiceInsert {
  kind: "insert";
  text: string;
}

export type ParsedVoice = VoiceCommand | VoiceSearch | VoiceInsert;

const AI_PATTERNS: { pattern: RegExp; action: AiAction }[] = [
  { pattern: /^scribe,?\s*r[ée]sum[ée]/i, action: "summarize" },
  { pattern: /^scribe,?\s*reformule/i, action: "reformulate" },
  { pattern: /^scribe,?\s*corrige/i, action: "correct" },
  { pattern: /^scribe,?\s*traduis\s+en\s+anglais/i, action: "translate_en" },
];

const SEARCH_PATTERN = /^scribe,?\s*cherche\s+(.+)/i;
const OPEN_PATTERN = /^scribe,?\s*ouvre\s+(.+)/i;

export function parseVoiceTranscript(raw: string): ParsedVoice {
  const text = raw.trim();
  if (!text) return { kind: "insert", text: "" };

  for (const { pattern, action } of AI_PATTERNS) {
    if (pattern.test(text)) {
      return { kind: "ai", action };
    }
  }

  const search = text.match(SEARCH_PATTERN);
  if (search) {
    return { kind: "search", query: search[1].trim() };
  }

  const open = text.match(OPEN_PATTERN);
  if (open) {
    return { kind: "insert", text: `[[${open[1].trim()}]]` };
  }

  return { kind: "insert", text };
}

export function insertTranscript(current: string, fragment: string): string {
  if (!fragment) return current;
  if (!current.trim()) return fragment;
  const sep = current.endsWith("\n") || current.endsWith(" ") ? "" : " ";
  return current + sep + fragment;
}
