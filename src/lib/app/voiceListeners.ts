import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "$lib/tauri/api";
import { notify } from "$lib/stores/notifications";
import type { VoiceTranscript } from "$lib/types";

export type VoiceCrashState = {
  restarts: number;
  windowStart: number;
};

export type VoiceListenerDeps = {
  onTranscript: (text: string) => void;
  setStatus: (msg: string) => void;
  refreshVoice: () => Promise<void>;
};

/** Enregistre les listeners Tauri voix ; retourne des fonctions de désinscription. */
export async function registerVoiceListeners(
  deps: VoiceListenerDeps,
  crash: VoiceCrashState,
): Promise<UnlistenFn[]> {
  const unsubs: UnlistenFn[] = [];

  unsubs.push(
    await listen<VoiceTranscript>("voice-transcript", (event) => {
      deps.onTranscript(event.payload.text);
    }),
  );

  unsubs.push(
    await listen("voice-event", async (event) => {
      await deps.refreshVoice();
      const payload = event.payload as {
        type?: string;
        message?: string;
      };
      if (payload?.type === "error" && payload.message) {
        const soft =
          payload.message.includes("Transcription encore") ||
          payload.message.includes("automatiquement");
        deps.setStatus(`Voix : ${payload.message}`);
        if (!soft) {
          notify({
            kind: "error",
            title: "Erreur vocale",
            message: payload.message,
            key: `voice-error:${payload.message}`,
          });
        } else {
          notify({
            kind: "warning",
            title: "Voix",
            message: payload.message,
            key: "voice-soft",
          });
        }
      }
    }),
  );

  unsubs.push(
    await listen("voice-worker-stopped", async (event) => {
      await deps.refreshVoice();
      const payload = (event.payload ?? {}) as { message?: string };
      const detail =
        payload.message?.trim() ||
        "Worker vocal arrêté. Réglages → Voix → « Appliquer la config voix » pour le relancer.";
      deps.setStatus(detail);
      notify({
        kind: "error",
        title: "Worker vocal arrêté",
        message: detail,
        key: "voice-stopped",
        durationMs: 16000,
      });

      const now = Date.now();
      if (now - crash.windowStart > 60_000) {
        crash.windowStart = now;
        crash.restarts = 0;
      }
      if (crash.restarts >= 1) {
        notify({
          kind: "warning",
          title: "Voix bloquée",
          message:
            "Relance auto arrêtée. Réglages → Voix → « Appliquer la config voix ». Logs : Documents/CyberScribeNote/voice_worker.log",
          key: "voice-blocked",
          durationMs: 20000,
        });
        return;
      }
      crash.restarts += 1;

      try {
        await invoke("voice_restart", { force: true });
        await invoke("voice_preload_whisper_model");
        notify({
          kind: "info",
          title: "Worker vocal relancé",
          message: "Attendez le chargement du modèle Whisper avant de dicter.",
          key: "voice-restart",
        });
        await deps.refreshVoice();
      } catch (e) {
        notify({
          kind: "error",
          title: "Relance impossible",
          message: String(e),
          key: "voice-restart-fail",
        });
      }
    }),
  );

  return unsubs;
}
