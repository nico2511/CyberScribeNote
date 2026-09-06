import { describe, expect, it } from "vitest";
import { extractUrls, isLinkOnlyNote } from "./links";

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
