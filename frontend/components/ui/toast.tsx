"use client";

/**
 * Toast — umpan balik aksi (design.md: setiap aksi pengguna harus punya
 * konfirmasi). Kebijakan isi/kedaluwarsa ada di `lib/toast.ts`; komponen ini
 * hanya menampilkan dan mengatur waktu.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, Info, TriangleAlert, CircleAlert, X } from "lucide-react";
import {
  createToast,
  dismissToast,
  expireToasts,
  nextExpiryIn,
  pushToast,
  type Toast,
  type ToastInput,
  type ToastTone,
} from "@/lib/toast";
import { cn } from "@/lib/utils";

type ToastContextValue = {
  push: (input: ToastInput) => void;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast harus dipakai di dalam <ToastProvider>");
  return ctx;
}

const TONE_STYLES: Record<ToastTone, string> = {
  success: "border-status-safe/40 bg-status-safe/10",
  danger: "border-status-danger/40 bg-status-danger/10",
  warning: "border-status-warning/50 bg-status-warning/20",
  info: "border-navy-700/30 bg-navy-700/10",
};

const TONE_ICONS: Record<ToastTone, typeof Info> = {
  success: CheckCircle2,
  danger: CircleAlert,
  warning: TriangleAlert,
  info: Info,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((input: ToastInput) => {
    setToasts((list) => pushToast(list, createToast(input, Date.now())));
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => dismissToast(list, id));
  }, []);

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  // Satu timer untuk toast yang paling cepat kedaluwarsa — bukan satu timer per toast.
  useEffect(() => {
    if (toasts.length === 0) return;
    const delay = nextExpiryIn(toasts, Date.now());
    if (delay === null) return;
    const timer = window.setTimeout(
      () => setToasts((list) => expireToasts(list, Date.now())),
      Math.max(150, delay),
    );
    return () => window.clearTimeout(timer);
  }, [toasts]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastHost({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:w-96"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  const Icon = TONE_ICONS[toast.tone];
  return (
    <div
      role={toast.tone === "danger" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex items-start gap-3 rounded-lg border bg-card p-3 shadow-sm",
        TONE_STYLES[toast.tone],
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-navy-900" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-navy-900">{toast.title}</p>
        {toast.description && (
          <p className="mt-0.5 text-xs text-navy-700">{toast.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Tutup notifikasi"
        className="shrink-0 rounded-md p-1 text-navy-700 transition-colors hover:bg-navy-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
