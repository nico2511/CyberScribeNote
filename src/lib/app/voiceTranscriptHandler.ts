import { parseVoiceTranscript } from "$lib/voice/keywords";
import { translateLangLabel } from "$lib/ai/languages";
import { getSkill } from "$lib/ai/skills";
import { noteBody } from "$lib/note/frontmatter";
import { notify } from "$lib/stores/notifications";
import { noteSession } from "$lib/stores/noteSession.svelte";
import { voiceSession } from "$lib/stores/voiceSession.svelte";
import type { AiActionRequest } from "$lib/voice/commands";
import type { SkillId } from "$lib/ai/skills";

export type VoiceTranscriptDeps = {
  setStatus: (msg: string) => void;
  silenceAiHelpers: (ms: number) => void;
  openSearch: () => void;
  runSearch: (q: string) => Promise<void>;
  openNoteByQuery: (query: string) => Promise<void>;
  ensureOllamaRunning: (silent?: boolean) => Promise<boolean>;
  openSettings: () => void;
  ollamaAvailable: boolean;
  customPromptFocused: boolean;
  companionOpen: boolean;
  appendTranscript: (text: string) => void;
  handleAiAction: (request: AiActionRequest) => Promise<void>;
  handleSkill: (id: SkillId) => Promise<void>;
};

export async function processVoiceTranscript(
  deps: VoiceTranscriptDeps,
  text: string,
): Promise<void> {
  if (!text.trim()) {
    const msg =
      "Aucune parole reconnue — phrase trop longue, trop de pauses, ou micro trop bas. Réessayez, ou passez la durée max à 90 s (Réglages → Voix).";
    deps.setStatus(msg);
    notify({ kind: "warning", title: "Aucune parole détectée", message: msg, key: "voice-empty" });
    return;
  }

  deps.silenceAiHelpers(8000);
  const parsed = parseVoiceTranscript(text);

  if (parsed.kind === "unknown") {
    const preview = text.slice(0, 80);
    const msg = `Commande non reconnue : « ${preview} ». Dites par ex. « Scribe, corrige ».`;
    deps.setStatus(msg);
    notify({ kind: "warning", title: "Commande vocale", message: msg, key: "voice-cmd" });
    return;
  }

  if (parsed.kind === "search") {
    deps.openSearch();
    if (parsed.query) await deps.runSearch(parsed.query);
    const msg = parsed.query
      ? `Recherche vocale : ${parsed.query}`
      : "Recherche vocale — saisissez un mot-clé.";
    deps.setStatus(msg);
    notify({ kind: "success", title: "Scribe · chercher", message: msg, key: "voice-cmd" });
    return;
  }

  if (parsed.kind === "open") {
    await deps.openNoteByQuery(parsed.query);
    return;
  }

  if (parsed.kind === "ai") {
    const labels: Record<string, string> = {
      summarize: "résume",
      reformulate: "reformule",
      correct: "corrige",
      translate: parsed.translateTo
        ? `traduis en ${translateLangLabel(parsed.translateTo).toLowerCase()}`
        : "traduis",
    };
    const phrase = labels[parsed.action] ?? parsed.action;
    if (!noteSession.selectedPath) {
      const msg = "Ouvrez une note pour les commandes IA vocales (PTT).";
      deps.setStatus(msg);
      notify({ kind: "warning", title: "Scribe", message: msg, key: "voice-cmd" });
      return;
    }
    if (!noteBody(noteSession.content).trim()) {
      const msg = "La note est vide — rien à transformer. Dictez d'abord du texte.";
      deps.setStatus(msg);
      notify({ kind: "warning", title: "Scribe", message: msg, key: "voice-cmd" });
      return;
    }
    if (!deps.ollamaAvailable && parsed.action !== "correct") {
      const ok = await deps.ensureOllamaRunning(true);
      if (!ok) {
        const msg = "Ollama hors ligne — impossible d'exécuter la commande IA.";
        deps.setStatus(msg);
        notify({ kind: "error", title: "Scribe", message: msg, key: "voice-cmd" });
        deps.openSettings();
        return;
      }
    }
    deps.setStatus(`Commande vocale : ${phrase}…`);
    notify({
      kind: "info",
      title: "Scribe",
      message: `Commande « ${phrase} » reconnue — traitement…`,
      key: "voice-cmd",
    });
    await deps.handleAiAction({
      action: parsed.action,
      translateTo: parsed.translateTo,
    });
    return;
  }

  if (parsed.kind === "skill") {
    if (!noteSession.selectedPath) {
      const msg = "Ouvrez une note pour les commandes de conception (PTT).";
      deps.setStatus(msg);
      notify({ kind: "warning", title: "Scribe", message: msg, key: "voice-cmd" });
      return;
    }
    deps.setStatus(`Commande vocale : ${getSkill(parsed.skillId).label}…`);
    notify({
      kind: "info",
      title: "Scribe",
      message: `Skill « ${getSkill(parsed.skillId).label} » — traitement…`,
      key: "voice-cmd",
    });
    await deps.handleSkill(parsed.skillId);
    return;
  }

  if (!noteSession.selectedPath) {
    const msg = "Ouvrez une note pour insérer la dictée (PTT).";
    deps.setStatus(msg);
    notify({ kind: "warning", title: "Note requise", message: msg });
    return;
  }

  if (deps.customPromptFocused && deps.companionOpen) {
    voiceSession.pendingPromptDictation = { text: parsed.text, id: Date.now() };
    const preview = `« ${parsed.text.slice(0, 60)}${parsed.text.length > 60 ? "…" : ""} »`;
    deps.setStatus(`Dictée → prompt custom : ${preview}`);
    notify({ kind: "success", title: "Dictée (prompt)", message: preview, key: "voice-prompt" });
    return;
  }

  deps.appendTranscript(parsed.text);
  const preview = `« ${parsed.text.slice(0, 60)}${parsed.text.length > 60 ? "…" : ""} »`;
  deps.setStatus(`Dictée insérée : ${preview}`);
  notify({ kind: "success", title: "Dictée insérée", message: preview });
}
