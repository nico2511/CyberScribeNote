import { describe, expect, it } from "vitest";
import { sanitizeTipTapHtml } from "./sanitize";

describe("sanitizeTipTapHtml", () => {
  it("strips script tags and event handlers", () => {
    const dirty = '<p>ok</p><script>alert(1)</script><img src=x onerror="alert(1)">';
    const clean = sanitizeTipTapHtml(dirty);
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("onerror");
  });

  it("strips inline svg", () => {
    const dirty = "<p>text</p><svg onload=\"alert(1)\"><circle /></svg>";
    expect(sanitizeTipTapHtml(dirty)).not.toContain("<svg");
  });

  it("preserves wikilink spans", () => {
    const html = '<span data-wikilink="Note" class="wikilink">[[Note]]</span>';
    expect(sanitizeTipTapHtml(html)).toContain('data-wikilink="Note"');
  });
});
