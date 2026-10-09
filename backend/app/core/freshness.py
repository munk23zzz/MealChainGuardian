"""Ambang kesegaran — penerapan `docs/Skill.md` §3 ("Freshness threshold default, final").

Dokumen menetapkan:

* `freshness_score >= 0.85` → `pass`
* `0.60 <= freshness_score < 0.85` → `needs_verification` (bukan otomatis gagal)
* `< 0.60` → `fail` / tidak layak
* gerbang hard constraint: `freshness_score >= threshold` (default 0.6, **di config, bukan hardcode**)

Modul ini murni (tanpa DB, tanpa FastAPI) dan diuji di `tests/test_freshness.py`, supaya angka
safety-critical tidak pernah dihitung LLM (`Rules.md` §1.1) dan tidak tersebar di beberapa tempat.

Sebelumnya `batches.freshness_score` hanya ditulis seed dan tidak dibaca siapa pun; sekarang
`app/api/ui.py` memakai pita di sini untuk `freshnessStatus`, dan skor di bawah gerbang tidak lagi
dihitung sebagai stok terpakai — sama seperti batch yang gagal status keamanannya.
"""

from __future__ import annotations

from collections.abc import Iterable
from decimal import Decimal, InvalidOperation
from typing import Literal

from app.config import freshness_gate_threshold

# Kosakata dokumen (pita) vs kosakata layar (`frontend/lib/api/schema.d.ts`). Dipetakan 1:1 di
# `status_for_ui` supaya kontrak UI tidak perlu berubah saat dokumen memakai istilah lain.
FreshnessBand = Literal["pass", "needs_verification", "fail"]
FreshnessStatus = Literal["fresh", "approaching_expiry", "expired"]

PASS_THRESHOLD = Decimal("0.85")
NEEDS_VERIFICATION_THRESHOLD = Decimal("0.60")

# Nilai cadangan gerbang; nilai efektif dibaca `freshness_gate_threshold()` (env
# `FRESHNESS_GATE_THRESHOLD`) setiap kali dipakai, supaya operator bisa menggesernya tanpa rebuild.
DEFAULT_GATE_THRESHOLD = Decimal("0.60")

_BAND_BY_STATUS: dict[FreshnessBand, FreshnessStatus] = {
    "pass": "fresh",
    "needs_verification": "approaching_expiry",
    "fail": "expired",
}

# Keparahan untuk agregasi "pita terburuk" satu pasangan (lokasi, komoditas).
_SEVERITY: dict[FreshnessBand, int] = {"pass": 0, "needs_verification": 1, "fail": 2}


def _as_decimal(score: object) -> Decimal | None:
    """Skor dari DB/JSON bisa datang sebagai Decimal, float, atau string. None/bukan angka = None.

    `bool` ditolak walau `True` adalah `int` di Python — `True` bukan skor 1.0.
    """
    if score is None or isinstance(score, bool):
        return None
    if isinstance(score, Decimal):
        return score
    try:
        return Decimal(str(score))
    except (InvalidOperation, ValueError, TypeError):
        return None


def band(score: object) -> FreshnessBand | None:
    """Pita kesegaran dari skor. `None` = belum dievaluasi (bukan `fail`).

    Batas pita mengikuti dokumen apa adanya: tepat 0.85 = `pass`, tepat 0.60 = `needs_verification`.
    """
    value = _as_decimal(score)
    if value is None:
        return None
    if value >= PASS_THRESHOLD:
        return "pass"
    if value >= NEEDS_VERIFICATION_THRESHOLD:
        return "needs_verification"
    return "fail"


def worst_band(bands: Iterable[FreshnessBand | None]) -> FreshnessBand | None:
    """Pita terburuk dari sekumpulan batch — `fail` > `needs_verification` > `pass`.

    Batch yang belum dievaluasi (None) dilewati; kalau TIDAK SATU pun punya skor, hasilnya None
    supaya pemanggil bisa jatuh ke aturan lain (di UI: hitungan berbasis masa simpan).
    """
    worst: FreshnessBand | None = None
    for value in bands:
        if value is None:
            continue
        if worst is None or _SEVERITY[value] > _SEVERITY[worst]:
            worst = value
    return worst


def gate_threshold() -> Decimal:
    """Ambang gerbang hard constraint, dibaca dari env setiap panggilan."""
    return freshness_gate_threshold()


def is_eligible(score: object, *, gate: Decimal | None = None) -> bool:
    """True kalau skor lolos gerbang hard constraint (`>= ambang`, sesuai dokumen).

    `score` kosong = belum dievaluasi → True (tidak dihukum). Aturan itu sejalan dengan
    `app/api/ui.py::_freshness` yang tidak menuduh data yang belum ada, dan berbeda dari
    kegagalan keamanan/suhu yang selalu menutup batch.
    """
    value = _as_decimal(score)
    if value is None:
        return True
    return value >= (gate if gate is not None else gate_threshold())


def status_for_ui(band_value: FreshnessBand | None) -> FreshnessStatus | None:
    """Peta pita dokumen → kosakata UI (`fresh`/`approaching_expiry`/`expired`)."""
    if band_value is None:
        return None
    return _BAND_BY_STATUS[band_value]
