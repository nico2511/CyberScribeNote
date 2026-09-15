import { invoke as tauriInvoke } from "@tauri-apps/api/core";

type InvokeFn = typeof tauriInvoke;

let invokeImpl: InvokeFn = tauriInvoke;

/** Remplace l'implémentation invoke (tests unitaires). */
export function setInvokeImpl(fn: InvokeFn): void {
  invokeImpl = fn;
}

export function resetInvokeImpl(): void {
  invokeImpl = tauriInvoke;
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invokeImpl(cmd, args);
}
