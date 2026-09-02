import { noteBody, parseNoteContext } from "$lib/note/frontmatter";
import { marked, Renderer } from "marked";
import { escapeHtml, resolveMediaUrl } from "$lib/vault/media";

marked.setOptions({ gfm: true, breaks: true });

export interface ParsedImageAlt {
  alt: string;
  width?: string;
}

/** Format alt : `description|w:420` ou `description|w:50%` */
export function parseImageAlt(rawAlt: string): ParsedImageAlt {
  const pipe = rawAlt.lastIndexOf("|w:");
  if (pipe === -1) return { alt: rawAlt };
  const alt = rawAlt.slice(0, pipe);
  const width = rawAlt.slice(pipe + 3).trim();
  if (!width) return { alt: rawAlt };
  return { alt, width: width.endsWith("%") ? width : `${width}px` };
}

export function imageWidthStyle(width?: string): string {
  if (width) {
    return `max-width:${width};width:100%;height:auto;`;
  }
  return "max-width:min(100%,480px);width:auto;height:auto;";
}

function renderContextAside(content: string): string {
  const ctx = parseNoteContext(content);
  if (!ctx.trim()) return "";
  return `<aside class="note-context"><span class="note-context-label">Contexte</span><p>${escapeHtml(ctx)}</p></aside>`;
}

function bodyWithoutContextBlock(content: string): string {
  const body = noteBody(content);
  return body.replace(/^>\s*\*\*Contexte\*\*\s*[·:\-–—]\s*.+\n*/im, "").trimStart();
}

export function buildPreviewHtml(content: string, notePath: string, vaultPath: string): string {
  const contextHtml = renderContextAside(content);
  const markdownSource = bodyWithoutContextBlock(content);

  if (!vaultPath) {
    const body = marked.parse(markdownSource || "", { async: false }) as string;
    return contextHtml + body;
  }

  const renderer = new Renderer();
  renderer.image = ({ href, title, text }) => {
    if (!href) return "";
    const src = resolveMediaUrl(href, notePath, vaultPath);
    const { alt, width } = parseImageAlt(text || "");
    const style = imageWidthStyle(width);
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    const safeHref = escapeHtml(href);
    const safeAlt = escapeHtml(alt || "image");
    return `<figure class="note-figure" data-md-image="${safeHref}">
<img src="${src}" alt="${safeAlt}"${titleAttr} style="${style}" loading="lazy" />
<figcaption class="note-image-resize" aria-label="Taille image">
<button type="button" data-image-width="280" data-md-image="${safeHref}">S</button>
<button type="button" data-image-width="420" data-md-image="${safeHref}">M</button>
<button type="button" data-image-width="640" data-md-image="${safeHref}">L</button>
<button type="button" data-image-width="100%" data-md-image="${safeHref}">100%</button>
</figcaption></figure>`;
  };

  const body = marked.parse(markdownSource || "", { async: false, renderer }) as string;
  return contextHtml + body;
}

/** Met à jour la largeur d'une image Markdown dans le contenu. */
export function setMarkdownImageWidth(content: string, imagePath: string, width: string | number): string {
  const widthToken = typeof width === "number" ? String(width) : width.replace(/px$/, "");
  const escaped = imagePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`!\\[([^\\]]*)\\]\\(${escaped}\\)`, "g");

  return content.replace(re, (_match, alt: string) => {
    const baseAlt = alt.replace(/\|w:[^|]+$/, "").trim() || "image";
    return `![${baseAlt}|w:${widthToken}](${imagePath})`;
  });
}
