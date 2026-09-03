import { marked } from "marked";
import TurndownService from "turndown";
import { noteBodyRange } from "$lib/note/frontmatter";
import { resolveMediaUrl } from "$lib/vault/media";

marked.setOptions({ gfm: true, breaks: true });

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
});

turndown.addRule("textAlign", {
  filter: (node) => {
    if (!["P", "H1", "H2", "H3", "H4", "H5", "H6"].includes(node.nodeName)) return false;
    const align = (node as HTMLElement).style?.textAlign;
    return !!align && align !== "left" && align !== "start";
  },
  replacement: (content, node) => {
    const el = node as HTMLElement;
    const align = el.style.textAlign || "left";
    const tag = el.nodeName.toLowerCase();
    const inner = content.trim();
    return `\n<${tag} style="text-align:${align}">${inner}</${tag}>\n\n`;
  },
});

/** Préserve les wikilinks `[[Note]]` dans le HTML TipTap. */
turndown.addRule("wikilink", {
  filter: (node) =>
    node.nodeName === "SPAN" &&
    (node as HTMLElement).getAttribute("data-wikilink") != null,
  replacement: (_content, node) => {
    const title =
      (node as HTMLElement).getAttribute("data-wikilink") ||
      (node as HTMLElement).textContent ||
      "";
    return `[[${title}]]`;
  },
});

turndown.addRule("taskList", {
  filter: (node) =>
    node.nodeName === "UL" &&
    (node as HTMLElement).getAttribute("data-type") === "taskList",
  replacement: (content) => content,
});

turndown.addRule("taskItem", {
  filter: (node) =>
    node.nodeName === "LI" &&
    (node as HTMLElement).getAttribute("data-type") === "taskItem",
  replacement: (content, node) => {
    const checked = (node as HTMLElement).getAttribute("data-checked") === "true";
    const marker = checked ? "- [x]" : "- [ ]";
    const text = content.replace(/^\n+/, "").replace(/\n+$/, "");
    return `${marker} ${text}\n`;
  },
});

turndown.addRule("resizableImage", {
  filter: "img",
  replacement: (_content, node) => {
    const el = node as HTMLImageElement;
    const src = el.getAttribute("src") || "";
    const dataSrc = el.getAttribute("data-md-src") || src;
    const alt = el.getAttribute("alt") || "image";
    const width = el.getAttribute("width") || el.style.width?.replace("px", "");
    const altWithWidth =
      width && !alt.includes("|w:")
        ? `${alt}|w:${String(width).replace(/px$/, "")}`
        : alt;
    return `![${altWithWidth}](${dataSrc})`;
  },
});

/** Transforme `[[Note]]` en spans TipTap avant marked. */
export function preprocessWikilinks(markdown: string): string {
  return markdown.replace(/\[\[([^\]]+)\]\]/g, (_m, title: string) => {
    const t = title.trim();
    return `<span data-wikilink="${escapeAttr(t)}" class="wikilink">[[${t}]]</span>`;
  });
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Convertit le corps Markdown en HTML TipTap.
 * Les images utilisent `data-md-src` (chemin vault) et `src` résolu pour l'affichage.
 */
export function markdownToHtml(
  content: string,
  notePath: string,
  vaultPath: string,
): string {
  const { body } = noteBodyRange(content);
  let md = preprocessWikilinks(body);

  // Réécrire images pour garder le chemin relatif
  md = md.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_m, alt: string, href: string) => {
      const src = vaultPath ? resolveMediaUrl(href, notePath, vaultPath) : href;
      const pipe = alt.lastIndexOf("|w:");
      const width = pipe >= 0 ? alt.slice(pipe + 3).trim() : "";
      const cleanAlt = pipe >= 0 ? alt.slice(0, pipe).trim() : alt;
      const widthAttr = width
        ? ` width="${width.replace(/px$/, "")}" style="max-width:100%;width:${width.endsWith("%") ? width : width + "px"};height:auto"`
        : ` style="max-width:min(100%,480px);height:auto"`;
      return `<img src="${escapeAttr(src)}" data-md-src="${escapeAttr(href)}" alt="${escapeAttr(cleanAlt || "image")}"${widthAttr} />`;
    },
  );

  return marked.parse(md, { async: false }) as string;
}

/** Sérialise le HTML TipTap vers Markdown (corps uniquement). */
export function htmlToMarkdown(html: string): string {
  if (!html || html === "<p></p>") return "";
  return turndown.turndown(html).trimEnd() + "\n";
}

/** Recompose le document avec préfixe YAML éventuel. */
export function mergeBodyMarkdown(fullContent: string, newBody: string): string {
  const { start } = noteBodyRange(fullContent);
  if (start === 0) return newBody;
  const prefix = fullContent.slice(0, start);
  return prefix + newBody.replace(/^\n+/, "");
}

/** Extrait les headings pour l'outline. */
export function extractOutline(markdown: string): { level: number; text: string; offset: number }[] {
  const { body, start } = noteBodyRange(markdown);
  const items: { level: number; text: string; offset: number }[] = [];
  let offset = start;
  for (const line of body.split("\n")) {
    const m = /^(#{1,6})\s+(.+)$/.exec(line);
    if (m) {
      items.push({
        level: m[1].length,
        text: m[2].trim(),
        offset,
      });
    }
    offset += line.length + 1;
  }
  return items;
}
