/**
 * Data simulasi untuk halaman keamanan pangan, surplus, dan kualitas agen.
 *
 * Semua waktu disimpan sebagai OFFSET MENIT dari "sekarang" supaya demo selalu
 * terlihat hidup (batch baru saja matang, sampel baru diambil). Nilai ambang
 * TIDAK ada di sini — ambang resmi ada di lib/ccp.ts.
 */

import type { SurplusCandidate } from "@/lib/surplus";
import type { AgentRun } from "@/lib/quality";
import type { EpcisEvent, EpcisBizStep } from "@/lib/epcis";

/** Ubah offset menit menjadi waktu absolut. negatif = sudah lewat. */
export function fromOffset(now: number, minutes: number): number {
  return now + minutes * 60_000;
}

export type CcpReading = {
  ruleId: string;
  /** null = belum diukur (harus tampil sebagai belum terverifikasi). */
  value: number | null;
  batchId: string;
  measuredAtOffsetMin: number;
  note?: string;
};

export const MOCK_CCP_READINGS: CcpReading[] = [
  { ruleId: "chilled", value: 3.5, batchId: "B-2026-1007-A", measuredAtOffsetMin: -40 },
  { ruleId: "frozen", value: -19.5, batchId: "B-2026-1007-A", measuredAtOffsetMin: -40 },
  { ruleId: "hot-hold", value: 64, batchId: "B-2026-1007-A", measuredAtOffsetMin: -12 },
  { ruleId: "danger-zone", value: 58, batchId: "B-2026-1007-A", measuredAtOffsetMin: -12, note: "wadah antrian distribusi" },
  { ruleId: "thawing", value: 8.5, batchId: "B-2026-1007-A", measuredAtOffsetMin: -120 },
  { ruleId: "cook-to-serve", value: 2.5, batchId: "B-2026-1007-A", measuredAtOffsetMin: -12 },
  // Batch kedua sengaja punya satu titik belum diukur — contoh kejujuran data.
  { ruleId: "chilled", value: 5.5, batchId: "B-2026-1007-B", measuredAtOffsetMin: -25 },
  { ruleId: "hot-hold", value: null, batchId: "B-2026-1007-B", measuredAtOffsetMin: -5, note: "termometer belum dicatat" },
];

export type MockBatch = {
  id: string;
  menu: string;
  portions: number;
  /** Negatif = sudah matang beberapa menit lalu. */
  cookedAtOffsetMin: number;
  destination: string;
  travelMinutes: number;
};

export const MOCK_BATCHES: MockBatch[] = [
  {
    id: "B-2026-1007-A",
    menu: "Nasi, ayam bumbu kuning, tempe orek, sayur bening",
    portions: 3_100,
    cookedAtOffsetMin: -95,
    destination: "SDN 05 Jakarta Utara",
    travelMinutes: 35,
  },
  {
    id: "B-2026-1007-B",
    menu: "Nasi, telur balado, tahu, sayur sop",
    portions: 1_150,
    cookedAtOffsetMin: -215,
    destination: "SDN 12 Jakarta Pusat",
    travelMinutes: 55,
  },
  {
    id: "B-2026-1007-C",
    menu: "Nasi, mie goreng, bakso, sayur",
    portions: 1_010,
    cookedAtOffsetMin: -250,
    destination: "SMPN 3 Bogor",
    travelMinutes: 20,
  },
];

export const MOCK_SURPLUS_TARGETS: SurplusCandidate[] = [
  { id: "tgt-1", name: "Posyandu Melati (2 km)", kind: "posyandu", travelMinutes: 12, capacityPortions: 120 },
  { id: "tgt-2", name: "SPPG Kelurahan Waru", kind: "sppg", travelMinutes: 25, capacityPortions: 400 },
  { id: "tgt-3", name: "Bank Pangan Jakarta", kind: "bank_pangan", travelMinutes: 48, capacityPortions: 800 },
  { id: "tgt-4", name: "Panti Asuhan Harapan", kind: "panti", travelMinutes: 80, capacityPortions: 200 },
  // Sengaja lewat jendela 4 jam: contoh tujuan yang HARUS ditolak sistem.
  { id: "tgt-5", name: "Panti Sosial Tresna Werdha (3,5 jam)", kind: "panti", travelMinutes: 210, capacityPortions: 300 },
];

export type SampleBankEntry = {
  id: string;
  batchId: string;
  menu: string;
  locationName: string;
  takenAtOffsetMin: number;
  retainHours: number;
  label: string;
};

/** Bank sampel pangan matang — wajib ditahan 2×24 jam untuk investigasi KLB. */
export const MOCK_SAMPLE_BANK: SampleBankEntry[] = [
  {
    id: "SMP-001",
    batchId: "B-2026-1007-A",
    menu: "Sampel A — nasi + ayam",
    locationName: "Chiller sampel dapur Jakarta Utara",
    takenAtOffsetMin: -90,
    retainHours: 48,
    label: "B-2026-1007-A/NAS",
  },
  {
    id: "SMP-002",
    batchId: "B-2026-1007-B",
    menu: "Sampel B — nasi + telur",
    locationName: "Chiller sampel dapur Jakarta Pusat",
    takenAtOffsetMin: -210,
    retainHours: 48,
    label: "B-2026-1007-B/NAS",
  },
  {
    id: "SMP-003",
    batchId: "B-2026-1007-C",
    menu: "Sampel C — mie + bakso",
    locationName: "Chiller sampel dapur Bogor",
    takenAtOffsetMin: -245,
    retainHours: 48,
    label: "B-2026-1007-C/MIE",
  },
];

export const MOCK_AGENT_RUNS: AgentRun[] = [
  { id: "run-001", steps: 8, fallbacks: 0, verifierAgreement: "agree", decisionsApproved: 1, decisionsOverridden: 0, ccpCompliant: true },
  { id: "run-002", steps: 8, fallbacks: 1, verifierAgreement: "agree", decisionsApproved: 1, decisionsOverridden: 0, ccpCompliant: true },
  { id: "run-003", steps: 9, fallbacks: 2, verifierAgreement: "disagree", decisionsApproved: 0, decisionsOverridden: 1, ccpCompliant: true },
  { id: "run-004", steps: 8, fallbacks: 0, verifierAgreement: "unavailable", decisionsApproved: 1, decisionsOverridden: 0, ccpCompliant: true },
  { id: "run-005", steps: 7, fallbacks: 0, verifierAgreement: "agree", decisionsApproved: 0, decisionsOverridden: 0, ccpCompliant: false },
  { id: "run-006", steps: 8, fallbacks: 1, verifierAgreement: "agree", decisionsApproved: 1, decisionsOverridden: 0, ccpCompliant: true },
];

export type MockJourneyRow = {
  eventId: string;
  what: string;
  where: string;
  why: string;
  bizStep: EpcisBizStep;
  offsetMin: number;
  lot: string;
  gtin: string;
  gln: string;
};

/** Jejak satu lot telur dari gudang sampai dapur (bentuk EPCIS). */
export const MOCK_JOURNEY: MockJourneyRow[] = [
  {
    eventId: "evt-1",
    what: "Telur ayam (30 kg)",
    where: "Gudang Cianjur (CV Cianjur Segar)",
    why: "Penerimaan kiriman pemasok untuk dapur Jakarta Utara",
    bizStep: "receiving",
    offsetMin: -300,
    lot: "LOT-20261007-TLR",
    gtin: "08991234500012",
    gln: "1234567890123",
  },
  {
    eventId: "evt-2",
    what: "Telur ayam (30 kg)",
    where: "Dapur SPPG Jakarta Utara",
    why: "Pemeriksaan suhu dan kondisi fisik sebelum penyimpanan",
    bizStep: "inspecting",
    offsetMin: -280,
    lot: "LOT-20261007-TLR",
    gtin: "08991234500012",
    gln: "1234567890124",
  },
  {
    eventId: "evt-3",
    what: "Telur ayam (30 kg)",
    where: "Chiller dapur (3,5 °C)",
    why: "Penyimpanan sesuai FIFO/FEFO",
    bizStep: "storing",
    offsetMin: -270,
    lot: "LOT-20261007-TLR",
    gtin: "08991234500012",
    gln: "1234567890124",
  },
  {
    eventId: "evt-4",
    what: "Batch B-2026-1007-B (nasi + telur balado)",
    where: "SDN 12 Jakarta Pusat",
    why: "Pengiriman batch matang ke sekolah",
    bizStep: "shipping",
    offsetMin: -60,
    lot: "LOT-20261007-TLR",
    gtin: "08991234500012",
    gln: "1234567890125",
  },
];

export function readingsForBatch(batchId: string): CcpReading[] {
  return MOCK_CCP_READINGS.filter((reading) => reading.batchId === batchId);
}

export function journeyEvents(now: number): EpcisEvent[] {
  return MOCK_JOURNEY.map((row) => ({
    eventId: row.eventId,
    what: row.what,
    where: row.where,
    when: fromOffset(now, row.offsetMin),
    why: row.why,
    bizStep: row.bizStep,
    lot: row.lot,
    gtin: row.gtin,
    gln: row.gln,
  }));
}
