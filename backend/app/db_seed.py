"""Seed data demo ke Postgres.

Isi: master data (lokasi/komoditas/pemasok), tabel mock SAP (`docs/Schema.md` §4) berisi angka baku
Angka baku demo, akun demo, dan tarikan awal ke `supply_records`.

Jalankan:  python -m app.db_seed
Idempoten: data master dicocokkan berdasarkan nama/kode, tabel mock ditulis ulang.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.auth import hash_password
from app.core.shelf_life import DEFAULT_SHELF_LIFE_HOURS
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
from app.sap_integration.mock_provider import MockSAPProvider
from app.sap_integration.sql_mock_store import SqlSapMockStore

# --- master data (`app/db_seed.py`: Cianjur surplus, Jakarta shortage) ------------------

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
    # --- 8 titik tambahan dari dataset mock UI (`frontend/lib/mock-data.ts`) ----------------
    # Ditambahkan supaya mode nyata tampil sekaya mode demo. Angka baku demo (Cianjur/Jakarta) tidak
    # diubah; identitasnya pun tetap kota, bukan SPPG, karena narasi Event 1 memakai keduanya.
    # "SPPG Jakarta Pusat" di mock TIDAK diambil: titik "Jakarta" di atas sudah mewakili pusat,
    # dan menambahkan keduanya berarti menghitung kebutuhan Jakarta dua kali.
    {
        "name": "SPPG Jakarta Utara",
        "region": "West",
        "latitude": Decimal("-6.121800"),
        "longitude": Decimal("106.900000"),
        "role_hint": "demand_hub",
    },
    {
        "name": "SPPG Jakarta Barat",
        "region": "West",
        "latitude": Decimal("-6.167500"),
        "longitude": Decimal("106.763000"),
        "role_hint": "demand_hub",
    },
    {
        "name": "SPPG Jakarta Selatan",
        "region": "West",
        "latitude": Decimal("-6.261500"),
        "longitude": Decimal("106.810600"),
        "role_hint": "demand_hub",
    },
    {
        "name": "SPPG Jakarta Timur",
        "region": "West",
        "latitude": Decimal("-6.225000"),
        "longitude": Decimal("106.900400"),
        "role_hint": "demand_hub",
    },
    {
        "name": "SPPG Bogor",
        "region": "West",
        "latitude": Decimal("-6.597100"),
        "longitude": Decimal("106.806000"),
        "role_hint": "mixed",
    },
    {
        "name": "SPPG Depok",
        "region": "West",
        "latitude": Decimal("-6.402500"),
        "longitude": Decimal("106.794200"),
        "role_hint": "mixed",
    },
    {
        "name": "SPPG Tangerang",
        "region": "West",
        "latitude": Decimal("-6.178300"),
        "longitude": Decimal("106.631900"),
        "role_hint": "mixed",
    },
    {
        "name": "SPPG Bekasi",
        "region": "West",
        "latitude": Decimal("-6.238300"),
        "longitude": Decimal("106.975600"),
        "role_hint": "mixed",
    },
)

COMMODITIES = (
    {"name": "telur", "unit": "kg"},
    {"name": "ayam", "unit": "kg"},
    {"name": "wortel", "unit": "kg"},
)

# Pemasok fiktif (tidak menyerupai perusahaan/orang nyata). reliability_score memakai default
# Schema.md (0.80). Skor TIDAK lagi dihitung ulang: LEARN dihapus bersama
# `decisions.outcome` (revisi dokumen 9 Okt), jadi nilainya statis.
SUPPLIERS = (
    {"name": "Supplier A", "location": "Cianjur", "reliability_score": Decimal("0.80")},
    {"name": "Supplier B", "location": "Cianjur", "reliability_score": Decimal("0.80")},
    {"name": "Supplier C", "location": "Jakarta", "reliability_score": Decimal("0.80")},
)

# Baris pasokan demo — satu baris = satu pasangan (lokasi, komoditas).
#
# Angka baku `app/db_seed.py` (Cianjur 1.400/500 kg, Jakarta 300/1.000 kg) tetap utuh; delapan titik
# SPPG lain diambil dari dataset mock UI (`frontend/lib/mock-data.ts`) supaya mode nyata tampil sekaya
# mode demo. `batch_count` hanya MEMECAH jumlah itu jadi beberapa batch (mengikuti angka mock), bukan
# menambah stok.
#
# `safety`/`freshness_hours`/`temperature_c` menerjemahkan kolom mock (safetyStatus, freshnessStatus,
# temperatureExcursion) ke atribut batch:
#   pass + 72 jam             → batch segar
#   needs_verification + 12 h  → batch perlu verifikasi + kesegaran menipis + suhu menyimpang
#   pass + 12 jam              → kesegaran menipis (kuning)
#   fail + freshness_hours < 0 → gagal aman: batch sudah lewat usable_until dan stoknya TIDAK dihitung
#                                (Schema.md §6), tapi justru itu yang membuatnya merah di peta
# `temperature_c` di atas 4 °C = penyimpangan rantai dingin (`frontend/lib/ccp.ts`, rule `chilled`).
#
# CATATAN: `SapMockMaterialStock` in-memory (`InMemorySapMockStore`) masih memakai angka baku demo saja —
# ia fixture kontrak layer SAP. Store Postgres (mode yang dijalankan demo) memakai tabel di sini.
SUPPLY_ROWS = (
    # Angka baku demo — batch-nya sengaja SATU per titik supaya kode batch B-2026-0101/0102 (dipakai contract
    # test SAP) tidak berubah.
    {"location": "Cianjur", "commodity": "telur", "quantity": Decimal("1400.00"), "batch_count": 1,
     "price_per_kg": Decimal("26500.00"), "safety": "pass", "freshness_hours": 72,
     "temperature_c": None},
    {"location": "Jakarta", "commodity": "telur", "quantity": Decimal("300.00"), "batch_count": 1,
     "price_per_kg": Decimal("26500.00"), "safety": "pass", "freshness_hours": 72,
     "temperature_c": None},
    # --- 8 titik dari mock UI ---
    {"location": "SPPG Jakarta Utara", "commodity": "telur", "quantity": Decimal("280.00"),
     "batch_count": 2, "price_per_kg": Decimal("30000.00"), "safety": "needs_verification",
     "freshness_hours": 12, "temperature_c": Decimal("12.5")},
    {"location": "SPPG Jakarta Utara", "commodity": "ayam", "quantity": Decimal("180.00"),
     "batch_count": 1, "price_per_kg": Decimal("37000.00"), "safety": "pass",
     "freshness_hours": 12, "temperature_c": None},
    {"location": "SPPG Jakarta Utara", "commodity": "wortel", "quantity": Decimal("140.00"),
     "batch_count": 2, "price_per_kg": Decimal("13000.00"), "safety": "pass",
     "freshness_hours": 72, "temperature_c": None},
    {"location": "SPPG Jakarta Barat", "commodity": "telur", "quantity": Decimal("880.00"),
     "batch_count": 4, "price_per_kg": Decimal("27500.00"), "safety": "pass",
     "freshness_hours": 72, "temperature_c": None},
    {"location": "SPPG Jakarta Barat", "commodity": "ayam", "quantity": Decimal("600.00"),
     "batch_count": 3, "price_per_kg": Decimal("34500.00"), "safety": "pass",
     "freshness_hours": 72, "temperature_c": None},
    {"location": "SPPG Jakarta Selatan", "commodity": "ayam", "quantity": Decimal("50.00"),
     "batch_count": 1, "price_per_kg": Decimal("40000.00"), "safety": "fail",
     "freshness_hours": -6, "temperature_c": None},
    {"location": "SPPG Jakarta Timur", "commodity": "wortel", "quantity": Decimal("680.00"),
     "batch_count": 3, "price_per_kg": Decimal("11500.00"), "safety": "pass",
     "freshness_hours": 72, "temperature_c": None},
    {"location": "SPPG Bogor", "commodity": "telur", "quantity": Decimal("380.00"),
     "batch_count": 2, "price_per_kg": Decimal("29000.00"), "safety": "pass",
     "freshness_hours": 72, "temperature_c": None},
    {"location": "SPPG Bogor", "commodity": "wortel", "quantity": Decimal("110.00"),
     "batch_count": 1, "price_per_kg": Decimal("14000.00"), "safety": "pass",
     "freshness_hours": 72, "temperature_c": None},
    {"location": "SPPG Depok", "commodity": "telur", "quantity": Decimal("600.00"),
     "batch_count": 3, "price_per_kg": Decimal("27500.00"), "safety": "pass",
     "freshness_hours": 72, "temperature_c": None},
    {"location": "SPPG Depok", "commodity": "wortel", "quantity": Decimal("520.00"),
     "batch_count": 2, "price_per_kg": Decimal("11000.00"), "safety": "pass",
     "freshness_hours": 72, "temperature_c": None},
    {"location": "SPPG Tangerang", "commodity": "ayam", "quantity": Decimal("430.00"),
     "batch_count": 2, "price_per_kg": Decimal("35000.00"), "safety": "pass",
     "freshness_hours": 72, "temperature_c": None},
    {"location": "SPPG Tangerang", "commodity": "telur", "quantity": Decimal("285.00"),
     "batch_count": 2, "price_per_kg": Decimal("29500.00"), "safety": "pass",
     "freshness_hours": 12, "temperature_c": None},
    {"location": "SPPG Bekasi", "commodity": "telur", "quantity": Decimal("240.00"),
     "batch_count": 2, "price_per_kg": Decimal("31000.00"), "safety": "pass",
     "freshness_hours": 72, "temperature_c": None},
    {"location": "SPPG Bekasi", "commodity": "ayam", "quantity": Decimal("170.00"),
     "batch_count": 1, "price_per_kg": Decimal("36500.00"), "safety": "pass",
     "freshness_hours": 12, "temperature_c": None},

    # --- komoditas tambahan (langkah 2: 10 lokasi x 9 komoditas menu MBG) ----------
    {"location": "Jakarta", "commodity": "ayam", "quantity": Decimal("750.00"),
     "batch_count": 3, "price_per_kg": Decimal("35000.00"), "safety": "pass",
     "freshness_hours": 72, "temperature_c": None},
    {"location": "Jakarta", "commodity": "wortel", "quantity": Decimal("480.00"),
     "batch_count": 4, "price_per_kg": Decimal("12000.00"), "safety": "pass",
     "freshness_hours": 72, "temperature_c": None},
    {"location": "Cianjur", "commodity": "wortel", "quantity": Decimal("1520.00"),
     "batch_count": 6, "price_per_kg": Decimal("10500.00"), "safety": "pass",
     "freshness_hours": 72, "temperature_c": None},
)

# Demand per (lokasi, komoditas). Angka baku demo untuk Cianjur/Jakarta, sisanya dari mock UI. Titik yang tidak
# punya baris di sini dianggap tidak punya kebutuhan — bukan kebutuhan nol yang dikarang.
DEMAND_ROWS = (
    {"location": "Cianjur", "commodity": "telur", "quantity": Decimal("500.00"), "days_ahead": 3},
    {"location": "Jakarta", "commodity": "telur", "quantity": Decimal("1000.00"), "days_ahead": 3},
    {"location": "SPPG Jakarta Utara", "commodity": "telur", "quantity": Decimal("500.00"),
     "days_ahead": 3},
    {"location": "SPPG Jakarta Utara", "commodity": "ayam", "quantity": Decimal("300.00"),
     "days_ahead": 3},
    {"location": "SPPG Jakarta Selatan", "commodity": "ayam", "quantity": Decimal("400.00"),
     "days_ahead": 3},
    {"location": "SPPG Jakarta Timur", "commodity": "wortel", "quantity": Decimal("500.00"),
     "days_ahead": 3},
    {"location": "SPPG Bogor", "commodity": "wortel", "quantity": Decimal("250.00"), "days_ahead": 3},
    {"location": "SPPG Depok", "commodity": "telur", "quantity": Decimal("700.00"), "days_ahead": 3},
    {"location": "SPPG Tangerang", "commodity": "telur", "quantity": Decimal("420.00"),
     "days_ahead": 3},
    {"location": "SPPG Bekasi", "commodity": "telur", "quantity": Decimal("400.00"), "days_ahead": 3},
    {"location": "SPPG Bekasi", "commodity": "ayam", "quantity": Decimal("420.00"), "days_ahead": 3},
    {"location": "Jakarta", "commodity": "ayam", "quantity": Decimal("800.00"),
     "days_ahead": 3},
    {"location": "SPPG Jakarta Utara", "commodity": "wortel", "quantity": Decimal("200.00"),
     "days_ahead": 3},
)

# Harga referensi telur (`app/db_seed.py`) — sinyal harga di titik baku demo.
REFERENCE_PRICE_PER_KG = Decimal("26500.00")

# Kode batch: B-2026-0101, 0102, … (0101/0102 = angka baku demo). Nomor urut mengikuti SUPPLY_ROWS.
BATCH_CODE_PREFIX = "B-2026-"
FIRST_BATCH_NUMBER = 101

# Atribut batch yang tidak ada di angka baku demo (kesegaran, suhu, sertifikasi) adalah placeholder demo dan
# WAJIB tetap ditandai sebagai data simulasi di UI (lihat deviasi #18).
BATCH_CERTIFICATION = "hygiene"
BATCH_FRESHNESS_SCORE = Decimal("0.95")
BATCH_HARVESTED_DAYS_AGO = 2
# Suhu normal batch segar yang disimpan dingin (< 4 °C, `frontend/lib/ccp.ts`).
BATCH_BASE_TEMPERATURE_C = Decimal("2.0")

# Akun demo (`docs/Schema.md` §3: 6 akun — head + nutritionist Jakarta & Cianjur, 2 monitor BGN).
#
# Email TIGA akun pertama SENGAJA sama dengan yang tertulis di halaman login demo
# (`frontend/lib/demo-accounts.ts`, docs/design.md §1.5). Sebelumnya seed ini memakai
# `kepala.jakarta@demo.local` dkk, sehingga tombol quick-login di UI GAGAL begitu
# `NEXT_PUBLIC_USE_MOCK=false` — email itu tidak ada di database. Dokumen yang menang
# (tampilan mengikuti design.md), jadi seed ini yang menyesuaikan, bukan UI-nya.
#
# CATATAN (perlu keputusan Roy): dokumen revisi 9 Okt tidak lagi mencantumkan daftar akun demo.
# Yang ada di sini mengikuti kebutuhan demo: Jakarta (tujuan) + Cianjur (asal).
# Bogor BELUM dibuat karena tidak ada di dataset angka baku demo (Cianjur surplus, Jakarta kurang)
# sehingga lokasinya belum ada dan stok/demand-nya akan kosong — lebih baik akunnya menyusul bersama
# datanya daripada membuat lokasi tanpa isi.
UI_DEMO_EMAILS = (
    "sppg.head@demo.local",
    "sppg.nutritionist@demo.local",
    "bgn.monitor@demo.local",
)

# Email akun demo yang PERNAH dipakai dan sekarang diganti. Dipakai `seed_demo_data` untuk
# memindahkan baris akun yang sudah ada (lihat komentar di sana) — bukan sekadar catatan sejarah,
# jadi entri boleh dihapus setelah semua database (termasuk VPS nanti) pernah di-seed ulang.
RENAMED_DEMO_EMAILS = {
    "kepala.jakarta@demo.local": "sppg.head@demo.local",
    "gizi.jakarta@demo.local": "sppg.nutritionist@demo.local",
    "monitor1@demo.local": "bgn.monitor@demo.local",
    "monitor2@demo.local": "bgn.monitor2@demo.local",
}

DEMO_USERS = (
    {"name": "Kepala SPPG Jakarta", "email": "sppg.head@demo.local", "role": "sppg_head",
     "location": "Jakarta"},
    {"name": "Ahli Gizi Jakarta", "email": "sppg.nutritionist@demo.local",
     "role": "sppg_nutritionist", "location": "Jakarta"},
    {"name": "Kepala SPPG Cianjur", "email": "kepala.cianjur@demo.local", "role": "sppg_head",
     "location": "Cianjur"},
    {"name": "Ahli Gizi Cianjur", "email": "gizi.cianjur@demo.local", "role": "sppg_nutritionist",
     "location": "Cianjur"},
    {"name": "Monitor BGN 1", "email": "bgn.monitor@demo.local", "role": "bgn_monitor", "location": None},
    {"name": "Monitor BGN 2", "email": "bgn.monitor2@demo.local", "role": "bgn_monitor", "location": None},
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


def _split_quantity(total: Decimal, count: int) -> list[Decimal]:
    """Bagi satu jumlah menjadi `count` batch; selisih pembulatan ditaruh di batch terakhir.

    Jumlah batch TIDAK boleh menambah atau mengurangi stok: total hasilnya harus sama dengan `total`.
    Itu sebabnya sisanya tidak dibuang, dan dikunci test.
    """
    if count < 1:
        raise ValueError(f"batch_count minimal 1, dapat {count}")

    share = (total / count).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    quantities = [share] * (count - 1)
    quantities.append(total - share * (count - 1))
    return quantities


def _temperature_log(now: datetime, excursion_c: Decimal | None) -> list[dict[str, object]]:
    """Log suhu batch: satu bacaan normal, plus bacaan menyimpang bila barisnya memang menyimpang.

    Dua bacaan (bukan hanya yang menyimpang) supaya log-nya terbaca seperti riwayat sensor biasa —
    dan supaya ambang di `app/core/location_status.py` benar-benar diuji oleh data seed, bukan hanya
    oleh nilai buatan test.
    """
    log: list[dict[str, object]] = [
        {
            "timestamp": (now - timedelta(hours=2)).isoformat(),
            "celsius": float(BATCH_BASE_TEMPERATURE_C),
        }
    ]
    if excursion_c is not None:
        log.append({"timestamp": (now - timedelta(hours=1)).isoformat(), "celsius": float(excursion_c)})
    return log


def _freshness_score(freshness_hours: int) -> Decimal:
    """Skor kesegaran demo mengikuti sisa masa simpan (placeholder, bukan hasil `/freshness/evaluate`)."""
    if freshness_hours < 0:
        return Decimal("0.30")
    if freshness_hours < 48:
        return Decimal("0.70")
    return BATCH_FRESHNESS_SCORE


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

    # Email akun demo yang pernah berubah: barisnya di-UPDATE, bukan dihapus, dan WAJIB dijalankan
    # SEBELUM loop di bawah (kalau sesudah, akun baru sudah dibuat sehingga baris lama tertinggal).
    #
    # Kenapa UPDATE: `approvals.approved_by` (dan riwayat lain) menunjuk `users.id`, jadi menghapus
    # akun demo lama melanggar FK — dan kalau dipaksa, membuang riwayat approval. Identitas akun demo
    # = peran + lokasi; email hanya label. Idempotent: setelah sekali jalan, `old_email` tidak ada lagi.
    for old_email, new_email in RENAMED_DEMO_EMAILS.items():
        stale = session.scalar(select(User).where(User.email == old_email))
        if stale is None:
            continue
        if session.scalar(select(User).where(User.email == new_email)) is None:
            stale.email = new_email
            session.flush()
        # Kalau email baru sudah ada, baris lama dibiarkan apa adanya (masih mungkin dirujuk riwayat).

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

    # Batch + tabel mock SAP dibangun dari SATU daftar (SUPPLY_ROWS) supaya jumlah dan isinya tidak
    # bisa berbeda: `batches` = unit domain (kesegaran/keamanan/stok terpakai), baris SAP = bentuk
    # sumbernya. Sebelumnya keduanya ditulis dari daftar terpisah. (Tidak ada kolom yang menautkan
    # keduanya — Schema.md §2 tidak mendefinisikannya — jadi kesamaan yang dijamin adalah jumlah baris
    # per pasangan, dikunci test di tests/test_demo_dataset.py.)
    session.execute(delete(SapMockMaterialStock))
    session.execute(delete(Batch))
    now = datetime.now(timezone.utc)
    supplier_ids = {row.name: row.id for row in session.scalars(select(Supplier)).all()}
    # Empat titik pertama memakai pemasok dari angka baku demo apa adanya; titik tambahan memakai Supplier B
    # (menambah pemasok baru berarti mengubah `app/db_seed.py` — keputusan dokumen, bukan implementasi).
    supplier_by_location = {
        "Cianjur": "Supplier A",
        "Jakarta": "Supplier C",
    }

    batch_number = FIRST_BATCH_NUMBER
    batches_written = 0
    for spec in SUPPLY_ROWS:
        plant = PLANT_CODE_BY_LOCATION[spec["location"]]
        material = MATERIAL_NUMBER_BY_COMMODITY[spec["commodity"]]
        supplier_name = supplier_by_location.get(spec["location"], "Supplier B")
        for quantity in _split_quantity(spec["quantity"], spec["batch_count"]):
            code = f"{BATCH_CODE_PREFIX}{batch_number:04d}"
            batch_number += 1
            batches_written += 1

            session.add(
                SapMockMaterialStock(
                    material_number=material,
                    plant=plant,
                    storage_location=DEFAULT_STORAGE_LOCATION,
                    batch=code,
                    quantity=quantity,
                    unit="KG",
                )
            )
            session.add(
                Batch(
                    commodity_id=commodity_ids[spec["commodity"]],  # type: ignore[arg-type]
                    location_id=location_ids[spec["location"]],  # type: ignore[arg-type]
                    supplier_id=supplier_ids[supplier_name],
                    quantity_kg=quantity,
                    # `batches.usable_until` dihapus dari skema (9 Okt), jadi yang disetel adalah
                    # waktu panen; batas layak pakainya diturunkan (`core/shelf_life.py`).
                    # Angka `freshness_hours` seed tetap berarti "layak sampai now + N jam".
                    harvested_at=now
                    + timedelta(hours=spec["freshness_hours"] - DEFAULT_SHELF_LIFE_HOURS),
                    temperature_log=_temperature_log(now, spec["temperature_c"]),
                    certification_status=BATCH_CERTIFICATION,
                    freshness_score=_freshness_score(spec["freshness_hours"]),
                    safety_status=spec["safety"],
                )
            )

    session.flush()

    # Demand + harga domain. Ditulis ulang tiap seed supaya demo selalu mulai dari angka yang sama.
    session.execute(delete(DemandRecord))
    for spec in DEMAND_ROWS:
        session.add(
            DemandRecord(
                location_id=location_ids[spec["location"]],  # type: ignore[arg-type]
                commodity_id=commodity_ids[spec["commodity"]],  # type: ignore[arg-type]
                quantity_kg=spec["quantity"],
                needed_by=now + timedelta(days=spec["days_ahead"]),
                recorded_at=now,
            )
        )

    session.execute(delete(PriceSignal))
    for spec in SUPPLY_ROWS:
        # Kuotasi pemasok hanya masuk akal kalau lokasi itu memang punya pemasok — `price_signals`
        # mensyaratkan `supplier_id` terisi untuk source='supplier_quote' (docs/Schema.md §2,
        # ditegakkan CHECK constraint). Titik tanpa pemasok memakai harga acuan pasar (PIHPS).
        quote_supplier = supplier_by_location.get(spec["location"])
        is_reference = spec["price_per_kg"] == REFERENCE_PRICE_PER_KG or quote_supplier is None
        session.add(
            PriceSignal(
                location_id=location_ids[spec["location"]],  # type: ignore[arg-type]
                commodity_id=commodity_ids[spec["commodity"]],  # type: ignore[arg-type]
                price_per_kg=spec["price_per_kg"],
                recorded_at=now,
                source="pihps_reference" if is_reference else "supplier_quote",
                supplier_id=None if is_reference else supplier_ids[quote_supplier],  # type: ignore[index]
            )
        )

    session.flush()

    # Tarikan awal: stok SAP (store Postgres = mode yang dijalankan demo) -> supply_records domain.
    synced = sync_supply_records(session, MockSAPProvider(store=SqlSapMockStore(session=session)))

    return {
        "locations": len(LOCATIONS),
        "commodities": len(COMMODITIES),
        "suppliers": len(SUPPLIERS),
        "users": len(DEMO_USERS),
        "sap_mock_material_stock": batches_written,
        "supply_records": synced,
        "demand_records": len(DEMAND_ROWS),
        "price_signals": len(SUPPLY_ROWS),
        "batches": batches_written,
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
