"""Seed data demo ke Postgres.

Isi: master data (lokasi/komoditas/pemasok), tabel mock SAP (`docs/Schema.md` §4) berisi angka baku
`docs/Skill.md` §11, akun demo, dan tarikan awal ke `supply_records`.

Jalankan:  python -m app.db_seed
Idempoten: data master dicocokkan berdasarkan nama/kode, tabel mock ditulis ulang.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.auth import hash_password
from app.db import get_session_factory
from app.ingest import sync_supply_records
from app.models import (
    Batch,
    Commodity,
    DemandRecord,
    Location,
    PriceSignal,
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

# Demand, harga, dan atribut batch domain — angka baku docs/Skill.md §11 (demand 500/1000 kg,
# referensi harga 26.500 Rp/kg). Nilai `batches` yang tidak ada di §11 (kesegaran, suhu, sertifikasi)
# adalah placeholder demo dan WAJIB ikut ditandai sebagai data simulasi di UI (lihat deviasi #18).
DEMAND_ROWS = (
    {"location": "Cianjur", "quantity": Decimal("500.00"), "days_ahead": 3},
    {"location": "Jakarta", "quantity": Decimal("1000.00"), "days_ahead": 3},
)
REFERENCE_PRICE_PER_KG = Decimal("26500.00")
BATCH_ATTRIBUTES = {
    "B-2026-0101": {
        "harvested_days_ago": 2,
        "freshness_score": Decimal("0.95"),
        "safety_status": "pass",
        "usable_in_days": 3,
        "certification_status": "certified",
    },
    "B-2026-0102": {
        "harvested_days_ago": 2,
        "freshness_score": Decimal("0.92"),
        "safety_status": "pass",
        "usable_in_days": 3,
        "certification_status": "certified",
    },
}

# Akun demo (docs/Skill.md §9). Hash di bawah PLACEHOLDER — bukan kredensial, dan login belum ada.
#
# CATATAN (perlu keputusan Roy): §9 menyebut akun demo untuk Jakarta dan Bogor. Jakarta ada di sini;
# Bogor BELUM, karena Bogor tidak ada di dataset §11 (Cianjur surplus, Jakarta kekurangan) sehingga
# lokasinya belum ada dan stok/demand-nya akan kosong — lebih baik akunnya menyusul bersama datanya
# daripada membuat lokasi tanpa isi. Cianjur ditambahkan (additive) karena ia SPPG asal di dataset.
DEMO_USERS = (
    {"name": "Kepala SPPG Jakarta", "email": "kepala.jakarta@demo.local", "role": "sppg_head",
     "location": "Jakarta"},
    {"name": "Ahli Gizi Jakarta", "email": "gizi.jakarta@demo.local", "role": "sppg_nutritionist",
     "location": "Jakarta"},
    {"name": "Kepala SPPG Cianjur", "email": "kepala.cianjur@demo.local", "role": "sppg_head",
     "location": "Cianjur"},
    {"name": "Ahli Gizi Cianjur", "email": "gizi.cianjur@demo.local", "role": "sppg_nutritionist",
     "location": "Cianjur"},
    {"name": "Monitor BGN 1", "email": "monitor1@demo.local", "role": "bgn_monitor", "location": None},
    {"name": "Monitor BGN 2", "email": "monitor2@demo.local", "role": "bgn_monitor", "location": None},
)

# Password demo per peran. Ini BUKAN kredensial rahasia: nilainya memang ditampilkan di halaman login
# demo supaya juri bisa masuk tanpa mengetik. Yang di-hash tetap hash sungguhan (PBKDF2-SHA256) supaya
# jalur login yang diuji adalah jalur yang sama dengan produksi — bukan perbandingan string (deviasi #16).
DEMO_PASSWORD_BY_ROLE = {
    "sppg_head": "Demo#SPPG2026",
    "sppg_nutritionist": "Demo#Nut2026",
    "bgn_monitor": "Demo#BGN2026",
}


def demo_password_hash(role: str) -> str:
    """Hash password demo untuk satu peran (dipakai seed)."""
    return hash_password(DEMO_PASSWORD_BY_ROLE[role])


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
                    password_hash=demo_password_hash(spec["role"]),
                    role=spec["role"],
                    location_id=location_ids.get(spec["location"]),  # type: ignore[arg-type]
                )
            )
        else:
            # Akun demo sengaja DIKEMBALIKAN ke password demo tiap seed: nilai lama (placeholder
            # "!dev-placeholder-..." dari versi sebelum login) bukan hash yang sah, sehingga login
            # demo akan selalu gagal tanpa baris ini.
            existing.password_hash = demo_password_hash(spec["role"])

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

    # Demand + harga domain (angka baku docs/Skill.md §11). Ditulis ulang tiap seed supaya demo
    # selalu mulai dari angka yang sama.
    session.execute(delete(DemandRecord))
    for spec in DEMAND_ROWS:
        now = datetime.now(timezone.utc)
        session.add(
            DemandRecord(
                location_id=location_ids[spec["location"]],  # type: ignore[arg-type]
                commodity_id=commodity_ids["telur"],  # type: ignore[arg-type]
                quantity_kg=spec["quantity"],
                needed_by=now + timedelta(days=spec["days_ahead"]),
                recorded_at=now,
            )
        )

    session.execute(delete(PriceSignal))
    now = datetime.now(timezone.utc)
    for spec in LOCATIONS:
        session.add(
            PriceSignal(
                location_id=location_ids[spec["name"]],  # type: ignore[arg-type]
                commodity_id=commodity_ids["telur"],  # type: ignore[arg-type]
                price_per_kg=REFERENCE_PRICE_PER_KG,
                recorded_at=now,
                source="reference",
            )
        )

    # Batch domain: satu batch per baris stok SAP, dengan atribut kesegaran/keamanan demo.
    session.execute(delete(Batch))
    supplier_ids = {
        row.name: row.id for row in session.scalars(select(Supplier)).all()
    }
    for spec in MATERIAL_STOCK_ROWS:
        attributes = BATCH_ATTRIBUTES[spec["batch"]]
        session.add(
            Batch(
                commodity_id=commodity_ids["telur"],  # type: ignore[arg-type]
                location_id=location_ids[spec["location"]],  # type: ignore[arg-type]
                supplier_id=(
                    supplier_ids["Supplier A"]
                    if spec["location"] == "Cianjur"
                    else supplier_ids["Supplier C"]
                ),
                quantity_kg=spec["quantity"],
                harvested_at=now - timedelta(days=attributes["harvested_days_ago"]),
                temperature_log=[],
                certification_status=attributes["certification_status"],
                freshness_score=attributes["freshness_score"],
                safety_status=attributes["safety_status"],
                usable_until=now + timedelta(days=attributes["usable_in_days"]),
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
        "demand_records": len(DEMAND_ROWS),
        "price_signals": len(LOCATIONS),
        "batches": len(MATERIAL_STOCK_ROWS),
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
