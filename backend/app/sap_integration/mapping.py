"""Pemetaan record OData SAP -> model domain kita (docs/Skill.md §7).

Lapisan ini yang menjaga `core/`, `api/`, dan `agent/` tidak pernah menyentuh istilah SAP.
Di sini juga tempat error integrasi muncul dengan pesan yang bisa dibaca manusia: kalau SAP
mengirim plant/material yang tidak kita kenal, itu bug konfigurasi yang harus terlihat, bukan
diam-diam jadi `None`.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable, Mapping, Sequence

from .field_mapping import (
    BUSINESS_PARTNER_BY_SUPPLIER_NAME,
    DOMAIN_UNIT_BY_SAP_UNIT,
    MATERIAL_NUMBER_BY_COMMODITY,
    PLANT_CODE_BY_LOCATION,
)
from .provider_interface import MaterialStockRecord


class UnmappedSapValueError(RuntimeError):
    """Nilai SAP tidak punya padanan di model domain kita (plant/material tak dikenal)."""


@dataclass(frozen=True, slots=True)
class SupplySnapshot:
    """Stok satu batch, dalam istilah domain (bukan istilah SAP)."""

    location: str
    commodity: str
    batch: str
    quantity_kg: Decimal
    unit: str
    storage_location: str


_LOCATION_BY_PLANT: Mapping[str, str] = {
    plant: location for location, plant in PLANT_CODE_BY_LOCATION.items()
}
_COMMODITY_BY_MATERIAL: Mapping[str, str] = {
    material: commodity for commodity, material in MATERIAL_NUMBER_BY_COMMODITY.items()
}


def location_name(plant: str) -> str:
    try:
        return _LOCATION_BY_PLANT[plant]
    except KeyError as exc:
        dikenal = ", ".join(sorted(_LOCATION_BY_PLANT)) or "(kosong)"
        raise UnmappedSapValueError(
            f"Plant SAP {plant!r} belum dipetakan ke lokasi domain (dikenal: {dikenal}). "
            f"Tambahkan di app/sap_integration/field_mapping.py."
        ) from exc


def commodity_name(material_number: str) -> str:
    try:
        return _COMMODITY_BY_MATERIAL[material_number]
    except KeyError as exc:
        dikenal = ", ".join(sorted(_COMMODITY_BY_MATERIAL)) or "(kosong)"
        raise UnmappedSapValueError(
            f"MaterialNumber {material_number!r} belum dipetakan ke komoditas domain "
            f"(dikenal: {dikenal}). Tambahkan di app/sap_integration/field_mapping.py."
        ) from exc


def to_supply_snapshot(record: MaterialStockRecord) -> SupplySnapshot:
    """Satu record API_MATERIAL_STOCK -> satu snapshot domain.

    `MatlStkQty` + `BaseUnit` -> `quantity_kg` + `unit` (docs/Skill.md §7). Satuan dipetakan ke
    istilah domain `docs/Schema.md` §1 (`kg`); satuan yang belum dikenal ditolak keras daripada
    ditampilkan dengan satuan yang salah.
    """
    unit = DOMAIN_UNIT_BY_SAP_UNIT.get(record.BaseUnit.upper())
    if unit is None:
        dikenal = ", ".join(sorted(DOMAIN_UNIT_BY_SAP_UNIT)) or "(kosong)"
        raise UnmappedSapValueError(
            f"BaseUnit {record.BaseUnit!r} belum didukung (SAP yang dikenal: {dikenal}); konversi "
            "satuan harus eksplisit, bukan diasumsikan. Tambahkan di "
            "app/sap_integration/field_mapping.py."
        )
    return SupplySnapshot(
        location=location_name(record.Plant),
        commodity=commodity_name(record.MaterialNumber),
        batch=record.Batch,
        quantity_kg=record.MatlStkQty,
        unit=unit,
        storage_location=record.StorageLocation,
    )


def to_supply_snapshots(records: Iterable[MaterialStockRecord]) -> list[SupplySnapshot]:
    return [to_supply_snapshot(record) for record in records]


def total_quantity_kg(snapshots: Sequence[SupplySnapshot]) -> Decimal:
    return sum((s.quantity_kg for s in snapshots), start=Decimal("0"))


_SUPPLIER_NAME_BY_BUSINESS_PARTNER: Mapping[str, str] = {
    code: name for name, code in BUSINESS_PARTNER_BY_SUPPLIER_NAME.items()
}


def business_partner_code(supplier_name: str) -> str:
    """Nama pemasok domain -> kode business partner SAP (dokumen SAP memakai kode)."""
    try:
        return BUSINESS_PARTNER_BY_SUPPLIER_NAME[supplier_name]
    except KeyError as exc:
        dikenal = ", ".join(sorted(BUSINESS_PARTNER_BY_SUPPLIER_NAME)) or "(kosong)"
        raise UnmappedSapValueError(
            f"Pemasok {supplier_name!r} belum punya kode business partner SAP (dikenal: {dikenal}). "
            f"Tambahkan di app/sap_integration/field_mapping.py."
        ) from exc


def supplier_name(business_partner: str) -> str:
    """Kode business partner SAP -> nama pemasok domain (kebalikannya `business_partner_code`)."""
    try:
        return _SUPPLIER_NAME_BY_BUSINESS_PARTNER[business_partner]
    except KeyError as exc:
        dikenal = ", ".join(sorted(_SUPPLIER_NAME_BY_BUSINESS_PARTNER)) or "(kosong)"
        raise UnmappedSapValueError(
            f"BusinessPartner {business_partner!r} belum dipetakan ke pemasok domain "
            f"(dikenal: {dikenal}). Tambahkan di app/sap_integration/field_mapping.py."
        ) from exc
