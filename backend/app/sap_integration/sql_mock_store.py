"""Mock SAP store di atas Postgres — implementasi protokol `SapMockStore` (docs/Schema.md §4).

Provider (`MockSAPProvider`) tidak tahu store-nya in-memory atau Postgres: keduanya memenuhi
protokol yang sama, sehingga `api/` dan `core/` tidak berubah.

Keterbatasan yang disadari:
  * `docs/Schema.md` §4 tidak punya kolom tanggal dokumen, jadi `PurchasingDocumentDate` saat dibaca
    kembali memakai tanggal `created_at` baris itu. Perlu kolom tersendiri kalau tanggal dokumen
    harus berbeda dari tanggal pembuatan PO.
  * Satu PO = satu transaksi HANYA kalau store berdiri sendiri. Untuk alur `execute` (PO + status
    keputusan + bukti + jejak agen harus atomik), store dipakai dengan `session=` milik pemanggil
    sehingga seluruh tulisan berada di satu transaksi.
"""

from __future__ import annotations

import uuid
from typing import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.models import SapMockMaterialStock, SapMockPurchaseOrder, Supplier

from .field_mapping import DEFAULT_PURCHASING_ORGANIZATION, MATERIAL_NUMBER_BY_COMMODITY
from .mapping import UnmappedSapValueError, business_partner_code, supplier_name
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

    def __init__(
        self,
        session_factory: sessionmaker[Session] | None = None,
        *,
        session: Session | None = None,
    ) -> None:
        """Dua cara pakai, dan bedanya penting untuk transaksi:

        * `SqlSapMockStore(session_factory)` — store MEMILIKI sessionnya: setiap tulis langsung
          di-commit. Dipakai seed, tool CLI, dan test yang memang menguji store sendirian.
        * `SqlSapMockStore(session=session)` — store MEMINJAM session milik pemanggil dan tidak
          pernah commit/close sendiri. Dipakai endpoint `execute`, supaya PO mock dan baris domain
          (status keputusan, bukti, jejak agen) masuk dalam SATU transaksi.
        """
        if (session_factory is None) == (session is None):
            raise ValueError(
                "Isi tepat satu: session_factory (store memiliki session) atau session (dipinjam)."
            )
        self._session_factory = session_factory
        self._session = session
        self._owns_session = session is None

    @property
    def session(self) -> Session:
        if self._session is None:
            assert self._session_factory is not None
            self._session = self._session_factory()
        return self._session

    def close(self) -> None:
        """Tutup session HANYA kalau store yang memilikinya; session pinjaman milik pemanggil."""
        if not self._owns_session:
            return
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
        """BusinessPartner = KODE SAP (`SUP-A`, docs/Skill.md §11), bukan UUID domain.

        Dokumen SAP selalu memakai kode alfanumerik, jadi provider mock pun memakai kode — sama di
        kedua mode store. Pasangan kode <-> pemasok domain ada di `field_mapping.py`
        (`BUSINESS_PARTNER_BY_SUPPLIER_NAME`); di produksi pasangan itu datang dari vendor master.
        """
        rows = self.session.scalars(select(Supplier).order_by(Supplier.name)).all()
        return tuple(
            BusinessPartnerRecord(
                BusinessPartner=business_partner_code(row.name),
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
        rows = self.session.execute(
            select(SapMockPurchaseOrder, Supplier.name)
            .join(Supplier, Supplier.id == SapMockPurchaseOrder.supplier_id)
            .order_by(SapMockPurchaseOrder.po_number)
        ).all()
        return tuple(
            _StoredPurchaseOrder(
                record=self._to_record(row, supplier_name_),
                decision_reference=str(row.decision_id) if row.decision_id else None,
            )
            for row, supplier_name_ in rows
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
        if self._owns_session:
            # store berdiri sendiri: satu tulis = satu transaksi
            self.session.commit()
        else:
            # session milik pemanggil: dia yang memutuskan commit atau rollback
            self.session.flush()

    def next_po_number(self) -> str:
        last = self.session.scalar(select(func.max(SapMockPurchaseOrder.po_number)))
        offset = int(last) - PO_NUMBER_BASE if last else 0
        return str(PO_NUMBER_BASE + offset + 1)

    # -- pembantu ---------------------------------------------------------------------

    @staticmethod
    def _to_record(row: SapMockPurchaseOrder, supplier_name_: str) -> PurchaseOrderRecord:
        return PurchaseOrderRecord(
            PurchaseOrder=row.po_number,
            # Dokumen SAP memuat KODE (`SUP-A`), bukan UUID domain — sama seperti provider in-memory.
            Supplier=business_partner_code(supplier_name_),
            MaterialNumber=row.material_number,
            OrderQuantity=row.ordered_quantity,
            NetPriceAmount=row.price,
            # createdAt sebagai pengganti tanggal dokumen (lihat keterbatasan di docstring modul)
            PurchasingDocumentDate=row.created_at.date(),
            Status=row.status,
        )

    def _supplier_uuid(self, business_partner: str) -> uuid.UUID:
        """Kode business partner SAP -> `suppliers.id` (kolom FK tetap menyimpan UUID domain)."""
        try:
            name = supplier_name(business_partner)
        except UnmappedSapValueError as exc:
            # Kesalahan pemetaan tetap dilaporkan sebagai kesalahan provider, supaya pemanggil cukup
            # menangkap satu jenis error dari lapisan SAP (lihat juga exception handler 502 di main.py).
            raise SAPProviderError(str(exc)) from exc
        supplier_id = self.session.scalar(select(Supplier.id).where(Supplier.name == name))
        if supplier_id is None:
            raise SAPProviderError(
                f"Pemasok {name!r} dipetakan dari kode {business_partner!r} tetapi tidak ada di tabel "
                "suppliers. Seed dan field_mapping.BUSINESS_PARTNER_BY_SUPPLIER_NAME tidak sinkron."
            )
        return supplier_id

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
