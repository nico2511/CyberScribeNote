import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resetInvokeImpl } from "$lib/tauri/api";
import { runVaultSearch, searchSession } from "./searchSession.svelte";

describe("runVaultSearch", () => {
  beforeEach(() => {
    resetInvokeImpl();
    searchSession.results = [];
    searchSession.loading = false;
    searchSession.query = "";
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetInvokeImpl();
  });

  it("clears results and loading when query is empty", async () => {
    searchSession.loading = true;
    searchSession.results = [{ path: "a.md", title: "A", snippet: "x" }];
    await runVaultSearch("  ");
    expect(searchSession.results).toEqual([]);
    expect(searchSession.loading).toBe(false);
  });

});
