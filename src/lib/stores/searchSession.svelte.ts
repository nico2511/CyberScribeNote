import { invoke } from "$lib/tauri/api";
import type { SearchResult } from "$lib/types";

export const searchSession = $state({
  open: false,
  query: "",
  results: [] as SearchResult[],
  loading: false,
});

let searchTimer: ReturnType<typeof setTimeout> | null = null;

export function openSearchPanel(): void {
  searchSession.open = true;
  searchSession.query = "";
  searchSession.results = [];
}

export function closeSearchPanel(): void {
  searchSession.open = false;
}

export async function runVaultSearch(q: string): Promise<void> {
  searchSession.query = q;
  if (searchTimer) clearTimeout(searchTimer);
  if (!q.trim()) {
    searchSession.results = [];
    return;
  }
  searchSession.loading = true;
  searchTimer = setTimeout(async () => {
    try {
      searchSession.results = await invoke<SearchResult[]>("search_vault", { query: q });
    } finally {
      searchSession.loading = false;
    }
  }, 200);
}
