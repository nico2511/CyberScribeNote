import { describe, expect, it } from "vitest";
import { runSkillSequence } from "./skillPlan";

describe("runSkillSequence", () => {
  it("annonce le plan puis enchaîne les skills", async () => {
    const seen: string[] = [];
    const statuses: string[] = [];
    await runSkillSequence(
      ["brief", "tags"],
      async (id) => {
        seen.push(id);
      },
      (message) => statuses.push(message),
    );
    expect(statuses).toEqual(["Je lance Brief puis Tags."]);
    expect(seen).toEqual(["brief", "tags"]);
  });
});
