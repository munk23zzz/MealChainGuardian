"""Status lokasi (ok / warning / critical) — CERMIN dari `frontend/lib/status.ts`.

Kenapa cermin dan bukan aturan karangan sendiri: `deriveLocationStatus` di frontend sudah jadi aturan
yang benar-benar dipakai (pewarnaan marker peta, notifikasi) dan diuji (`lib/status.test.ts`),
sementara `docs/design.md` §3.1 hanya menyebut warnanya ("hijau normal, kuning tight, merah kritis").
Backend mengembalikan `Location.status` (dibutuhkan `frontend/lib/api/schema.d.ts`), jadi aturannya
harus SATU: kalau berbeda, lokasi bisa merah di backend dan hijau di UI. Mengubah aturan di sini
WAJIB diikuti perubahan `lib/status.ts` (dan sebaliknya).

Keparahan: FAIL keamanan atau suhu menyimpang = critical; defisit, kesegaran menipis, atau butuh
verifikasi = warning; selebihnya ok.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import timedelta
from typing import Literal

LocationStatus = Literal["ok", "warning", "critical"]

# Ambang suhu rantai dingin untuk bahan mentah hewani — Kemenkes, cermin `frontend/lib/ccp.ts`
# (rule `chilled`: max 4 °C). Backend yang memutuskan flag-nya karena `temperature_log` ada di DB.
CHILLED_MAX_C = 4.0

# Batch dianggap "kesegaran menipis" kalau masa simpannya tinggal kurang dari ini. TIDAK ada di
# dokumen; dipilih supaya batch seed (usable_until +3 hari) tetap hijau dan batch yang tinggal
# kurang dari sehari jadi kuning. Pindahkan ke dokumen bila Roy menetapkan angka lain.
FRESHNESS_WARNING_WINDOW = timedelta(hours=24)


@dataclass(frozen=True)
class SupplyCondition:
    """Kondisi satu pasangan (lokasi, komoditas) — bahan keputusan status lokasi."""

    has_safety_fail: bool = False
    has_temperature_excursion: bool = False
    has_needs_verification: bool = False
    has_deficit: bool = False
    has_freshness_risk: bool = False


def location_status(conditions: Iterable[SupplyCondition]) -> LocationStatus:
    """Status lokasi = keparahan TERTINGGI dari kondisi pasokannya (cermin deriveLocationStatus).

    Daftar kosong = "ok": belum ada data bukan alasan menandai lokasi bermasalah.
    """
    severity = 0
    for condition in conditions:
        if condition.has_safety_fail or condition.has_temperature_excursion:
            severity = max(severity, 2)
        elif (
            condition.has_deficit
            or condition.has_freshness_risk
            or condition.has_needs_verification
        ):
            severity = max(severity, 1)

    if severity >= 2:
        return "critical"
    if severity >= 1:
        return "warning"
    return "ok"


def has_temperature_excursion(temperature_log: object) -> bool:
    """True kalau ada catatan suhu di atas ambang rantai dingin.

    `temperature_log` = JSONB `[{timestamp, celsius}]` (Schema.md §2). Log KOSONG berarti belum ada
    pengukuran, bukan pelanggaran — jangan menuduh tanpa data. Entri yang bentuknya tidak dikenal
    diabaikan, bukan dianggap pelanggaran.
    """
    if not isinstance(temperature_log, list):
        return False

    for entry in temperature_log:
        if not isinstance(entry, dict):
            continue
        celsius = entry.get("celsius")
        if isinstance(celsius, bool) or not isinstance(celsius, (int, float)):
            continue
        if celsius > CHILLED_MAX_C:
            return True
    return False
