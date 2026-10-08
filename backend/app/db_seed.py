"""Seed data demo ke Postgres.

Isi: master data (lokasi/komoditas/pemasok), tabel mock SAP (`docs/Schema.md` §4) berisi angka baku
`docs/Skill.md` §11, akun demo, dan tarikan awal ke `supply_records`.

Jalankan:  python -m app.db_seed
Idempoten: data master dicocokkan berdasarkan nama/kode, tabel mock ditulis ulang.
"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import get_session_factory
from app.ingest import sync_supply_records
from app.models import (
    Commodity,
    Location,
    SapMockMaterialStock,
    Supplier,
    User,
)
from app.sap_integration.field_mapping import (
    DEFAULT_STORAGE_LOCATION,
    MATERIAL_NUMBER_BY_COMMODITY,
    PLANT_CODE_BY_LOCATION,
)
from app.sap_integration.mock_provider import InMemorySapMockStore, MockSAPProvider

# --- master data (docs/Skill.md §11: Cianjur surplus, Jakarta shortage) ------------------

LOCATIONS = (
    {
        "name": "Cianjur",
        "region": "West",
        "latitude": Decimal("-6.816800"),
        "longitude": Decimal("107.142500"),
        "role_hint": "producer_hub",
    },
    {
        "name": "Jakarta",
        "region": "West",
        "latitude": Decimal("-6.208800"),
        "longitude": Decimal("106.845600"),
        "role_hint": "demand_hub",
    },
)

COMMODITIES = ({"name": "telur", "unit": "kg"},)

# Pemasok fiktif (tidak menyerupai perusahaan/orang nyata). reliability_score memakai default
# Schema.md (0.80); angka berbeda menyusul bersama alur LEARN (Skill.md §10).
SUPPLIERS = (
    {"name": "Supplier A", "location": "Cianjur", "reliability_score": Decimal("0.80")},
    {"name": "Supplier B", "location": "Cianjur", "reliability_score": Decimal("0.80")},
    {"name": "Supplier C", "location": "Jakarta", "reliability_score": Decimal("0.80")},
)

# Baris stok mock SAP = angka baku demo (docs/Skill.md §11).
MATERIAL_STOCK_ROWS = (
    {"location": "Cianjur", "batch": "B-2026-0101", "quantity": Decimal("1400.00")},
    {"location": "Jakarta", "batch": "B-2026-0102", "quantity": Decimal("300.00")},
)

# Akun demo (docs/Skill.md §9). Hash di bawah PLACEHOLDER — bukan kredensial, dan login belum ada.
DEMO_USERS = (
    {"name": "Kepala SPPG Cianjur", "email": "kepala.cianjur@demo.local", "role": "sppg_head",
     "location": "Cianjur"},
    {"name": "Ahli Gizi Cianjur", "email": "gizi.cianjur@demo.local", "role": "sppg_nutritionist",
     "location": "Cianjur"},
    {"name": "Monitor BGN", "email": "monitor@demo.local", "role": "bgn_monitor", "location": None},
)
PLACEHOLDER_PASSWORD_HASH = "!dev-placeholder-bukan-kredensial"


def seed_demo_data(session: Session) -> dict[str, int]:
    """Tulis master data + tabel mock SAP + akun demo. Mengembalikan jumlah baris per kategori."""
    location_ids: dict[str, object] = {}
    for spec in LOCATIONS:
        row = session.scalar(select(Location).where(Location.name == spec["name"]))
        if row is None:
            row = Location(**spec)
            session.add(row)
            session.flush()
        location_ids[spec["name"]] = row.id

    commodity_ids: dict[str, object] = {}
    for spec in COMMODITIES:
        row = session.scalar(select(Commodity).where(Commodity.name == spec["name"]))
        if row is None:
            row = Commodity(**spec)
            session.add(row)
            session.flush()
        commodity_ids[spec["name"]] = row.id

    for spec in SUPPLIERS:
        existing = session.scalar(select(Supplier).where(Supplier.name == spec["name"]))
        if existing is None:
            session.add(
                Supplier(
                    name=spec["name"],
                    location_id=location_ids[spec["location"]],  # type: ignore[arg-type]
                    reliability_score=spec["reliability_score"],
                )
            )

    for spec in DEMO_USERS:
        existing = session.scalar(select(User).where(User.email == spec["email"]))
        if existing is None:
            session.add(
                User(
                    name=spec["name"],
                    email=spec["email"],
                    password_hash=PLACEHOLDER_PASSWORD_HASH,
                    role=spec["role"],
                    location_id=location_ids.get(spec["location"]),  # type: ignore[arg-type]
                )
            )

    # Tabel mock SAP ditulis ulang supaya angka demo selalu sama.
    session.execute(delete(SapMockMaterialStock))
    material = MATERIAL_NUMBER_BY_COMMODITY["telur"]
    for spec in MATERIAL_STOCK_ROWS:
        session.add(
            SapMockMaterialStock(
                material_number=material,
                plant=PLANT_CODE_BY_LOCATION[spec["location"]],
                storage_location=DEFAULT_STORAGE_LOCATION,
                batch=spec["batch"],
                quantity=spec["quantity"],
                unit="KG",
            )
        )

    session.flush()

    # Tarikan awal: stok SAP -> supply_records domain (source='mock_sap').
    synced = sync_supply_records(session, MockSAPProvider(store=InMemorySapMockStore()))

    return {
        "locations": len(LOCATIONS),
        "commodities": len(COMMODITIES),
        "suppliers": len(SUPPLIERS),
        "users": len(DEMO_USERS),
        "sap_mock_material_stock": len(MATERIAL_STOCK_ROWS),
        "supply_records": synced,
    }


def main() -> None:  # pragma: no cover - dipanggil manual
    session = get_session_factory()()
    try:
        counts = seed_demo_data(session)
        print("seed selesai:")
        for key, value in counts.items():
            print(f"  {key}: {value}")
    finally:
        session.close()


if __name__ == "__main__":  # pragma: no cover
    main()
