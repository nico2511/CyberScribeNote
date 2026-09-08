import { describe, expect, it } from "vitest";
import { resolveMediaUrl } from "./media";

describe("resolveMediaUrl", () => {
  const vault = "C:/Users/me/Documents/CyberScribeNote/vault";
  const note = "notes/test.md";

  it("rejects absolute Windows paths", () => {
    expect(resolveMediaUrl("C:\\Users\\secret\\file.png", note, vault)).toBe("");
  });

  it("rejects UNC paths", () => {
    expect(resolveMediaUrl("\\\\server\\share\\file.png", note, vault)).toBe("");
  });

  it("rejects data URLs", () => {
    expect(resolveMediaUrl("data:image/png;base64,abc", note, vault)).toBe("");
  });

  it("rejects path traversal", () => {
    expect(resolveMediaUrl("../secret.png", note, vault)).toBe("");
  });

  it("allows https URLs", () => {
    expect(resolveMediaUrl("https://example.com/img.png", note, vault)).toBe(
      "https://example.com/img.png",
    );
  });
});
