"""Aturan status lokasi — ambangnya sengaja dikunci di sini (lihat docstring modulnya).

Tanpa test ini, ambang bisa berubah tanpa ada yang sadar; dan `Location.status` yang salah membuat
lokasi kekurangan tampak hijau di peta — kesalahan yang justru berlawanan dengan tujuan produk.
"""

from decimal import Decimal

import pytest

from app.core.location_status import TIGHT_MARGIN, location_status


def test_stock_below_demand_is_critical():
    assert location_status(usable_stock_kg=Decimal("300"), demand_kg=Decimal("1000")) == "critical"


def test_no_demand_is_ok_even_without_stock():
    """Tanpa kebutuhan, tidak ada yang bisa dilanggar — jangan tampilkan lokasi tanpa data sebagai merah."""
    assert location_status(usable_stock_kg=Decimal("0"), demand_kg=Decimal("0")) == "ok"


def test_exactly_matching_demand_is_still_tight():
    """Stok pas kebutuhan = kuning, bukan hijau: tidak ada sisa sama sekali."""
    assert location_status(usable_stock_kg=Decimal("1000"), demand_kg=Decimal("1000")) == "warning"


def test_stock_above_tight_margin_is_ok():
    demand = Decimal("500")
    just_above = demand * TIGHT_MARGIN

    assert location_status(usable_stock_kg=just_above, demand_kg=demand) == "ok"
    assert location_status(usable_stock_kg=just_above - Decimal("1"), demand_kg=demand) == "warning"


def test_zero_stock_with_demand_is_critical():
    assert location_status(usable_stock_kg=Decimal("0"), demand_kg=Decimal("1")) == "critical"
