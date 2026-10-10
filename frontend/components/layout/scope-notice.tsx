/**
 * Banner cakupan peran bersama (design.md §1.4) — satu komponen untuk semua halaman
 * yang menampilkan data terbatas cakupan peran, supaya kalimatnya tidak beda-beda antar layar.
 *
 * Isi yang WAJIB ada, sesuai aturan `lib/scope.ts`: berapa yang ditampilkan, berapa yang
 * ada di luar cakupan (tanpa menyebut data yang disembunyikan itu hilang begitu saja),
 * penanda read-only, dan tombol buka cakupan ("Tampilkan semua SPPG" untuk peran SPPG).
 *
 * Komponen ini presentasional: cakupan efektif dihitung pemanggil (`scopeForRole` +
 * status tombol), bukan di sini.
 */
"use client";

import { Lock, ShieldCheck } from "lucide-react";
import {
  scopeDescription,
  scopeLabel,
  showAllLabel,
  type DataScope,
  type NamedLocationLike,
} from "@/lib/scope";

export function ScopeNotice({
  scope,
  outsideCount,
  detail,
  readOnly = false,
  canToggle = false,
  showingAll = false,
  roleScope,
  locations,
  onToggle,
}: {
  /** Cakupan yang SEDANG dipakai (bisa `all` kalau tombol "tampilkan semua" aktif). */
  scope: DataScope;
  /** Jumlah item yang jatuh di luar cakupan peran pengguna. */
  outsideCount: number;
  /** Keterangan tambahan, mis. "3 batch hari ini". */
  detail?: string;
  readOnly?: boolean;
  canToggle?: boolean;
  showingAll?: boolean;
  /** Cakupan asli peran, untuk label tombol saat mode "semua SPPG" aktif. */
  roleScope?: DataScope;
  /** Daftar lokasi (id + nama) supaya cakupan satu SPPG ditulis dengan nama SPPG-nya. */
  locations?: NamedLocationLike[];
  onToggle?: () => void;
}) {
  return (
    <div className="animate-fade-up flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <p className="flex flex-wrap items-center gap-2 text-sm text-navy-900">
        <ShieldCheck className="h-4 w-4 shrink-0 text-brand" aria-hidden />
        <span>{scopeDescription(scope, outsideCount, locations)}</span>
        {detail && <span className="text-muted-foreground">· {detail}</span>}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {readOnly && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-navy-900">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            Read-only — tanpa hak approve
          </span>
        )}
        {canToggle && onToggle && (
          <button
            type="button"
            onClick={onToggle}
            className="tap-target rounded-md border border-border px-3 py-1.5 text-sm text-navy-900 transition-colors hover:border-navy-700/30"
          >
            {showingAll
              ? `Batasi ke ${roleScope ? scopeLabel(roleScope, locations) : "cakupan Anda"}`
              : showAllLabel(roleScope ?? scope)}
          </button>
        )}
      </div>
    </div>
  );
}
