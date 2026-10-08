"""Kontrak data provider SAP — satu interface, banyak implementasi.

Ini anti-corruption layer proyek (docs/Architecture.md §9.2):
  * `core/`, `api/`, dan `agent/` TIDAK PERNAH memanggil SAP langsung — selalu lewat interface ini.
  * Implementasi boleh ditukar (mock -> tenant S/4HANA nyata) tanpa mengubah kode di core/api/agent.
  * Nama field pada record di bawah mengikuti kontrak OData docs/Skill.md §6, supaya output semua
    provider identik dan bisa dites oleh SATU contract test (tests/test_sap_integration_contract.py).
  * Pemetaan field SAP -> model domain kita ada di docs/Skill.md §7, dikodekan di `field_mapping.py`.

DEVIASI dari docs/Skill.md §6 yang perlu persetujuan Roy (keduanya additive, field §6 tidak diubah):
  1. `PurchaseOrderRecord.Status` — §6 tidak menyebut status, tapi docs/Schema.md §4 (tabel
     `sap_mock_purchase_orders`: draft|submitted|confirmed) dan UI membutuhkannya.
  2. `ProductMasterRecord` — §6 tidak mendaftar field mock untuk API_PRODUCT_SRV; dipakai minimal
     (MaterialNumber, ProductDescription, BaseUnit) karena §7 memakai API_PRODUCT_SRV untuk material.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from enum import Enum


class SAPMode(str, Enum):
    """Mode implementasi, dibaca per kapabilitas dari env (docs/Architecture.md §9.2)."""

    MOCK = "mock"
    AWS_MCP = "aws_mcp"
    ODATA = "odata"  # DEVIASI ADDITIVE: direct OData ke tenant S/4HANA nyata (CAL appliance)


class DataSource(str, Enum):
    """Sumber data satu respons — dipakai untuk header `X-Data-Source` dan badge UI.

    Aturan docs/Skill.md §6 + Rules.md: data mock WAJIB ditandai. Jangan pernah melabeli
    respons mock sebagai "SAP".
    """

    MOCK = "MOCK"
    SAP = "SAP"


class SAPCapability(str, Enum):
    """Saklar switch per kapabilitas — bukan satu saklar global (docs/Architecture.md §9.2)."""

    MATERIAL_STOCK = "MATERIAL_STOCK"
    PURCHASE_ORDER = "PURCHASE_ORDER"
    BUSINESS_PARTNER = "BUSINESS_PARTNER"
    PRODUCT_MASTER = "PRODUCT_MASTER"
    MATERIAL_DOCUMENT = "MATERIAL_DOCUMENT"


class SAPProviderError(RuntimeError):
    """Error dari sisi provider SAP (validasi, tidak ditemukan, atau mode belum tersedia)."""


# --------------------------------------------------------------------------------------
# Record — nama field = nama field OData (docs/Skill.md §6). Jangan diubah tanpa ubah §6.
# --------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class MaterialStockRecord:
    """≈ API_MATERIAL_STOCK_SRV (docs/Skill.md §6)."""

    MaterialNumber: str
    Plant: str
    StorageLocation: str
    Batch: str
    MatlStkQty: Decimal
    BaseUnit: str


@dataclass(frozen=True, slots=True)
class PurchaseOrderRecord:
    """≈ API_PURCHASEORDER_PROCESS_SRV (docs/Skill.md §6).

    Field `Status` = deviasi additive (lihat docstring modul).
    Field `ApprovalStatus`/`FiscalYear`/`CompanyCode` = field wajib SAP asli yang tidak ada di mock
    (docs/Skill.md §7): kompleksitasnya diserap di dalam provider, TIDAK boleh bocor ke core/agent.
    Untuk provider mock ketiganya harus `None`.
    """

    PurchaseOrder: str
    Supplier: str
    MaterialNumber: str
    OrderQuantity: Decimal
    NetPriceAmount: Decimal
    PurchasingDocumentDate: date
    Status: str | None = None
    ApprovalStatus: str | None = None
    FiscalYear: str | None = None
    CompanyCode: str | None = None


@dataclass(frozen=True, slots=True)
class BusinessPartnerRecord:
    """≈ API_BUSINESS_PARTNER (docs/Skill.md §6)."""

    BusinessPartner: str
    BusinessPartnerName: str
    PurchasingOrganization: str


@dataclass(frozen=True, slots=True)
class ProductMasterRecord:
    """≈ API_PRODUCT_SRV (deviasi additive, lihat docstring modul)."""

    MaterialNumber: str
    ProductDescription: str
    BaseUnit: str


@dataclass(frozen=True, slots=True)
class CreatePurchaseOrderRequest:
    """Input untuk `create_purchase_order`.

    `DecisionReference` = `decisions.id` internal kita. SAP mock menyimpannya di
    `sap_mock_purchase_orders.decision_id` (docs/Schema.md §4) supaya PO bisa dilacak balik ke
    keputusan pemicunya; provider SAP asli boleh memetakannya ke field teks bebas atau mengabaikannya.
    """

    Supplier: str
    MaterialNumber: str
    OrderQuantity: Decimal
    NetPriceAmount: Decimal
    PurchasingDocumentDate: date
    Status: str = "submitted"
    DecisionReference: str | None = None


# --------------------------------------------------------------------------------------
# Interface
# --------------------------------------------------------------------------------------


class SAPDataProvider(ABC):
    """Kontrak yang harus dipatuhi SEMUA implementasi (mock, AWS for SAP MCP, OData langsung)."""

    @property
    @abstractmethod
    def data_source(self) -> DataSource:
        """Sumber data provider ini — dipakai untuk header `X-Data-Source`."""

    @abstractmethod
    def supported_capabilities(self) -> frozenset[SAPCapability]:
        """Kapabilitas yang benar-benar diimplementasikan (stub mengembalikan himpunan kosong)."""

    @abstractmethod
    def get_material_stock(
        self,
        *,
        plant: str | None = None,
        material_number: str | None = None,
        batch: str | None = None,
    ) -> list[MaterialStockRecord]:
        """Stok fisik per plant/storage location/batch."""

    @abstractmethod
    def get_purchase_orders(
        self,
        *,
        po_number: str | None = None,
        supplier: str | None = None,
        decision_reference: str | None = None,
    ) -> list[PurchaseOrderRecord]:
        """Baca purchase order yang sudah ada."""

    @abstractmethod
    def create_purchase_order(self, request: CreatePurchaseOrderRequest) -> PurchaseOrderRecord:
        """Tulis satu purchase order. HANYA dipanggil setelah approvals.approved = true."""

    @abstractmethod
    def get_business_partner(
        self, *, business_partner: str | None = None
    ) -> list[BusinessPartnerRecord]:
        """Master supplier/business partner."""

    @abstractmethod
    def get_product_master(self, *, material_number: str | None = None) -> list[ProductMasterRecord]:
        """Master material."""
