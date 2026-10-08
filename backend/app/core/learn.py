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
