import { describe, expect, it } from "vitest";
import { matchSkillFromText } from "./skills";
import {
  combineSkillPlan,
  opensSkillIntent,
  routeSkillsFromIntent,
  type SkillRoutePlan,
} from "./skillRouter";

function ids(text: string, extra: Parameters<typeof routeSkillsFromIntent>[0] = { text }) {
  return routeSkillsFromIntent({ ...extra, text })?.skills ?? [];
}

describe("routeSkillsFromIntent", () => {
  it("chaine keypoints, brief puis tags pour une analyse de CR", () => {
    const plan = routeSkillsFromIntent({ text: "analyse ce CR" });
    expect(plan?.skills).toEqual(["keypoints", "brief", "tags"]);
    expect(plan?.source).toBe("rules");
    expect(plan?.themes).toEqual(["analyse", "ecriture", "connexion"]);
    expect(plan?.confidence).toBeGreaterThan(0.7);
    expect(plan?.why.toLowerCase()).toContain("analyse");
    expect(plan?.steps.map((s) => s.id)).toEqual(plan?.skills);
    expect(combineSkillPlan(plan!)).toBe("Je lance Points clés, Brief puis Tags.");
    expect(ids("voici le compte rendu de la revue")).toEqual(["keypoints", "brief", "tags"]);
  });

  it("garde la commande courte sur un seul skill", () => {
    const plan = routeSkillsFromIntent({ text: "sommaire" });
    expect(matchSkillFromText("sommaire")).toBe("outline");
    expect(plan?.skills).toEqual(["outline"]);
    expect(plan?.confidence).toBeGreaterThan(0.9);
    expect(plan?.themes).toEqual(["construction"]);
    expect(combineSkillPlan(plan!)).toBe("Je lance Sommaire.");
  });

  it("route le texte libre long que le match court ignore", () => {
    const text = "fais un sommaire puis des tags pour classer cette note";
    expect(matchSkillFromText(text)).toBeNull();
    const plan = routeSkillsFromIntent({ text });
    expect(plan?.skills).toEqual(["outline", "tags"]);
    expect(plan?.source).toBe("rules");
    expect(combineSkillPlan(plan!)).toBe("Je lance Sommaire puis Tags.");
  });

  it("propose Structurer pour une consigne de forme, sans la confondre avec une commande courte", () => {
    const text = "Mets en forme correctement les balises markdown du fichier";
    expect(matchSkillFromText(text)).toBeNull();
    expect(ids(text)).toEqual(["structure"]);
    expect(routeSkillsFromIntent({ text })?.themes).toEqual(["amelioration"]);
  });

  it("combine construction et un skill nommé", () => {
    expect(ids("construis cette note et ajoute des tags")).toEqual(["plan", "outline", "tags"]);
  });

  it("relie puis pose des wikiliens", () => {
    expect(ids("relie cette note au vault")).toEqual(["related", "wikilinks"]);
  });

  it("indexe le dossier puis cherche les notes liées", () => {
    expect(ids("indexe ce dossier et trouve les notes liees")).toEqual([
      "folderIndex",
      "related",
    ]);
  });

  it("enchaîne plan puis brief", () => {
    expect(ids("ajoute un plan puis un brief")).toEqual(["plan", "brief"]);
    expect(combineSkillPlan({ skills: ["brief", "tags"] })).toBe("Je lance Brief puis Tags.");
  });

  it("ajoute le lien quand un URL est signalé", () => {
    expect(ids("analyse cette page", { text: "analyse cette page", hasUrl: true })).toEqual([
      "enrich",
      "keypoints",
      "brief",
      "tags",
    ]);
  });

  it("structure un document importé même sans texte", () => {
    const plan = routeSkillsFromIntent({ text: "", docImported: true });
    expect(plan?.skills).toEqual(["structure", "keypoints", "tags"]);
    expect(plan?.why.toLowerCase()).toContain("import");
  });

  it("lit une note longue inachevée seulement si la consigne est vague", () => {
    const excerpt = `${"paragraphe ".repeat(80)}`;
    expect(excerpt.length).toBeGreaterThan(500);
    expect(ids("", { text: "", noteExcerpt: excerpt })).toEqual(["keypoints", "brief", "tags"]);
    expect(ids("traduis ce paragraphe en gardant le ton", { text: "traduis ce paragraphe en gardant le ton", noteExcerpt: excerpt })).toEqual(
      [],
    );
  });

  it("retourne null sans signal", () => {
    expect(routeSkillsFromIntent({ text: "bonjour ami" })).toBeNull();
    expect(routeSkillsFromIntent({ text: "   " })).toBeNull();
    expect(combineSkillPlan({ skills: [] })).toBe("Aucun skill à lancer.");
  });

  it("laisse le classifieur primer seulement s'il est plus sûr", () => {
    const llm: SkillRoutePlan = {
      skills: ["tags"],
      themes: ["connexion"],
      confidence: 0.99,
      why: "Le modèle local ne voit que les tags.",
      source: "llm",
      steps: [],
    };
    const won = routeSkillsFromIntent({ text: "analyse ce CR" }, { classify: () => llm });
    expect(won?.source).toBe("llm");
    expect(won?.skills).toEqual(["tags"]);

    const kept = routeSkillsFromIntent(
      { text: "analyse ce CR" },
      { classify: () => ({ ...llm, confidence: 0.2 }) },
    );
    expect(kept?.source).toBe("rules");
    expect(kept?.skills).toEqual(["keypoints", "brief", "tags"]);
  });

  it("retombe sur les règles si Ollama (le crochet) échoue", () => {
    const plan = routeSkillsFromIntent(
      { text: "analyse ce CR" },
      {
        classify: () => {
          throw new Error("ollama down");
        },
      },
    );
    expect(plan?.source).toBe("rules");
    expect(plan?.skills).toEqual(["keypoints", "brief", "tags"]);
  });

  it("ignore les ids inconnus du crochet", () => {
    const plan = routeSkillsFromIntent(
      { text: "bonjour" },
      {
        classify: () =>
          ({
            skills: ["nope", "brief"],
            themes: [],
            confidence: 0.9,
            why: "partiel",
            source: "llm",
            steps: [],
          }) as unknown as SkillRoutePlan,
      },
    );
    expect(plan?.skills).toEqual(["brief"]);
    expect(plan?.source).toBe("llm");
  });
});

describe("opensSkillIntent", () => {
  it("reconnaît un verbe de skill en tête, pas une dictée", () => {
    expect(opensSkillIntent("analyse ce CR")).toBe(true);
    expect(opensSkillIntent("peux tu relier cette note")).toBe(true);
    expect(opensSkillIntent("aujourd'hui j'analyse le marché")).toBe(false);
  });
});
