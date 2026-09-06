import { describe, expect, it } from "vitest";
import { canMoveVaultItem, parentPath } from "./tree";

describe("canMoveVaultItem", () => {
  it("blocks same-folder moves", () => {
    expect(canMoveVaultItem({ path: "a/note.md", isDir: false }, "a")).toBe(false);
  });

  it("allows moving a note into another folder", () => {
    expect(canMoveVaultItem({ path: "a/note.md", isDir: false }, "b")).toBe(true);
    expect(canMoveVaultItem({ path: "note.md", isDir: false }, "b")).toBe(true);
  });

  it("blocks dropping a folder into itself", () => {
    expect(canMoveVaultItem({ path: "proj", isDir: true }, "proj")).toBe(false);
    expect(canMoveVaultItem({ path: "proj", isDir: true }, "proj/sub")).toBe(false);
  });
});

describe("parentPath", () => {
  it("returns empty for root files", () => {
    expect(parentPath("note.md")).toBe("");
    expect(parentPath("a/b.md")).toBe("a");
  });
});
