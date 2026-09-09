import { marked } from "marked";
import TurndownService from "turndown";
import { noteBodyRange } from "$lib/note/frontmatter";
import { resolveMediaUrl } from "$lib/vault/media";
import { escapeHtml, sanitizeTipTapHtml } from "$lib/markdown/sanitize";

marked.setOptions({ gfm: true, breaks: true });

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

marked.use({
  extensions: [
    {
      name: "wikilink",
      level: "inline",
      start(src) {
        const idx = src.indexOf("[[");
        return idx === -1 ? undefined : idx;
      },
      tokenizer(src) {
        const match = /^\[\[([^\]]+)\]\]/.exec(src);
        if (!match) return undefined;
        const title = match[1].trim();
        return { type: "wikilink", raw: match[0], title };
      },
      renderer(token) {
        const t = escapeAttr(token.title);
        return `<span data-wikilink="${t}" class="wikilink">[[${token.title}]]</span>`;
      },
    },
  ],
  renderer: {
    /** HTML brut interdit : affiché échappé, puis filtré par DOMPurify. */
    html({ text }) {
      return escapeHtml(text);
    },
  },
  hooks: {
    postprocess(html) {
      return sanitizeTipTapHtml(html);
    },
  },
});

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
});

turndown.addRule("emptyParagraph", {
  filter: (node) => {
    if (node.nodeName !== "P") return false;
    const el = node as HTMLElement;
    if (el.querySelector("img, span[data-wikilink]")) return false;
    return !(el.textContent || "").replace(/\u200b/g, "").trim();
  },
  // Marqueur invisible pour survivre au round-trip TipTap ↔ Markdown
  replacement: () => `\n\n\u200b\n\n`,
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
  let md = repairCorruptedWikilinkMarkdown(body);

  // Lignes « vides » TipTap (paragraphes vides) : \u200b seul → <p></p>
  md = md.replace(/^(?:\u200b|[ \t])+$/gm, "<p></p>");

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

const WIKILINK_CORRUPT_RE = /data-wikilink|<\/span>|\\\[\\\[|&lt;span/i;

/** Répare les wikilinks corrompus (HTML littéral laissé par un ancien round-trip marked). */
export function repairCorruptedWikilinkMarkdown(markdown: string): string {
  if (!WIKILINK_CORRUPT_RE.test(markdown)) return markdown;

  let md = markdown;

  // Spans wikilink complets (attributs dans n'importe quel ordre ; pas de \\b après la valeur)
  md = md.replace(
    /<span\b[^>]*\bdata-wikilink=(?:"([^"]+)"|'([^']+)')[^>]*>\[\[([^\]]+)\]\]<\/span>/gi,
    (_m, dq: string, sq: string) => `[[${(dq || sq).trim()}]]`,
  );

  // Entités HTML échappées
  md = md.replace(
    /&lt;span\b[^&]*\bdata-wikilink="([^"]+)"[^&]*&gt;\[\[([^\]]+)\]\]&lt;\/span&gt;/gi,
    "[[$1]]",
  );

  // Résidus turndown / marked (crochets échappés + fermeture span)
  md = md.replace(/\\\[\\\[([^\]]+)\\\]\\\]<\/span>/g, "[[$1]]");

  // Span ouvert sans fermeture (wikilink visible à l'intérieur)
  md = md.replace(
    /<span\b[^>]*\bdata-wikilink=(?:"([^"]+)"|'([^']+)')[^>]*>(\[\[[^\]]+\]\])/gi,
    "$3",
  );

  // Fermeture span orpheline après wikilink
  md = md.replace(/(\[\[[^\]]+\]\])(?:<\/span>|&lt;\/span&gt;)/g, "$1");

  // Span vide + texte wikilink + fermeture orpheline
  md = md.replace(
    /<span\b[^>]*\bdata-wikilink="([^"]+)"[^>]*><\/span>\[\[([^\]]+)\]\](?:&lt;\/span&gt;|<\/span>)?/gi,
    "[[$1]]",
  );

  return md;
}

/** Sérialise le HTML TipTap vers Markdown (corps uniquement). */
export function htmlToMarkdown(html: string): string {
  if (!html || html === "<p></p>") return "";
  let md = turndown.turndown(html);
  // Normaliser marqueurs de paragraphes vides
  md = md.replace(/(?:^|\n)\u200b(?=\n|$)/g, "\n");
  md = md.replace(/\n{3,}/g, "\n\n\u200b\n\n");
  return md.replace(/[ \t]+\n/g, "\n").replace(/\s+$/g, "") + "\n";
}

/** Recompose le document avec préfixe YAML éventuel. */
export function mergeBodyMarkdown(fullContent: string, newBody: string): string {
  const { start } = noteBodyRange(fullContent);
  if (start === 0) return newBody;
  const prefix = fullContent.slice(0, start);
  return prefix + newBody.replace(/^\n+/, "");
}

/** Extrait les headings pour l'outline (ignore les blocs de code). */
export function extractOutline(markdown: string): { level: number; text: string; offset: number }[] {
  const { body, start } = noteBodyRange(markdown);
  const items: { level: number; text: string; offset: number }[] = [];
  let offset = start;
  let inFence = false;
  for (const line of body.split("\n")) {
    if (/^(`{3,}|~{3,})/.test(line.trim())) {
      inFence = !inFence;
    } else if (!inFence) {
      const m = /^(#{1,6})\s+(.+)$/.exec(line);
      if (m) {
        items.push({
          level: m[1].length,
          text: m[2].trim(),
          offset,
        });
      }
    }
    offset += line.length + 1;
  }
  return items;
}
