/**
 * Antrean aksi offline — murni & bisa diuji.
 *
 * Lapangan (dapur SPPG) sering kehilangan jaringan. Aksi yang gagal terkirim
 * TIDAK boleh hilang tanpa jejak: masuk antrean lokal, lalu dikirim saat online.
 * Data mentah dari localStorage selalu disaring (toleran terhadap sampah/versi
 * lama) — jangan pernah mempercayai isi storage begitu saja.
 */

export type QueuedKind = "receiving_inspection";

export type QueuedAction = {
  id: string;
  kind: QueuedKind;
  /** Ringkasan pendek untuk ditampilkan ke pengguna. */
  label: string;
  payload: unknown;
  createdAt: number;
  attempts: number;
  status: "pending" | "sent";
};

export type QueuedInput = {
  kind: QueuedKind;
  label: string;
  payload: unknown;
};

export const QUEUE_STORAGE_KEY = "mealchain.queue.v1";
export const QUEUE_LIMIT = 25;

const VALID_KINDS: QueuedKind[] = ["receiving_inspection"];

export function createQueuedAction(
  input: QueuedInput,
  now: number,
  id: string,
): QueuedAction {
  return {
    id,
    kind: input.kind,
    label: input.label,
    payload: input.payload,
    createdAt: now,
    attempts: 0,
    status: "pending",
  };
}

/** Terbaru di depan; antrean lama dipotong agar storage tidak membengkak. */
export function enqueue(list: QueuedAction[], action: QueuedAction): QueuedAction[] {
  return [action, ...list].slice(0, QUEUE_LIMIT);
}

export function markSent(list: QueuedAction[], id: string): QueuedAction[] {
  return list.map((action) =>
    action.id === id ? { ...action, status: "sent", attempts: action.attempts + 1 } : action,
  );
}

export function pendingActions(list: QueuedAction[]): QueuedAction[] {
  return list.filter((action) => action.status === "pending");
}

export function pendingCount(list: QueuedAction[]): number {
  return pendingActions(list).length;
}

export function serializeQueue(list: QueuedAction[]): string {
  return JSON.stringify(list);
}

function isQueuedAction(value: unknown): value is QueuedAction {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<QueuedAction>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.createdAt === "number" &&
    typeof candidate.attempts === "number" &&
    (candidate.status === "pending" || candidate.status === "sent") &&
    VALID_KINDS.includes(candidate.kind as QueuedKind)
  );
}

/** Toleran: entri rusak/versi lama dibuang, bukan bikin aplikasi gagal muat. */
export function deserializeQueue(raw: string | null): QueuedAction[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isQueuedAction).slice(0, QUEUE_LIMIT);
  } catch {
    return [];
  }
}

export function formatQueueLabel(list: QueuedAction[]): string {
  const count = pendingCount(list);
  if (count === 0) return "Semua aksi terkirim";
  return `${count} aksi menunggu dikirim`;
}
