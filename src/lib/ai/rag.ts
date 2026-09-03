import { invoke } from "@tauri-apps/api/core";
import type { RagHit } from "$lib/types";

export type { RagHit, RagStatus } from "$lib/types";

export async function fetchRagContext(
  query: string,
  excludePath?: string | null,
): Promise<string> {
  const q = query.trim();
  if (q.length < 12) return "";
  try {
    const hits = await invoke<RagHit[]>("rag_query", {
      query: q.slice(0, 2000),
      topK: 5,
      excludePath: excludePath ?? null,
    });
    if (!hits.length) return "";
    const lines = hits.map(
      (h, i) => `[${i + 1}] ${h.title} (${h.path})\n${h.text.trim()}`,
    );
    return (
      "Contexte récupéré dans le vault (RAG) — utilise-le seulement s'il est pertinent :\n\n" +
      lines.join("\n\n")
    );
  } catch {
    return "";
  }
}
