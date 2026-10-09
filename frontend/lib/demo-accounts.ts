/**
 * Akun demo di halaman login — SATU sumber untuk UI dan mode mock.
 *
 * Emailnya wajib sama dengan seed backend (`backend/app/db_seed.py`; docs/design.md §1.5). Tombol
 * "klik untuk langsung masuk" memakai jalur login yang sama dengan form, jadi begitu
 * `NEXT_PUBLIC_USE_MOCK=false`, email yang berbeda = login gagal tepat di depan juri.
 * `lib/demo-accounts.test.ts` menahan daftar ini agar tidak menyimpang dari mock & dokumen.
 *
 * Password demo BUKAN rahasia: nilainya memang ditampilkan di halaman login (docs/design.md §1.5).
 */
export type DemoAccount = {
  /** Peran mesin (`JwtPayload["role"]`) — dipakai test untuk mencocokkan mock & backend. */
  role: "sppg_head" | "sppg_nutritionist" | "bgn_monitor";
  /** Label yang dilihat pengguna. */
  label: string;
  username: string;
  password: string;
  detail: string;
  recommended: boolean;
};

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    role: "sppg_head",
    label: "Kepala SPPG",
    username: "sppg.head@demo.local",
    password: "Demo#SPPG2026",
    // Label mengikuti CAKUPAN yang benar-benar berlaku di UI (mode mock: `MOCK_USERS` di
    // lib/mock-data.ts). Cakupan data backend belum memakai kosakata yang sama
    // (region backend masih "West"/"Central", lokasinya Cianjur/Jakarta saja) — lihat TODO.
    detail: "DKI Jakarta · bisa approve",
    recommended: true,
  },
  {
    role: "sppg_nutritionist",
    label: "Ahli Gizi SPPG",
    username: "sppg.nutritionist@demo.local",
    password: "Demo#Nut2026",
    detail: "Jawa Barat (Bogor) · bisa approve",
    recommended: false,
  },
  {
    role: "bgn_monitor",
    label: "Monitor BGN",
    username: "bgn.monitor@demo.local",
    password: "Demo#BGN2026",
    detail: "Semua wilayah · read-only",
    recommended: false,
  },
];
