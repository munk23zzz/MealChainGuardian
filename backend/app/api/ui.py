"""Endpoint baca untuk UI — bentuknya sengaja mengikuti `frontend/lib/api/schema.d.ts`.

Kenapa berkas terpisah dari `supply.py`/`decisions.py`: dua endpoint itu memakai istilah domain +
snake_case, kontrak yang dipakai test integrasi SAP dan (S3-01) akan didaftarkan ke AgentCore
Gateway. UI butuh bentuk lain — camelCase + nilai TURUNAN seperti `status` lokasi. Menambah endpoint
di sini tidak mengubah kontrak yang sudah ada, jadi integrasi agent tidak ikut berisiko.

Yang dihitung di sini karena hanya backend yang punya datanya (Rules.md: angka tidak dikarang di
frontend): stok terpakai dari `batches`, kebutuhan terbaru per lokasi, dan status lokasi (aturannya
di `app/core/location_status.py`, cermin `frontend/lib/status.ts`).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, SessionDep
from app.core.location_status import (
    FRESHNESS_WARNING_WINDOW,
    LocationStatus,
    SupplyCondition,
    has_temperature_excursion,
    location_status,
)
from app.models import Batch, Commodity, DemandRecord, Location, Supplier

router = APIRouter(tags=["ui"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _decimal(value: object) -> Decimal:
    return Decimal(str(value)) if value is not None else Decimal(0)


# --- Bentuk respons (nama kolom camelCase = kontrak UI) ------------------------------------


class LocationOut(BaseModel):
    """`Location` di `frontend/lib/api/schema.d.ts`."""

    id: str
    name: str
    region: str
    latitude: float
    longitude: float
    role_hint: str | None = Field(default=None, serialization_alias="roleHint")
    status: LocationStatus


class CommodityOut(BaseModel):
    id: str
    name: str
    unit: str


class DemandOut(BaseModel):
    """`DemandRecord` di `frontend/lib/api/schema.d.ts`."""

    location_id: str = Field(serialization_alias="locationId")
    commodity_id: str = Field(serialization_alias="commodityId")
    projected_kg: float = Field(serialization_alias="projectedKg")
    deficit_kg: float = Field(serialization_alias="deficitKg")
    surplus_kg: float = Field(serialization_alias="surplusKg")


class SupplierOut(BaseModel):
    id: str
    name: str
    location_id: str = Field(serialization_alias="locationId")
    reliability_score: float = Field(serialization_alias="reliabilityScore")


# --- Turunan dari tabel domain --------------------------------------------------------------


@dataclass(frozen=True)
class PairSupply:
    """Kondisi satu pasangan (lokasi, komoditas) dari batch-nya."""

    usable_kg: Decimal
    has_safety_fail: bool
    has_needs_verification: bool
    has_temperature_excursion: bool
    has_freshness_risk: bool


def _supply_by_pair(
    session: Session, now: datetime
) -> dict[tuple[uuid.UUID, uuid.UUID], PairSupply]:
    """Stok terpakai + tanda bahaya per (lokasi, komoditas), dari `batches` (Schema.md §2).

    Aturan yang dipegang di sini:
    - batch `safety_status='fail'` TIDAK menambah stok terpakai (Schema.md §6: batch gagal aman
      tidak boleh jadi kandidat alokasi), dan batch yang `usable_until`-nya sudah lewat juga tidak;
      menganggap keduanya tersedia akan membuat lokasi kekurangan tampak hijau;
    - tanda bahayanya tetap dihitung walau stoknya dibuang — justru itu yang membuat lokasi
      bermasalah terlihat di peta;
    - `usable_until` kosong = freshness belum dievaluasi (`/freshness/evaluate` belum jalan), jadi
      bukan tanda bahaya.
    """
    rows = session.execute(
        select(
            Batch.location_id,
            Batch.commodity_id,
            Batch.quantity_kg,
            Batch.safety_status,
            Batch.temperature_log,
            Batch.usable_until,
        )
    ).all()

    freshness_deadline = now + FRESHNESS_WARNING_WINDOW
    usable: dict[tuple[uuid.UUID, uuid.UUID], Decimal] = {}
    state: dict[tuple[uuid.UUID, uuid.UUID], dict[str, bool]] = {}

    for location_id, commodity_id, quantity_kg, safety_status, temperature_log, usable_until in rows:
        key = (location_id, commodity_id)
        usable.setdefault(key, Decimal(0))
        flags = state.setdefault(
            key,
            {
                "fail": False,
                "needs_verification": False,
                "temperature": False,
                "freshness": False,
            },
        )
        expired = usable_until is not None and usable_until <= now

        if safety_status == "fail":
            flags["fail"] = True
        if safety_status == "needs_verification":
            flags["needs_verification"] = True
        if has_temperature_excursion(temperature_log):
            flags["temperature"] = True
        if expired or (usable_until is not None and usable_until <= freshness_deadline):
            flags["freshness"] = True
        if safety_status != "fail" and not expired:
            usable[key] += _decimal(quantity_kg)

    return {
        key: PairSupply(
            usable_kg=usable[key],
            has_safety_fail=flags["fail"],
            has_needs_verification=flags["needs_verification"],
            has_temperature_excursion=flags["temperature"],
            has_freshness_risk=flags["freshness"],
        )
        for key, flags in state.items()
    }


def _latest_demand(session: Session) -> dict[tuple[uuid.UUID, uuid.UUID], Decimal]:
    """Kebutuhan TERBARU per (lokasi, komoditas).

    Yang dipakai baris terbaru, bukan jumlah seluruh riwayat: `demand_records` bersifat
    time-series (Schema.md §2), jadi menjumlahkan baris lama akan menggelembungkan kebutuhan
    setiap kali seed atau forecast berjalan.
    """
    rows = (
        session.execute(
            select(DemandRecord).order_by(
                DemandRecord.recorded_at.desc(), DemandRecord.created_at.desc()
            )
        )
        .scalars()
        .all()
    )
    latest: dict[tuple[uuid.UUID, uuid.UUID], Decimal] = {}
    for row in rows:
        latest.setdefault((row.location_id, row.commodity_id), _decimal(row.quantity_kg))
    return latest


# --- Endpoint -------------------------------------------------------------------------------


@router.get("/locations", response_model=list[LocationOut])
def list_locations(session: SessionDep, _user: CurrentUser) -> list[LocationOut]:
    """Lokasi + statusnya, untuk peta dan daftar di UI."""
    now = _now()
    supplies = _supply_by_pair(session, now)
    demand = _latest_demand(session)

    conditions: dict[uuid.UUID, list[SupplyCondition]] = {}
    for (location_id, commodity_id), pair in supplies.items():
        demand_kg = demand.get((location_id, commodity_id), Decimal(0))
        conditions.setdefault(location_id, []).append(
            SupplyCondition(
                has_safety_fail=pair.has_safety_fail,
                has_temperature_excursion=pair.has_temperature_excursion,
                has_needs_verification=pair.has_needs_verification,
                has_deficit=demand_kg > pair.usable_kg,
                has_freshness_risk=pair.has_freshness_risk,
            )
        )

    rows = session.scalars(select(Location).order_by(Location.name)).all()
    return [
        LocationOut(
            id=str(row.id),
            name=row.name,
            region=row.region,
            latitude=float(row.latitude),
            longitude=float(row.longitude),
            role_hint=row.role_hint,
            status=location_status(conditions.get(row.id, [])),
        )
        for row in rows
    ]


@router.get("/commodities", response_model=list[CommodityOut])
def list_commodities(session: SessionDep, _user: CurrentUser) -> list[CommodityOut]:
    """Komoditas yang dipantau (Schema.md §1 `commodities`)."""
    rows = session.scalars(select(Commodity).order_by(Commodity.name)).all()
    return [CommodityOut(id=str(row.id), name=row.name, unit=row.unit) for row in rows]


@router.get("/demand", response_model=list[DemandOut])
def list_demand(session: SessionDep, _user: CurrentUser) -> list[DemandOut]:
    """Kebutuhan per lokasi+komoditas, dengan selisih terhadap stok yang masih boleh dipakai."""
    supplies = _supply_by_pair(session, _now())

    out: list[DemandOut] = []
    for (location_id, commodity_id), projected in sorted(
        _latest_demand(session).items(), key=lambda item: (str(item[0][0]), str(item[0][1]))
    ):
        pair = supplies.get((location_id, commodity_id))
        stock = pair.usable_kg if pair is not None else Decimal(0)
        out.append(
            DemandOut(
                location_id=str(location_id),
                commodity_id=str(commodity_id),
                projected_kg=float(projected),
                deficit_kg=float(max(projected - stock, Decimal(0))),
                surplus_kg=float(max(stock - projected, Decimal(0))),
            )
        )
    return out


@router.get("/suppliers", response_model=list[SupplierOut])
def list_suppliers(session: SessionDep, _user: CurrentUser) -> list[SupplierOut]:
    """Pemasok + skor kepercayaan terkini (diperbarui lewat LEARN, Skill.md §10)."""
    rows = session.scalars(select(Supplier).order_by(Supplier.name)).all()
    return [
        SupplierOut(
            id=str(row.id),
            name=row.name,
            location_id=str(row.location_id),
            reliability_score=float(row.reliability_score),
        )
        for row in rows
    ]
