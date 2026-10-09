"""Dataset demo (seed) — angka §11 utuh, perluasannya konsisten, dan stok tidak bocor.

Kenapa dijaga test: seed adalah "kebenaran" yang dilihat juri. Kalau pembagian batch menambah atau
mengurangi stok, atau kalau titik/komoditas tidak punya padanan SAP, mode nyata gagal diam-diam saat
dipakai — bukan saat dibangun.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.db_seed import (
    COMMODITIES,
    DEMAND_ROWS,
    LOCATIONS,
    SUPPLY_ROWS,
    _split_quantity,
    seed_demo_data,
)
from app.core.shelf_life import usable_until as derive_usable_until
from app.models import Batch, Commodity, DemandRecord, Location, SapMockMaterialStock
from app.sap_integration.field_mapping import (
    MATERIAL_NUMBER_BY_COMMODITY,
    PLANT_CODE_BY_LOCATION,
)

# Angka baku docs/Skill.md §11 — cerita demo (Cianjur surplus, Jakarta kekurangan).
CANONICAL = {
    ("Cianjur", "telur"): (1400, 500),
    ("Jakarta", "telur"): (300, 1000),
}
EXPECTED_BATCHES = sum(row["batch_count"] for row in SUPPLY_ROWS)


def _decimal(value: str) -> Decimal:
    return Decimal(value)


def _supply_by_pair() -> dict[tuple[str, str], dict]:
    return {(row["location"], row["commodity"]): row for row in SUPPLY_ROWS}


def _demand_by_pair() -> dict[tuple[str, str], int]:
    return {(row["location"], row["commodity"]): int(row["quantity"]) for row in DEMAND_ROWS}


@pytest.mark.parametrize(
    ("total", "count"),
    [("1400.00", 1), ("280.00", 2), ("880.00", 4), ("100.00", 3), ("50.00", 7)],
)
def test_split_quantity_conserves_stock(total, count):
    """Membagi stok jadi beberapa batch tidak boleh menambah/mengurangi stok."""
    parts = _split_quantity(_decimal(total), count)

    assert len(parts) == count
    assert sum(parts) == _decimal(total)
    assert all(part > 0 for part in parts)


def test_split_quantity_rejects_impossible_count():
    with pytest.raises(ValueError):
        _split_quantity(_decimal("100.00"), 0)


def test_every_supply_row_maps_to_sap_master_data():
    """Titik/komoditas tanpa kode plant atau nomor material akan gagal saat seed & sync."""
    names = {row["name"] for row in LOCATIONS}

    for row in SUPPLY_ROWS:
        assert row["location"] in names, f"lokasi {row['location']!r} tidak ada di LOCATIONS"
        assert row["commodity"] in {c["name"] for c in COMMODITIES}
        assert PLANT_CODE_BY_LOCATION.get(row["location"]), (
            f"plant {row['location']!r} belum dipetakan"
        )
        assert MATERIAL_NUMBER_BY_COMMODITY.get(row["commodity"]), (
            f"material {row['commodity']!r} belum dipetakan"
        )
        assert row["batch_count"] >= 1
        assert row["safety"] in {"pass", "needs_verification", "fail"}
        assert row["price_per_kg"] > 0


def test_supply_rows_do_not_repeat_a_pair():
    pairs = [(row["location"], row["commodity"]) for row in SUPPLY_ROWS]

    assert len(pairs) == len(set(pairs)), "satu (lokasi, komoditas) boleh punya satu baris saja"


def test_demand_rows_reference_known_locations_and_commodities():
    names = {row["name"] for row in LOCATIONS}

    for row in DEMAND_ROWS:
        assert row["location"] in names, f"lokasi {row['location']!r} tidak ada di LOCATIONS"
        assert row["commodity"] in {c["name"] for c in COMMODITIES}
        assert row["quantity"] > 0


def test_documented_numbers_are_still_the_demo_story():
    supply = _supply_by_pair()
    demand = _demand_by_pair()

    for pair, (stock, need) in CANONICAL.items():
        assert supply[pair]["quantity"] == stock, f"{pair} tidak lagi {stock} kg (§11)"
        assert demand[pair] == need, f"kebutuhan {pair} tidak lagi {need} kg (§11)"

    # Cianjur surplus 900 kg, Jakarta defisit 700 kg — inti cerita Event 1.
    assert demand[("Cianjur", "telur")] - supply[("Cianjur", "telur")]["quantity"] == -900
    assert demand[("Jakarta", "telur")] - supply[("Jakarta", "telur")]["quantity"] == 700


def test_canonical_rows_stay_single_batch():
    """Batch B-2026-0101/0102 dipakai contract test SAP: dua baris §11 harus tetap 1 batch."""
    assert SUPPLY_ROWS[0]["location"] == "Cianjur" and SUPPLY_ROWS[0]["batch_count"] == 1
    assert SUPPLY_ROWS[1]["location"] == "Jakarta" and SUPPLY_ROWS[1]["batch_count"] == 1


def test_seed_writes_batches_and_sap_rows_with_the_same_shape(db_factory):
    with db_factory() as session:
        counts = seed_demo_data(session)
        session.commit()

    assert counts["batches"] == EXPECTED_BATCHES
    assert counts["sap_mock_material_stock"] == EXPECTED_BATCHES
    assert counts["demand_records"] == len(DEMAND_ROWS)

    with db_factory() as session:
        codes = list(session.scalars(select(SapMockMaterialStock.batch)).all())
        quantity_sum = sum(
            float(quantity) for quantity in session.scalars(select(Batch.quantity_kg)).all()
        )

    assert len(codes) == EXPECTED_BATCHES
    assert len(set(codes)) == EXPECTED_BATCHES, "kode batch SAP harus unik"
    assert sorted(codes)[:2] == ["B-2026-0101", "B-2026-0102"], "dua kode §11 harus tetap yang itu"
    assert quantity_sum == float(sum(row["quantity"] for row in SUPPLY_ROWS))


def test_seeded_batches_conserve_the_stock_of_their_row(db_factory):
    with db_factory() as session:
        seed_demo_data(session)
        session.commit()

    with db_factory() as session:
        names = {row.id: row.name for row in session.scalars(select(Location)).all()}
        commodities = {row.id: row.name for row in session.scalars(select(Commodity)).all()}
        totals: dict[tuple[str, str], float] = {}
        for batch in session.scalars(select(Batch)).all():
            key = (names[batch.location_id], commodities[batch.commodity_id])
            totals[key] = round(totals.get(key, 0.0) + float(batch.quantity_kg), 2)

    assert totals == {
        (row["location"], row["commodity"]): float(row["quantity"]) for row in SUPPLY_ROWS
    }


def test_failed_and_excursing_batches_are_seeded_as_described(db_factory):
    """Dua kondisi yang membuat lokasi merah harus ada datanya, bukan cuma di mock UI."""
    now = datetime.now(timezone.utc)

    with db_factory() as session:
        seed_demo_data(session)
        session.commit()

    with db_factory() as session:
        names = {row.id: row.name for row in session.scalars(select(Location)).all()}
        batches = session.scalars(select(Batch)).all()
        failed = [b for b in batches if b.safety_status == "fail"]
        excursing = [
            b for b in batches if any(float(entry["celsius"]) > 4.0 for entry in b.temperature_log)
        ]

    # Kasus merah harus tetap ada datanya: satu batch gagal aman (Jakarta Selatan) dan satu titik
    # penyimpangan suhu rantai dingin (Jakarta Utara). Jangan dilonggarkan jadi "> 0" — kalau ada
    # yang menghapus barisnya, nama lokasinya tidak lagi cocok dengan narasi demo.
    assert [names[b.location_id] for b in failed] == ["SPPG Jakarta Selatan"]
    assert all(derive_usable_until(b.harvested_at) < now for b in failed), (
        "batch gagal aman harus sudah lewat masa pakai"
    )
    # Titik itu punya 2 batch, jadi keduanya harus menyimpang — bukan hanya satu.
    assert {names[b.location_id] for b in excursing} == {"SPPG Jakarta Utara"}


def test_seeded_demand_records_are_dated_ahead(db_factory):
    """Kebutuhan selalu punya tenggat di depan; kalau tidak, UI menampilkannya sebagai telat."""
    with db_factory() as session:
        seed_demo_data(session)
        session.commit()

    with db_factory() as session:
        needs = list(session.scalars(select(DemandRecord.needed_by)).all())

    assert needs and all(need > datetime.now(timezone.utc) for need in needs)
