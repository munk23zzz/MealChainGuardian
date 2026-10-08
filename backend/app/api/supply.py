"""Endpoint stok/supply — alat deterministik, bukan LLM (docs/Architecture.md §4, §6).

Alur: HTTP -> `SAPDataProvider` (bukan SAP langsung) -> `mapping.py` (istilah SAP jadi istilah
domain) -> respons JSON + header `X-Data-Source`.

Penyimpanan belum ada di langkah ini: endpoint membaca langsung dari provider. Tabel Postgres
(`sap_mock_*`, `supply_records` — docs/Schema.md §4/§2) menyusul, dan saat itu terjadi, kontrak
endpoint ini tidak berubah.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Iterator

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, PlainSerializer

from app.sap_integration.factory import get_sap_provider
from app.sap_integration.mapping import SupplySnapshot, to_supply_snapshots, total_quantity_kg
from app.sap_integration.provider_interface import SAPCapability, SAPDataProvider
from app.sap_integration.store_factory import get_mock_store

router = APIRouter(tags=["supply"])

# Angka domain disimpan sebagai Decimal; di JSON dikirim sebagai number (bukan string) supaya
# frontend tidak perlu parsing khusus. Presisi tetap dijaga di sisi Python.
Quantity = Annotated[
    Decimal, PlainSerializer(lambda value: float(value), return_type=float, when_used="json")
]


class SupplyRecordOut(BaseModel):
    location: str
    commodity: str
    batch: str
    quantity_kg: Quantity
    unit: str
    storage_location: str


class SupplyDetailOut(BaseModel):
    location: str
    commodity: str
    total_quantity_kg: Quantity
    unit: str
    batches: list[SupplyRecordOut]


def get_provider() -> Iterator[SAPDataProvider]:
    """Dependency provider SAP untuk satu request.

    Di produksi: dibaca dari env (`SAP_*_MODE` per kapabilitas + `SAP_MOCK_STORE`). Dioverride di
    test dengan provider apa pun. Store (mis. session Postgres) ditutup setelah request selesai.
    """
    provider = get_sap_provider(mock_store=get_mock_store())
    try:
        yield provider
    finally:
        close = getattr(provider, "close", None)
        if callable(close):
            close()


def _mark_data_source(response: Response, provider: SAPDataProvider, capability: SAPCapability) -> None:
    """Tandai sumber data respons (Rules.md: data mock wajib ditandai).

    Label diambil PER KAPABILITAS, bukan dari nilai global: kalau nanti sebagian kapabilitas sudah
    tersambung SAP asli, respons dari kapabilitas mock tetap tidak boleh dilabeli "SAP".
    """
    response.headers["X-Data-Source"] = provider.data_source_for(capability).value


def _to_out(snapshot: SupplySnapshot) -> SupplyRecordOut:
    return SupplyRecordOut(
        location=snapshot.location,
        commodity=snapshot.commodity,
        batch=snapshot.batch,
        quantity_kg=snapshot.quantity_kg,
        unit=snapshot.unit,
        storage_location=snapshot.storage_location,
    )


@router.get("/supply", response_model=list[SupplyRecordOut])
def list_supply(
    response: Response,
    provider: Annotated[SAPDataProvider, Depends(get_provider)],
    location: Annotated[str | None, Query(description="Nama lokasi domain, mis. Cianjur")] = None,
    commodity: Annotated[str | None, Query(description="Nama komoditas domain, mis. Telur")] = None,
) -> list[SupplyRecordOut]:
    """Daftar stok per batch, dalam istilah domain."""
    snapshots = to_supply_snapshots(provider.get_material_stock())
    if location is not None:
        snapshots = [s for s in snapshots if s.location.lower() == location.lower()]
    if commodity is not None:
        snapshots = [s for s in snapshots if s.commodity.lower() == commodity.lower()]
    _mark_data_source(response, provider, SAPCapability.MATERIAL_STOCK)
    return [_to_out(s) for s in snapshots]


@router.get("/supply/{location}/{commodity}", response_model=SupplyDetailOut)
def get_supply_detail(
    location: str,
    commodity: str,
    response: Response,
    provider: Annotated[SAPDataProvider, Depends(get_provider)],
) -> SupplyDetailOut:
    """Total stok satu lokasi+komoditas, dirinci per batch."""
    snapshots = to_supply_snapshots(provider.get_material_stock())
    matched = [
        s
        for s in snapshots
        if s.location.lower() == location.lower() and s.commodity.lower() == commodity.lower()
    ]
    if not matched:
        raise HTTPException(
            status_code=404,
            detail=f"Tidak ada stok untuk lokasi={location!r}, komoditas={commodity!r}",
        )
    _mark_data_source(response, provider, SAPCapability.MATERIAL_STOCK)
    return SupplyDetailOut(
        location=matched[0].location,
        commodity=matched[0].commodity,
        total_quantity_kg=total_quantity_kg(matched),
        unit=matched[0].unit,
        batches=[_to_out(s) for s in matched],
    )
