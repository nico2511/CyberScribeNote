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
});
