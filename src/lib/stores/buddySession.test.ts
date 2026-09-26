import { describe, expect, it } from "vitest";
import { handleBuddyAction } from "./buddySession.svelte";

describe("handleBuddyAction", () => {
  it("ouvre le compagnon et lance le plan", () => {
    const opened: string[] = [];
    const planned: string[][] = [];
    handleBuddyAction(
      { kind: "skill_plan", skillIds: ["keypoints", "brief", "tags"] },
      {
        openCompanion: () => opened.push("open"),
        runSkill: (id) => opened.push(id),
        runSkillPlan: (ids) => planned.push(ids),
      },
    );
    expect(opened).toEqual(["open"]);
    expect(planned).toEqual([["keypoints", "brief", "tags"]]);
  });

  it("retombe sur la première skill si aucun runner de plan n'est branché", () => {
    const ran: string[] = [];
    handleBuddyAction(
      { kind: "skill_plan", skillIds: ["brief", "tags"] },
      {
        openCompanion: () => {},
        runSkill: (id) => ran.push(id),
      },
    );
    expect(ran).toEqual(["brief"]);
  });

  it("laisse passer une skill seule", () => {
    const ran: string[] = [];
    handleBuddyAction(
      { kind: "skill", skillId: "outline" },
      {
        openCompanion: () => {},
        runSkill: (id) => ran.push(id),
      },
    );
    expect(ran).toEqual(["outline"]);
  });
});
