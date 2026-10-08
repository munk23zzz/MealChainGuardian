"""AWSforSAPMCPProvider — implementasi jalur AWS for SAP MCP Server (docs/Architecture.md §9.2).

Sengaja ditulis sejak Sprint 1 sebagai stub (docs/Architecture.md §4: "Ditulis sejak awal (boleh
raise NotImplementedError di body), supaya interface teruji sejak Sprint 1").

Status: BELUM ADA TENANT. Aktifkan hanya kalau panitia mengonfirmasi tertulis adanya tenant SAP data
nyata (TODO.md S5-04). Kredensial lewat AgentCore Identity, BUKAN `.env` (docs/Skill.md §7).
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
    "AWSforSAPMCPProvider belum diimplementasikan: menunggu konfirmasi tertulis tenant SAP data "
    "nyata dari panitia (docs/Architecture.md §9.2, TODO.md S5-04). Pakai SAP_*_MODE=mock."
)


class AWSforSAPMCPProvider(SAPDataProvider):
    """Stub jalur AWS for SAP MCP Server. Semua method raise sampai tenant tersedia."""

    mode: SAPMode = SAPMode.AWS_MCP

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
