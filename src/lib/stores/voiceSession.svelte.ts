import { invoke } from "@tauri-apps/api/core";
import type { VoiceStatus } from "$lib/types";
import { notify } from "$lib/stores/notifications";

export const voiceSession = $state({
  status: {
    running: false,
    recording: false,
    transcribing: false,
    modelLoaded: false,
    modelLoading: false,
    depsOk: false,
    hotkey: "F8",
  } as VoiceStatus,
  pendingDictation: null as { text: string; id: number } | null,
  pendingPromptDictation: null as { text: string; id: number } | null,
});

let voiceTranscriptChain: Promise<void> = Promise.resolve();
let voiceLoadingToastId: string | null = null;

export function getVoiceLoadingToastId(): string | null {
  return voiceLoadingToastId;
}

export function setVoiceLoadingToastId(id: string | null): void {
  voiceLoadingToastId = id;
}

export async function refreshVoice(): Promise<void> {
  voiceSession.status = await invoke<VoiceStatus>("voice_get_status");
}

export async function handleVoiceToggle(setStatus: (msg: string) => void): Promise<void> {
  const voiceStatus = voiceSession.status;
  if (voiceStatus.transcribing) {
    const msg = "Transcription en cours — patientez quelques secondes.";
    setStatus(msg);
    notify({ kind: "info", title: "Transcription en cours", message: msg });
    return;
  }
  await refreshVoice();
  const st = voiceSession.status;
  if (st.modelLoading) {
    const msg = "Chargement du modèle Whisper en cours — patientez avant de dicter.";
    setStatus(msg);
    notify({ kind: "warning", title: "Modèle en chargement", message: msg });
    return;
  }
  if (st.running && !st.modelLoaded) {
    const msg = "Modèle Whisper non chargé — Réglages → Voix → « Appliquer la config voix ».";
    setStatus(msg);
    notify({ kind: "warning", title: "Dictée indisponible", message: msg });
    return;
  }
  if (st.error) {
    const soft = st.error.includes("automatiquement") || st.error.includes("Transcription encore");
    if (!soft) {
      setStatus(`Voix : ${st.error}`);
      notify({ kind: "error", title: "Erreur vocale", message: st.error });
      return;
    }
  }
  try {
    await invoke("voice_toggle");
    await refreshVoice();
  } catch (e) {
    const msg = String(e);
    setStatus(msg);
    notify({
      kind: msg.includes("chargement") || msg.includes("redémarré") ? "warning" : "error",
      title: "Dictée",
      message: msg,
      key: "voice-toggle",
    });
    await refreshVoice();
  }
}

export function appendTranscript(fragment: string, onSilenceAi: (ms: number) => void): void {
  const raw = fragment.trim();
  if (!raw) return;
  voiceSession.pendingDictation = { text: raw, id: Date.now() };
  onSilenceAi(8000);
}

export function enqueueVoiceTranscript(task: () => Promise<void>): Promise<void> {
  voiceTranscriptChain = voiceTranscriptChain.then(task);
  return voiceTranscriptChain;
}

export function isVoiceBusy(): boolean {
  return voiceSession.status.recording || voiceSession.status.transcribing;
}
