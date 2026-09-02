const PROACTIVE_KEY = "csn-companion-proactive";
const AUTO_TYPO_KEY = "csn-companion-auto-typo";
const PANEL_POS_KEY = "csn-companion-panel-pos";
const PANEL_SIZE_KEY = "csn-companion-panel-size";
const CUSTOM_PROMPT_KEY = "csn-companion-custom-prompt";

export type CompanionPanelSize = "s" | "m" | "l";

export interface CompanionPanelPos {
  x: number;
  y: number;
}

export const COMPANION_SIZE_PRESETS: Record<
  CompanionPanelSize,
  { width: number; maxHeightRatio: number; label: string; title: string }
> = {
  s: { width: 300, maxHeightRatio: 0.42, label: "S", title: "Discret" },
  m: { width: 380, maxHeightRatio: 0.62, label: "M", title: "Moyen" },
  l: { width: 480, maxHeightRatio: 0.85, label: "L", title: "Grand" },
};

export function loadProactiveEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  const raw = localStorage.getItem(PROACTIVE_KEY);
  return raw === null ? true : raw === "1";
}

export function saveProactiveEnabled(enabled: boolean) {
  localStorage.setItem(PROACTIVE_KEY, enabled ? "1" : "0");
}

/** Correction automatique des fautes (locale, sans Ollama). */
export function loadAutoTypoFixEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  const raw = localStorage.getItem(AUTO_TYPO_KEY);
  return raw === null ? true : raw === "1";
}

export function saveAutoTypoFixEnabled(enabled: boolean) {
  localStorage.setItem(AUTO_TYPO_KEY, enabled ? "1" : "0");
}

export function loadCompanionPanelPos(): CompanionPanelPos | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(PANEL_POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CompanionPanelPos;
    if (typeof parsed.x === "number" && typeof parsed.y === "number") return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

export function saveCompanionPanelPos(pos: CompanionPanelPos) {
  localStorage.setItem(PANEL_POS_KEY, JSON.stringify(pos));
}

export function loadCompanionPanelSize(): CompanionPanelSize {
  if (typeof localStorage === "undefined") return "m";
  const raw = localStorage.getItem(PANEL_SIZE_KEY);
  return raw === "s" || raw === "m" || raw === "l" ? raw : "m";
}

export function saveCompanionPanelSize(size: CompanionPanelSize) {
  localStorage.setItem(PANEL_SIZE_KEY, size);
}

export function companionPanelWidth(size: CompanionPanelSize): number {
  const preset = COMPANION_SIZE_PRESETS[size];
  if (typeof window === "undefined") return preset.width;
  return Math.min(window.innerWidth * 0.92, preset.width);
}

export function companionPanelMaxHeight(size: CompanionPanelSize): number {
  const preset = COMPANION_SIZE_PRESETS[size];
  if (typeof window === "undefined") return 560;
  return Math.min(window.innerHeight * preset.maxHeightRatio, 820);
}

export function loadCustomPrompt(): string {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(CUSTOM_PROMPT_KEY) ?? "";
}

export function saveCustomPrompt(value: string) {
  localStorage.setItem(CUSTOM_PROMPT_KEY, value);
}

export function defaultCompanionPanelPos(size: CompanionPanelSize = "m"): CompanionPanelPos {
  if (typeof window === "undefined") return { x: 16, y: 16 };
  const width = companionPanelWidth(size);
  return {
    x: Math.max(8, window.innerWidth - width - 16),
    y: Math.max(8, window.innerHeight - 420),
  };
}
