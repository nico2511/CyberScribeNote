import DOMPurify from "isomorphic-dompurify";

/** Allowlist alignée sur les extensions TipTap (StarterKit + images, liens, tâches, wikilinks). */
const ALLOWED_TAGS = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "del",
  "mark",
  "code",
  "pre",
  "blockquote",
  "a",
  "img",
  "span",
  "br",
  "hr",
  "input",
];

const ALLOWED_ATTR = [
  "href",
  "src",
  "alt",
  "width",
  "style",
  "class",
  "data-wikilink",
  "data-md-src",
  "data-type",
  "data-checked",
  "type",
  "checked",
  "disabled",
];

export function sanitizeTipTapHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["script", "svg", "iframe", "object", "embed", "form", "style"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
  });
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
