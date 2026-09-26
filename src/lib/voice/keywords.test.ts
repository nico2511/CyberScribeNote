import { describe, expect, it } from "vitest";
import { parseVoiceTranscript } from "./keywords";

describe("parseVoiceTranscript", () => {
  it("recognizes AI commands with wake variants", () => {
    expect(parseVoiceTranscript("Scribe, corrige")).toMatchObject({
      kind: "ai",
      action: "correct",
    });
    expect(parseVoiceTranscript("Scrib corriger")).toMatchObject({
      kind: "ai",
      action: "correct",
    });
    expect(parseVoiceTranscript("Euh scribe, résume")).toMatchObject({
      kind: "ai",
      action: "summarize",
    });
  });

  it("recognizes conception skills", () => {
    expect(parseVoiceTranscript("Scribe, sommaire")).toMatchObject({
      kind: "skill",
      skillId: "outline",
    });
    expect(parseVoiceTranscript("Scribe structure")).toMatchObject({
      kind: "skill",
      skillId: "structure",
    });
    expect(parseVoiceTranscript("Scribe, plan")).toMatchObject({
      kind: "skill",
      skillId: "plan",
    });
    expect(parseVoiceTranscript("Scribe, tags")).toMatchObject({
      kind: "skill",
      skillId: "tags",
    });
    expect(parseVoiceTranscript("Scribe, brief")).toMatchObject({
      kind: "skill",
      skillId: "brief",
    });
    expect(parseVoiceTranscript("Scribe, lien")).toMatchObject({
      kind: "skill",
      skillId: "enrich",
    });
  });

  it("parses search and open", () => {
    expect(parseVoiceTranscript("Scribe, cherche recettes")).toMatchObject({
      kind: "search",
      query: "recettes",
    });
    expect(parseVoiceTranscript("Scribe ouvre la note pain")).toMatchObject({
      kind: "open",
      query: "pain",
    });
  });

  it("does not insert unknown short Scribe phrases", () => {
    expect(parseVoiceTranscript("Scribe bonjour").kind).toBe("unknown");
  });

  it("routes a freeform skill sentence the short matcher skips", () => {
    expect(parseVoiceTranscript("Scribe, analyse ce CR")).toMatchObject({
      kind: "skill_plan",
      skillIds: ["keypoints", "brief", "tags"],
    });
    expect(
      parseVoiceTranscript("Scribe, fais un sommaire puis des tags pour classer cette note"),
    ).toMatchObject({
      kind: "skill_plan",
      skillIds: ["outline", "tags"],
    });
  });

  it("keeps a long dictation that does not open on a skill verb", () => {
    const said =
      "Scribe, aujourd'hui j'ai beaucoup écrit dans cette note sans demander de skill particulière du tout";
    expect(parseVoiceTranscript(said).kind).toBe("insert");
  });

  it("keeps free dictation as insert", () => {
    expect(parseVoiceTranscript("Aujourd'hui j'ai fait du pain").kind).toBe("insert");
  });
});
