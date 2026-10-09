"""Masa layak batch (usable_until) — DITURUNKAN, tidak lagi disimpan.

`docs/Schema.md` §2 (revisi 9 Okt) menghapus kolom `batches.usable_until`, sementara
`docs/Skill.md` §5 tetap menyebut `usable_until` di respons `/freshness/evaluate`. Supaya keduanya
benar, nilainya dihitung saat dibutuhkan dari `harvested_at` + masa layak komoditas.

Angka masa layak tidak ditetapkan dokumen per komoditas. Yang dipakai: 72 jam (3 hari) — angka
yang sama dengan mayoritas baris seed demo (`freshness_hours` di `app/db_seed.py`), supaya status
kesegaran lokasi tidak berubah hanya karena kolomnya berpindah tempat. Kalau Roy menetapkan angka
per komoditas, isi `SHELF_LIFE_HOURS_BY_COMMODITY` — sisanya tidak perlu diubah.
"""

from __future__ import annotations

from datetime import datetime, timedelta

DEFAULT_SHELF_LIFE_HOURS = 72

# Kosong = semua komoditas memakai DEFAULT_SHELF_LIFE_HOURS. Kunci = `commodities.name`.
SHELF_LIFE_HOURS_BY_COMMODITY: dict[str, int] = {}


def shelf_life(commodity_name: str | None = None) -> timedelta:
    """Masa layak satu komoditas sebagai `timedelta`."""
    if commodity_name is not None and commodity_name in SHELF_LIFE_HOURS_BY_COMMODITY:
        return timedelta(hours=SHELF_LIFE_HOURS_BY_COMMODITY[commodity_name])
    return timedelta(hours=DEFAULT_SHELF_LIFE_HOURS)


def usable_until(harvested_at: datetime, commodity_name: str | None = None) -> datetime:
    """Batas layak pakai batch: waktu panen + masa layak komoditasnya."""
    return harvested_at + shelf_life(commodity_name)
