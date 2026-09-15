import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { resetInvokeImpl, setInvokeImpl } from "$lib/tauri/api";
import {
  activeOllamaModel,
  ensureOllamaRunning,
  ollamaSession,
  refreshOllama,
} from "./ollamaSession.svelte";

describe("ollamaSession", () => {
  beforeEach(() => {
    resetInvokeImpl();
    ollamaSession.status = {
      available: false,
      models: ["phi3"],
      host: "http://127.0.0.1:11434",
      selectedModel: "",
      networkMode: "local",
      isLocalhost: true,
    };
  });

  it("refreshOllama updates status from invoke", async () => {
    setInvokeImpl(
      (async (cmd) => {
        if (cmd === "ollama_status") {
          return {
            available: true,
            models: ["llama3.2"],
            host: "http://127.0.0.1:11434",
            selectedModel: "llama3.2",
            networkMode: "local",
            isLocalhost: true,
          };
        }
        throw new Error(`unexpected ${cmd}`);
      }) as typeof tauriInvoke,
    );
    await refreshOllama();
    expect(ollamaSession.status.available).toBe(true);
    expect(ollamaSession.status.selectedModel).toBe("llama3.2");
  });

  it("activeOllamaModel falls back to first model", () => {
    ollamaSession.status.selectedModel = "";
    ollamaSession.status.models = ["qwen2.5", "phi3"];
    expect(activeOllamaModel()).toBe("qwen2.5");
  });

  it("ensureOllamaRunning returns true when status already available", async () => {
    setInvokeImpl(
      (async (cmd) => {
        if (cmd === "ollama_status") {
          return { ...ollamaSession.status, available: true };
        }
        throw new Error(`unexpected ${cmd}`);
      }) as typeof tauriInvoke,
    );
    const onStatus = vi.fn();
    const ok = await ensureOllamaRunning(false, onStatus);
    expect(ok).toBe(true);
    expect(onStatus).not.toHaveBeenCalled();
  });
});
