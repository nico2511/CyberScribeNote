import { describe, expect, it } from "vitest";
import { repairLocalMarkdown, upsertOutline, wrapWikilinks } from "./structure";
import { extractOutline } from "./bridge";

describe("repairLocalMarkdown", () => {
  it("fences an unwrapped docker compose block", () => {
    const src = `# Stacks

services:
  homepage:
    image: ghcr.io/gethomepage/homepage:latest
    ports:
      - "3000:3000"
    restart: unless-stopped

## Autre
`;
    const out = repairLocalMarkdown(src);
    expect(out).toContain("```yaml");
    expect(out).toContain("image: ghcr.io/gethomepage/homepage:latest");
    expect(out).toContain("## Autre");
    expect(extractOutline(out).map((i) => i.text)).toEqual(["Stacks", "Autre"]);
  });

  it("does not fence ambiguous prose that mentions services", () => {
    const src = `# Note

services: on en parle demain.

Puis du texte libre avec name: foo
et une liste :
- item a
- item b
`;
    const out = repairLocalMarkdown(src);
    expect(out).not.toContain("```yaml");
    expect(out).toContain("services: on en parle demain.");
  });

  it("names empty headings from the next compose service", () => {
    const src = `## 

\`\`\`
version: "3"
services:
  gluetun:
    image: qmcgaw/gluetun
\`\`\`

## 

\`\`\`
\`\`\`
`;
    const out = repairLocalMarkdown(src);
    expect(out).toContain("## Gluetun");
    expect(out).toContain("```yaml");
    expect(out).not.toMatch(/^##\s*$/m);
    expect(out).not.toMatch(/```\s*\n```/);
  });
});

describe("upsertOutline", () => {
  it("inserts a TOC after the H1 from existing headings", () => {
    const src = `# Docker

## Homepage

texte

## Nginx

texte
`;
    const out = upsertOutline(src);
    expect(out).toBeTruthy();
    expect(out).toMatch(/# Docker\s*\n+## Sommaire/);
    expect(out).toContain("- [Homepage](#homepage)");
    expect(out).toContain("- [Nginx](#nginx)");
    expect(out).not.toMatch(/```[\s\S]*Homepage/);
  });
});

describe("wrapWikilinks", () => {
  it("wraps vault titles outside code fences", () => {
    const src = `# Note\n\nVoir Homepage et nginx.\n\n\`\`\`\nHomepage\n\`\`\`\n`;
    const out = wrapWikilinks(src, ["Homepage"], "Note");
    expect(out).toContain("[[Homepage]]");
    expect(out).toMatch(/```\nHomepage\n```/);
  });
});
