import type { VaultDragPayload } from "./tree";

/** Réf synchrone pendant un drag HTML5 (évite le lag du state Svelte). */
let active: VaultDragPayload | null = null;

export function setActiveVaultDrag(payload: VaultDragPayload | null) {
  active = payload;
}

export function getActiveVaultDrag(): VaultDragPayload | null {
  return active;
}
