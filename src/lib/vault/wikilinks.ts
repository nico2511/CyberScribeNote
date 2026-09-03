import type { VaultEntry } from "$lib/types";

/** Aplatit l'arbre vault en notes `.md` uniquement. */
export function flattenNotes(entries: VaultEntry[]): VaultEntry[] {
  const out: VaultEntry[] = [];
  const walk = (items: VaultEntry[]) => {
    for (const e of items) {
      if (e.isDir) {
        if (e.children) walk(e.children);
      } else if (e.path.toLowerCase().endsWith(".md")) {
        out.push(e);
      }
    }
  };
  walk(entries);
  return out;
}

export function noteStem(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.md$/i, "");
}

function normalizeQuery(q: string): string {
  return q
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[''`]/g, "")
    .replace(/\s+/g, " ");
}

/** Score de similarité simple (plus haut = meilleur). */
function scoreMatch(query: string, path: string): number {
  const q = normalizeQuery(query);
  if (!q) return 0;
  const stem = normalizeQuery(noteStem(path));
  const full = normalizeQuery(path.replace(/\.md$/i, ""));
  if (stem === q || full === q) return 100;
  if (stem.startsWith(q) || full.endsWith(q)) return 80;
  if (stem.includes(q) || full.includes(q)) return 60;
  const tokens = q.split(" ").filter(Boolean);
  if (tokens.length > 1 && tokens.every((t) => stem.includes(t) || full.includes(t))) {
    return 50;
  }
  return 0;
}

/**
 * Résout une requête (titre / stem / chemin) vers un chemin de note.
 * Retourne null si aucun match suffisamment bon.
 */
export function resolveWikilink(
  query: string,
  entries: VaultEntry[],
): { path: string; title: string; score: number } | null {
  const cleaned = query
    .trim()
    .replace(/^la\s+note\s+/i, "")
    .replace(/^le\s+fichier\s+/i, "")
    .replace(/^["«]|["»]$/g, "")
    .replace(/\s*(s['']il\s+te\s+pla[iî]t|stp|please)\s*$/i, "")
    .trim();
  if (!cleaned) return null;

  const notes = flattenNotes(entries);
  let best: { path: string; title: string; score: number } | null = null;

  for (const note of notes) {
    const score = scoreMatch(cleaned, note.path);
    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = { path: note.path, title: noteStem(note.path), score };
    }
  }

  return best && best.score >= 50 ? best : null;
}

