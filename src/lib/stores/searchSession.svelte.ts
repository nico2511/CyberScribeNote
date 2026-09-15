import { invoke } from "$lib/tauri/api";
import type { SearchResult } from "$lib/types";

export const searchSession = $state({
  open: false,
  query: "",
  results: [] as SearchResult[],
  loading: false,
});

let searchTimer: ReturnType<typeof setTimeout> | null = null;
let searchSeq = 0;

export function openSearchPanel(): void {
  searchSession.open = true;
  searchSession.query = "";
  searchSession.results = [];
  searchSession.loading = false;
}

export function closeSearchPanel(): void {
  searchSession.open = false;
}

export async function runVaultSearch(q: string): Promise<void> {
  searchSession.query = q;
  if (searchTimer) clearTimeout(searchTimer);
  if (!q.trim()) {
    searchSeq += 1;
    searchSession.results = [];
    searchSession.loading = false;
    return;
  }
  const seq = ++searchSeq;
  searchSession.loading = true;
  const query = q.trim();
  searchTimer = setTimeout(async () => {
    try {
      const results = await invoke<SearchResult[]>("search_vault", { query });
      if (seq !== searchSeq) return;
      searchSession.results = results;
    } finally {
      if (seq === searchSeq) {
        searchSession.loading = false;
      }
    }
  }, 200);
}
