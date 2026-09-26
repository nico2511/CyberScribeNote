import { describe, expect, it } from "vitest";
import {
  buildFolderSommaireMarkdown,
  collectFolderInventory,
  findVaultEntry,
  formatFolderInventoryContext,
  sommaireMentionsInventory,
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

  it("builds empty placeholder for folder without notes", () => {
    const empty: VaultEntry = { name: "vide", path: "vide", isDir: true, children: [] };
    const md = buildFolderSommaireMarkdown("vide", empty);
    expect(md).toContain("Aucune note dans ce dossier");
    expect(collectFolderInventory("vide", empty)).toBeNull();
  });

  it("inventorie pour Ollama et refuse un sommaire qui oublie une note", () => {
    const folder = findVaultEntry(TREE, "projets")!;
    const inv = collectFolderInventory("projets", folder);
    expect(inv?.notes).toEqual(["projets/alpha.md"]);
    expect(formatFolderInventoryContext(inv!)).toContain("[[projets/alpha]]");
    expect(formatFolderInventoryContext(inv!)).toContain("nested");
    expect(
      sommaireMentionsInventory("# Sommaire\n\n- [[projets/alpha]]\n- [[projets/nested/sommaire]]", inv!),
    ).toBe(true);
    expect(sommaireMentionsInventory("# Sommaire\n\nRien ici.", inv!)).toBe(false);
  });
});
