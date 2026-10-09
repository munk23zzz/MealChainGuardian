"""Factory provider SAP — switch PER KAPABILITAS, dengan satu saklar global opsional
(docs/Architecture.md §9).

Env yang dibaca:

    SAP_MODE=mock|aws_mcp|odata                      # default untuk SEMUA kapabilitas
    SAP_MATERIAL_STOCK_MODE=mock|aws_mcp|odata       # menang atas SAP_MODE
    SAP_PURCHASE_ORDER_MODE=mock|aws_mcp|odata
    SAP_BUSINESS_PARTNER_MODE=mock|aws_mcp|odata
    SAP_PRODUCT_MASTER_MODE=mock|aws_mcp|odata
    SAP_MATERIAL_DOCUMENT_MODE=mock|aws_mcp|odata

Urutan yang menang: env PER KAPABILITAS → `SAP_MODE` → default `mock`. Jadi "satu baris konfigurasi"
yang dijanjikan dokumen memang berlaku (`SAP_MODE=aws_mcp` menyalakan jalur AWS untuk semua
kapabilitas), sementara `SAP_MATERIAL_STOCK_MODE` tetap bisa menimpanya saat hanya satu kapabilitas
yang boleh naik ke tenant nyata.

`get_sap_provider()` mengembalikan router yang meneruskan tiap method ke provider yang dipilih untuk
kapabilitasnya. Tidak ada kode di `core/`, `api/`, atau `agent/` yang berubah saat mode di-switch.
"""

from __future__ import annotations

import os
from typing import Mapping

from .aws_mcp_provider import AWSforSAPMCPProvider
from .mock_provider import MockSAPProvider, SapMockStore
from .odata_provider import ODataSAPProvider
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

CAPABILITY_ENV_VAR: Mapping[SAPCapability, str] = {
    SAPCapability.MATERIAL_STOCK: "SAP_MATERIAL_STOCK_MODE",
    SAPCapability.PURCHASE_ORDER: "SAP_PURCHASE_ORDER_MODE",
    SAPCapability.BUSINESS_PARTNER: "SAP_BUSINESS_PARTNER_MODE",
    SAPCapability.PRODUCT_MASTER: "SAP_PRODUCT_MASTER_MODE",
    SAPCapability.MATERIAL_DOCUMENT: "SAP_MATERIAL_DOCUMENT_MODE",
}

# Saklar global: dipakai kapabilitas yang env-nya sendiri tidak diisi. Inilah "satu baris" yang
# disebut docs/Architecture.md §9 — per-kapabilitas tetap menang supaya bisa naik bertahap.
GLOBAL_ENV_VAR = "SAP_MODE"

DEFAULT_MODE = SAPMode.MOCK


def resolve_mode(capability: SAPCapability, source: Mapping[str, str]) -> SAPMode:
    """Mode untuk satu kapabilitas: env per-kapabilitas → `SAP_MODE` → `mock`.

    Variabel yang ADA di env tapi nilainya tidak bisa dipakai (kosong atau salah tulis) DITOLAK,
    bukan diam-diam jadi mock — kontrak yang sudah berlaku untuk `SAP_*_MODE` dan tetap dipegang
    untuk `SAP_MODE`. Yang tidak ada sama sekali baru jatuh ke default.
    """
    var = CAPABILITY_ENV_VAR[capability]
    used = var
    raw = source.get(var)
    if raw is None:
        used = GLOBAL_ENV_VAR
        raw = source.get(GLOBAL_ENV_VAR)
    if raw is None:
        return DEFAULT_MODE
    try:
        return SAPMode(raw.strip().lower())
    except ValueError as exc:
        valid = "|".join(m.value for m in SAPMode)
        raise SAPProviderError(f"{used}={raw!r} tidak valid (pilihan: {valid})") from exc


def build_provider(mode: SAPMode, *, mock_store: SapMockStore | None = None):
    """Buat provider tunggal untuk satu mode."""
    if mode is SAPMode.MOCK:
        return MockSAPProvider(store=mock_store)
    if mode is SAPMode.AWS_MCP:
        return AWSforSAPMCPProvider()
    if mode is SAPMode.ODATA:
        return ODataSAPProvider()
    raise SAPProviderError(f"Mode SAP tidak dikenal: {mode!r}")


class SAPProviderRouter(SAPDataProvider):
    """`SAPDataProvider` yang meneruskan tiap kapabilitas ke provider yang dikonfigurasi."""

    def __init__(self, providers: Mapping[SAPCapability, object]) -> None:
        self._providers = dict(providers)

    # -- diagnostik --------------------------------------------------------------------

    def provider_for(self, capability: SAPCapability):
        try:
            return self._providers[capability]
        except KeyError as exc:  # pragma: no cover - hanya kalau kapabilitas tak terpetakan
            raise SAPProviderError(f"Kapabilitas tidak dikonfigurasi: {capability}") from exc

    def mode_for(self, capability: SAPCapability) -> SAPMode:
        return self.provider_for(capability).mode

    def data_source_for(self, capability: SAPCapability) -> DataSource:
        """Sumber data untuk satu kapabilitas — pakai ini untuk header `X-Data-Source`.

        Jangan pakai `data_source` router untuk melabeli satu respons: kalau sebagian kapabilitas
        mock dan sebagian nyata, label per respons harus mengikuti provider yang benar-benar
        menghasilkan data itu (Rules.md: data mock wajib ditandai).
        """
        return self.provider_for(capability).data_source

    @property
    def data_source(self) -> DataSource:
        """Konservatif: SAP hanya kalau SEMUA kapabilitas bersumber SAP."""
        sources = {p.data_source for p in self._providers.values()}
        return DataSource.SAP if sources == {DataSource.SAP} else DataSource.MOCK

    @property
    def is_mixed(self) -> bool:
        sources = {p.data_source for p in self._providers.values()}
        return len(sources) > 1

    def supported_capabilities(self) -> frozenset[SAPCapability]:
        return frozenset(
            cap for cap, provider in self._providers.items() if cap in provider.supported_capabilities()
        )

    def describe(self) -> dict[str, dict[str, str | bool]]:
        return {
            cap.value: {
                "mode": self.mode_for(cap).value,
                "data_source": self.data_source_for(cap).value,
                "supported": cap in self.supported_capabilities(),
            }
            for cap in self._providers
        }

    # -- delegasi ----------------------------------------------------------------------

    def get_material_stock(self, **kwargs) -> list[MaterialStockRecord]:
        return self.provider_for(SAPCapability.MATERIAL_STOCK).get_material_stock(**kwargs)

    def get_purchase_orders(self, **kwargs) -> list[PurchaseOrderRecord]:
        return self.provider_for(SAPCapability.PURCHASE_ORDER).get_purchase_orders(**kwargs)

    def create_purchase_order(self, request: CreatePurchaseOrderRequest) -> PurchaseOrderRecord:
        return self.provider_for(SAPCapability.PURCHASE_ORDER).create_purchase_order(request)

    def get_business_partner(self, **kwargs) -> list[BusinessPartnerRecord]:
        return self.provider_for(SAPCapability.BUSINESS_PARTNER).get_business_partner(**kwargs)

    def get_product_master(self, **kwargs) -> list[ProductMasterRecord]:
        return self.provider_for(SAPCapability.PRODUCT_MASTER).get_product_master(**kwargs)


def get_sap_provider(
    env: Mapping[str, str] | None = None, *, mock_store: SapMockStore | None = None
) -> SAPProviderRouter:
    """Bangun router dari env. Tiap kapabilitas: `SAP_*_MODE` → `SAP_MODE` → `mock`."""
    source = os.environ if env is None else env
    providers: dict[SAPCapability, object] = {}
    for capability in CAPABILITY_ENV_VAR:
        providers[capability] = build_provider(
            resolve_mode(capability, source), mock_store=mock_store
        )
    return SAPProviderRouter(providers)
