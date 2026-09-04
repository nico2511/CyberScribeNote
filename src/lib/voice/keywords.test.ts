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

  it("keeps free dictation as insert", () => {
    expect(parseVoiceTranscript("Aujourd'hui j'ai fait du pain").kind).toBe("insert");
  });
});
