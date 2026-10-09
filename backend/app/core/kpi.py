"""Hitungan KPI (docs/Skill.md §4) dari tabel operasional — murni, tanpa DB dan tanpa DOM.

Prinsipnya satu: **angka hanya keluar kalau sumbernya ada.** KPI yang bahannya tidak pernah
disimpan di skema (rencana menu, limbah makanan) TIDAK dikarang — namanya masuk daftar
`unavailable` beserta alasannya, dan UI menampilkan "—". Halaman KPI memang sudah menyatakan
"tidak dikarang" untuk hal serupa, jadi perilakunya sejalan.

Definisi yang dipakai (dan bedanya dari §4, supaya tidak diam-diam berbeda):

* `evidenceCompletenessPercent` — rata-rata kelengkapan bukti per keputusan; satu kanal terisi
  (SAP / IoT / fisik) bernilai 1/3, persis seperti yang dihitung UI (`lib/evidence.ts`).
* `averageSafeDeliveredCostPerKg` — rata-rata `decisions.safe_delivered_cost` yang terisi.
* `regionalImbalanceResolutionRate` — % keputusan ketidakseimbangan regional yang sudah
  dieksekusi. §4 menyebut "seberapa cepat defisit teratasi"; lamanya waktu tidak tersimpan
  sebagai kolom, jadi yang dihitung adalah tuntas/tidaknya, bukan durasinya.
* `averageDecisionTimeMinutes` — rata-rata durasi langkah DECIDE milik agent (ms -> menit).
  Waktu "deteksi defisit" tidak tersimpan, jadi yang dipakai durasi pengambilan keputusan.
* `averageProcurementPriceDeviationPercent` — jarak harga kuotasi pemasok dari harga acuan PIHPS
  untuk komoditas yang punya baris acuan; komoditas tanpa acuan tidak ikut dihitung.
* `mealContinuityRate`, `avoidableFoodLossKg`, `avoidableFoodLossRp` — TIDAK dihitung: tidak ada
  sumbernya di skema (S3-15 / tidak ada tabel limbah).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP

#: `price_signals.source` yang menandai baris harga acuan pasar (dipakai seed §11).
REFERENCE_PRICE_SOURCE = "pihps_reference"

#: Kanal bukti yang diminta Skill.md §4: SAP + IoT + fisik.
EVIDENCE_CHANNELS = 3

_UNAVAILABLE_STATIC: dict[str, str] = {
    "mealContinuityRate": (
        "rencana menu vs menu terpenuhi tidak ada di skema — belum bisa dihitung, bukan 0"
    ),
    "avoidableFoodLossKg": (
        "tidak ada tabel food loss / limbah di skema — belum bisa dihitung, bukan 0"
    ),
    "avoidableFoodLossRp": (
        "tidak ada tabel food loss / limbah di skema — belum bisa dihitung, bukan 0"
    ),
}


@dataclass(frozen=True)
class DecisionFact:
    """Satu keputusan, diringkas jadi angka yang dibutuhkan KPI."""

    decision_type: str
    status: str
    safe_delivered_cost: Decimal | None
    evidence_channels: int  # 0..3 kanal terisi
    decide_duration_ms: int | None


@dataclass(frozen=True)
class PriceFact:
    """Satu sinyal harga; `source` menentukan apakah ini acuan pasar atau kuotasi."""

    commodity_id: uuid.UUID
    price_per_kg: Decimal
    source: str


def _round1(value: float) -> float:
    return float(Decimal(str(value)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def _average(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def price_deviation_percent(prices: list[PriceFact]) -> float | None:
    """Rata-rata jarak harga kuotasi dari harga acuan, per komoditas yang punya acuan."""
    references: dict[uuid.UUID, Decimal] = {
        price.commodity_id: price.price_per_kg
        for price in prices
        if price.source == REFERENCE_PRICE_SOURCE and price.price_per_kg > 0
    }
    if not references:
        return None

    deviations: list[float] = []
    for price in prices:
        reference = references.get(price.commodity_id)
        if price.source == REFERENCE_PRICE_SOURCE or reference is None or reference == 0:
            continue
        deviations.append(float(abs(price.price_per_kg - reference) / reference * 100))
    return _average(deviations)


def compute_kpi(
    decisions: list[DecisionFact],
    prices: list[PriceFact],
) -> tuple[dict[str, float], dict[str, str]]:
    """Kembalikan (nilai KPI yang bisa dihitung, alasan KPI yang tidak bisa)."""
    values: dict[str, float] = {}
    unavailable: dict[str, str] = dict(_UNAVAILABLE_STATIC)

    completeness = _average(
        [min(decision.evidence_channels, EVIDENCE_CHANNELS) / EVIDENCE_CHANNELS * 100
         for decision in decisions]
    )
    if completeness is None:
        unavailable["evidenceCompletenessPercent"] = "belum ada keputusan untuk dinilai"
    else:
        values["evidenceCompletenessPercent"] = _round1(completeness)

    costs = [
        float(decision.safe_delivered_cost)
        for decision in decisions
        if decision.safe_delivered_cost is not None
    ]
    average_cost = _average(costs)
    if average_cost is None:
        unavailable["averageSafeDeliveredCostPerKg"] = (
            "belum ada keputusan dengan safe delivered cost terisi"
        )
    else:
        values["averageSafeDeliveredCostPerKg"] = _round1(average_cost)

    regional = [d for d in decisions if d.decision_type == "regional_balance"]
    if not regional:
        unavailable["regionalImbalanceResolutionRate"] = (
            "belum ada keputusan ketidakseimbangan regional"
        )
    else:
        executed = sum(1 for d in regional if d.status == "executed")
        values["regionalImbalanceResolutionRate"] = _round1(executed / len(regional) * 100)

    durations = [
        decision.decide_duration_ms / 60_000
        for decision in decisions
        if decision.decide_duration_ms is not None
    ]
    average_duration = _average(durations)
    if average_duration is None:
        unavailable["averageDecisionTimeMinutes"] = "belum ada langkah DECIDE tercatat"
    else:
        values["averageDecisionTimeMinutes"] = _round1(average_duration)

    deviation = price_deviation_percent(prices)
    if deviation is None:
        unavailable["averageProcurementPriceDeviationPercent"] = (
            "tidak ada harga acuan pasar di `price_signals` (source pihps_reference)"
        )
    else:
        values["averageProcurementPriceDeviationPercent"] = _round1(deviation)

    return values, unavailable
