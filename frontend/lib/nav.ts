/**
 * Daftar navigasi bersama (murni) — satu sumber untuk sidebar & command palette.
 * Ikon sengaja TIDAK di sini (ikon = urusan komponen); yang diuji adalah urutan,
 * label, dan pembatasan peran.
 */

import type { Role } from "@/lib/api/schema";

export type NavItem = {
  href: string;
  label: string;
  /** Kosong = tampil untuk semua peran (design.md §1.4). */
  roles?: Role[];
  /** Ditampilkan di mode lapangan (mobile) sebagai prioritas. */
  field?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", field: true },
  { href: "/today", label: "Hari Ini", field: true },
  { href: "/decisions", label: "Keputusan", field: true },
  { href: "/compliance", label: "Keamanan Pangan", field: true },
  { href: "/surplus", label: "Surplus & Limbah", roles: ["sppg_head", "sppg_nutritionist"] },
  { href: "/suppliers", label: "Pemasok" },
  { href: "/agent-log", label: "Agent Log" },
  { href: "/quality", label: "Kualitas Agen" },
  { href: "/kpi", label: "KPI" },
  // `Sumber Data` (/sources) SENGAJA tidak ada di daftar ini (keputusan Roy, 9 Okt 2026): halamannya
  // tetap hidup dan bisa dibuka langsung di /sources, tetapi tidak ditampilkan di sidebar maupun
  // command palette. Kalau perlu dimunculkan lagi, cukup tambahkan kembali entri di sini — ikonnya
  // sudah ada di `components/sidebar/sidebar.tsx` dan tes penjaganya ada di `lib/commands.test.ts`.
];

export function visibleNavItems(role: Role | null | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.roles || (role && item.roles.includes(role)));
}

export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
