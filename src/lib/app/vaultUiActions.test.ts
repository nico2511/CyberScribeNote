import { describe, expect, it, vi } from "vitest";
import { deleteVaultPath } from "./vaultUiActions";

describe("vaultUiActions", () => {
  it("deleteVaultPath aborts when user declines confirm", async () => {
    vi.stubGlobal("confirm", () => false);
    const setStatus = vi.fn();
    await deleteVaultPath("notes/x.md", { setStatus, openNote: async () => {} });
    expect(setStatus).not.toHaveBeenCalled();
  });
});
