import { describe, expect, it } from "vitest";
import {
  extractLinksWithTitles,
  extractUrls,
  formatExtractedLinksList,
  isLinkOnlyNote,
} from "./links";

describe("extractUrls", () => {
  it("finds http(s) outside fences", () => {
    expect(
      extractUrls("Voir https://example.com/docs et https://foo.io/a."),
    ).toEqual(["https://example.com/docs", "https://foo.io/a"]);
  });

  it("ignores urls inside code fences", () => {
    expect(
      extractUrls("```\nhttps://secret.example/x\n```\nhttps://ok.example/y"),
    ).toEqual(["https://ok.example/y"]);
  });
});

describe("extractLinksWithTitles", () => {
  it("parses netscape bookmark href + title", () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><A HREF="https://github.com/foo/bar" ADD_DATE="1">Foo Bar</A>
  <DT><A HREF="https://ollama.com">Ollama Home</A>
</DL>`;
    expect(extractLinksWithTitles(html)).toEqual([
      { url: "https://github.com/foo/bar", title: "Foo Bar" },
      { url: "https://ollama.com", title: "Ollama Home" },
    ]);
  });

  it("formats a markdown list", () => {
    const html = `<A HREF="https://a.example/x">Alpha</A>`;
    expect(formatExtractedLinksList(html)).toBe("- [Alpha](https://a.example/x)");
  });
});

describe("isLinkOnlyNote", () => {
  it("detects a note that is mostly a URL", () => {
    expect(isLinkOnlyNote("https://example.com/article")).toBe(true);
    expect(isLinkOnlyNote("# Lien\n\nhttps://example.com/a")).toBe(true);
  });

  it("rejects notes with real prose", () => {
    expect(
      isLinkOnlyNote(
        "Voici un long commentaire sur https://example.com/a avec beaucoup de contexte utile.",
      ),
    ).toBe(false);
  });
});
