import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "$lib/tauri/api";
import { notify } from "$lib/stores/notifications";
import type { AppConfig, UpdateInfo } from "$lib/types";
import { shouldNotifyUpdate } from "$lib/app/updateNotice";

let startupCheckStarted = false;

/** À appeler une fois le splash et l'assistant fermés. N'attend pas le réseau au démarrage. */
export async function runStartupUpdateCheck(): Promise<void> {
  if (startupCheckStarted) return;
  startupCheckStarted = true;
  try {
    const config = await invoke<AppConfig>("get_app_config");
    if (config.checkUpdatesOnStartup === false) return;
    const info = await invoke<UpdateInfo>("check_app_update");
    if (
      !shouldNotifyUpdate({
        checkOnStartup: true,
        updateAvailable: info.updateAvailable,
        latest: info.latest,
        snoozeUntil: config.updateSnoozeUntil,
        snoozeVersion: config.updateSnoozeVersion,
      })
    ) {
      return;
    }
    const message = info.body?.trim() || info.name?.trim() || "Une version plus récente est disponible.";
    notify({
      kind: "info",
      title: `Nouvelle version ${info.latest}`,
      message,
      durationMs: 0,
      key: `update-${info.latest}`,
      actions: [
        {
          label: "Ouvrir la release",
          onClick: () => {
            if (!info.releaseUrl) return;
            void openUrl(info.releaseUrl).catch(() => {
              /* le bandeau est déjà fermé ; l'échec reste discret */
            });
          },
        },
        {
          label: "Plus tard",
          onClick: () => {
            void invoke("snooze_app_update", { version: info.latest }).catch(() => {
              notify({
                kind: "warning",
                title: "Mise à jour",
                message: "Le report de 7 jours n'a pas pu être enregistré.",
                durationMs: 5000,
                key: "update-snooze-failed",
              });
            });
          },
        },
      ],
    });
  } catch {
    /* hors ligne ou GitHub indisponible : ne jamais bloquer le démarrage */
  }
}
