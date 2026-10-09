"""Status lokasi (hijau normal / kuning tight / merah kritis) — satu aturan untuk endpoint UI.

Kenapa modul sendiri: `docs/design.md` §3.1 hanya menyebut WARNA ("hijau (normal), kuning (tight),
merah (kritis)"), tidak menyebut cara menentukannya, sedangkan UI menuntut `Location.status` terisi
(`frontend/lib/api/schema.d.ts`). Ambangnya karena itu ditetapkan di sini — diberi nama, bukan angka
yang tersebar di dalam query — dan dikunci test supaya keputusannya kelihatan dan mudah diubah.
Kalau Roy setuju, angkanya dipindahkan ke `docs/design.md` §3.1 supaya dokumen dan kode sejalan lagi.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Literal

LocationStatus = Literal["ok", "warning", "critical"]

# Lokasi masih "tight" (kuning) kalau kebutuhan tertutup tetapi sisanya di bawah margin ini.
TIGHT_MARGIN = Decimal("1.20")


def location_status(*, usable_stock_kg: Decimal, demand_kg: Decimal) -> LocationStatus:
    """Status satu lokasi dari stok yang masih boleh dipakai vs kebutuhan.

    Tanpa kebutuhan (0 kg) statusnya "ok" — tidak ada yang bisa dilanggar. Stok di bawah kebutuhan
    = "critical": lokasi yang kekurangan harus terlihat, bukan tersembunyi di daftar. Di antara
    kebutuhan dan `TIGHT_MARGIN` = "warning" (stok cukup, tapi tipis).
    """
    if demand_kg <= 0:
        return "ok"
    if usable_stock_kg < demand_kg:
        return "critical"
    if usable_stock_kg < demand_kg * TIGHT_MARGIN:
        return "warning"
    return "ok"
