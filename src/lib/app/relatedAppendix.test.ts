import { describe, expect, it } from "vitest";
import { formatRelatedAppendix, relatedProposalStaysOnContext } from "./relatedAppendix";

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

  it("n'accepte un wikilien que s'il est dans le contexte", () => {
    const ctx = "- [[Autre]] — extrait du vault";
    expect(relatedProposalStaysOnContext("## Notes liées\n\n- [[Autre]] — extrait", ctx)).toBe(
      true,
    );
    expect(relatedProposalStaysOnContext("## Notes liées\n\n- [[Invente]]", ctx)).toBe(false);
    expect(relatedProposalStaysOnContext("Aucune note liée pertinente.", ctx)).toBe(false);
  });
});
