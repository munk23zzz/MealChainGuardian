"""Aturan status lokasi — kasusnya SENGAJA sama dengan `frontend/lib/status.test.ts`.

Aturan itu dipakai dua kali: backend mengembalikan `Location.status`, frontend menurunkannya sendiri
untuk pewarnaan marker dari `/supply`. Kalau keduanya menyimpang, peta bisa merah di backend dan
hijau di UI tanpa ada error apa pun — jadi kasus ujinya dikunci sepasang.
"""

from __future__ import annotations

from app.core.location_status import (
    CHILLED_MAX_C,
    SupplyCondition,
    has_temperature_excursion,
    location_status,
)


def test_all_conditions_safe_is_ok():
    assert location_status([SupplyCondition()]) == "ok"


def test_no_conditions_at_all_is_ok():
    """Belum ada data bukan alasan menandai lokasi bermasalah."""
    assert location_status([]) == "ok"


def test_safety_fail_is_critical():
    assert location_status([SupplyCondition(has_safety_fail=True)]) == "critical"


def test_temperature_excursion_is_critical():
    assert location_status([SupplyCondition(has_temperature_excursion=True)]) == "critical"


def test_deficit_is_warning():
    """Defisit TIDAK otomatis kritis — keparahan tinggi hanya untuk kegagalan keamanan/suhu."""
    assert location_status([SupplyCondition(has_deficit=True)]) == "warning"


def test_freshness_risk_is_warning():
    assert location_status([SupplyCondition(has_freshness_risk=True)]) == "warning"


def test_needs_verification_is_warning():
    assert location_status([SupplyCondition(has_needs_verification=True)]) == "warning"


def test_critical_beats_warning():
    conditions = [
        SupplyCondition(has_deficit=True),
        SupplyCondition(has_safety_fail=True),
    ]

    assert location_status(conditions) == "critical"


def test_temperature_log_without_measurement_is_not_a_violation():
    assert has_temperature_excursion([]) is False
    assert has_temperature_excursion(None) is False


def test_temperature_log_above_the_cold_chain_limit_is_a_violation():
    assert has_temperature_excursion([{"timestamp": "2026-10-01T00:00:00Z", "celsius": 12.5}]) is True
    # Tepat di ambang masih lulus: aturan CCP-nya "max 4 °C".
    assert has_temperature_excursion([{"celsius": CHILLED_MAX_C}]) is False


def test_temperature_log_entries_with_unknown_shape_are_ignored():
    """Data rusak tidak boleh dianggap pelanggaran (dan tidak boleh melempar error)."""
    assert has_temperature_excursion(["bukan objek", {"celsius": "dingin"}, {"tanpa": "suhu"}]) is False
