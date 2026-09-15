import { invoke } from "$lib/tauri/api";
import { buildAiProposal } from "$lib/ai/buildProposal";
import { extractExistingSummary, isDuplicateSummary } from "$lib/ai/languages";
import { fetchRagContext } from "$lib/ai/rag";
import { noteBody, parseNoteContext } from "$lib/note/frontmatter";
import { aiQueue, stillCurrentAiRequest } from "$lib/stores/aiQueue.svelte";
import { noteSession } from "$lib/stores/noteSession.svelte";
import type { AiSuggestion } from "$lib/types";

const lastKeyByNote = { key: "" };

export type AutoSummarizeDeps = {
  enabled: boolean;
  activeModel: string;
  setStatus: (msg: string) => void;
  ensureOllamaRunning: (silent?: boolean) => Promise<boolean>;
  ollamaAvailable: boolean;
};

export async function maybeAutoSummarize(
  deps: AutoSummarizeDeps,
  path: string,
  body: string,
): Promise<void> {
  if (!deps.enabled) return;
  if (Date.now() - noteSession.noteOpenedAt < 20000) return;

  const epoch = noteSession.aiEpoch;
  const text = noteBody(body).trim();
  if (text.length < 280) return;
  if (text.split(/\s+/).length < 40) return;

  const existing = extractExistingSummary(body);
  const key = `${path}:${text.length}:${text.slice(0, 80)}`;
  if (key === lastKeyByNote.key) return;
  if (aiQueue.aiLoading || aiQueue.proactiveLoading) return;

  if (!deps.ollamaAvailable) {
    const ok = await deps.ensureOllamaRunning(true);
    if (!ok) return;
  }

  const already = aiQueue.aiSuggestions.some(
    (s) =>
      s.action === "summarize" &&
      s.source === "proactive" &&
      s.notePath === path &&
      !s.selection,
  );
  if (already) return;

  try {
    deps.setStatus("Résumé automatique en cours…");
    const ragContext = await fetchRagContext(text.slice(0, 800), path);
    if (!stillCurrentAiRequest(epoch, path)) return;

    const result = await invoke<string>("ollama_summarize_note", {
      content: text,
      model: deps.activeModel,
      noteContext: parseNoteContext(body).trim() || null,
      ragContext: ragContext || null,
    });
    if (!stillCurrentAiRequest(epoch, path)) return;

    const proposal = buildAiProposal("summarize", text, result);
    if (!proposal) return;
    if (isDuplicateSummary(existing, proposal)) {
      lastKeyByNote.key = key;
      deps.setStatus("Résumé déjà à jour — aucune proposition.");
      return;
    }

    lastKeyByNote.key = key;
    aiQueue.companionOpen = true;
    const suggestion: AiSuggestion = {
      id: crypto.randomUUID(),
      action: "summarize",
      label: "Résumé",
      scope: "à ajouter en fin de note",
      proposedText: proposal,
      originalText: "",
      notePath: path,
      source: "proactive",
      applyMode: "append",
      reason: "Inactivité d'édition — complément, pas un remplacement",
    };
    aiQueue.aiSuggestions = [
      suggestion,
      ...aiQueue.aiSuggestions.filter((s) => s.notePath === path),
    ].slice(0, 12);
    deps.setStatus("Résumé prêt (ajout en fin de note) — appliquez ou ignorez.");
  } catch (e) {
    if (stillCurrentAiRequest(epoch, path)) {
      deps.setStatus(`Résumé auto indisponible : ${e}`);
    }
  }
}
