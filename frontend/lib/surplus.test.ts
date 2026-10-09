import { describe, expect, it } from "vitest";
import { TARGET_KIND_LABELS, candidateLabel, planSurplus, type SurplusCandidate } from "@/lib/surplus";

const HOUR = 3_600_000;
const MIN = 60_000;
const T0 = 1_700_000_000_000;

const target = (
  id: string,
  travelMinutes: number,
  capacityPortions: number,
): SurplusCandidate => ({
  id,
  name: `Tujuan ${id}`,
  kind: "posyandu",
  travelMinutes,
  capacityPortions,
});

describe("planSurplus", () => {
  it("memilih tujuan terdekat yang masih di dalam jendela aman", () => {
    const plan = planSurplus({
      surplusPortions: 50,
      cookedAt: T0,
      now: T0 + HOUR,
      candidates: [target("jauh", 90, 100), target("dekat", 20, 30)],
    });
    expect(plan.recommended?.candidate.id).toBe("dekat");
    expect(plan.allocatedPortions).toBe(50);
    expect(plan.unallocatedPortions).toBe(0);
    expect(plan.reason).toContain("Tujuan dekat");
  });

  it("mengalokasikan bertahap bila kapasitas tujuan terdekat tidak cukup", () => {
    const plan = planSurplus({
      surplusPortions: 80,
      cookedAt: T0,
      now: T0 + HOUR,
      candidates: [target("a", 10, 30), target("b", 20, 30), target("c", 30, 25)],
    });
    expect(plan.rows.map((r) => r.acceptedPortions)).toEqual([30, 30, 20]);
    expect(plan.allocatedPortions).toBe(80);
    expect(plan.unallocatedPortions).toBe(0);
  });

  it("melewati tujuan yang akan tiba setelah batas 4 jam", () => {
    const plan = planSurplus({
      surplusPortions: 40,
      cookedAt: T0,
      now: T0 + 3 * HOUR + 30 * MIN,
      candidates: [target("telat", 45, 100), target("masih", 15, 100)],
    });
    const late = plan.rows.find((r) => r.candidate.id === "telat");
    expect(late?.withinWindow).toBe(false);
    expect(late?.acceptedPortions).toBe(0);
    expect(plan.recommended?.candidate.id).toBe("masih");
  });

  it("sisa yang tidak teralokasi dicatat sebagai kewajiban penanganan", () => {
    const plan = planSurplus({
      surplusPortions: 120,
      cookedAt: T0,
      now: T0 + HOUR,
      candidates: [target("a", 10, 40)],
    });
    expect(plan.allocatedPortions).toBe(40);
    expect(plan.unallocatedPortions).toBe(80);
    expect(plan.wasteNote).toContain("80 porsi");
    expect(plan.wasteNote).toContain("PerBGN 1/2026");
  });

  it("tanpa kandidat atau tanpa surplus: tidak ada rekomendasi", () => {
    const empty = planSurplus({ surplusPortions: 30, cookedAt: T0, now: T0, candidates: [] });
    expect(empty.recommended).toBeNull();
    expect(empty.reason).toContain("jendela aman");

    const none = planSurplus({ surplusPortions: 0, cookedAt: T0, now: T0, candidates: [target("a", 5, 10)] });
    expect(none.recommended).toBeNull();
    expect(none.reason).toBe("Tidak ada surplus hari ini");
    expect(none.tone).toBe("safe");
  });

  it("surplus negatif diperlakukan sebagai nol", () => {
    const plan = planSurplus({ surplusPortions: -5, cookedAt: T0, now: T0, candidates: [] });
    expect(plan.allocatedPortions).toBe(0);
    expect(plan.unallocatedPortions).toBe(0);
  });

  it("tone mengikuti sisa jendela pada saat tiba", () => {
    const safe = planSurplus({
      surplusPortions: 10,
      cookedAt: T0,
      now: T0,
      candidates: [target("a", 30, 10)],
    });
    expect(safe.tone).toBe("safe");

    const tight = planSurplus({
      surplusPortions: 10,
      cookedAt: T0,
      now: T0 + 3 * HOUR + 40 * MIN,
      candidates: [target("a", 10, 10)],
    });
    expect(tight.tone).toBe("danger");
  });
});

describe("label", () => {
  it("menyusun label tujuan", () => {
    expect(candidateLabel(target("a", 5, 5))).toBe("Tujuan a · Posyandu");
    expect(TARGET_KIND_LABELS.bank_pangan).toBe("Bank pangan");
    expect(TARGET_KIND_LABELS.panti).toBe("Panti asuhan");
  });
});

describe("catatan baris", () => {
  it("membedakan tiga keadaan: dapat porsi, jendela aman tapi porsi habis, dan lewat jendela", () => {
    const plan = planSurplus({
      surplusPortions: 10,
      cookedAt: T0,
      now: T0,
      candidates: [target("dekat", 10, 10), target("jauh", 10, 10), target("lewat", 300, 10)],
    });

    const [dekat, jauh, lewat] = plan.rows;
    expect(dekat.acceptedPortions).toBe(10);
    expect(dekat.note).toBe("Dalam jendela 4 jam saat tiba");
    expect(jauh.acceptedPortions).toBe(0);
    expect(jauh.note).toContain("porsi sudah teralokasi");
    expect(lewat.withinWindow).toBe(false);
    expect(lewat.note).toContain("catat sebagai limbah");
  });
});
