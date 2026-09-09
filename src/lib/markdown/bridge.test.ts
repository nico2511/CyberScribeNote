import { describe, expect, it } from "vitest";
import {
  extractOutline,
  htmlToMarkdown,
  markdownToHtml,
  repairCorruptedWikilinkMarkdown,
} from "./bridge";
import { repairMarkdownProposal, unwrapOuterMarkdownFence } from "./repair";

describe("extractOutline", () => {
  it("skips headings that live inside fenced code", () => {
    const md = `# Vrai titre

\`\`\`yaml
# faux titre dans le code
services:
  web:
    image: nginx
\`\`\`

## Section
`;
    expect(extractOutline(md).map((i) => i.text)).toEqual(["Vrai titre", "Section"]);
  });
});

describe("repairCorruptedWikilinkMarkdown", () => {
  it("fixes escaped wikilink spans left in markdown", () => {
    const broken = "## Notes liées\n\n- \\[\\[Stacks Docker\\]\\]</span> — excerpt\n";
    expect(repairCorruptedWikilinkMarkdown(broken)).toContain("- [[Stacks Docker]] — excerpt");
  });

  it("fixes literal wikilink span HTML in markdown lists", () => {
    const broken =
      "## Notes liées\n\n- <span data-wikilink=\"Stacks Docker\" class=\"wikilink\">[[Stacks Docker]]</span> — excerpt\n";
    const fixed = repairCorruptedWikilinkMarkdown(broken);
    expect(fixed).toContain("- [[Stacks Docker]] — excerpt");
    expect(fixed).not.toContain("<span");
    const html = markdownToHtml(fixed, "note.md", "/vault");
    expect(html).toContain('data-wikilink="Stacks Docker"');
    expect(html).not.toContain("&lt;span");
  });
});

describe("wikilink roundtrip", () => {
  it("preserves list wikilinks through html roundtrip", () => {
    const md = "## Notes liées\n\n- [[Stacks Docker]] — excerpt here\n";
    const html = markdownToHtml(md, "note.md", "/vault");
    expect(html).not.toMatch(/&lt;span[^>]*data-wikilink/);
    expect(html).toMatch(/<span[^>]*data-wikilink="Stacks Docker"/);
    const back = htmlToMarkdown(html);
    expect(back).toContain("[[Stacks Docker]]");
    expect(back).not.toContain("data-wikilink");
  });
});

describe("markdownToHtml", () => {
  it("neutralizes raw HTML in markdown", () => {
    const md = '<img onerror="alert(1)" src=x>\n\n# Titre';
    const html = markdownToHtml(md, "note.md", "/vault");
    expect(html).not.toMatch(/<img[^>]*onerror/i);
    expect(html).toContain("&lt;img");
    expect(html).toContain("<h1>Titre</h1>");
  });
});

describe("repairMarkdownProposal", () => {
  it("unwraps an outer markdown fence without eating yaml", () => {
    const raw = "```markdown\n# Docker\n\n```yaml\nservices:\n  web:\n```\n```";
    const out = unwrapOuterMarkdownFence(raw);
    expect(out).toContain("# Docker");
    expect(out).toContain("```yaml");
  });

  it("unwraps a TOC fence but keeps docker yaml", () => {
    const raw = `# Stacks

\`\`\`
- [web](#web)
- [db](#db)
\`\`\`

\`\`\`yaml
services:
  web:
    image: nginx
\`\`\`
`;
    const out = repairMarkdownProposal(raw);
    expect(out.startsWith("# Stacks")).toBe(true);
    expect(out).toContain("- [web](#web)");
    expect(out).not.toMatch(/```\s*\n- \[web\]/);
    expect(out).toContain("```yaml");
  });
});
