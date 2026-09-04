export type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastInput {
  kind: ToastKind;
  title: string;
  message?: string;
  /** 0 = reste jusqu'à fermeture manuelle */
  durationMs?: number;
  /** Si fourni, remplace un toast déjà affiché avec la même clé. */
  key?: string;
}

export interface Toast extends ToastInput {
  id: string;
  durationMs: number;
}

type Listener = (toasts: Toast[]) => void;

const listeners = new Set<Listener>();
let toasts: Toast[] = [];

function emit() {
  const snapshot = [...toasts];
  for (const listener of listeners) listener(snapshot);
}

const DEFAULT_DURATION: Record<ToastKind, number> = {
  info: 6000,
  success: 5000,
  warning: 9000,
  error: 14000,
};

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener([...toasts]);
  return () => listeners.delete(listener);
}

export function notify(input: ToastInput): string {
  const key = input.key ?? `${input.kind}:${input.title}:${input.message ?? ""}`;
  const existing = toasts.find((t) => t.key === key);
  if (existing) {
    toasts = toasts.filter((t) => t.id !== existing.id);
  }

  const id = crypto.randomUUID();
  const durationMs = input.durationMs ?? DEFAULT_DURATION[input.kind];
  const toast: Toast = { ...input, id, key, durationMs };
  toasts = [toast, ...toasts].slice(0, 4);
  emit();
  if (durationMs > 0) {
    setTimeout(() => dismissToast(id), durationMs);
  }
  return id;
}

export function dismissToast(id: string) {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}
