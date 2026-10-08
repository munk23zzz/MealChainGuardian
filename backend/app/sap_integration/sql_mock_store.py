"""Mock SAP store di atas Postgres — implementasi protokol `SapMockStore` (docs/Schema.md §4).

Provider (`MockSAPProvider`) tidak tahu store-nya in-memory atau Postgres: keduanya memenuhi
protokol yang sama, sehingga `api/` dan `core/` tidak berubah.

Keterbatasan yang disadari:
  * `docs/Schema.md` §4 tidak punya kolom tanggal dokumen, jadi `PurchasingDocumentDate` saat dibaca
    kembali memakai tanggal `created_at` baris itu. Perlu kolom tersendiri kalau tanggal dokumen
    harus berbeda dari tanggal pembuatan PO.
  * Satu PO = satu transaksi. Alur approve -> execute yang butuh beberapa tulis atomik belum ada;
    waktu alur itu dibangun, penulisan harus dibungkus satu unit of work.
"""

from __future__ import annotations

import uuid
from typing import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.models import SapMockMaterialStock, SapMockPurchaseOrder, Supplier

from .field_mapping import DEFAULT_PURCHASING_ORGANIZATION, MATERIAL_NUMBER_BY_COMMODITY
from .mock_provider import PO_NUMBER_BASE, _StoredPurchaseOrder
from .provider_interface import (
    BusinessPartnerRecord,
    MaterialStockRecord,
    ProductMasterRecord,
    PurchaseOrderRecord,
    SAPProviderError,
)

_DESCRIPTION_BY_MATERIAL = {material: name for name, material in MATERIAL_NUMBER_BY_COMMODITY.items()}


class SqlSapMockStore:
    """Store mock SAP berbasis Postgres. Satu instance = satu session (satu request)."""

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory
        self._session: Session | None = None

    @property
    def session(self) -> Session:
        if self._session is None:
            self._session = self._session_factory()
        return self._session

    def close(self) -> None:
        if self._session is not None:
            self._session.close()
            self._session = None

    # -- baca -------------------------------------------------------------------------

    def material_stock(self) -> Sequence[MaterialStockRecord]:
        rows = self.session.scalars(
            select(SapMockMaterialStock).order_by(
                SapMockMaterialStock.plant, SapMockMaterialStock.batch
            )
        ).all()
        return tuple(
            MaterialStockRecord(
                MaterialNumber=row.material_number,
                Plant=row.plant,
                StorageLocation=row.storage_location,
                Batch=row.batch,
                MatlStkQty=row.quantity,
                BaseUnit=row.unit,
            )
            for row in rows
        )

    def business_partners(self) -> Sequence[BusinessPartnerRecord]:
        """BusinessPartner = `suppliers.id` (docs/Skill.md §7: suppliers.id <-> Supplier).

        SAP asli memakai kode alfanumerik, tabel domain kita memakai UUID — karena itu
        identifikasinya berupa string UUID. Pertanyaan terbuka untuk Roy: apakah perlu kolom kode SAP
        terpisah di `suppliers` supaya mock benar-benar menyerupai SAP.
        """
        rows = self.session.scalars(select(Supplier).order_by(Supplier.name)).all()
        return tuple(
            BusinessPartnerRecord(
                BusinessPartner=str(row.id),
                BusinessPartnerName=row.name,
                PurchasingOrganization=DEFAULT_PURCHASING_ORGANIZATION,
            )
            for row in rows
        )

    def product_master(self) -> Sequence[ProductMasterRecord]:
        rows = self.session.execute(
            select(SapMockMaterialStock.material_number, SapMockMaterialStock.unit)
            .distinct()
            .order_by(SapMockMaterialStock.material_number)
        ).all()
        return tuple(
            ProductMasterRecord(
                MaterialNumber=material_number,
                ProductDescription=_DESCRIPTION_BY_MATERIAL.get(material_number, material_number),
                BaseUnit=unit,
            )
            for material_number, unit in rows
        )

    def purchase_orders(self) -> Sequence[_StoredPurchaseOrder]:
        rows = self.session.scalars(
            select(SapMockPurchaseOrder).order_by(SapMockPurchaseOrder.po_number)
        ).all()
        return tuple(
            _StoredPurchaseOrder(
                record=self._to_record(row),
                decision_reference=str(row.decision_id) if row.decision_id else None,
            )
            for row in rows
        )

    # -- tulis ------------------------------------------------------------------------

    def add_purchase_order(self, stored: _StoredPurchaseOrder) -> None:
        record = stored.record
        self.session.add(
            SapMockPurchaseOrder(
                po_number=record.PurchaseOrder,
                supplier_id=self._supplier_uuid(record.Supplier),
                material_number=record.MaterialNumber,
                ordered_quantity=record.OrderQuantity,
                price=record.NetPriceAmount,
                decision_id=self._decision_uuid(stored.decision_reference),
                status=record.Status or "submitted",
            )
        )
        self.session.commit()

    def next_po_number(self) -> str:
        last = self.session.scalar(select(func.max(SapMockPurchaseOrder.po_number)))
        offset = int(last) - PO_NUMBER_BASE if last else 0
        return str(PO_NUMBER_BASE + offset + 1)

    # -- pembantu ---------------------------------------------------------------------

    @staticmethod
    def _to_record(row: SapMockPurchaseOrder) -> PurchaseOrderRecord:
        return PurchaseOrderRecord(
            PurchaseOrder=row.po_number,
            Supplier=str(row.supplier_id),
            MaterialNumber=row.material_number,
            OrderQuantity=row.ordered_quantity,
            NetPriceAmount=row.price,
            # createdAt sebagai pengganti tanggal dokumen (lihat keterbatasan di docstring modul)
            PurchasingDocumentDate=row.created_at.date(),
            Status=row.status,
        )

    @staticmethod
    def _supplier_uuid(supplier: str) -> uuid.UUID:
        try:
            return uuid.UUID(supplier)
        except ValueError as exc:
            raise SAPProviderError(
                f"Supplier {supplier!r} bukan UUID supplier yang dikenal. Provider mock Postgres "
                "memakai suppliers.id sebagai identitas business partner — ambil nilainya dari "
                "get_business_partner()."
            ) from exc

    @staticmethod
    def _decision_uuid(decision_reference: str | None) -> uuid.UUID | None:
        if decision_reference is None:
            return None
        try:
            return uuid.UUID(decision_reference)
        except ValueError as exc:
            raise SAPProviderError(
                f"DecisionReference {decision_reference!r} bukan UUID. Kolom "
                "sap_mock_purchase_orders.decision_id bertipe UUID dengan FK ke decisions.id "
                "(docs/Schema.md §4)."
            ) from exc
