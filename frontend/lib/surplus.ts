/**
 * Alokasi surplus pangan — dasar hukum: Peraturan BGN No. 1 Tahun 2026
 * (SPPG wajib menangani sisa pangan, sampah, dan limbah MBG).
 *
 * Aturan yang dipegang: sisa pangan hanya boleh dialihkan bila MASIH berada di
 * dalam jendela aman 4 jam saat TIBA di penerima. Kalau tidak, jangan
 * dialihkan untuk dikonsumsi — catat sebagai limbah.
 */

import { SAFE_WINDOW_MS, windowTone, type WindowTone } from "@/lib/four-hour";

export type SurplusTargetKind = "sppg" | "posyandu" | "bank_pangan" | "panti";

export type SurplusCandidate = {
  id: string;
  name: string;
  kind: SurplusTargetKind;
  travelMinutes: number;
  capacityPortions: number;
};

export type SurplusRow = {
  candidate: SurplusCandidate;
  arrivesAt: number;
  remainingOnArrivalMs: number;
  withinWindow: boolean;
  acceptedPortions: number;
  tone: WindowTone;
  /**
   * Kalimat status untuk baris ini. Dihitung di sini (bukan di komponen) supaya
   * tabel, CSV, dan ringkasan selalu memakai kalimat yang sama.
   */
  note: string;
};

export type SurplusPlan = {
  rows: SurplusRow[];
  recommended: SurplusRow | null;
  allocatedPortions: number;
  unallocatedPortions: number;
  reason: string;
  wasteNote: string;
  tone: WindowTone;
};

export const TARGET_KIND_LABELS: Record<SurplusTargetKind, string> = {
  sppg: "SPPG lain",
  posyandu: "Posyandu",
  bank_pangan: "Bank pangan",
  panti: "Panti asuhan",
};

export function planSurplus(input: {
  surplusPortions: number;
  cookedAt: number;
  now: number;
  candidates: SurplusCandidate[];
  windowMs?: number;
}): SurplusPlan {
  const windowMs = input.windowMs ?? SAFE_WINDOW_MS;
  const deadline = input.cookedAt + windowMs;
  const surplus = Math.max(0, input.surplusPortions);

  // Terdekat lebih dulu: makin cepat tiba, makin besar jendela aman yang tersisa.
  const ordered = [...input.candidates].sort(
    (a, b) => a.travelMinutes - b.travelMinutes,
  );

  let remaining = surplus;
  const rows: SurplusRow[] = ordered.map((candidate) => {
    const arrivesAt = input.now + candidate.travelMinutes * 60_000;
    const remainingOnArrivalMs = deadline - arrivesAt;
    const withinWindow = remainingOnArrivalMs > 0;
    const acceptedPortions = withinWindow
      ? Math.max(0, Math.min(remaining, candidate.capacityPortions))
      : 0;
    remaining -= acceptedPortions;
    // Kalimat status dibedakan: jendela aman ≠ otomatis dapat porsi (bisa jadi
    // porsinya sudah habis dialokasikan ke tujuan yang lebih dekat).
    const note = !withinWindow
      ? "Lewat jendela 4 jam saat tiba — jangan dialihkan untuk konsumsi, catat sebagai limbah"
      : acceptedPortions > 0
        ? "Dalam jendela 4 jam saat tiba"
        : "Jendela aman, tetapi porsi sudah teralokasi ke tujuan yang lebih dekat";
    return {
      candidate,
      arrivesAt,
      remainingOnArrivalMs,
      withinWindow,
      acceptedPortions,
      tone: windowTone(remainingOnArrivalMs, !withinWindow),
      note,
    };
  });

  const eligible = rows.filter((row) => row.withinWindow && row.acceptedPortions > 0);
  const recommended = eligible[0] ?? null;
  const allocatedPortions = surplus - remaining;

  const reason =
    surplus === 0
      ? "Tidak ada surplus hari ini"
      : recommended
        ? `Dialihkan ke ${recommended.candidate.name} (tiba dalam ${recommended.candidate.travelMinutes} menit, masih di dalam jendela 4 jam)`
        : "Tidak ada tujuan yang bisa menerima dalam jendela aman 4 jam";

  const wasteNote =
    remaining > 0
      ? `${remaining} porsi tidak dialihkan — wajib dicatat penanganannya (PerBGN 1/2026: sisa pangan, sampah, dan limbah)`
      : "Seluruh surplus teralokasi di dalam jendela aman";

  // Tone menandai ADANYA masalah: tanpa surplus = aman; ada surplus tapi tak ada
  // tujuan yang bisa menerima dalam jendela aman = bahaya (harus ditangani).
  const tone: WindowTone =
    surplus === 0 ? "safe" : recommended ? recommended.tone : "danger";

  return {
    rows,
    recommended,
    allocatedPortions,
    unallocatedPortions: remaining,
    reason,
    wasteNote,
    tone,
  };
}

export function candidateLabel(candidate: SurplusCandidate): string {
  return `${candidate.name} · ${TARGET_KIND_LABELS[candidate.kind]}`;
}
