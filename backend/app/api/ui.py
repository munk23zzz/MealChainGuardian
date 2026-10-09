"""Endpoint baca untuk UI — bentuknya sengaja mengikuti `frontend/lib/api/schema.d.ts`.

Kenapa berkas terpisah dari `supply.py`/`decisions.py`: dua endpoint itu memakai istilah domain +
snake_case, kontrak yang dipakai test integrasi SAP dan (S3-01) akan didaftarkan ke AgentCore
Gateway. UI butuh bentuk lain — camelCase + nilai TURUNAN seperti `status` lokasi. Menambah endpoint
di sini tidak mengubah kontrak yang sudah ada, jadi integrasi agent tidak ikut berisiko.

Yang dihitung di sini karena hanya backend yang punya datanya (Rules.md: angka tidak dikarang di
frontend): stok terpakai dari `batches`, kebutuhan terbaru per lokasi, dan status lokasi.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, SessionDep
from app.core.location_status import LocationStatus, location_status
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


def _usable_stock_by_location(session: Session, now: datetime) -> dict[uuid.UUID, Decimal]:
    """Stok yang masih boleh dipakai per lokasi, dari `batches` (Schema.md §2).

    Batch `safety_status='fail'` dan batch yang `usable_until`-nya sudah lewat TIDAK dihitung:
    stok seperti itu tidak boleh menutupi kebutuhan (Schema.md §6 — batch gagal aman tidak pernah
    jadi kandidat alokasi). Menganggapnya tersedia akan membuat lokasi kekurangan tampak hijau.
    """
    rows = session.execute(
        select(Batch.location_id, func.coalesce(func.sum(Batch.quantity_kg), 0))
        .where(Batch.safety_status != "fail")
        .where(or_(Batch.usable_until.is_(None), Batch.usable_until > now))
        .group_by(Batch.location_id)
    ).all()
    return {location_id: _decimal(total) for location_id, total in rows}


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
    usable = _usable_stock_by_location(session, now)

    demand_by_location: dict[uuid.UUID, Decimal] = {}
    for (location_id, _commodity_id), quantity in _latest_demand(session).items():
        demand_by_location[location_id] = demand_by_location.get(location_id, Decimal(0)) + quantity

    rows = session.scalars(select(Location).order_by(Location.name)).all()
    return [
        LocationOut(
            id=str(row.id),
            name=row.name,
            region=row.region,
            latitude=float(row.latitude),
            longitude=float(row.longitude),
            role_hint=row.role_hint,
            status=location_status(
                usable_stock_kg=usable.get(row.id, Decimal(0)),
                demand_kg=demand_by_location.get(row.id, Decimal(0)),
            ),
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
    now = _now()
    usable = _usable_stock_by_location(session, now)

    out: list[DemandOut] = []
    for (location_id, commodity_id), projected in sorted(
        _latest_demand(session).items(), key=lambda item: (str(item[0][0]), str(item[0][1]))
    ):
        stock = usable.get(location_id, Decimal(0))
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
