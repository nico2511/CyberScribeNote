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

/** Poll until the API answers, or until deadline. */
async function waitUntilOllamaAvailable(
  maxMs: number,
  onStatus?: (message: string) => void,
  silent = false,
): Promise<boolean> {
  const started = Date.now();
  let attempt = 0;
  while (Date.now() - started < maxMs) {
    attempt += 1;
    await refreshOllama();
    if (ollamaSession.status.available) {
      if (!silent) {
        onStatus?.("Ollama connecté.");
      }
      return true;
    }
    if (!silent && attempt === 1) {
      onStatus?.("Démarrage d'Ollama…");
    }
    const elapsed = Date.now() - started;
    const delay = elapsed < 4000 ? 1200 : elapsed < 12000 ? 2000 : 3000;
    await new Promise((r) => setTimeout(r, delay));
  }
  await refreshOllama();
  return ollamaSession.status.available;
}

export async function ensureOllamaRunning(
  silent = false,
  onStatus?: (message: string) => void,
): Promise<boolean> {
  await refreshOllama();
  if (ollamaSession.status.available) return true;

  try {
    const detect = await invoke<OllamaDetect>("ollama_detect");
    if (!detect.serviceRunning) {
      try {
        await invoke<string>("ollama_start_service");
      } catch (e) {
        if (!silent) {
          onStatus?.(String(e));
        }
        return false;
      }
    }

    // Tray cold-start on Windows can exceed ~10s when models live on another disk.
    const ok = await waitUntilOllamaAvailable(28000, onStatus, silent);
    if (ok) return true;
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
