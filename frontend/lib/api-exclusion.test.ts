/**
 * Eksklusi pemasok di sisi frontend (`Rules.md` §1.2).
 *
 * Yang dijaga di sini: UI hanya MENGUSULKAN. `suppliers.status` tidak berubah sebelum keputusan
 * disetujui, dan eksekusi menolak keputusan yang belum `approved` — hukuman yang sama dengan
 * penjaga di backend (`POST /actions/exclude`).
 *
 * Mode mock dipaksa lewat env SEBELUM `lib/api` diimpor, karena `USE_MOCK` dibaca saat modul dimuat.
 * Impor-nya dinamis (di dalam test) supaya urutannya pasti dan tidak perlu top-level await — modul
 * tetap di-cache, jadi ongkosnya nihil setelah panggilan pertama.
 */
import { beforeEach, describe, expect, it } from "vitest";

process.env.NEXT_PUBLIC_USE_MOCK = "true";

const ALASAN = "Dua pengiriman terakhir gagal inspeksi suhu dan mutu.";

const api = () => import("./api");
const mockSuppliers = async () => (await import("./mock-data")).MOCK_SUPPLIERS;

/** Keadaan mock adalah objek modul yang hidup — dikembalikan bersih sebelum tiap test. */
beforeEach(async () => {
  for (const supplier of await mockSuppliers()) {
    supplier.status = "active";
    supplier.excludedAt = null;
    supplier.exclusionReason = null;
  }
});

describe("usulan eksklusi pemasok", () => {
  it("mencatat keputusan pending_approval tanpa mengubah pemasok", async () => {
    const { getSuppliers, proposeSupplierExclusion } = await api();
    const supplier = (await mockSuppliers())[0];

    const decision = await proposeSupplierExclusion(supplier.id, ALASAN);

    expect(decision.decisionType).toBe("supplier_exclusion");
    expect(decision.status).toBe("pending_approval");
    expect(decision.supplierId).toBe(supplier.id);
    expect(decision.supplierName).toBe(supplier.name);
    expect(decision.exclusionReason).toBe(ALASAN);
    // Inti aturannya: usulan saja belum mengecualikan siapa pun.
    const tersimpan = (await getSuppliers()).find((s) => s.id === supplier.id);
    expect(tersimpan?.status).toBe("active");
    expect(tersimpan?.exclusionReason).toBeNull();
  });

  it("menolak alasan yang terlalu pendek", async () => {
    const { proposeSupplierExclusion } = await api();
    const supplier = (await mockSuppliers())[0];

    await expect(proposeSupplierExclusion(supplier.id, "-")).rejects.toThrow(/minimal/i);
  });

  it("menolak pemasok yang sudah dikecualikan", async () => {
    const { proposeSupplierExclusion } = await api();
    const supplier = (await mockSuppliers())[0];
    supplier.status = "excluded";
    supplier.excludedAt = new Date().toISOString();
    supplier.exclusionReason = ALASAN;

    await expect(proposeSupplierExclusion(supplier.id, ALASAN)).rejects.toThrow(
      /sudah dikecualikan/i,
    );
  });
});

describe("eksekusi eksklusi", () => {
  it("ditolak sebelum disetujui (tidak ada auto-execute)", async () => {
    const { excludeSupplier, getSuppliers, proposeSupplierExclusion } = await api();
    const supplier = (await mockSuppliers())[0];
    const decision = await proposeSupplierExclusion(supplier.id, ALASAN);

    await expect(excludeSupplier(decision.id)).rejects.toThrow(/disetujui/i);
    const tersimpan = (await getSuppliers()).find((s) => s.id === supplier.id);
    expect(tersimpan?.status).toBe("active");
  });

  it("setelah approve: pemasok jadi excluded dengan alasan dan waktu", async () => {
    const { approveDecision, excludeSupplier, getSuppliers, proposeSupplierExclusion } =
      await api();
    const supplier = (await mockSuppliers())[0];
    const decision = await proposeSupplierExclusion(supplier.id, ALASAN);
    await approveDecision(decision.id);

    const hasil = await excludeSupplier(decision.id);

    expect(hasil.status).toBe("executed");
    expect(hasil.executedAt).toBeTruthy();
    const tersimpan = (await getSuppliers()).find((s) => s.id === supplier.id);
    expect(tersimpan?.status).toBe("excluded");
    expect(tersimpan?.exclusionReason).toBe(ALASAN);
    expect(tersimpan?.excludedAt).toBeTruthy();
  });

  it("menolak keputusan yang bukan usulan eksklusi", async () => {
    const { excludeSupplier, getDecisions } = await api();
    const biasa = (await getDecisions()).find((d) => d.decisionType !== "supplier_exclusion");
    expect(biasa).toBeDefined();

    await expect(excludeSupplier(biasa!.id)).rejects.toThrow(/bukan usulan eksklusi/i);
  });
});
