import { describe, expect, it } from "vitest";
import { isGroundedAppendix } from "./grounding";
import {
  matchSkillFromText,
  noteHasDecisionCue,
  NOTE_SKILLS,
  runSkillLocal,
  titleIsSolid,
  titleStaysOnTopic,
  withProposedTitle,
  isEmptyLlmAppendix,
  parseTagsProposal,
  type SkillTheme,
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

describe("NOTE_SKILLS themes", () => {
  it("couvre les sept thèmes du cerveau sans retirer le groupe UI", () => {
    const themes = new Set<SkillTheme>(NOTE_SKILLS.map((s) => s.theme));
    expect(NOTE_SKILLS).toHaveLength(19);
    expect(themes).toEqual(
      new Set([
        "prise-de-notes",
        "analyse",
        "ecriture",
        "construction",
        "amelioration",
        "documents",
        "connexion",
      ]),
    );
    expect(NOTE_SKILLS.every((s) => s.group)).toBe(true);
  });
});

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
    expect(matchSkillFromText("indexe dossier")).toBe("folderIndex");
    expect(matchSkillFromText("points cles")).toBe("keypoints");
    expect(matchSkillFromText("taches")).toBe("keypoints");
    expect(matchSkillFromText("todos")).toBe("keypoints");
    expect(matchSkillFromText("actions")).toBe("actions");
    expect(matchSkillFromText("questions")).toBe("questions");
    expect(matchSkillFromText("decisions")).toBe("decisions");
    expect(matchSkillFromText("clarifie")).toBe("clarify");
    expect(matchSkillFromText("raccourcis")).toBe("shorten");
    expect(matchSkillFromText("titre")).toBe("title");
    expect(matchSkillFromText("relis")).toBe("proofread");
    expect(matchSkillFromText("sources")).toBe("sources");
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

  it("liste les sources locales sans rien inventer", () => {
    const note = "Voir https://example.com/alpha et aussi https://ollama.com/docs/guide.";
    const result = runSkillLocal("sources", note);
    expect(result?.applyMode).toBe("append");
    expect(result?.proposed).toContain("## Sources");
    expect(result?.proposed).toContain("https://example.com/alpha");
    expect(result?.proposed).not.toContain("http://invente");
    expect(runSkillLocal("sources", "Pas de lien ici.")).toBeNull();
    expect(runSkillLocal("sources", `${note}\n\n## Sources\n\n- déjà`)).toBeNull();
  });

  it("ne fabrique pas de décision quand la note n'en pose pas", () => {
    const empty = runSkillLocal("decisions", "Réunion sur le pain et le four.");
    expect(noteHasDecisionCue("Réunion sur le pain et le four.")).toBe(false);
    expect(empty?.proposed).toContain("Aucune décision déjà posée");
    expect(empty?.proposed).not.toMatch(/migrer|postgres|budget/i);

    const posed = "On a décidé de migrer vers Postgres.";
    expect(noteHasDecisionCue(posed)).toBe(true);
    expect(runSkillLocal("decisions", posed)).toBeNull();
  });

  it("corrige localement une faute connue pour Relire", () => {
    const result = runSkillLocal("proofread", "Salu tu va bieng");
    expect(result?.proposed.toLowerCase()).toContain("salut");
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

describe("title helpers", () => {
  it("laisse un titre déjà solide et pose un titre ancré", () => {
    const solid = "# Stacks Docker\n\nHomepage nginx et postgres.";
    expect(titleIsSolid(solid)).toBe(true);
    expect(titleIsSolid("# Note\n\nHomepage nginx et postgres.")).toBe(false);
    expect(titleStaysOnTopic(solid, "Stacks Docker nginx")).toBe(true);
    expect(titleStaysOnTopic(solid, "Recette de soupe")).toBe(false);
    const next = withProposedTitle("# Note\n\nHomepage nginx.", "Homepage nginx");
    expect(next.startsWith("# Homepage nginx")).toBe(true);
    expect(next).toContain("Homepage nginx.");
  });
});

describe("isEmptyLlmAppendix", () => {
  it("detects empty task replies", () => {
    expect(isEmptyLlmAppendix("(aucune tâche)")).toBe(true);
    expect(isEmptyLlmAppendix("## Tâches\n\n- [ ] relancer nginx")).toBe(false);
    expect(isEmptyLlmAppendix("## Actions\n\n(aucune action déjà mentionnée)")).toBe(true);
  });
});
