"""LEARN — penyesuaian `reliability_score` pemasok (docs/Skill.md §10).

**Bukan machine learning.** Tidak ada model yang dilatih ulang di sini: ini aritmetika deterministik
biasa, konsisten dengan prinsip "LLM bukan calculator" (`docs/Architecture.md` §1). Kalimat yang
benar untuk juri: "sistem menyesuaikan skor kepercayaan pemasok berdasarkan hasil keputusan
sebelumnya."

Formula acuan §10 (dinyatakan dokumen sebagai belum final, boleh di-tune):

    reliability_score_baru = clamp(0.5 x skor_lama + 0.5 x success_rate_N_terakhir, 0, 1)

Modul ini murni: tanpa HTTP, tanpa database, tanpa ORM — supaya bisa diuji tanpa Postgres.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Sequence

# "N terakhir" tidak diberi angka oleh dokumen. 5 dipilih supaya insiden baru punya bobot nyata
# tanpa menghapus riwayat lama, dan dibuat konstanta supaya bisa di-tune di satu tempat.
LEARN_WINDOW = 5

DECIDED_OUTCOMES = ("success", "failure")
KNOWN_OUTCOMES = ("success", "failure", "pending")

HALF = Decimal("0.5")
SCORE_PLACES = Decimal("0.01")
RATE_PLACES = Decimal("0.0001")


def _validate(outcomes: Sequence[str | None], window: int) -> None:
    if window < 1:
        raise ValueError(f"window harus >= 1, bukan {window}.")
    for outcome in outcomes:
        if outcome is not None and outcome not in KNOWN_OUTCOMES:
            raise ValueError(
                f"outcome {outcome!r} tidak dikenal. Yang sah: {', '.join(KNOWN_OUTCOMES)} "
                "(docs/Schema.md §3)."
            )


def _recent_decided(outcomes: Sequence[str | None], window: int) -> list[str]:
    """Hanya outcome yang sudah diputuskan, urut lama -> baru, diambil `window` terakhir.

    `None` dan `pending` dilewati: keduanya berarti belum ada hasil, dan bukan berarti gagal.
    """
    decided = [outcome for outcome in outcomes if outcome in DECIDED_OUTCOMES]
    return decided[-window:]


def success_rate(outcomes: Sequence[str | None], window: int = LEARN_WINDOW) -> Decimal | None:
    """Porsi `success` dari `window` outcome terakhir. `None` kalau belum ada yang diputuskan."""
    _validate(outcomes, window)
    decided = _recent_decided(outcomes, window)
    if not decided:
        return None

    successes = sum(1 for outcome in decided if outcome == "success")
    return (Decimal(successes) / Decimal(len(decided))).quantize(RATE_PLACES, ROUND_HALF_UP)


def adjusted_reliability(
    current: Decimal,
    outcomes: Sequence[str | None],
    window: int = LEARN_WINDOW,
) -> Decimal:
    """Skor baru setelah menggabungkan skor sekarang dengan riwayat outcome terakhir.

    Kalau belum ada outcome yang diputuskan, skor tidak berubah — tidak ada yang bisa dipelajari.
    Hasil selalu dibulatkan 2 desimal karena kolom `suppliers.reliability_score` bertipe
    NUMERIC(3,2) (`docs/Schema.md` §1).
    """
    rate = success_rate(outcomes, window)
    if rate is None:
        return current.quantize(SCORE_PLACES, ROUND_HALF_UP)

    blended = HALF * Decimal(current) + HALF * rate
    clamped = min(max(blended, Decimal("0")), Decimal("1"))
    return clamped.quantize(SCORE_PLACES, ROUND_HALF_UP)


@dataclass(frozen=True)
class DeliveryEvent:
    """Satu penerimaan yang SUDAH diputuskan — bahan replay skor (design.md §3.9c)."""

    at: datetime
    outcome: str  # success | failure
    decision_id: str


@dataclass(frozen=True)
class ScorePoint:
    """Satu titik grafik riwayat pemasok (`SupplierScorePoint` di schema UI)."""

    at: datetime | None
    score: Decimal
    outcome: str | None
    is_incident: bool
    decision_id: str | None


def replay_reliability(base: Decimal, events: Sequence[DeliveryEvent]) -> list[ScorePoint]:
    """Deret skor dari replay LEARN — cermin `frontend/lib/reliability.ts`.

    Titik pertama (`at=None`) adalah skor SEBELUM ada penerimaan; sesudahnya satu titik per
    penerimaan, urut waktu. `is_incident` menandai pengiriman gagal ATAU skor yang turun, sama
    seperti `reliabilitySeries`. Karena rumusnya deterministik, titik terakhir harus sama dengan
    `suppliers.reliability_score` yang tersimpan (diuji di `tests/test_supplier_history.py`).
    """
    ordered = sorted(events, key=lambda event: event.at)
    points = [
        ScorePoint(
            at=None,
            score=Decimal(base).quantize(SCORE_PLACES, ROUND_HALF_UP),
            outcome=None,
            is_incident=False,
            decision_id=None,
        )
    ]

    outcomes: list[str] = []
    score = points[0].score
    for event in ordered:
        before = score
        outcomes.append(event.outcome)
        score = adjusted_reliability(before, outcomes)
        points.append(
            ScorePoint(
                at=event.at,
                score=score,
                outcome=event.outcome,
                # Sama seperti UI: gagal ATAU turun = insiden. Gagal tapi skor tetap (mis. sudah
                # 0) tetap ditandai, karena kejadiannya memang insiden.
                is_incident=event.outcome == "failure" or score < before,
                decision_id=event.decision_id,
            )
        )
    return points
