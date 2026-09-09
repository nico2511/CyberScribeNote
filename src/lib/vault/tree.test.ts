import { describe, expect, it } from "vitest";
import { canMoveVaultItem, countNotesInFolder, isFolderEmpty, parentPath } from "./tree";

describe("canMoveVaultItem", () => {
  it("blocks same-folder moves", () => {
    expect(
      canMoveVaultItem({ path: "a/note.md", isDir: false }, "a"),
    ).toBe(false);
  });

  it("allows move into another folder", () => {
    expect(
      canMoveVaultItem({ path: "a/note.md", isDir: false }, "b"),
    ).toBe(true);
  });

  it("blocks dropping a folder into itself", () => {
    expect(
      canMoveVaultItem({ path: "proj", isDir: true }, "proj/sub"),
    ).toBe(false);
  });
});

describe("countNotesInFolder", () => {
  it("counts nested notes recursively", () => {
    expect(
      countNotesInFolder({
        name: "Docker",
        path: "Docker",
        isDir: true,
        children: [
          { name: "a.md", path: "Docker/a.md", isDir: false },
          {
            name: "sub",
            path: "Docker/sub",
            isDir: true,
            children: [
              { name: "b.md", path: "Docker/sub/b.md", isDir: false },
              { name: "c.md", path: "Docker/sub/c.md", isDir: false },
            ],
          },
        ],
      }),
    ).toBe(3);
  });
});

describe("isFolderEmpty", () => {
  it("is true when folder has no children", () => {
    expect(isFolderEmpty({ name: "Empty", path: "Empty", isDir: true, children: [] })).toBe(true);
    expect(isFolderEmpty({ name: "Empty", path: "Empty", isDir: true })).toBe(true);
  });

  it("is false when folder has notes or subfolders", () => {
    expect(
      isFolderEmpty({
        name: "A",
        path: "A",
        isDir: true,
        children: [{ name: "n.md", path: "A/n.md", isDir: false }],
      }),
    ).toBe(false);
  });
});
