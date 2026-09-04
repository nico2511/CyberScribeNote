import { describe, expect, it } from "vitest";
import { mapCaretThroughReplace, locateSelectionInContent } from "./caret";
import { applyLocalCorrections } from "../ai/localCorrect";

describe("mapCaretThroughReplace", () => {
  it("keeps caret before the edit", () => {
    expect(mapCaretThroughReplace(3, 10, 15, 2)).toBe(3);
  });

  it("clamps caret inside the replaced span", () => {
    expect(mapCaretThroughReplace(12, 10, 15, 3)).toBe(12);
    expect(mapCaretThroughReplace(14, 10, 15, 2)).toBe(12);
  });

  it("shifts caret after the edit by delta", () => {
    // replace 5 chars with 2 → delta -3
    expect(mapCaretThroughReplace(20, 10, 15, 2)).toBe(17);
  });
});

describe("locateSelectionInContent", () => {
  it("uses exact range when text still matches", () => {
    const content = "Bonjour le monde.";
    expect(
      locateSelectionInContent(content, { start: 8, end: 10, text: "le" }),
    ).toEqual({ start: 8, end: 10 });
  });

  it("finds text near a drifted offset", () => {
    const content = "AAA. Phrase cible ici. BBB.";
    expect(
      locateSelectionInContent(content, {
        start: 3,
        end: 10,
        text: "Phrase cible ici",
      }),
    ).toEqual({ start: 5, end: 21 });
  });
});

describe("applyLocalCorrections trailing spaces", () => {
  it("preserves trailing space while fixing typos", () => {
    expect(applyLocalCorrections("salu tu va ")).toBe("Salut tu vas ");
  });

  it("preserves whitespace-only input", () => {
    expect(applyLocalCorrections("   ")).toBe("   ");
  });
});
