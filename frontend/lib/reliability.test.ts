import { describe, it, expect } from "vitest";
import {
  LEARN_WINDOW,
  applyLearn,
  reliabilitySeries,
  reliabilityTone,
  successRate,
  type DeliveryOutcome,
} from "./reliability";

/**
 * Bukti LEARN (Skill.md §10, design.md §3.9c): skor kepercayaan pemasok
 * diperbarui deterministik dari `decisions.outcome` — bukan retraining model.
 * Formula acuan: clamp(0.5 × lama + 0.5 × success_rate_N_terakhir, 0, 1).
 */

const outcomes = (...values: DeliveryOutcome[]) => values;

describe("successRate", () => {
  it("menghitung rasio sukses dari histori yang diberikan", () => {
    expect(successRate(outcomes("success", "success", "failure", "success"))).toBe(
      0.75,
    );
  });

  it("tanpa histori → 0 (tidak mengarang angka)", () => {
    expect(successRate([])).toBe(0);
  });
});

describe("applyLearn", () => {
  it("memakai formula dokumen: 0,5 × lama + 0,5 × success_rate", () => {
    // 0,5 × 0,8 + 0,5 × 0,75 = 0,775
    expect(
      applyLearn(0.8, outcomes("success", "success", "failure", "success")),
    ).toBeCloseTo(0.775, 5);
  });

  it("semua sukses menaikkan skor, semua gagal menurunkannya", () => {
    const up = applyLearn(0.8, outcomes("success", "success"));
    const down = applyLearn(0.8, outcomes("failure", "failure"));
    expect(up).toBeGreaterThan(0.8);
    expect(down).toBeLessThan(0.8);
  });

  it("skor tetap terjepit di antara 0 dan 1 (clamp)", () => {
    expect(applyLearn(0.99, outcomes("success", "success"))).toBeLessThanOrEqual(1);
    expect(applyLearn(0.02, outcomes("failure", "failure"))).toBeGreaterThanOrEqual(
      0,
    );
  });

  it("hanya memakai LEARN_WINDOW hasil terakhir", () => {
    // 6 gagal lama lalu 6 sukses: window 5 terakhir semuanya sukses → skor naik.
    // (Kalau rata-rata sepanjang masa dipakai, hasilnya 0,5 → skor turun.)
    const gagalLama = outcomes(...Array<DeliveryOutcome>(6).fill("failure"));
    const suksesBaru = outcomes(...Array<DeliveryOutcome>(6).fill("success"));
    expect(LEARN_WINDOW).toBe(5);
    expect(applyLearn(0.8, [...gagalLama, ...suksesBaru])).toBeGreaterThan(0.8);
    expect(applyLearn(0.8, [...gagalLama, ...suksesBaru])).toBeCloseTo(0.9, 5);
  });

  it("tanpa histori → skor tidak berubah (tidak ada dasar untuk menghukum)", () => {
    expect(applyLearn(0.8, [])).toBe(0.8);
  });
});

describe("reliabilitySeries", () => {
  const events = [
    { at: "2026-10-01T08:00:00.000Z", outcome: "success" as DeliveryOutcome },
    { at: "2026-10-03T08:00:00.000Z", outcome: "failure" as DeliveryOutcome },
    { at: "2026-10-05T08:00:00.000Z", outcome: "success" as DeliveryOutcome },
  ];

  it("mengembalikan titik awal (skor awal) lalu satu titik per kejadian", () => {
    const series = reliabilitySeries(0.8, events);
    expect(series).toHaveLength(events.length + 1);
    expect(series[0].score).toBe(0.8);
    expect(series[0].outcome).toBeNull();
  });

  it("bergerak menuju success rate window terakhir (rumus dokumen, per kejadian)", () => {
    const series = reliabilitySeries(0.8, events);
    // 0,5×0,8 + 0,5×1,00 = 0,90
    expect(series[1].score).toBeCloseTo(0.9, 5);
    // 0,5×0,90 + 0,5×0,50 = 0,70  (window [S,F])
    expect(series[2].score).toBeCloseTo(0.7, 5);
    // 0,5×0,70 + 0,5×0,667 = 0,683 (window [S,F,S]) — masih turun karena skor
    // sekarang di atas tingkat sukses terkini; ini perilaku dokumen, bukan bug.
    expect(series[3].score).toBeCloseTo(0.683, 3);
  });

  it("skor naik ketika tingkat sukses terkini di atas skor sekarang", () => {
    const naik = reliabilitySeries(0.6, [
      { at: "2026-10-01T08:00:00.000Z", outcome: "success", decisionId: "d-1" },
      { at: "2026-10-02T08:00:00.000Z", outcome: "success", decisionId: "d-2" },
    ]);
    expect(naik[2].score).toBeGreaterThan(naik[0].score);
  });

  it("menandai titik yang merupakan insiden (dipakai untuk marker di grafik)", () => {
    const series = reliabilitySeries(0.8, events);
    expect(series[2].isIncident).toBe(true);
    expect(series[1].isIncident).toBe(false);
  });

  it("urutan output mengikuti waktu, bukan urutan input", () => {
    const series = reliabilitySeries(0.8, [events[2], events[0], events[1]]);
    expect(series[1].at).toBe(events[0].at);
    expect(series[3].at).toBe(events[2].at);
  });

  it("skor akhir sama dengan applyLearn berulang (deterministik, bukan tebakan)", () => {
    const series = reliabilitySeries(0.8, events);
    // Semantik: tiap titik = applyLearn(0.5×sebelumnya + 0.5×success_rate window).
    const s1 = applyLearn(0.8, [events[0].outcome]);
    const s2 = applyLearn(s1, events.slice(0, 2).map((e) => e.outcome));
    const s3 = applyLearn(s2, events.map((e) => e.outcome));
    expect(series[series.length - 1].score).toBeCloseTo(s3, 5);
  });
});

describe("reliabilityTone", () => {
  it("memetakan skor ke nada status yang dipakai UI", () => {
    expect(reliabilityTone(0.92)).toBe("safe");
    expect(reliabilityTone(0.85)).toBe("safe");
    expect(reliabilityTone(0.78)).toBe("warning");
    expect(reliabilityTone(0.7)).toBe("warning");
    expect(reliabilityTone(0.55)).toBe("danger");
  });
});
