import { describe, expect, it } from "vitest";
import { mapCaretThroughReplace } from "./caret";
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

describe("applyLocalCorrections trailing spaces", () => {
  it("preserves trailing space while fixing typos", () => {
    expect(applyLocalCorrections("salu tu va ")).toBe("Salut tu vas ");
  });

  it("preserves whitespace-only input", () => {
    expect(applyLocalCorrections("   ")).toBe("   ");
  });
});
