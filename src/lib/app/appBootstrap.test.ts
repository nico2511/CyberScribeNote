import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFirstRunUi } from "./appBootstrap";

describe("resolveFirstRunUi", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    });
  });

  it("opens setup when nothing stored", () => {
    const r = resolveFirstRunUi();
    expect(r.setupOpen).toBe(true);
    expect(r.splashOpen).toBe(false);
  });

  it("shows splash when setup done but splash not dismissed", () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) => {
      if (key === "csn-setup-done") return "1";
      if (key === "csn-splash-dismissed") return null;
      return null;
    });
    const r = resolveFirstRunUi();
    expect(r.setupOpen).toBe(false);
    expect(r.splashOpen).toBe(true);
  });
});
