import { describe, expect, it } from "vitest";
import {
  imageImportStatusMessage,
  imageMarkdownForRelative,
} from "./noteImages";

describe("noteImages", () => {
  it("builds markdown with alt from filename", () => {
    expect(imageMarkdownForRelative("notes/foo/_media/pic.png")).toContain("![pic]");
    expect(imageMarkdownForRelative("notes/foo/_media/pic.png")).toContain("(notes/foo/_media/pic.png)");
  });

  it("status message mentions note media folder", () => {
    expect(imageImportStatusMessage("a/_media/x.png")).toContain("dossier de la note");
    expect(imageImportStatusMessage("media/x.png")).toContain("media/");
  });
});
