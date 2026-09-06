import { describe, expect, it } from "vitest";
import { isGroundedAppendix } from "./grounding";
import {
  matchSkillFromText,
  runSkillLocal,
  isEmptyLlmAppendix,
  parseTagsProposal,
} from "./skills";

const DOCKER = `# Stacks Docker

services:
  homepage:
    image: nginx:alpine
    ports:
      - "80:80"
  postgres:
    image: postgres:16
`;

describe("matchSkillFromText", () => {
  it("maps short voice phrases only", () => {
    expect(matchSkillFromText("sommaire")).toBe("outline");
    expect(matchSkillFromText("structure")).toBe("structure");
    expect(matchSkillFromText("plan")).toBe("plan");
    expect(matchSkillFromText("tags")).toBe("tags");
    expect(matchSkillFromText("brief")).toBe("brief");
    expect(matchSkillFromText("lien")).toBe("enrich");
    expect(matchSkillFromText("template")).toBe("template");
    expect(matchSkillFromText("liees")).toBe("related");
    expect(matchSkillFromText("points cles")).toBe("keypoints");
  });

  it("never hijacks a free-form formatting instruction", () => {
    expect(
      matchSkillFromText("Mets en forme correctement les balises markdown du fichier"),
    ).toBeNull();
    expect(matchSkillFromText("Répare le Markdown sans changer le contenu")).toBeNull();
  });
});

describe("runSkillLocal", () => {
  it("structures docker yaml without an LLM", () => {
    const result = runSkillLocal("structure", DOCKER);
    expect(result?.proposed).toContain("```yaml");
    expect(result?.proposed).toContain("postgres:16");
  });

  it("builds a daily template on empty notes", () => {
    const result = runSkillLocal("template", "");
    expect(result?.proposed).toContain("# Daily");
    expect(result?.applyMode).toBe("replace");
  });

  it("formats related notes from a RAG block", () => {
    const result = runSkillLocal("related", "note", {
      ragBlock: "- [[Autre]] — extrait",
    });
    expect(result?.proposed).toContain("## Notes liées");
    expect(result?.proposed).toContain("[[Autre]]");
  });
});

describe("parseTagsProposal", () => {
  it("parses comma-separated tags", () => {
    expect(parseTagsProposal("tags: docker, devops, nginx")).toEqual([
      "docker",
      "devops",
      "nginx",
    ]);
  });
});

describe("isGroundedAppendix", () => {
  it("accepts a plan that keeps docker terms", () => {
    const plan =
      "## Plan de note\n\n- Homepage : image nginx et port 80\n- Postgres : image postgres 16";
    expect(isGroundedAppendix(DOCKER, plan)).toBe(true);
  });

  it("rejects a recipe appendix", () => {
    expect(
      isGroundedAppendix(DOCKER, "## Plan\n\nIngrédients : farine, sucre. Préparation au four."),
    ).toBe(false);
  });
});

describe("isEmptyLlmAppendix", () => {
  it("detects empty task replies", () => {
    expect(isEmptyLlmAppendix("(aucune tâche)")).toBe(true);
    expect(isEmptyLlmAppendix("## Tâches\n\n- [ ] relancer nginx")).toBe(false);
  });
});
