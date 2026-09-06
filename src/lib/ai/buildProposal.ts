import { finalizeCorrection, applyLocalCorrections } from "$lib/ai/localCorrect";
import { isFaithfulCorrection } from "$lib/ai/faithful";
import {
  instructionRequiresFidelity,
  isGroundedTransform,
} from "$lib/ai/grounding";
import { sanitizeAiOutput } from "$lib/ai/sanitize";
import { hasMeaningfulDiff } from "$lib/ai/textDiff";
import { repairMarkdownProposal } from "$lib/markdown/repair";
import type { AiAction } from "$lib/types";

/** Prépare le texte proposé pour une action IA (correction orthographique stricte). */
export function buildAiProposal(
  action: AiAction,
  original: string,
  aiRaw: string,
  instruction?: string,
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

  let cleaned = sanitizeAiOutput(aiRaw, action);
  if (action === "custom") {
    cleaned = repairMarkdownProposal(cleaned);
  }
  if (!cleaned.trim()) return null;

  if (
    (action === "custom" || action === "reformulate") &&
    (!instruction || instructionRequiresFidelity(instruction)) &&
    !isGroundedTransform(original, cleaned)
  ) {
    return null;
  }

  return cleaned;
}

/** Correction locale prioritaire — sans Ollama. Les règles sont contrôlées, pas de filtre de fidélité. */
export function buildLocalCorrection(original: string): string | null {
  const local = applyLocalCorrections(original);
  if (!hasMeaningfulDiff(original, local)) return null;
  return local;
}
