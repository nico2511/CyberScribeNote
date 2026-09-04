import { describe, expect, it } from "vitest";
import {
  parseFrontmatterMeta,
  setFrontmatterTags,
  touchUpdatedDate,
} from "./frontmatter";

describe("frontmatter meta", () => {
  it("parses tags and dates", () => {
    const md = `---
title: Hello
tags: [a, b]
created: 2026-01-01
updated: 2026-02-01
---

# Hello
`;
    expect(parseFrontmatterMeta(md)).toEqual({
      title: "Hello",
      tags: ["a", "b"],
      created: "2026-01-01",
      updated: "2026-02-01",
    });
  });

  it("sets tags and touches updated", () => {
    const withTags = setFrontmatterTags("# Note\n", ["recette", "pain"]);
    expect(withTags).toContain("tags: [recette, pain]");
    const touched = touchUpdatedDate(withTags);
    expect(touched).toMatch(/updated: \d{4}-\d{2}-\d{2}/);
  });
});
