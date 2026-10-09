/**
 * Skenario demo (murni) — satu hari di SPPG, dari bahan datang sampai batas
 * 4 jam. Dipakai bilah demo (?demo=1) dan tur terpandu saat presentasi.
 *
 * Prinsip: mode demo TIDAK memalsukan data. Ia hanya menyorot bagian yang sudah
 * ada dan menjelaskan urutannya — supaya tidak ada klaim palsu saat presentasi.
 */

export type DemoHighlight =
  | "ccp"
  | "four-hour"
  | "decisions"
  | "receiving"
  | "surplus"
  | "quality"
  | "none";

export type DemoStep = {
  id: string;
  clock: string;
  title: string;
  detail: string;
  href: string;
  highlight: DemoHighlight;
  source: string;
};

export const DEMO_STEPS: DemoStep[] = [
  {
    id: "step-1",
    clock: "04:30",
    title: "Bahan datang di dapur SPPG",
    detail:
      "Suhu chiller, freezer, dan waktu bongkar dicatat. Belum ada pengukuran = tidak dianggap aman.",
    href: "/compliance",
    highlight: "ccp",
    source: "Ambang Kemenkes (chiller ≤ 4 °C, beku ≤ −18 °C)",
  },
  {
    id: "step-2",
    clock: "09:00",
    title: "Agen mendeteksi risiko",
    detail:
      "Stok menipis + riwayat bahaya komoditas memunculkan peringatan sebelum masalahnya terjadi.",
    href: "/dashboard",
    highlight: "decisions",
    source: "Data simulasi + matriks komoditas × bahaya (temuan BGN)",
  },
  {
    id: "step-3",
    clock: "10:15",
    title: "Usulan keputusan + pendapat kedua",
    detail:
      "Agen menyusun opsi, lalu verifier independen memberi pendapat kedua. Jika verifier tidak tersedia, keputusan tidak diteruskan sendiri.",
    href: "/decisions",
    highlight: "decisions",
    source: "Aturan fallback Architecture.md §10",
  },
  {
    id: "step-4",
    clock: "11:00",
    title: "Manusia menyetujui",
    detail:
      "Persetujuan berjenjang: hanya peran dengan hak di wilayah tujuan. Setiap persetujuan tercatat sebagai bukti.",
    href: "/decisions",
    highlight: "decisions",
    source: "RBAC + approval berjenjang (Schema.md §6)",
  },
  {
    id: "step-5",
    clock: "14:00",
    title: "Batas 4 jam & surplus",
    detail:
      "Jendela masak→konsumsi dipantau; sisa pangan yang masih aman dialihkan, sisanya dicatat penanganannya.",
    href: "/surplus",
    highlight: "four-hour",
    source: "BGN (maks 4 jam) + Peraturan BGN 1/2026 (sisa pangan & limbah)",
  },
];

export function stepAt(index: number): DemoStep | null {
  return DEMO_STEPS[index] ?? null;
}

export function nextStep(index: number): number {
  return Math.min(index + 1, DEMO_STEPS.length - 1);
}

export function previousStep(index: number): number {
  return Math.max(0, index - 1);
}

export function demoHref(index: number): string {
  return `/dashboard?demo=1&step=${index}`;
}

/** Membaca ?demo=1&step=N dari query string tanpa hooks (aman untuk layout). */
export function parseDemoQuery(search: string): { enabled: boolean; step: number } {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const raw = params.get("demo");
  const enabled = raw === "1" || raw === "true";
  const parsedStep = Number.parseInt(params.get("step") ?? "", 10);
  const step =
    Number.isFinite(parsedStep) && parsedStep >= 0 && parsedStep < DEMO_STEPS.length
      ? parsedStep
      : 0;
  return { enabled, step };
}
