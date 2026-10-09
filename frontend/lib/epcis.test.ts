import { describe, expect, it } from "vitest";
import {
  BIZ_STEP_LABELS,
  buildEpcisEvent,
  groupByLot,
  sortByTime,
  validateEpcisEvent,
  type EpcisEvent,
} from "@/lib/epcis";

const base = (over: Partial<EpcisEvent> = {}): EpcisEvent =>
  buildEpcisEvent({
    eventId: "evt-1",
    what: "Telur (30 kg)",
    where: "Gudang Cianjur",
    when: 1_700_000_000_000,
    why: "Penerimaan kiriman pemasok SUP-005",
    bizStep: "receiving",
    lot: "LOT-20261007-A",
    gtin: "08991234500012",
    gln: "1234567890123",
    ...over,
  });

describe("validateEpcisEvent", () => {
  it("kejadian lengkap dianggap sah", () => {
    expect(validateEpcisEvent(base())).toEqual([]);
  });

  it("kejadian tanpa lot tetap sah (lot opsional)", () => {
    expect(validateEpcisEvent(base({ lot: undefined }))).toEqual([]);
  });

  it("menandai field wajib yang kosong", () => {
    const problems = validateEpcisEvent(base({ what: "  ", why: "" }));
    expect(problems.some((p) => p.includes("what"))).toBe(true);
    expect(problems.some((p) => p.includes("why"))).toBe(true);
  });

  it("menolak format gtin/lot/gln yang salah", () => {
    expect(validateEpcisEvent(base({ gtin: "abc" })).some((p) => p.includes("gtin"))).toBe(true);
    expect(validateEpcisEvent(base({ lot: "a" })).some((p) => p.includes("lot"))).toBe(true);
    expect(validateEpcisEvent(base({ gln: "123" })).some((p) => p.includes("gln"))).toBe(true);
  });

  it("menolak waktu yang tidak masuk akal", () => {
    expect(validateEpcisEvent(base({ when: 0 })).length).toBe(1);
    expect(validateEpcisEvent(base({ when: Number.NaN })).length).toBe(1);
  });
});

describe("sortByTime & groupByLot", () => {
  const early = base({ eventId: "e1", when: 1, lot: "LOT-A" });
  const late = base({ eventId: "e2", when: 5, lot: "LOT-A" });
  const other = base({ eventId: "e3", when: 3, lot: "LOT-B" });

  it("mengurutkan tanpa mengubah masukan", () => {
    const input = [late, early];
    expect(sortByTime(input).map((e) => e.eventId)).toEqual(["e1", "e2"]);
    expect(input[0].eventId).toBe("e2");
  });

  it("mengelompokkan per lot dan mengurutkan di dalam grup", () => {
    const groups = groupByLot([late, other, early]);
    expect(groups.map((g) => g.lot).sort()).toEqual(["LOT-A", "LOT-B"]);
    expect(groups.find((g) => g.lot === "LOT-A")?.events.map((e) => e.eventId)).toEqual([
      "e1",
      "e2",
    ]);
  });

  it("kejadian tanpa lot masuk kelompok tersendiri", () => {
    const groups = groupByLot([base({ lot: undefined, eventId: "x" })]);
    expect(groups[0].lot).toBe("(tanpa lot)");
  });
});

describe("label langkah bisnis", () => {
  it("Bahasa Indonesia untuk semua langkah", () => {
    expect(BIZ_STEP_LABELS.receiving).toBe("Penerimaan");
    expect(BIZ_STEP_LABELS.consuming).toBe("Konsumsi");
    expect(Object.keys(BIZ_STEP_LABELS)).toHaveLength(5);
  });
});
