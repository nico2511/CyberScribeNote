import { describe, expect, it } from "vitest";
import { buildTemplateMarkdown, pickTemplateId } from "./templates";

describe("pickTemplateId", () => {
  it("picks from context keywords", () => {
    expect(pickTemplateId("", "réunion équipe")).toBe("meeting");
    expect(pickTemplateId("fiche livre", "")).toBe("reading");
    expect(pickTemplateId("roadmap projet", "")).toBe("project");
    expect(pickTemplateId("", "")).toBe("daily");
  });
});

describe("buildTemplateMarkdown", () => {
  it("fills empty notes", () => {
    const { proposed, reason } = buildTemplateMarkdown("", "");
    expect(proposed).toContain("# Daily");
    expect(proposed).toContain("## Focus");
    expect(reason).toMatch(/Daily/);
  });

  it("appends when the note already has content", () => {
    const { proposed } = buildTemplateMarkdown("# Déjà là\n", "meeting");
    expect(proposed).toContain("## Template ·");
    expect(proposed).toContain("Compte-rendu");
  });
});
