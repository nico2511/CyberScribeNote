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

/** Wake word entendu, mais verbe inconnu — ne pas insérer dans la note. */
export interface VoiceUnknown {
  kind: "unknown";
  text: string;
}

export type ParsedVoice =
  | VoiceCommand
  | VoiceSearch
  | VoiceOpen
  | VoiceInsert
  | VoiceUnknown;

const FILLER_RE =
  /^(?:(?:euh|heu|eu|bah|ben|bon|alors|ok|okay|ouais|oui|ouai|hey|salut|hello|cest|c est|cet)\s+)*/;

/** Formes que Whisper entend souvent à la place de « Scribe ». */
const STRONG_WAKE_RE = /^(?:cyber[\s-]*scribe|scribe|scrib)\b/;
const WEAK_WAKE_RE = /^(?:script|scripts|escribe|ascribe|skribe?|stribe)\b/;

/** Normalise accents / ponctuation pour le matching vocal. */
export function normalizeVoiceText(raw: string): string {
  return raw
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,;:!?…'"«»“”‘’()[\]{}]/g, " ")
    .replace(/[-–—_/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function stripFiller(normalized: string): string {
  return normalized.replace(FILLER_RE, "").trim();
}

function splitWake(normalized: string): {
  wake: "strong" | "weak" | null;
  rest: string;
} {
  const s = stripFiller(normalized);
  const strong = s.match(STRONG_WAKE_RE);
  if (strong) {
    return { wake: "strong", rest: s.slice(strong[0].length).trim() };
  }
  const weak = s.match(WEAK_WAKE_RE);
  if (weak) {
    return { wake: "weak", rest: s.slice(weak[0].length).trim() };
  }
  return { wake: null, rest: s };
}

function extractAfter(raw: string, verb: RegExp): string {
  const m = raw.match(verb);
  return (m?.[1] ?? "").trim();
}

function matchCommand(
  rest: string,
  original: string,
): Exclude<ParsedVoice, VoiceInsert | VoiceUnknown> | null {
  if (/^(resume[rez]?|un resume|le resume|la resume|fait un resume)\b/.test(rest)) {
    return { kind: "ai", action: "summarize" };
  }
  if (/^reformul/.test(rest)) {
    return { kind: "ai", action: "reformulate" };
  }
  if (/^corrig|^correction\b/.test(rest)) {
    return { kind: "ai", action: "correct" };
  }
  if (/^tradu/.test(rest)) {
    const langRaw =
      extractAfter(
        original,
        /tradu(?:is|it|ire|ction)(?:\s+en\s+(.+))?/i,
      ) || extractAfter(rest, /^tradu\S*(?:\s+en\s+(.+))?/);
    const translateTo = parseTranslateVoiceLang(langRaw || "anglais") ?? "en";
    return { kind: "ai", action: "translate", translateTo };
  }

  if (/^(?:re)?cherch/.test(rest)) {
    const query =
      extractAfter(original, /(?:re)?cherch(?:e|er|ez|é|ée)?\s+(.+)/i) ||
      extractAfter(rest, /^(?:re)?cherch\S*\s+(.+)/);
    if (query) return { kind: "search", query };
    return { kind: "search", query: "" };
  }

  if (/^ouvr/.test(rest)) {
    const query =
      extractAfter(
        original,
        /ouvr(?:e|ir|ez|ert)?\s+(?:(?:la|une)\s+note\s+|(?:le|un)\s+fichier\s+)?(.+)/i,
      ) ||
      extractAfter(
        rest,
        /^ouvr\S*\s+(?:(?:la|une)\s+note\s+|(?:le|un)\s+fichier\s+)?(.+)/,
      );
    if (query) return { kind: "open", query };
    return null;
  }

  return null;
}

export function parseVoiceTranscript(raw: string): ParsedVoice {
  const text = raw.trim();
  if (!text) return { kind: "insert", text: "" };

  const normalized = normalizeVoiceText(text);
  const { wake, rest } = splitWake(normalized);

  if (!wake) {
    return { kind: "insert", text };
  }

  const command = matchCommand(rest, text);
  if (command) return command;

  // « script python pour… » : dictée, pas une commande.
  if (wake === "weak") {
    return { kind: "insert", text };
  }

  // Dictée longue qui commence par « Scribe » : on insère.
  const words = rest.split(/\s+/).filter(Boolean);
  if (words.length >= 10) {
    return { kind: "insert", text };
  }

  return { kind: "unknown", text };
}
