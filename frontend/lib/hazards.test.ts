import { describe, expect, it } from "vitest";
import {
  COMMODITY_HAZARDS,
  HAZARDS,
  commodityRisk,
  hazardsForCommodity,
  prioritizeCommodities,
  riskMatrix,
} from "@/lib/hazards";

describe("katalog bahaya", () => {
  it("empat bahaya dengan catatan sumber", () => {
    expect(HAZARDS.map((h) => h.id).sort()).toEqual([
      "bacillus",
      "e_coli",
      "salmonella",
      "staph",
    ]);
    expect(HAZARDS.every((h) => h.note.length > 0)).toBe(true);
  });

  it("setiap baris matriks menunjuk bahaya yang ada", () => {
    const ids = new Set(HAZARDS.map((h) => h.id));
    expect(COMMODITY_HAZARDS.every((row) => ids.has(row.hazard))).toBe(true);
  });
});

describe("hazardsForCommodity", () => {
  it("mencocokkan tanpa peduli huruf besar/kecil dan spasi", () => {
    expect(hazardsForCommodity("  ayam ").length).toBe(2);
    expect(hazardsForCommodity("AYAM").length).toBe(2);
    expect(hazardsForCommodity("telur").length).toBe(1);
  });

  it("komoditas tak dikenal menghasilkan daftar kosong", () => {
    expect(hazardsForCommodity("wagyu").length).toBe(0);
  });
});

describe("commodityRisk", () => {
  it("ayam = tinggi (E. coli + Salmonella)", () => {
    const risk = commodityRisk("Ayam");
    expect(risk.level).toBe("tinggi");
    expect(risk.tone).toBe("danger");
    expect(risk.hazards.map((h) => h.id).sort()).toEqual(["e_coli", "salmonella"]);
  });

  it("sayur = sedang", () => {
    expect(commodityRisk("Sayur").level).toBe("sedang");
    expect(commodityRisk("Sayur").tone).toBe("warning");
  });

  it("komoditas tanpa riwayat = rendah dan aman", () => {
    const risk = commodityRisk("Kentang");
    expect(risk.level).toBe("rendah");
    expect(risk.tone).toBe("safe");
    expect(risk.hazards).toEqual([]);
  });
});

describe("prioritizeCommodities", () => {
  it("menaruh risiko tinggi di depan dan yang tak dikenal di belakang", () => {
    const order = prioritizeCommodities(["Kentang", "Sayur", "Telur", "Ayam"]).map(
      (r) => r.commodity,
    );
    expect(order[0]).toBe("Ayam");
    expect(order[order.length - 1]).toBe("Kentang");
  });
});

describe("riskMatrix", () => {
  it("satu baris per bahaya dengan komoditasnya", () => {
    const matrix = riskMatrix();
    expect(matrix).toHaveLength(4);
    const eColi = matrix.find((m) => m.hazard.id === "e_coli");
    expect(eColi?.rows.map((r) => r.commodity)).toContain("Nasi");
  });
});
