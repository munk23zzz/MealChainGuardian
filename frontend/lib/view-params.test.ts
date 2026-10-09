import { describe, expect, it } from "vitest";
import { matchParamToIds, setQueryParam } from "./view-params";

describe("matchParamToIds", () => {
  const ids = ["B-2026-1007-A", "B-2026-1007-B"];

  it("mengembalikan id yang memang ada di daftar", () => {
    expect(matchParamToIds("B-2026-1007-B", ids)).toBe("B-2026-1007-B");
  });

  it("menolak id di luar daftar (cakupan peran tidak bisa ditembus lewat URL)", () => {
    // Batch C milik wilayah lain: parameter URL tidak boleh membuatnya tampil.
    expect(matchParamToIds("B-2026-1007-C", ids)).toBeNull();
  });

  it("menolak nilai kosong, spasi, dan null", () => {
    expect(matchParamToIds("", ids)).toBeNull();
    expect(matchParamToIds("   ", ids)).toBeNull();
    expect(matchParamToIds(null, ids)).toBeNull();
    expect(matchParamToIds(undefined, ids)).toBeNull();
  });

  it("menerima id yang sah walau ada spasi di ujung (tautan yang tertempel)", () => {
    expect(matchParamToIds(" B-2026-1007-A ", ids)).toBe("B-2026-1007-A");
  });
});

describe("setQueryParam", () => {
  it("menambah parameter ke query kosong", () => {
    expect(setQueryParam("", "batch", "B-1")).toBe("?batch=B-1");
  });

  it("mengganti parameter yang sudah ada tanpa menggandakan", () => {
    expect(setQueryParam("?batch=B-1", "batch", "B-2")).toBe("?batch=B-2");
  });

  it("mempertahankan parameter lain", () => {
    expect(setQueryParam("?tab=ccp", "batch", "B-1")).toBe("?tab=ccp&batch=B-1");
  });

  it("menghapus parameter saat nilainya null/kosong", () => {
    expect(setQueryParam("?tab=ccp&batch=B-1", "batch", null)).toBe("?tab=ccp");
    expect(setQueryParam("?batch=B-1", "batch", "")).toBe("");
  });

  it("menerima query string tanpa tanda tanya", () => {
    expect(setQueryParam("batch=B-1", "batch", "B-3")).toBe("?batch=B-3");
  });
});
