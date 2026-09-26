import { describe, expect, it } from "vitest";
import { scanBuddyTip } from "./scribeBuddy";

describe("scanBuddyTip", () => {
  it("reacts to typing before structure tips", () => {
    const tip = scanBuddyTip({
      markdown: "## A\n\n## B\n\n## C\n",
      typing: true,
      busy: false,
      hasSuggestions: false,
      noteOpen: true,
    });
    expect(tip?.mood).toBe("listen");
  });

  it("suggests outline when many headings", () => {
    const tip = scanBuddyTip({
      markdown: "# Doc\n\n## Un\n\nx\n\n## Deux\n\ny\n\n## Trois\n\nz\n",
      typing: false,
      busy: false,
      hasSuggestions: false,
      noteOpen: true,
    });
    expect(tip?.id).toBe("outline");
    expect(tip?.action).toEqual({ kind: "skill", skillId: "outline" });
  });

  it("warns on unclosed fence", () => {
    const tip = scanBuddyTip({
      markdown: "# X\n\n```yaml\nservices:\n  a:\n    image: nginx\n",
      typing: false,
      busy: false,
      hasSuggestions: false,
      noteOpen: true,
    });
    expect(tip?.id).toBe("fence-open");
  });

  it("names empty heading tip", () => {
    const tip = scanBuddyTip({
      markdown: "## \n\n```\nversion: \"3\"\nservices:\n  gluetun:\n    image: x\n```\n",
      typing: false,
      busy: false,
      hasSuggestions: false,
      noteOpen: true,
    });
    expect(tip?.id).toBe("empty-heading");
  });

  it("suggests enrich on link-only notes", () => {
    const tip = scanBuddyTip({
      markdown: "https://example.com/article",
      typing: false,
      busy: false,
      hasSuggestions: false,
      noteOpen: true,
    });
    expect(tip?.id).toBe("link-only");
    expect(tip?.action).toEqual({ kind: "skill", skillId: "enrich" });
  });

  it("suggests template on empty notes", () => {
    const tip = scanBuddyTip({
      markdown: "   ",
      typing: false,
      busy: false,
      hasSuggestions: false,
      noteOpen: true,
    });
    expect(tip?.id).toBe("empty");
    expect(tip?.action).toEqual({ kind: "skill", skillId: "template" });
  });

  it("suggests enrich when a URL is selected", () => {
    const tip = scanBuddyTip({
      markdown: "# Doc\n\nBeaucoup de texte déjà présent dans la note qui n'est pas un simple lien.\n",
      typing: false,
      busy: false,
      hasSuggestions: false,
      noteOpen: true,
      selectionText: "https://github.com/nico2511/CyberScribeNote",
    });
    expect(tip?.id).toBe("sel-link");
    expect(tip?.action).toEqual({ kind: "skill", skillId: "enrich" });
  });

  it("propose un plan d'analyse sur une note longue sans brief ni tags", () => {
    const tip = scanBuddyTip({
      markdown: "mot ".repeat(160),
      typing: false,
      busy: false,
      hasSuggestions: false,
      noteOpen: true,
    });
    expect(tip?.id).toBe("analyse-plan");
    expect(tip?.action).toEqual({
      kind: "skill_plan",
      skillIds: ["keypoints", "brief", "tags"],
    });
    expect(tip?.actionLabel).toBe("Enchaîner");
  });

  it("garde un seul skill tags sur une note moyenne", () => {
    const tip = scanBuddyTip({
      markdown: "mot ".repeat(80),
      typing: false,
      busy: false,
      hasSuggestions: false,
      noteOpen: true,
    });
    expect("mot ".repeat(80).length).toBeGreaterThan(280);
    expect("mot ".repeat(80).length).toBeLessThan(520);
    expect(tip?.id).toBe("tags");
    expect(tip?.action).toEqual({ kind: "skill", skillId: "tags" });
  });

  it("propose le brief seul quand les tags sont déjà là", () => {
    const tip = scanBuddyTip({
      markdown: `# tags: [mot]\n\n${"mot ".repeat(160)}`,
      typing: false,
      busy: false,
      hasSuggestions: false,
      noteOpen: true,
    });
    expect(tip?.id).toBe("presence");
    expect(tip?.action).toEqual({ kind: "skill", skillId: "brief" });
  });

  it("préfère le plan d'analyse au tip Liées sur une note longue", () => {
    const tip = scanBuddyTip({
      markdown: "mot ".repeat(160),
      typing: false,
      busy: false,
      hasSuggestions: false,
      noteOpen: true,
      hasRelated: true,
    });
    expect(tip?.id).toBe("analyse-plan");
    expect(tip?.action).toEqual({
      kind: "skill_plan",
      skillIds: ["keypoints", "brief", "tags"],
    });
  });

  it("propose Sources quand plusieurs URL sont déjà dans la note", () => {
    const tip = scanBuddyTip({
      markdown:
        "Voir https://example.com/alpha et https://example.com/bravo dans le texte de la note.",
      typing: false,
      busy: false,
      hasSuggestions: false,
      noteOpen: true,
    });
    expect(tip?.id).toBe("sources");
    expect(tip?.action).toEqual({ kind: "skill", skillId: "sources" });
  });

  it("propose Décisions sur un CR qui a déjà un brief", () => {
    const tip = scanBuddyTip({
      markdown: `## Brief\n\n${"mot ".repeat(100)}\n\nCompte rendu de la réunion.\n`,
      typing: false,
      busy: false,
      hasSuggestions: false,
      noteOpen: true,
    });
    expect(tip?.id).toBe("decisions");
    expect(tip?.action).toEqual({ kind: "skill", skillId: "decisions" });
  });

  it("propose les tags seuls si le brief existe déjà", () => {
    const tip = scanBuddyTip({
      markdown: `## Brief\n\n${"mot ".repeat(160)}`,
      typing: false,
      busy: false,
      hasSuggestions: false,
      noteOpen: true,
    });
    expect(tip?.id).toBe("tags");
    expect(tip?.action).toEqual({ kind: "skill", skillId: "tags" });
  });
});
