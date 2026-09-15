/** État initial wizard / splash (premier lancement). */
export function resolveFirstRunUi(): { setupOpen: boolean; splashOpen: boolean } {
  try {
    const setupDone = localStorage.getItem("csn-setup-done") === "1";
    const splashDismissed = localStorage.getItem("csn-splash-dismissed") === "1";
    if (!setupDone && !splashDismissed) {
      return { setupOpen: true, splashOpen: false };
    }
    if (!setupDone) {
      localStorage.setItem("csn-setup-done", "1");
    }
    return { setupOpen: false, splashOpen: !splashDismissed };
  } catch {
    return { setupOpen: true, splashOpen: false };
  }
}
