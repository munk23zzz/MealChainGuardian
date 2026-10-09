"""Ambang kesegaran (`app/core/freshness.py`) — penerapan `docs/Skill.md` §3.

Dokumen menetapkan SATU blok final (keputusan 2026-10-01) dan satu kalimat gerbang:

* `freshness_score >= 0.85` → `pass`
* `0.60 <= freshness_score < 0.85` → `needs_verification` (bukan otomatis gagal)
* `< 0.60` → `fail` / tidak layak
* hard constraint: `freshness_score >= threshold` (default 0.6, "taruh di config, jangan hardcode")

Sebelum modul ini, `batches.freshness_score` hanya DITULIS seed dan tidak pernah dibaca logika
mana pun, jadi ambang di dokumen tidak punya wujud di kode. Test ini menahan angka-angka itu:
kalau dokumen berubah, test ini yang harus berubah lebih dulu.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.core.freshness import (
    DEFAULT_GATE_THRESHOLD,
    FreshnessBand,
    band,
    gate_threshold,
    is_eligible,
    status_for_ui,
    worst_band,
)


class TestBand:
    """Pita status dari skor kesegaran (batas ATAS pita ikut masuk pita bawah, sesuai dokumen)."""

    @pytest.mark.parametrize("score", [Decimal("1.00"), Decimal("0.95"), Decimal("0.85")])
    def test_tinggi_adalah_pass(self, score):
        assert band(score) == "pass"

    @pytest.mark.parametrize("score", [Decimal("0.8499"), Decimal("0.70"), Decimal("0.60")])
    def test_menengah_adalah_needs_verification(self, score):
        """0.85 TIDAK masuk sini, 0.60 MASUK sini — dua batas itu yang paling mudah salah."""
        assert band(score) == "needs_verification"

    @pytest.mark.parametrize("score", [Decimal("0.5999"), Decimal("0.30"), Decimal("0.00")])
    def test_rendah_adalah_fail(self, score):
        assert band(score) == "fail"

    def test_skor_belum_ada_bukan_fail(self):
        """`freshness_score` NULL = belum dievaluasi (`/freshness/evaluate` belum jalan).

        Bukan `fail`: menuduh data yang memang belum ada akan menutup lokasi tanpa dasar.
        """
        assert band(None) is None

    def test_menerima_float_dan_str_dari_json(self):
        """Nilai dari JSON/DB bisa datang sebagai float atau string, bukan hanya Decimal."""
        assert band(0.9) == "pass"
        assert band("0.59") == "fail"


class TestWorstBand:
    def test_mengambil_yang_terburuk(self):
        assert worst_band(["pass", "fail", "needs_verification"]) == "fail"
        assert worst_band(["pass", "needs_verification"]) == "needs_verification"
        assert worst_band(["pass", "pass"]) == "pass"

    def test_abaikan_yang_belum_dievaluasi(self):
        assert worst_band([None, "pass"]) == "pass"
        assert worst_band([None, None]) is None
        assert worst_band([]) is None


class TestGerbang:
    def test_default_sesuai_dokumen(self):
        assert DEFAULT_GATE_THRESHOLD == Decimal("0.60")

    def test_pada_batas_gerbang_lolos(self):
        """Dokumen: `freshness_score >= threshold` — jadi tepat 0.60 LOLOS gerbang."""
        assert is_eligible(Decimal("0.60")) is True
        assert is_eligible(Decimal("0.5999")) is False

    def test_belum_dievaluasi_tidak_dihukum(self):
        """Konsisten dengan aturan `_freshness` di `app/api/ui.py`: data kosong bukan pelanggaran."""
        assert is_eligible(None) is True

    def test_gerbang_bisa_dinaikkan_operator(self, monkeypatch):
        monkeypatch.setenv("FRESHNESS_GATE_THRESHOLD", "0.75")
        assert gate_threshold() == Decimal("0.75")
        assert is_eligible(Decimal("0.70")) is False
        assert is_eligible(Decimal("0.80")) is True

    def test_nilai_env_ngawur_diabaikan(self, monkeypatch):
        monkeypatch.setenv("FRESHNESS_GATE_THRESHOLD", "bukan-angka")
        assert gate_threshold() == DEFAULT_GATE_THRESHOLD

    def test_nilai_env_di_luar_0_sampai_1_diabaikan(self, monkeypatch):
        """Gerbang 7.5 atau -1 akan membalik arti keputusan — lebih baik jatuh ke default."""
        monkeypatch.setenv("FRESHNESS_GATE_THRESHOLD", "7.5")
        assert gate_threshold() == DEFAULT_GATE_THRESHOLD

    def test_panggilan_is_eligible_memakai_env_terbaru(self, monkeypatch):
        monkeypatch.setenv("FRESHNESS_GATE_THRESHOLD", "0.90")
        assert is_eligible(Decimal("0.85")) is False


class TestStatusUntukUi:
    """Kosakata UI (`fresh`/`approaching_expiry`/`expired`) dipetakan 1:1 dari pita dokumen."""

    @pytest.mark.parametrize(
        ("band_value", "expected"),
        [
            ("pass", "fresh"),
            ("needs_verification", "approaching_expiry"),
            ("fail", "expired"),
            (None, None),
        ],
    )
    def test_peta(self, band_value: FreshnessBand | None, expected: str | None):
        assert status_for_ui(band_value) == expected
