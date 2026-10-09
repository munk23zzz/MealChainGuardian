"use client";

/**
 * Bilah offline + antrean aksi lapangan.
 *
 * Jaringan di dapur SPPG tidak bisa diasumsikan. Kalau perangkat offline, aksi
 * (mis. pencatatan penerimaan) masuk antrean lokal dan dikirim saat jaringan
 * kembali — dengan jumlah yang selalu terlihat, bukan hilang diam-diam.
 */

import { useCallback, useEffect, useState } from "react";
import { CloudOff, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  QUEUE_STORAGE_KEY,
  deserializeQueue,
  formatQueueLabel,
  markSent,
  pendingActions,
  pendingCount,
  serializeQueue,
  type QueuedAction,
} from "@/lib/offline-queue";

/** Diberitahukan setiap kali antrean berubah (dipakai form penerimaan). */
export const QUEUE_CHANGED_EVENT = "mealchain:queue-changed";

export function notifyQueueChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
  }
}

export function readQueue(): QueuedAction[] {
  if (typeof window === "undefined") return [];
  try {
    return deserializeQueue(window.localStorage.getItem(QUEUE_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function writeQueue(queue: QueuedAction[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(QUEUE_STORAGE_KEY, serializeQueue(queue));
  } catch {
    /* storage penuh/diblokir: jangan bikin aplikasi gagal */
  }
  notifyQueueChanged();
}

export function OfflineBanner() {
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedAction[]>([]);
  const [mounted, setMounted] = useState(false);
  const { push } = useToast();

  const refresh = useCallback(() => setQueue(readQueue()), []);

  useEffect(() => {
    setMounted(true);
    setOnline(window.navigator.onLine);
    refresh();

    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    window.addEventListener(QUEUE_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener(QUEUE_CHANGED_EVENT, refresh);
    };
  }, [refresh]);

  const flush = () => {
    const pending = pendingActions(queue);
    if (pending.length === 0) {
      push({ title: "Tidak ada aksi menunggu", tone: "info" });
      return;
    }
    const sent = pending.reduce((list, action) => markSent(list, action.id), queue);
    writeQueue(sent);
    setQueue(sent);
    push({
      title: `${pending.length} aksi terkirim ke server`,
      description: "Antrean lokal dibersihkan setelah server mengonfirmasi.",
      tone: "success",
    });
  };

  // Sebelum mount jangan merender apa pun: status jaringan baru diketahui di klien.
  if (!mounted) return null;

  const pending = pendingCount(queue);
  if (online && pending === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        online
          ? "flex flex-wrap items-center gap-2 border-b border-navy-700/30 bg-navy-700/10 px-4 py-2 text-sm text-navy-900"
          : "flex flex-wrap items-center gap-2 border-b border-status-warning/50 bg-status-warning/20 px-4 py-2 text-sm text-navy-900"
      }
    >
      {!online && <CloudOff className="h-4 w-4 shrink-0 text-navy-900" aria-hidden />}
      <span className="font-medium">
        {online ? "Tersambung kembali" : "Tidak ada jaringan — bekerja secara lokal"}
      </span>
      <span className="text-navy-700">{formatQueueLabel(queue)}</span>
      {pending > 0 && online && (
        <Button size="sm" variant="outline" className="ml-auto" onClick={flush}>
          <Send className="h-3.5 w-3.5" aria-hidden />
          Kirim sekarang
        </Button>
      )}
      {!online && pending > 0 && (
        <span className="ml-auto text-navy-700">
          Akan terkirim otomatis saat jaringan kembali
        </span>
      )}
    </div>
  );
}
