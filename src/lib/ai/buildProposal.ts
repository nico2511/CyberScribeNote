import { finalizeCorrection, applyLocalCorrections } from "$lib/ai/localCorrect";
import { isFaithfulCorrection } from "$lib/ai/faithful";
import { sanitizeAiOutput } from "$lib/ai/sanitize";
import { hasMeaningfulDiff } from "$lib/ai/textDiff";
import type { AiAction } from "$lib/types";

/** Prépare le texte proposé pour une action IA (correction orthographique stricte). */
export function buildAiProposal(
  action: AiAction,
  original: string,
  aiRaw: string,
): string | null {
  if (action === "correct") {
    const fromAi = finalizeCorrection(original, aiRaw);
    if (hasMeaningfulDiff(original, fromAi) && isFaithfulCorrection(original, fromAi)) {
      return fromAi;
    }

    const local = applyLocalCorrections(original);
    if (hasMeaningfulDiff(original, local) && isFaithfulCorrection(original, local)) {
      return local;
    }

    return null;
  }

  const cleaned = sanitizeAiOutput(aiRaw, action === "custom" ? "reformulate" : action);
  if (!cleaned.trim()) return null;
  return cleaned;
}

/** Correction locale prioritaire — sans Ollama. Les règles sont contrôlées, pas de filtre de fidélité. */
export function buildLocalCorrection(original: string): string | null {
  const local = applyLocalCorrections(original);
  if (!hasMeaningfulDiff(original, local)) return null;
  return local;
}
