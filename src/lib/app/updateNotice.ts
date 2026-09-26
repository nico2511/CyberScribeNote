/** Décide si l'avis de démarrage doit s'afficher (sans appel réseau). */

export interface UpdateNoticeInput {
  /** Préférence « Vérifier les mises à jour au démarrage ». */
  checkOnStartup: boolean;
  updateAvailable: boolean;
  latest: string;
  /** RFC3339. Absent = pas de report. */
  snoozeUntil?: string | null;
  /** Version (avec ou sans `v`) masquée par « Plus tard ». */
  snoozeVersion?: string | null;
  now?: Date;
}

export function stripVersionPrefix(version: string): string {
  return version.trim().replace(/^v/i, "");
}

/**
 * « Plus tard » masque uniquement la version concernée jusqu'à `snoozeUntil`
 * (7 jours, posé côté Rust). Une version différente, un report expiré ou une
 * date illisible réaffichent l'avis.
 */
export function shouldNotifyUpdate(input: UpdateNoticeInput): boolean {
  if (!input.checkOnStartup || !input.updateAvailable) return false;
  const latest = stripVersionPrefix(input.latest);
  const snoozed = stripVersionPrefix(input.snoozeVersion ?? "");
  if (!input.snoozeUntil || !snoozed || snoozed !== latest) return true;
  const until = Date.parse(input.snoozeUntil);
  if (Number.isNaN(until)) return true;
  const now = input.now ?? new Date();
  return now.getTime() >= until;
}
