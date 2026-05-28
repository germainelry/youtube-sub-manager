import { useEffect, useState } from 'react';

export type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

const listeners = new Set<(toast: ToastItem | null) => void>();
let nextId = 0;
let activeTimer: ReturnType<typeof setTimeout> | null = null;

const TOAST_DURATION_MS = 3500;

export function showToast(message: string, kind: ToastKind = 'success'): void {
  const item: ToastItem = { id: ++nextId, message, kind };
  listeners.forEach((cb) => cb(item));
  if (activeTimer !== null) clearTimeout(activeTimer);
  activeTimer = setTimeout(() => {
    listeners.forEach((cb) => cb(null));
    activeTimer = null;
  }, TOAST_DURATION_MS);
}

export function ToastHost(): JSX.Element | null {
  const [toast, setToast] = useState<ToastItem | null>(null);

  useEffect(() => {
    listeners.add(setToast);
    return () => {
      listeners.delete(setToast);
    };
  }, []);

  if (!toast) return null;
  return (
    <div className={`toast toast-${toast.kind}`} role="status" key={toast.id}>
      {toast.message}
    </div>
  );
}
