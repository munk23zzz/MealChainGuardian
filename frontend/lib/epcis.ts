/**
 * Kejadian rantai pasok dengan bentuk GS1 EPCIS (what / where / when / why).
 * Dipakai untuk menampilkan jejak lot yang bisa dipahami mitra & auditor —
 * bukan format internal yang hanya dipahami pembuatnya.
 */

export type EpcisBizStep =
  | "receiving"
  | "inspecting"
  | "storing"
  | "shipping"
  | "consuming";

export type EpcisEvent = {
  eventId: string;
  /** what */
  what: string;
  /** where */
  where: string;
  /** when */
  when: number;
  /** why */
  why: string;
  bizStep: EpcisBizStep;
  /** Nomor barang (Global Trade Item Number). */
  gtin?: string;
  /** Nomor lot/batch — kunci penelusuran saat investigasi KLB. */
  lot?: string;
  /** Lokasi global (Global Location Number). */
  gln?: string;
};

export const BIZ_STEP_LABELS: Record<EpcisBizStep, string> = {
  receiving: "Penerimaan",
  inspecting: "Inspeksi",
  storing: "Penyimpanan",
  shipping: "Pengiriman",
  consuming: "Konsumsi",
};

export type EpcisInput = {
  eventId: string;
  what: string;
  where: string;
  when: number;
  why: string;
  bizStep: EpcisBizStep;
  gtin?: string;
  lot?: string;
  gln?: string;
};

const GTIN_PATTERN = /^\d{8,14}$/;
const LOT_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;
const GLN_PATTERN = /^\d{13}$/;

export function buildEpcisEvent(input: EpcisInput): EpcisEvent {
  return { ...input };
}

/** Mengembalikan daftar masalah; kosong berarti sah. */
export function validateEpcisEvent(event: EpcisEvent): string[] {
  const problems: string[] = [];
  if (!event.eventId.trim()) problems.push("event_id wajib diisi");
  if (!event.what.trim()) problems.push("what (komoditas/item) wajib diisi");
  if (!event.where.trim()) problems.push("where (lokasi) wajib diisi");
  if (!event.why.trim()) problems.push("why (alasan bisnis) wajib diisi");
  if (!Number.isFinite(event.when) || event.when <= 0) {
    problems.push("when (waktu) harus berupa waktu yang sah");
  }
  if (event.gtin && !GTIN_PATTERN.test(event.gtin)) {
    problems.push("gtin harus 8–14 digit angka");
  }
  if (event.lot && !LOT_PATTERN.test(event.lot)) {
    problems.push("lot hanya boleh huruf/angka/._- (3–32 karakter)");
  }
  if (event.gln && !GLN_PATTERN.test(event.gln)) {
    problems.push("gln harus 13 digit angka");
  }
  return problems;
}

/** Urut waktu, lalu ringkas per lot untuk kebutuhan penelusuran. */
export function sortByTime(events: EpcisEvent[]): EpcisEvent[] {
  return [...events].sort((a, b) => a.when - b.when);
}

export function groupByLot(events: EpcisEvent[]): { lot: string; events: EpcisEvent[] }[] {
  const lots = new Map<string, EpcisEvent[]>();
  for (const event of events) {
    const key = event.lot ?? "(tanpa lot)";
    lots.set(key, [...(lots.get(key) ?? []), event]);
  }
  return Array.from(lots.entries()).map(([lot, group]) => ({
    lot,
    events: sortByTime(group),
  }));
}
