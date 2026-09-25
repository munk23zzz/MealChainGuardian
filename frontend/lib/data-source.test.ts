import { describe, it, expect } from "vitest";
import {
  DATA_SOURCE_HEADER,
  dataSourceLabel,
  isMockMode,
  shouldShowDataSourceBadge,
} from "./data-source";

/**
 * Rules.md §1.4: data dari mock SAP WAJIB ditandai jelas di UI. Test ini menjaga
 * supaya penandaan tidak bisa hilang tanpa sengaja.
 */
describe("dataSourceLabel", () => {
  it("mock ditandai 'Data Simulasi' (bukan diam-diam tampil seperti SAP asli)", () => {
    expect(dataSourceLabel("MOCK")).toBe("Data Simulasi");
  });

  it("data live punya label yang berbeda dan eksplisit", () => {
    expect(dataSourceLabel("LIVE")).toBe("SAP (live)");
  });
});

describe("shouldShowDataSourceBadge", () => {
  it("badge wajib muncul untuk data mock", () => {
    expect(shouldShowDataSourceBadge("MOCK")).toBe(true);
  });

  it("badge tidak muncul untuk data live", () => {
    expect(shouldShowDataSourceBadge("LIVE")).toBe(false);
  });
});

describe("isMockMode", () => {
  it("hanya true kalau env var persis 'true'", () => {
    expect(isMockMode("true")).toBe(true);
    expect(isMockMode("false")).toBe(false);
    expect(isMockMode("1")).toBe(false);
    expect(isMockMode(undefined)).toBe(false);
    expect(isMockMode("")).toBe(false);
  });
});

describe("DATA_SOURCE_HEADER", () => {
  it("selaras dengan header X-Data-Source di Rules.md §1.4", () => {
    expect(DATA_SOURCE_HEADER).toBe("X-Data-Source");
  });
});
