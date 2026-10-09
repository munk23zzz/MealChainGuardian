"""Uji murni `app/core/kpi.py` — hitungan KPI dari fakta, tanpa DB.

Yang dijaga di sini: KPI yang tidak punya sumber data TIDAK muncul sebagai 0 (yang terbaca seperti
"nol kejadian" padahal artinya "tidak ada datanya"), melainkan masuk daftar `unavailable`.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from app.core.kpi import (
    DecisionFact,
    PriceFact,
    compute_kpi,
    price_deviation_percent,
)

TELUR = uuid.uuid4()
AYAM = uuid.uuid4()


def _decision(**overrides) -> DecisionFact:
    base = dict(
        decision_type="regional_balance",
        status="executed",
        safe_delivered_cost=Decimal("26200.00"),
        evidence_channels=1,
        decide_duration_ms=90_000,
    )
    base.update(overrides)
    return DecisionFact(**base)  # type: ignore[arg-type]


# --- Jarak harga dari acuan pasar -------------------------------------------------------------


def test_price_deviation_uses_the_reference_rows_as_baseline():
    """Kuotasi dibandingkan harga acuan PIHPS komoditas yang sama, bukan antar sembarang baris."""
    prices = [
        PriceFact(commodity_id=TELUR, price_per_kg=Decimal("26500.00"), source="pihps_reference"),
        PriceFact(commodity_id=TELUR, price_per_kg=Decimal("30000.00"), source="supplier_quote"),
        PriceFact(commodity_id=TELUR, price_per_kg=Decimal("27500.00"), source="supplier_quote"),
        # Komoditas tanpa baris acuan: harganya tidak boleh menyeret rata-rata.
        PriceFact(commodity_id=AYAM, price_per_kg=Decimal("40000.00"), source="supplier_quote"),
    ]

    deviation = price_deviation_percent(prices)

    assert deviation is not None
    # ((30000-26500) + (27500-26500)) / 2 / 26500 * 100 = 8.490...
    assert round(deviation, 3) == 8.491


def test_price_deviation_is_none_without_a_reference_row():
    assert price_deviation_percent([PriceFact(TELUR, Decimal("30000"), "supplier_quote")]) is None


def test_price_deviation_ignores_zero_reference():
    """Acuan 0 tidak boleh jadi pembagi (ZeroDivisionError / angka tak berarti)."""
    prices = [
        PriceFact(commodity_id=TELUR, price_per_kg=Decimal("0"), source="pihps_reference"),
        PriceFact(commodity_id=TELUR, price_per_kg=Decimal("30000"), source="supplier_quote"),
    ]

    assert price_deviation_percent(prices) is None


# --- KPI yang bisa dihitung --------------------------------------------------------------------


def test_computable_kpis_are_averaged_from_the_facts():
    decisions = [
        _decision(evidence_channels=2, decide_duration_ms=120_000),
        _decision(status="pending_approval", evidence_channels=1, decide_duration_ms=60_000),
    ]
    values, unavailable = compute_kpi(decisions, [])

    # (2/3 + 1/3) / 2 * 100 = 50.0
    assert values["evidenceCompletenessPercent"] == 50.0
    assert values["averageSafeDeliveredCostPerKg"] == 26200.0
    # 1 dari 2 keputusan regional dieksekusi.
    assert values["regionalImbalanceResolutionRate"] == 50.0
    # (120000 + 60000) / 2 ms = 1,5 menit.
    assert values["averageDecisionTimeMinutes"] == 1.5
    # Tanpa baris acuan harga, KPI ini tidak muncul sebagai angka.
    assert "averageProcurementPriceDeviationPercent" not in values
    assert "averageProcurementPriceDeviationPercent" in unavailable


def test_evidence_channels_are_capped_at_three():
    values, _ = compute_kpi([_decision(evidence_channels=99)], [])

    assert values["evidenceCompletenessPercent"] == 100.0


# --- KPI yang tidak boleh dikarang -------------------------------------------------------------


def test_kpis_without_a_data_source_are_never_zero():
    values, unavailable = compute_kpi([], [])

    for key in ("mealContinuityRate", "avoidableFoodLossKg", "avoidableFoodLossRp"):
        assert key not in values, f"{key} tidak punya sumber data, jangan diisi 0"
        assert "skema" in unavailable[key]

    # KPI yang bergantung isi tabel juga kosong + alasannya jelas, bukan 0.
    for key in (
        "evidenceCompletenessPercent",
        "averageSafeDeliveredCostPerKg",
        "regionalImbalanceResolutionRate",
        "averageDecisionTimeMinutes",
        "averageProcurementPriceDeviationPercent",
    ):
        assert key not in values
        assert unavailable[key]


def test_decisions_of_other_types_do_not_count_for_regional_resolution():
    values, unavailable = compute_kpi([_decision(decision_type="price_anomaly")], [])

    assert "regionalImbalanceResolutionRate" not in values
    assert "ketidakseimbangan regional" in unavailable["regionalImbalanceResolutionRate"]


def test_missing_cost_or_duration_is_skipped_not_counted_as_zero():
    """Keputusan tanpa biaya/durasi tidak boleh menurunkan rata-rata menjadi 0."""
    decisions = [
        _decision(safe_delivered_cost=None, decide_duration_ms=None),
        _decision(safe_delivered_cost=Decimal("30000.00"), decide_duration_ms=180_000),
    ]

    values, _ = compute_kpi(decisions, [])

    assert values["averageSafeDeliveredCostPerKg"] == 30000.0
    assert values["averageDecisionTimeMinutes"] == 3.0
