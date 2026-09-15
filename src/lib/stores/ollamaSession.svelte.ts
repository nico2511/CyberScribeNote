import { invoke } from "$lib/tauri/api";
import type { OllamaDetect, OllamaStatus } from "$lib/types";

const defaultStatus = (): OllamaStatus => ({
  available: false,
  models: [],
  host: "http://127.0.0.1:11434",
  selectedModel: "llama3.2",
  networkMode: "local",
  isLocalhost: true,
});

export const ollamaSession = $state({
  status: defaultStatus(),
});

export function setOllamaStatus(status: OllamaStatus): void {
  ollamaSession.status = status;
}

export async function refreshOllama(): Promise<void> {
  ollamaSession.status = await invoke<OllamaStatus>("ollama_status");
}

export async function ensureOllamaRunning(
  silent = false,
  onStatus?: (message: string) => void,
): Promise<boolean> {
  await refreshOllama();
  if (ollamaSession.status.available) return true;

  try {
    const detect = await invoke<OllamaDetect>("ollama_detect");
    if (!detect.cliInstalled && !detect.serviceRunning) {
      try {
        await invoke<string>("ollama_start_service");
      } catch {
        return false;
      }
    } else if (!detect.serviceRunning) {
      await invoke<string>("ollama_start_service");
    }

    if (!silent) {
      onStatus?.("Démarrage d'Ollama…");
    }

    for (const delay of [2500, 3500, 5000]) {
      await new Promise((r) => setTimeout(r, delay));
      await refreshOllama();
      if (ollamaSession.status.available) {
        if (!silent) {
          onStatus?.("Ollama connecté.");
        }
        return true;
      }
    }
  } catch (e) {
    if (!silent) {
      onStatus?.(String(e));
    }
  }

  return ollamaSession.status.available;
}

export function activeOllamaModel(): string {
  const s = ollamaSession.status;
  return s.selectedModel || s.models[0] || "llama3.2";
}
