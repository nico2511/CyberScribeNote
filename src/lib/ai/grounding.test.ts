import { describe, expect, it } from "vitest";
import {
  instructionRequiresFidelity,
  instructionWantsVaultContext,
  isGroundedTransform,
} from "./grounding";
import { buildAiProposal } from "./buildProposal";
import { sanitizeAiOutput } from "./sanitize";

const DOCKER_NOTE = `# Stacks Docker

Sauvegardes pour relancer les services.

\`\`\`yaml
services:
  homepage:
    image: ghcr.io/gethomepage/homepage:latest
    ports:
      - "3000:3000"
    volumes:
      - ./config:/app/config
    restart: unless-stopped
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
\`\`\`
`;

const RECIPE = `# Tarte aux pommes

## Ingrédients
- farine
- sucre
- beurre
- pommes

## Préparation
Préchauffer le four à 180°C. Faire revenir les pommes.
`;

describe("isGroundedTransform", () => {
  it("accepts a formatted version of the same docker note", () => {
    const formatted = `# Stacks Docker

- [Homepage](#homepage)
- [Nginx](#nginx)

## Homepage

\`\`\`yaml
services:
  homepage:
    image: ghcr.io/gethomepage/homepage:latest
    ports:
      - "3000:3000"
    volumes:
      - ./config:/app/config
    restart: unless-stopped
\`\`\`

## Nginx

\`\`\`yaml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
\`\`\`
`;
    expect(isGroundedTransform(DOCKER_NOTE, formatted)).toBe(true);
  });

  it("rejects a cooking recipe in place of docker stacks", () => {
    expect(isGroundedTransform(DOCKER_NOTE, RECIPE)).toBe(false);
  });
});

describe("instruction helpers", () => {
  it("requires fidelity by default", () => {
    expect(instructionRequiresFidelity("Mets en forme les balises markdown")).toBe(true);
    expect(instructionRequiresFidelity("invente une histoire")).toBe(false);
  });

  it("detects explicit vault context requests", () => {
    expect(instructionWantsVaultContext("croise avec mes autres notes")).toBe(true);
    expect(instructionWantsVaultContext("Répare le markdown")).toBe(false);
  });
});

describe("sanitizeAiOutput", () => {
  it("does not chop an inner yaml fence when wrapped in markdown", () => {
    const raw = "```markdown\n# Stacks\n\n```yaml\nservices:\n  web:\n    image: nginx\n```\n```";
    const out = sanitizeAiOutput(raw, "custom");
    expect(out).toContain("# Stacks");
    expect(out).toContain("```yaml");
    expect(out).toContain("nginx");
  });

  it("keeps a note that starts with a yaml fence", () => {
    const raw = "```yaml\nservices:\n  web:\n    image: nginx\n```\n\n# Suite";
    expect(sanitizeAiOutput(raw, "custom")).toBe(raw);
  });
});

describe("buildAiProposal custom", () => {
  it("rejects a hallucinated recipe", () => {
    expect(buildAiProposal("custom", DOCKER_NOTE, RECIPE, "Répare le markdown")).toBeNull();
  });

  it("unwraps a TOC accidentally put in a code fence", () => {
    const raw = `# Stacks Docker

\`\`\`
- [Homepage](#homepage)
- [Nginx](#nginx)
\`\`\`

\`\`\`yaml
services:
  homepage:
    image: ghcr.io/gethomepage/homepage:latest
    restart: unless-stopped
  nginx:
    image: nginx:alpine
\`\`\`
`;
    const out = buildAiProposal("custom", DOCKER_NOTE, raw, "Mets en forme les balises markdown");
    expect(out).toBeTruthy();
    expect(out).toContain("- [Homepage](#homepage)");
    expect(out).not.toMatch(/```\n- \[Homepage\]/);
    expect(out).toContain("```yaml");
  });
});
