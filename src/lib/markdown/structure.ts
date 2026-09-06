import { extractOutline } from "$lib/markdown/bridge";

const TOC_HEADING_RE = /^##\s+(Sommaire|Table des mati[eè]res|TOC)\s*$/i;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** Sommaire Markdown généré depuis les titres (hors H1). */
export function buildOutlineSection(markdown: string): string | null {
  const items = extractOutline(markdown).filter((i) => i.level >= 2);
  if (items.length < 2) return null;
  const lines = items.map((i) => {
    const indent = "  ".repeat(Math.max(0, i.level - 2));
    return `${indent}- [${i.text}](#${slugify(i.text)})`;
  });
  return `## Sommaire\n\n${lines.join("\n")}\n`;
}

function insertAfterLead(body: string, block: string): string {
  const trimmedBlock = block.trim() + "\n\n";
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i < lines.length && /^>\s*\*\*Contexte\*\*/i.test(lines[i])) {
    i++;
    while (i < lines.length && !lines[i].trim()) i++;
  }
  if (i < lines.length && /^#\s+\S/.test(lines[i])) {
    i++;
    if (i < lines.length && !lines[i].trim()) i++;
    return [...lines.slice(0, i), "", trimmedBlock.trimEnd(), "", ...lines.slice(i)]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
  }
  return `${trimmedBlock}${body.replace(/^\n+/, "")}`;
}

function replaceOutlineSection(body: string, section: string): string {
  const lines = body.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (TOC_HEADING_RE.test(lines[i].trim())) {
      start = i;
      break;
    }
  }
  if (start < 0) return insertAfterLead(body, section);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+\S/.test(lines[i]) && !TOC_HEADING_RE.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  return [...lines.slice(0, start), section.trim(), "", ...lines.slice(end)]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** Insère ou remplace le sommaire. Retourne null s'il n'y a pas assez de titres. */
export function upsertOutline(markdown: string): string | null {
  const section = buildOutlineSection(markdown);
  if (!section) return null;
  const next = replaceOutlineSection(markdown, section);
  return next === markdown ? null : next;
}

function isFenceOpen(line: string): boolean {
  return /^(`{3,}|~{3,})/.test(line.trim());
}

/** Bloc compose Docker non ambigu : `services:` + au moins une ligne indentée `image:`. */
function isClearComposeBlock(block: string[]): boolean {
  const text = block.join("\n");
  if (!/^\s*services:\s*$/m.test(text) && !/^\s*version:\s*['"]?\d/m.test(text)) {
    return false;
  }
  return /^\s{2,}image:\s+\S/m.test(text);
}

function fenceClearComposeBlocks(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inFence = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isFenceOpen(line)) {
      inFence = !inFence;
      out.push(line);
      i++;
      continue;
    }
    if (inFence) {
      out.push(line);
      i++;
      continue;
    }

    const trimmed = line.trimEnd();
    if (!/^(services|version):\s/.test(trimmed) && trimmed !== "services:") {
      out.push(line);
      i++;
      continue;
    }

    const start = i;
    i++;
    while (i < lines.length) {
      const next = lines[i];
      if (isFenceOpen(next) || /^#{1,6}\s/.test(next) || /^>\s/.test(next)) break;
      // Fin de bloc : ligne non indentée qui n'est pas une clé compose racine
      if (
        next.trim() &&
        !/^\s/.test(next) &&
        !/^(services|networks|volumes|configs|secrets|name|version):\s*/.test(next.trim())
      ) {
        break;
      }
      i++;
    }
    while (i > start + 1 && !lines[i - 1].trim()) i--;
    const block = lines.slice(start, i);
    if (isClearComposeBlock(block) && block.filter((l) => l.trim()).length >= 4) {
      out.push("```yaml", ...block, "```");
    } else {
      out.push(...block);
    }
  }
  return out.join("\n");
}

function fixAtxHeadings(markdown: string): string {
  const lines = markdown.split("\n");
  let inFence = false;
  return lines
    .map((line) => {
      if (isFenceOpen(line)) inFence = !inFence;
      if (inFence) return line;
      // Uniquement #Titre sans espace — pas les # commentaires YAML
      return line.replace(/^(#{1,6})([^\s#].*)$/, "$1 $2");
    })
    .join("\n");
}

function normalizeFences(markdown: string): string {
  return markdown.replace(/'''/g, "```");
}

/** Titre vide `##` → nom du service docker du bloc suivant. */
export function fillEmptyHeadingsFromServices(markdown: string): string {
  const lines = markdown.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (isFenceOpen(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s*$/.exec(lines[i]);
    if (!m) continue;
    let name: string | null = null;
    for (let j = i + 1; j < Math.min(i + 40, lines.length); j++) {
      if (isFenceOpen(lines[j])) {
        // cherche dans le prochain bloc
        for (let k = j + 1; k < lines.length && !isFenceOpen(lines[k]); k++) {
          const svc = /^\s{0,2}([\w.-]+):\s*$/.exec(lines[k]);
          if (svc && !/^(version|services|networks|volumes|configs|secrets|name)$/i.test(svc[1])) {
            name = svc[1];
            break;
          }
        }
        break;
      }
    }
    if (name) {
      const title = name.charAt(0).toUpperCase() + name.slice(1);
      lines[i] = `${m[1]} ${title}`;
    }
  }
  return lines.join("\n");
}

/** Supprime `##` + fence vide (stubs de fin de fichier). */
export function stripEmptyHeadingFences(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const heading = /^(#{1,6})\s*$/.exec(lines[i]);
    if (heading) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && /^```/.test(lines[j].trim())) {
        let k = j + 1;
        while (k < lines.length && !lines[k].trim().startsWith("```")) k++;
        const inner = lines.slice(j + 1, k).join("\n").trim();
        if (!inner && k < lines.length) {
          i = k + 1;
          while (i < lines.length && !lines[i].trim()) i++;
          continue;
        }
      }
    }
    out.push(lines[i]);
    i++;
  }
  return out.join("\n");
}

/** Fence nue ``` → ```yaml si le contenu ressemble à du compose. */
export function labelComposeFences(markdown: string): string {
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
    const lang = (open[1] || "").trim();
    let j = i + 1;
    while (j < lines.length && !lines[j].trim().startsWith("```")) j++;
    const inner = lines.slice(i + 1, j).join("\n");
    const looksCompose =
      /^\s*(version|services):\s*/m.test(inner) && /image:\s+\S/m.test(inner);
    if (!lang && looksCompose) {
      out.push("```yaml");
    } else {
      out.push(lines[i]);
    }
    out.push(...lines.slice(i + 1, Math.min(j + 1, lines.length)));
    i = j + 1;
  }
  return out.join("\n");
}

function closeUnclosedFence(markdown: string): string {
  let open = false;
  for (const line of markdown.split("\n")) {
    if (isFenceOpen(line)) open = !open;
  }
  return open ? markdown.replace(/\s*$/, "") + "\n```\n" : markdown;
}

/**
 * Réparations locales prudentes (sans LLM).
 * Titres vides, stubs, fences compose — sans réécrire le fond.
 */
export function repairLocalMarkdown(markdown: string): string {
  let next = normalizeFences(markdown);
  next = fixAtxHeadings(next);
  next = fillEmptyHeadingsFromServices(next);
  next = stripEmptyHeadingFences(next);
  next = labelComposeFences(next);
  next = fenceClearComposeBlocks(next);
  next = closeUnclosedFence(next);
  return next.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Entoure les mentions de titres de notes par `[[Titre]]`, hors blocs de code.
 */
export function wrapWikilinks(
  markdown: string,
  titles: string[],
  currentTitle?: string,
): string | null {
  const current = (currentTitle ?? "").trim().toLowerCase();
  const sorted = [...new Set(titles.map((t) => t.trim()).filter(Boolean))]
    .filter((t) => t.length >= 4 && t.toLowerCase() !== current)
    .sort((a, b) => b.length - a.length);
  if (!sorted.length) return null;

  const segments: { code: boolean; text: string }[] = [];
  const lines = markdown.split("\n");
  let buf: string[] = [];
  let inFence = false;
  const flush = (code: boolean) => {
    if (!buf.length) return;
    segments.push({ code, text: buf.join("\n") });
    buf = [];
  };
  for (const line of lines) {
    if (isFenceOpen(line)) {
      if (inFence) {
        buf.push(line);
        flush(true);
        inFence = false;
      } else {
        flush(false);
        inFence = true;
        buf.push(line);
      }
      continue;
    }
    buf.push(line);
  }
  flush(inFence);

  let changed = false;
  const next = segments
    .map((seg) => {
      if (seg.code) return seg.text;
      let text = seg.text;
      for (const title of sorted) {
        const re = new RegExp(
          `(?<!\\[\\[)\\b(${escapeRegExp(title)})\\b(?!\\]\\])`,
          "gi",
        );
        const replaced = text.replace(re, "[[$1]]");
        if (replaced !== text) {
          changed = true;
          text = replaced;
        }
      }
      return text;
    })
    .join("\n");

  return changed ? next : null;
}
