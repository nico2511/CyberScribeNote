import { repairLocalMarkdown } from "$lib/markdown/structure";

const WRAPPER_LANGS = new Set(["", "markdown", "md", "text", "txt", "plaintext"]);

function fenceUnclosed(md: string): boolean {
  let open = false;
  for (const line of md.split("\n")) {
    if (line.trim().startsWith("```")) open = !open;
  }
  return open;
}

/** Fence d'enveloppe du document entier — pas le premier bloc de code interne. */
export function unwrapOuterMarkdownFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;

  const lines = trimmed.split("\n");
  const lang = (lines[0].trim().replace(/^`+/, "").trim() || "").toLowerCase();
  if (!WRAPPER_LANGS.has(lang)) return trimmed;

  let lastClose = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim()) {
      lastClose = i;
      break;
    }
  }
  if (lastClose < 1 || !lines[lastClose].trim().startsWith("```")) return trimmed;

  let next = lines.slice(1, lastClose).join("\n").trim();
  if (fenceUnclosed(next)) next += "\n```";
  return next;
}

function isStructureLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^#{1,6}\s+\S/.test(t)) return true;
  if (/^[-*+]\s+\[[^\]]+\]\([^)]+\)/.test(t)) return true;
  if (/^[-*+]\s+\[\[[^\]]+\]\]/.test(t)) return true;
  if (/^\d+\.\s+\[[^\]]+\]\([^)]+\)/.test(t)) return true;
  return false;
}

function looksLikeStructureBlock(inner: string): boolean {
  const lines = inner.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return false;
  const ok = lines.filter(isStructureLine).length;
  return ok / lines.length >= 0.7;
}

/**
 * Si l'IA a enfermé titres / TOC dans un bloc de code, on retire cette fence.
 * Ne touche pas aux blocs yaml/docker/shell.
 */
export function unwrapAccidentalStructureFences(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].trim().match(/^```(.*)$/);
    if (!open) {
      out.push(lines[i]);
      i++;
      continue;
    }
    const lang = (open[1] || "").trim().toLowerCase();
    let j = i + 1;
    while (j < lines.length && !lines[j].trim().startsWith("```")) j++;
    const inner = lines.slice(i + 1, j).join("\n");
    const isCodeLang = lang && !WRAPPER_LANGS.has(lang);
    if (!isCodeLang && looksLikeStructureBlock(inner)) {
      out.push(...lines.slice(i + 1, j));
      i = j + 1;
      continue;
    }
    out.push(...lines.slice(i, Math.min(j + 1, lines.length)));
    i = j + 1;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Répare les dérives fréquentes d'une mise en forme Markdown par LLM. */
export function repairMarkdownProposal(text: string): string {
  let next = unwrapOuterMarkdownFence(text);
  next = unwrapAccidentalStructureFences(next);
  next = repairLocalMarkdown(next);
  return next.replace(/[ \t]+\n/g, "\n").trim();
}
