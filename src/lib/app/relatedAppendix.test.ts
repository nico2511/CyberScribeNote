import { describe, expect, it } from "vitest";
import { formatRelatedAppendix } from "./relatedAppendix";

describe("formatRelatedAppendix", () => {
  it("formats RAG hits as wikilink bullets", () => {
    const block = `Contexte récupéré dans le vault (RAG) :

[1] Ma Note (notes/ma.md)
Extrait utile pour le lien`;

    const out = formatRelatedAppendix(block);
    expect(out).toContain("[[Ma Note]]");
    expect(out).toContain("Extrait utile");
  });

  it("returns empty for blank input", () => {
    expect(formatRelatedAppendix("")).toBe("");
    expect(formatRelatedAppendix("   ")).toBe("");
  });
});
