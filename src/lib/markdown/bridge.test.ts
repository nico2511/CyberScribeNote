import { describe, expect, it } from "vitest";
import { extractOutline } from "./bridge";
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
