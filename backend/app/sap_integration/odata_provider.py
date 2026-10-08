"""ODataSAPProvider — implementasi jalur OData langsung ke tenant S/4HANA (CAL appliance).

DEVIASI ADDITIVE terhadap docs/Architecture.md §4: file ini tidak ada di daftar folder dokumen.
Alasannya: §9.2 hanya merencanakan dua mode (mock | aws_mcp), padahal tenant yang benar-benar
tersedia untuk proyek ini adalah appliance S/4HANA yang di-hosting sendiri (SAP Cloud Appliance
Library), yang diakses lewat OData + basic auth — bukan lewat AWS for SAP MCP Server.

Service yang ditargetkan (docs/Skill.md §7):
  API_MATERIAL_STOCK_SRV, API_PURCHASEORDER_PROCESS_SRV, API_BUSINESS_PARTNER,
  API_PRODUCT_SRV, API_MATERIAL_DOCUMENT.

Status: STUB. Host/port/kredensial tenant belum ada, dan kontrak field §7 belum diverifikasi
terhadap sistem nyata. Implementasi diisi setelah sesi capture pertama (lihat laporan
"Fase A" — A1..A4), dan begitu selesai, kontrak yang sama harus lolos
tests/test_sap_integration_contract.py tanpa mengubah core/, api/, maupun agent/.
"""

from __future__ import annotations

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

_MESSAGE = (
    "ODataSAPProvider belum diimplementasikan: menunggu sesi capture terhadap tenant S/4HANA "
    "(host, kredensial, dan verifikasi kontrak field docs/Skill.md §7). Pakai SAP_*_MODE=mock."
)


class ODataSAPProvider(SAPDataProvider):
    """Stub jalur OData langsung. Semua method raise sampai tenant disiapkan."""

    mode: SAPMode = SAPMode.ODATA

    @property
    def data_source(self) -> DataSource:
        return DataSource.SAP

    def supported_capabilities(self) -> frozenset[SAPCapability]:
        return frozenset()

    def get_material_stock(
        self,
        *,
        plant: str | None = None,
        material_number: str | None = None,
        batch: str | None = None,
    ) -> list[MaterialStockRecord]:
        raise SAPProviderError(_MESSAGE)

    def get_purchase_orders(
        self,
        *,
        po_number: str | None = None,
        supplier: str | None = None,
        decision_reference: str | None = None,
    ) -> list[PurchaseOrderRecord]:
        raise SAPProviderError(_MESSAGE)

    def create_purchase_order(self, request: CreatePurchaseOrderRequest) -> PurchaseOrderRecord:
        raise SAPProviderError(_MESSAGE)

    def get_business_partner(
        self, *, business_partner: str | None = None
    ) -> list[BusinessPartnerRecord]:
        raise SAPProviderError(_MESSAGE)

    def get_product_master(self, *, material_number: str | None = None) -> list[ProductMasterRecord]:
        raise SAPProviderError(_MESSAGE)
