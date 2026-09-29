import { describe, expect, it } from "vitest";
import { sanitizeAiOutput, truncateRepetitiveOutput } from "./sanitize";

describe("truncateRepetitiveOutput", () => {
  it("laisse un texte normal intact", () => {
    const text = "Liste des liens :\n- https://a.example\n- https://b.example\n";
    expect(truncateRepetitiveOutput(text)).toBe(text);
  });

  it("coupe une boucle de bloc répété en fin de sortie", () => {
    const block =
      "- [Site Alpha](https://example.com/alpha)\n- [Site Beta](https://example.com/beta)\n";
    const looped = `Intro\n\n${block.repeat(6)}`;
    const out = truncateRepetitiveOutput(looped);
    expect(out.length).toBeLessThan(looped.length);
    expect(out.startsWith("Intro")).toBe(true);
    // Au plus ~2 occurrences du bloc (préfixe + une coupe nette).
    expect(out.split("Site Alpha").length - 1).toBeLessThanOrEqual(3);
  });
});

describe("sanitizeAiOutput", () => {
  it("applique la coupe de répétition sur les prompts custom", () => {
    const block = "ligne utile avec url https://x.test/path-long-enough\n";
    const raw = `${block.repeat(8)}`;
    const out = sanitizeAiOutput(raw, "custom");
    expect(out.length).toBeLessThan(raw.length);
  });
});
