import type { ThemeMode } from "$lib/types";

const STORAGE_KEY = "csn-theme";

export function loadTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function saveTheme(theme: ThemeMode) {
  localStorage.setItem(STORAGE_KEY, theme);
  document.documentElement.dataset.theme = theme;
}

export function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
}

export function toggleTheme(current: ThemeMode): ThemeMode {
  return current === "light" ? "dark" : "light";
}
