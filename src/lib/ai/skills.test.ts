import { describe, expect, it } from "vitest";
import { isGroundedAppendix } from "./grounding";
import {
  matchSkillFromText,
  NOTE_SKILLS,
  proposedWikilinksStayInVault,
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

describe("catalogue LLM", () => {
  it("fait rédiger chaque skill par Ollama", () => {
    const missing = NOTE_SKILLS.filter(
      (s) => !s.needsLlm || !(s.llmInstruction && s.llmInstruction.trim().length > 40),
    ).map((s) => s.id);
    expect(missing).toEqual([]);
  });

  it("demande à Décisions de dire qu'il n'y en a pas, sans filet local", () => {
    const decisions = NOTE_SKILLS.find((s) => s.id === "decisions");
    expect(decisions?.llmInstruction).toMatch(/Aucune décision déjà posée/i);
    expect(decisions?.needsLlm).toBe(true);
  });
});

describe("proposedWikilinksStayInVault", () => {
  it("accepte un titre du vault et refuse une note inventée", () => {
    const note = "Voir le journal Docker demain.";
    expect(proposedWikilinksStayInVault(note, "Voir le [[Docker]] demain.", ["Docker"])).toBe(true);
    expect(proposedWikilinksStayInVault(note, "Voir [[Recette]] demain.", ["Docker"])).toBe(false);
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
