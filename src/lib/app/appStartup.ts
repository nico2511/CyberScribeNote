import { applyTheme, loadTheme } from "$lib/stores/theme";
import {
  loadProactiveEnabled,
  loadAutoTypoFixEnabled,
  loadAutoSummarizeEnabled,
} from "$lib/stores/companion";
import { initBuddyFromStorage } from "$lib/stores/buddySession.svelte";
import { refreshVault } from "$lib/stores/vaultStore.svelte";
import { refreshVoice } from "$lib/stores/voiceSession.svelte";
import { ensureOllamaRunning } from "$lib/stores/ollamaSession.svelte";
import type { ThemeMode } from "$lib/types";

export type AppStartupResult = {
  theme: ThemeMode;
  proactiveEnabled: boolean;
  autoTypoFixEnabled: boolean;
  autoSummarizeEnabled: boolean;
};

/** Charge thème, préférences et services (vault, Ollama, voix). */
export async function runAppStartup(
  onOllamaStatus?: (msg: string) => void,
): Promise<AppStartupResult> {
  const theme = loadTheme();
  applyTheme(theme);
  initBuddyFromStorage();
  await refreshVault();
  await ensureOllamaRunning(true, onOllamaStatus);
  await refreshVoice();

  return {
    theme,
    proactiveEnabled: loadProactiveEnabled(),
    autoTypoFixEnabled: loadAutoTypoFixEnabled(),
    autoSummarizeEnabled: loadAutoSummarizeEnabled(),
  };
}
