"""Aturan eksklusi pemasok — murni, tanpa DB/HTTP (`Rules.md` §1.2).

Keputusan desain yang dipegang di sini:

1. **Eksklusi bukan tombol.** Ia aksi berisiko tinggi, jadi wujudnya keputusan
   `supplier_exclusion` yang harus lewat `/actions/approve` dulu; modul ini hanya menjaga isi
   usulannya (alasan yang terbaca approver, pemasok yang masih aktif).
2. **Alasan wajib.** Eksklusi tanpa alasan tidak bisa diaudit, dan semua aksi berisiko tinggi di
   proyek ini punya jejak. Panjang minimum sengaja kecil tapi bukan nol — cukup untuk menolak
   tanda hubung atau "ok".
3. **Status tak dikenal = gagal tertutup.** `is_selectable` hanya True untuk `active`; pemasok
   dengan status yang belum dikenal tidak boleh dipilih untuk PO, karena kita belum bisa
   membuktikan ia berhak dipilih.
"""

from __future__ import annotations

EXCLUDED_STATUS = "excluded"
ACTIVE_STATUS = "active"

# Panjang minimum alasan eksklusi (dibaca approver, disalin ke `suppliers.exclusion_reason`).
MIN_REASON_LENGTH = 10


class ExclusionRuleError(Exception):
    """Pelanggaran aturan eksklusi. `code` dipetakan ke kode HTTP oleh lapisan API."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def validate_request(*, reason: str | None, supplier_status: str) -> None:
    """Periksa isi usulan eksklusi. Melempar `ExclusionRuleError` kalau tidak sah."""
    if supplier_status == EXCLUDED_STATUS:
        raise ExclusionRuleError(
            "supplier_already_excluded",
            "Pemasok ini sudah dikecualikan, jadi tidak ada yang perlu diusulkan lagi.",
        )

    if len((reason or "").strip()) < MIN_REASON_LENGTH:
        raise ExclusionRuleError(
            "exclusion_reason_required",
            "Alasan eksklusi wajib diisi (minimal "
            f"{MIN_REASON_LENGTH} karakter) supaya approver tahu dasarnya — "
            "eksklusi tanpa alasan tidak bisa diaudit.",
        )


def is_selectable(status: str | None) -> bool:
    """True hanya kalau pemasok berstatus `active` (dipakai pemilihan pemasok untuk PO)."""
    return status == ACTIVE_STATUS
