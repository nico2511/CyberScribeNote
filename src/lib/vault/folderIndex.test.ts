import { describe, expect, it } from "vitest";
import {
  buildFolderSommaireMarkdown,
  findVaultEntry,
  sommairePathForFolder,
} from "./folderIndex";
import type { VaultEntry } from "$lib/types";

const TREE: VaultEntry[] = [
  {
    name: "projets",
    path: "projets",
    isDir: true,
    children: [
      { name: "alpha.md", path: "projets/alpha.md", isDir: false },
      { name: "sommaire.md", path: "projets/sommaire.md", isDir: false },
      {
        name: "nested",
        path: "projets/nested",
        isDir: true,
        children: [{ name: "one.md", path: "projets/nested/one.md", isDir: false }],
      },
    ],
  },
  { name: "readme.md", path: "readme.md", isDir: false },
];

describe("folderIndex", () => {
  it("resolves sommaire path", () => {
    expect(sommairePathForFolder("projets")).toBe("projets/sommaire.md");
    expect(sommairePathForFolder("")).toBe("sommaire.md");
  });

  it("finds nested folder entry", () => {
    expect(findVaultEntry(TREE, "projets/nested")?.isDir).toBe(true);
    expect(findVaultEntry(TREE, "missing")).toBeNull();
  });

  it("builds sommaire with notes and subfolders", () => {
    const folder = findVaultEntry(TREE, "projets")!;
    const md = buildFolderSommaireMarkdown("projets", folder);
    expect(md).toContain("# Sommaire · projets");
    expect(md).toContain("[[projets/alpha]]");
    expect(md).not.toContain("[[projets/sommaire]]");
    expect(md).toContain("[[projets/nested/sommaire]]");
    expect(md).toContain("1 note");
  });

  it("returns null for empty folder", () => {
    const empty: VaultEntry = { name: "vide", path: "vide", isDir: true, children: [] };
    expect(buildFolderSommaireMarkdown("vide", empty)).toBeNull();
  });
});
