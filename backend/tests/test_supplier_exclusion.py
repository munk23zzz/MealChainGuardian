"""Aturan eksklusi pemasok (`app/core/supplier_exclusion.py`) — murni, tanpa DB/HTTP.

Sumber: `Rules.md` §1.2 ("mengeksklusi supplier WAJIB lewat tabel `approvals` dengan
`approved = true` dulu"). Karena itu eksklusi TIDAK punya tombol langsung: ia harus jadi keputusan
`supplier_exclusion` yang disetujui, dan modul ini menjaga dua syarat isinya sebelum keputusan itu
dibuat — alasan yang bisa dibaca approver, dan pemasok yang memang masih aktif.
"""

from __future__ import annotations

import pytest

from app.core.supplier_exclusion import (
    EXCLUDED_STATUS,
    ExclusionRuleError,
    is_selectable,
    validate_request,
)


class TestValidateRequest:
    def test_alasan_wajib_ada(self):
        with pytest.raises(ExclusionRuleError) as excinfo:
            validate_request(reason="", supplier_status="active")

        assert excinfo.value.code == "exclusion_reason_required"

    def test_alasan_spasi_saja_dianggap_kosong(self):
        with pytest.raises(ExclusionRuleError) as excinfo:
            validate_request(reason="   \n ", supplier_status="active")

        assert excinfo.value.code == "exclusion_reason_required"

    def test_alasan_terlalu_pendek_ditolak(self):
        """Alasan satu-dua huruf tidak berguna sebagai bukti audit."""
        with pytest.raises(ExclusionRuleError) as excinfo:
            validate_request(reason="rusak", supplier_status="active")

        assert excinfo.value.code == "exclusion_reason_required"

    def test_alasan_wajar_lolos(self):
        validate_request(
            reason="Dua pengiriman terakhir gagal inspeksi suhu dan mutu.",
            supplier_status="active",
        )

    def test_pemasok_yang_sudah_dikecualikan_tidak_bisa_diusulkan_lagi(self):
        with pytest.raises(ExclusionRuleError) as excinfo:
            validate_request(
                reason="Pengiriman terlambat tiga kali berturut-turut.",
                supplier_status=EXCLUDED_STATUS,
            )

        assert excinfo.value.code == "supplier_already_excluded"


class TestIsSelectable:
    def test_pemasok_aktif_boleh_dipilih(self):
        assert is_selectable("active") is True

    def test_pemasok_dikecualikan_tidak_boleh_dipilih(self):
        assert is_selectable(EXCLUDED_STATUS) is False

    def test_status_tak_dikenal_gagal_tertutup(self):
        """Status yang tidak dikenal JANGAN dianggap aktif — itu artinya belum bisa dibuktikan aman."""
        assert is_selectable("kadaluarsa") is False
        assert is_selectable("") is False
