/**
 * Pemetaan wilayah demo + penyaringan batch per cakupan peran.
 *
 * Yang dijaga:
 * 1. Batch mock (tujuan = nama sekolah) harus bisa dipetakan ke wilayah; satu batch yang
 *    tujuannya tak dikenali berarti ia HILANG dari semua layar peran wilayah — jadi tes
 *    terakhir menuntut setiap batch demo punya wilayah.
 * 2. Peran wilayah hanya melihat wilayahnya; monitor BGN melihat semua.
 * 3. Peran satu lokasi (sppg_staff) TIDAK melihat semua batch hanya karena wilayahnya
 *    cocok — nama wilayah bukan bukti lokasi.
 */
import { describe, expect, it } from "vitest";

import { MOCK_BATCHES } from "./mock-compliance";
import { DESTINATION_REGION_KEYWORDS, partitionBatchesByScope, regionForDestination } from "./region-map";
import { isRegionInScope, partitionByScope } from "./scope";
import type { DataScope } from "./role";

describe("regionForDestination", () => {
  it("mengenali wilayah dari nama tujuan pengiriman", () => {
    expect(regionForDestination("SDN 05 Jakarta Utara")).toBe("DKI Jakarta");
    expect(regionForDestination("SDN 12 Jakarta Pusat")).toBe("DKI Jakarta");
    expect(regionForDestination("SMPN 3 Bogor")).toBe("Jawa Barat");
    expect(regionForDestination("SMA 1 Tangerang")).toBe("Banten");
  });

  it("tidak peduli huruf besar/kecil", () => {
    expect(regionForDestination("sdn 2 depok")).toBe("Jawa Barat");
  });

  it("tujuan di luar Jabodetabek tidak dipaksa masuk wilayah", () => {
    expect(regionForDestination("SDN 1 Makassar")).toBeNull();
  });

  it("kata kunci hanya memakai nama wilayah yang ada di dataset demo", () => {
    const regionDemo = new Set(["DKI Jakarta", "Jawa Barat", "Banten"]);
    for (const entry of DESTINATION_REGION_KEYWORDS) {
      expect(regionDemo.has(entry.region)).toBe(true);
    }
  });
});

describe("isRegionInScope", () => {
  it("monitor (semua wilayah) melihat semuanya", () => {
    expect(isRegionInScope("DKI Jakarta", { kind: "all" })).toBe(true);
    expect(isRegionInScope(null, { kind: "all" })).toBe(true);
  });

  it("peran wilayah hanya cocok dengan wilayahnya sendiri", () => {
    const scope: DataScope = { kind: "region", region: "Jawa Barat" };
    expect(isRegionInScope("Jawa Barat", scope)).toBe(true);
    expect(isRegionInScope("DKI Jakarta", scope)).toBe(false);
  });

  it("wilayah tak diketahui dan cakupan satu lokasi ditolak (gagal-tertutup)", () => {
    expect(isRegionInScope(null, { kind: "region", region: "Jawa Barat" })).toBe(false);
    expect(isRegionInScope("DKI Jakarta", { kind: "location", locationId: "loc-2" })).toBe(false);
  });
});

describe("partitionBatchesByScope", () => {
  const scope = (over: DataScope): DataScope => over;

  it("kepala SPPG DKI Jakarta hanya melihat batch DKI Jakarta", () => {
    const hasil = partitionBatchesByScope(MOCK_BATCHES, scope({ kind: "region", region: "DKI Jakarta" }));
    expect(hasil.inScope.map((b) => b.id)).toEqual(["B-2026-1007-A", "B-2026-1007-B"]);
    expect(hasil.outOfScope.map((b) => b.id)).toEqual(["B-2026-1007-C"]);
  });

  it("ahli gizi Jawa Barat hanya melihat batch Jawa Barat", () => {
    const hasil = partitionBatchesByScope(MOCK_BATCHES, scope({ kind: "region", region: "Jawa Barat" }));
    expect(hasil.inScope.map((b) => b.id)).toEqual(["B-2026-1007-C"]);
    expect(hasil.outOfScope).toHaveLength(2);
  });

  it("monitor BGN melihat semua batch", () => {
    const hasil = partitionBatchesByScope(MOCK_BATCHES, scope({ kind: "all" }));
    expect(hasil.inScope).toHaveLength(MOCK_BATCHES.length);
    expect(hasil.outOfScope).toHaveLength(0);
  });

  it("peran satu lokasi tidak melihat batch mana pun lewat pencocokan wilayah", () => {
    const hasil = partitionBatchesByScope(MOCK_BATCHES, scope({ kind: "location", locationId: "loc-2" }));
    expect(hasil.inScope).toHaveLength(0);
    expect(hasil.outOfScope).toHaveLength(MOCK_BATCHES.length);
  });

  it("memakai partitionByScope: tidak membuang apa pun", () => {
    const { inScope, outOfScope } = partitionBatchesByScope(MOCK_BATCHES, scope({ kind: "all" }));
    const total = partitionByScope(MOCK_BATCHES, () => true);
    expect(inScope.length + outOfScope.length).toBe(total.inScope.length);
  });

  it("setiap batch demo punya wilayah yang dikenali", () => {
    for (const batch of MOCK_BATCHES) {
      expect(
        regionForDestination(batch.destination),
        `batch ${batch.id} (${batch.destination}) tidak bisa dipetakan ke wilayah`,
      ).not.toBeNull();
    }
  });
});
