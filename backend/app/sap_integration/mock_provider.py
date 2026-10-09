"""MockSAPProvider — implementasi default (dan permanen) MVP.

Meniru struktur OData SAP persis (docs/Skill.md §6) dan menyajikan angka baku demo
(angkanya tinggal di `app/db_seed.py`). Lihat TODO.md S1-02: "MockSAPProvider — ini permanen, bukan sementara".

Catatan store: docs/Schema.md §4 menaruh data mock di tabel Postgres `sap_mock_material_stock` dan
`sap_mock_purchase_orders`. Provider di sini hanya berbicara ke abstraksi `SapMockStore`, sehingga
penggantian ke store SQL (P2.2) tidak menyentuh provider, api/, maupun core/.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Mapping, Protocol, Sequence

from .field_mapping import (
    BUSINESS_PARTNER_BY_SUPPLIER_NAME,
    DEFAULT_PURCHASING_ORGANIZATION,
    DEFAULT_STORAGE_LOCATION,
    MATERIAL_NUMBER_BY_COMMODITY,
    PLANT_CODE_BY_LOCATION,
)
from .provider_interface import (
    BusinessPartnerRecord,
    CreatePurchaseOrderRequest,
    DataSource,
    MaterialStockRecord,
    ProductMasterRecord,
    PurchaseOrderRecord,
    SAPCapability,
    SAPDataProvider,
    SAPMode,
    SAPProviderError,
)

_PO_NUMBER_BASE = 4_500_000_000
PO_NUMBER_BASE = _PO_NUMBER_BASE  # dipakai juga oleh store SQL agar penomoran konsisten
PO_STATUSES = ("draft", "submitted", "confirmed")


@dataclass(frozen=True, slots=True)
class _StoredPurchaseOrder:
    """PO tersimpan + referensi internal kita (`decisions.id`, docs/Schema.md §4)."""

    record: PurchaseOrderRecord
    decision_reference: str | None = None


class SapMockStore(Protocol):
    """Penyimpanan sisi-mock. Implementasi SQL (= tabel `sap_mock_*`) menyusul di P2.2."""

    def material_stock(self) -> Sequence[MaterialStockRecord]: ...
    def business_partners(self) -> Sequence[BusinessPartnerRecord]: ...
    def product_master(self) -> Sequence[ProductMasterRecord]: ...
    def purchase_orders(self) -> Sequence[_StoredPurchaseOrder]: ...
    def add_purchase_order(self, stored: _StoredPurchaseOrder) -> None: ...
    def next_po_number(self) -> str: ...


class InMemorySapMockStore:
    """Store in-memory, di-seed dengan angka baku demo (`app/db_seed.py`).

    Seed: Cianjur (CJ01) 1.400 kg telur, Jakarta (JK01) 300 kg telur — persis angka yang dipakai
    narasi demo Event 1 (surplus 900 kg vs shortage 700 kg).
    """

    def __init__(
        self,
        *,
        material_stock: Sequence[MaterialStockRecord] | None = None,
        business_partners: Sequence[BusinessPartnerRecord] | None = None,
        product_master: Sequence[ProductMasterRecord] | None = None,
        purchase_orders: Sequence[_StoredPurchaseOrder] | None = None,
    ) -> None:
        self._material_stock = list(material_stock) if material_stock is not None else list(_seed_stock())
        self._business_partners = (
            list(business_partners) if business_partners is not None else list(_seed_business_partners())
        )
        self._product_master = (
            list(product_master) if product_master is not None else list(_seed_product_master())
        )
        self._purchase_orders = list(purchase_orders) if purchase_orders is not None else []
        self._po_counter = len(self._purchase_orders)

    def material_stock(self) -> Sequence[MaterialStockRecord]:
        return tuple(self._material_stock)

    def business_partners(self) -> Sequence[BusinessPartnerRecord]:
        return tuple(self._business_partners)

    def product_master(self) -> Sequence[ProductMasterRecord]:
        return tuple(self._product_master)

    def purchase_orders(self) -> Sequence[_StoredPurchaseOrder]:
        return tuple(self._purchase_orders)

    def add_purchase_order(self, stored: _StoredPurchaseOrder) -> None:
        self._purchase_orders.append(stored)

    def next_po_number(self) -> str:
        self._po_counter += 1
        return str(_PO_NUMBER_BASE + self._po_counter)


def _seed_stock() -> tuple[MaterialStockRecord, ...]:
    # Diambil dari peta komoditas->material, bukan literal, supaya nama komoditas boleh berubah
    # mengikuti docs/Schema.md tanpa memecahkan seed.
    eggs = next(iter(MATERIAL_NUMBER_BY_COMMODITY.values()))
    return (
        MaterialStockRecord(
            MaterialNumber=eggs,
            Plant=PLANT_CODE_BY_LOCATION["Cianjur"],
            StorageLocation=DEFAULT_STORAGE_LOCATION,
            Batch="B-2026-0101",
            MatlStkQty=Decimal("1400.00"),
            BaseUnit="KG",
        ),
        MaterialStockRecord(
            MaterialNumber=eggs,
            Plant=PLANT_CODE_BY_LOCATION["Jakarta"],
            StorageLocation=DEFAULT_STORAGE_LOCATION,
            Batch="B-2026-0102",
            MatlStkQty=Decimal("300.00"),
            BaseUnit="KG",
        ),
    )


def _seed_business_partners() -> tuple[BusinessPartnerRecord, ...]:
    # Nama fiktif sesuai angka baku demo (`app/db_seed.py`) — tidak boleh menyerupai perusahaan/orang nyata.
    # Kode pemasok datang dari field_mapping (satu sumber), supaya provider in-memory dan provider
    # Postgres tidak pernah berbeda identitas.
    return tuple(
        BusinessPartnerRecord(
            BusinessPartner=code,
            BusinessPartnerName=name,
            PurchasingOrganization=DEFAULT_PURCHASING_ORGANIZATION,
        )
        for name, code in BUSINESS_PARTNER_BY_SUPPLIER_NAME.items()
    )


def _seed_product_master() -> tuple[ProductMasterRecord, ...]:
    return tuple(
        ProductMasterRecord(MaterialNumber=number, ProductDescription=name, BaseUnit="KG")
        for name, number in MATERIAL_NUMBER_BY_COMMODITY.items()
    )


class MockSAPProvider(SAPDataProvider):
    """Implementasi `SAPDataProvider` untuk mode `SAP_*_MODE=mock` (default MVP)."""

    mode: SAPMode = SAPMode.MOCK

    def __init__(self, store: SapMockStore | None = None) -> None:
        self._store: SapMockStore = store if store is not None else InMemorySapMockStore()

    def close(self) -> None:
        """Tutup resource store kalau ia punya (store Postgres memegang session)."""
        close = getattr(self._store, "close", None)
        if callable(close):
            close()

    # -- identitas ---------------------------------------------------------------------

    @property
    def data_source(self) -> DataSource:
        return DataSource.MOCK

    def supported_capabilities(self) -> frozenset[SAPCapability]:
        # MATERIAL_DOCUMENT belum punya method di interface; menyusul bersama alur
        # /actions/receive (goods receipt) — docs/Schema.md §3, docs/Skill.md §7.
        return frozenset(
            {
                SAPCapability.MATERIAL_STOCK,
                SAPCapability.PURCHASE_ORDER,
                SAPCapability.BUSINESS_PARTNER,
                SAPCapability.PRODUCT_MASTER,
            }
        )

    # -- baca -------------------------------------------------------------------------

    def get_material_stock(
        self,
        *,
        plant: str | None = None,
        material_number: str | None = None,
        batch: str | None = None,
    ) -> list[MaterialStockRecord]:
        rows = self._store.material_stock()
        if plant is not None:
            rows = [r for r in rows if r.Plant == plant]
        if material_number is not None:
            rows = [r for r in rows if r.MaterialNumber == material_number]
        if batch is not None:
            rows = [r for r in rows if r.Batch == batch]
        return list(rows)

    def get_purchase_orders(
        self,
        *,
        po_number: str | None = None,
        supplier: str | None = None,
        decision_reference: str | None = None,
    ) -> list[PurchaseOrderRecord]:
        rows = list(self._store.purchase_orders())
        if po_number is not None:
            rows = [r for r in rows if r.record.PurchaseOrder == po_number]
        if supplier is not None:
            rows = [r for r in rows if r.record.Supplier == supplier]
        if decision_reference is not None:
            rows = [r for r in rows if r.decision_reference == decision_reference]
        return [r.record for r in rows]

    def get_business_partner(
        self, *, business_partner: str | None = None
    ) -> list[BusinessPartnerRecord]:
        rows = self._store.business_partners()
        if business_partner is not None:
            rows = [r for r in rows if r.BusinessPartner == business_partner]
        return list(rows)

    def get_product_master(self, *, material_number: str | None = None) -> list[ProductMasterRecord]:
        rows = self._store.product_master()
        if material_number is not None:
            rows = [r for r in rows if r.MaterialNumber == material_number]
        return list(rows)

    # -- tulis ------------------------------------------------------------------------

    def create_purchase_order(self, request: CreatePurchaseOrderRequest) -> PurchaseOrderRecord:
        """Buat satu PO. Pemanggil WAJIB sudah memastikan `approvals.approved = true`.

        Validasi di sini sengaja ketat: ia meniru penolakan SAP asli, supaya bug pemanggil ketahuan
        di mock, bukan nanti saat tenant nyata dipakai.
        """
        self._validate(request)

        record = PurchaseOrderRecord(
            PurchaseOrder=self._store.next_po_number(),
            Supplier=request.Supplier,
            MaterialNumber=request.MaterialNumber,
            OrderQuantity=request.OrderQuantity,
            NetPriceAmount=request.NetPriceAmount,
            PurchasingDocumentDate=request.PurchasingDocumentDate,
            Status=request.Status,
            # Field wajib SAP asli tetap None di mock — diserap di dalam provider (§7).
            ApprovalStatus=None,
            FiscalYear=None,
            CompanyCode=None,
        )
        self._store.add_purchase_order(
            _StoredPurchaseOrder(record=record, decision_reference=request.DecisionReference)
        )
        return record

    def _validate(self, request: CreatePurchaseOrderRequest) -> None:
        if not any(
            bp.BusinessPartner == request.Supplier for bp in self._store.business_partners()
        ):
            raise SAPProviderError(f"Business partner tidak dikenal: {request.Supplier!r}")
        if not any(
            pm.MaterialNumber == request.MaterialNumber for pm in self._store.product_master()
        ):
            raise SAPProviderError(f"Material tidak dikenal: {request.MaterialNumber!r}")
        if request.OrderQuantity <= 0:
            raise SAPProviderError(
                f"OrderQuantity harus > 0, dapat {request.OrderQuantity!r}"
            )
        if request.NetPriceAmount < 0:
            raise SAPProviderError(
                f"NetPriceAmount tidak boleh negatif, dapat {request.NetPriceAmount!r}"
            )
        if request.Status not in PO_STATUSES:
            raise SAPProviderError(
                f"Status PO tidak valid: {request.Status!r} (pilihan: {', '.join(PO_STATUSES)})"
            )
