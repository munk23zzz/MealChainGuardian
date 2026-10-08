"""Contract test integrasi SAP — SATU suite, berlaku untuk SEMUA provider.

Dasar: docs/Architecture.md §4 ("test yang sama jalan untuk KEDUA provider — bukti kontrak identik")
dan §9.2 ("tidak ada kode di core/, api/, atau agent yang berubah kalau ini di-switch").

Setiap test yang memakai fixture `contract_provider` otomatis dijalankan untuk setiap provider yang
terdaftar di tests/conftest.py. Menambah implementasi nyata = menambah satu baris di sana, bukan
menulis test baru.
"""

from __future__ import annotations

import dataclasses
from datetime import date
from typing import Any
from decimal import Decimal

import pytest

from app.sap_integration import field_mapping as fm
from app.sap_integration.factory import CAPABILITY_ENV_VAR, get_sap_provider
from app.sap_integration.provider_interface import (
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

# --- kontrak field, disalin dari docs/Skill.md §6 ---------------------------------------

MATERIAL_STOCK_CONTRACT_FIELDS = {
    "MaterialNumber",
    "Plant",
    "StorageLocation",
    "Batch",
    "MatlStkQty",
    "BaseUnit",
}
PURCHASE_ORDER_CONTRACT_FIELDS = {
    "PurchaseOrder",
    "Supplier",
    "MaterialNumber",
    "OrderQuantity",
    "NetPriceAmount",
    "PurchasingDocumentDate",
}
PURCHASE_ORDER_EXTRA_FIELDS = {"Status", "ApprovalStatus", "FiscalYear", "CompanyCode"}
BUSINESS_PARTNER_CONTRACT_FIELDS = {
    "BusinessPartner",
    "BusinessPartnerName",
    "PurchasingOrganization",
}

# --- angka baku demo, docs/Skill.md §11 --------------------------------------------------

SEED_STOCK = {
    ("CJ01", "TELUR-01"): Decimal("1400.00"),  # Cianjur, surplus 900 kg
    ("JK01", "TELUR-01"): Decimal("300.00"),  # Jakarta, shortage 700 kg
}
SUPPLIER_NAMES = {"Supplier A", "Supplier B", "Supplier C"}


def _first_supplier(provider) -> str:
    """Identitas business partner diambil dari provider, bukan ditulis harfiah.

    Store memory memakai kode demo (SUP-A...), store Postgres memakai `suppliers.id` (UUID).
    Identitas adalah urusan store; yang harus identik adalah bentuk dan perilakunya.
    """
    return provider.get_business_partner()[0].BusinessPartner


def _assert_same_except_document_date(actual: PurchaseOrderRecord, expected: PurchaseOrderRecord) -> None:
    """Bandingkan PO kecuali tanggal dokumen.

    `docs/Schema.md` §4 tidak punya kolom tanggal dokumen, jadi store Postgres memakai `created_at`
    saat membaca kembali. Perlu kolom sendiri kalau tanggal harus benar-benar identik.
    """
    for field_name in (
        "PurchaseOrder",
        "Supplier",
        "MaterialNumber",
        "OrderQuantity",
        "NetPriceAmount",
        "Status",
        "ApprovalStatus",
        "FiscalYear",
        "CompanyCode",
    ):
        assert getattr(actual, field_name) == getattr(expected, field_name)


def _request(**overrides: Any) -> CreatePurchaseOrderRequest:
    """Permintaan PO contoh. `DecisionReference` sengaja None: tautan ke keputusan adalah
    bookkeeping mock kita, bukan bagian kontrak SAP — diuji terpisah."""
    base: dict[str, Any] = dict(
        Supplier="SUP-A",
        MaterialNumber="TELUR-01",
        OrderQuantity=Decimal("700.00"),
        NetPriceAmount=Decimal("26200.00"),
        PurchasingDocumentDate=date(2026, 10, 8),
        DecisionReference=None,
    )
    base.update(overrides)
    return CreatePurchaseOrderRequest(**base)


# --- 1. kontrak dokumen: bentuk record tidak boleh melenceng -----------------------------


def test_material_stock_fields_match_skill_md_section6():
    names = {f.name for f in dataclasses.fields(MaterialStockRecord)}
    assert names == MATERIAL_STOCK_CONTRACT_FIELDS


def test_business_partner_fields_match_skill_md_section6():
    names = {f.name for f in dataclasses.fields(BusinessPartnerRecord)}
    assert names == BUSINESS_PARTNER_CONTRACT_FIELDS


def test_purchase_order_fields_are_section6_plus_declared_extras():
    names = {f.name for f in dataclasses.fields(PurchaseOrderRecord)}
    assert PURCHASE_ORDER_CONTRACT_FIELDS <= names
    assert names - PURCHASE_ORDER_CONTRACT_FIELDS == PURCHASE_ORDER_EXTRA_FIELDS


def test_product_master_field_set_is_explicit():
    # §6 belum mendaftar field mock untuk API_PRODUCT_SRV; deviasi additive ini dikunci di test
    # supaya perubahan berikutnya terlihat, bukan tersembunyi.
    names = {f.name for f in dataclasses.fields(ProductMasterRecord)}
    assert names == {"MaterialNumber", "ProductDescription", "BaseUnit"}


def test_field_mapping_matches_skill_md_section7():
    assert fm.FIELD_MAPPING == (
        ("locations.name", "Plant", "API_MATERIAL_STOCK"),
        ("batches.id", "Batch", "API_MATERIAL_STOCK"),
        ("commodities.name", "MaterialNumber", "API_MATERIAL_STOCK, API_PRODUCT_SRV"),
        ("supply_records.quantity_kg", "MatlStkQty", "API_MATERIAL_STOCK"),
        ("decisions.id", "PurchaseOrder", "API_PURCHASEORDER_PROCESS_SRV"),
        ("suppliers.id", "Supplier", "API_BUSINESS_PARTNER"),
        ("decisions.quantity_kg", "OrderQuantity", "API_PURCHASEORDER_PROCESS_SRV"),
        ("decisions.safe_delivered_cost", "NetPriceAmount", "API_PURCHASEORDER_PROCESS_SRV"),
        ("goods_receipt", "MaterialDocument", "API_MATERIAL_DOCUMENT"),
    )
    assert set(fm.SAP_ONLY_PURCHASE_ORDER_FIELDS) == {"ApprovalStatus", "FiscalYear", "CompanyCode"}


# --- 2. kontrak perilaku: berlaku untuk setiap provider terdaftar ------------------------


def test_provider_implements_the_interface(contract_provider):
    assert isinstance(contract_provider, SAPDataProvider)


def test_data_source_is_labelled(contract_provider):
    assert contract_provider.data_source in (DataSource.MOCK, DataSource.SAP)


def test_material_stock_seed_matches_demo_dataset(contract_provider):
    rows = contract_provider.get_material_stock()
    assert {(r.Plant, r.MaterialNumber): r.MatlStkQty for r in rows} == SEED_STOCK
    assert {r.BaseUnit for r in rows} == {"KG"}
    assert {r.Batch for r in rows} == {"B-2026-0101", "B-2026-0102"}


def test_material_stock_filters(contract_provider):
    assert [r.Plant for r in contract_provider.get_material_stock(plant="CJ01")] == ["CJ01"]
    assert len(contract_provider.get_material_stock(material_number="TELUR-01")) == 2
    assert len(contract_provider.get_material_stock(batch="B-2026-0102")) == 1
    assert contract_provider.get_material_stock(plant="TIDAK-ADA") == []
    assert contract_provider.get_material_stock(material_number="Beras") == []


def test_business_partner_seed_matches_demo_dataset(contract_provider):
    partners = contract_provider.get_business_partner()

    assert {p.BusinessPartnerName for p in partners} == SUPPLIER_NAMES
    assert {p.PurchasingOrganization for p in partners} == {"PO01"}
    ids = [p.BusinessPartner for p in partners]
    assert all(ids) and len(set(ids)) == 3
    assert [
        p.BusinessPartner
        for p in contract_provider.get_business_partner(business_partner=ids[0])
    ] == [ids[0]]


def test_product_master_exposes_seeded_material(contract_provider):
    material = contract_provider.get_product_master(material_number="TELUR-01")
    assert len(material) == 1
    assert material[0].ProductDescription == "telur"
    assert material[0].BaseUnit == "KG"


def test_purchase_order_roundtrip_and_po_number_format(contract_provider):
    assert contract_provider.get_purchase_orders() == []

    supplier = _first_supplier(contract_provider)
    po = contract_provider.create_purchase_order(_request(Supplier=supplier))

    assert isinstance(po, PurchaseOrderRecord)
    assert po.PurchaseOrder == "4500000001"
    assert len(po.PurchaseOrder) == 10
    assert po.PurchaseOrder.startswith("450000")
    assert po.Status == "submitted"
    assert po.Supplier == supplier
    assert po.MaterialNumber == "TELUR-01"
    assert po.OrderQuantity == Decimal("700.00")
    assert po.NetPriceAmount == Decimal("26200.00")
    assert isinstance(po.PurchasingDocumentDate, date)

    # field wajib SAP asli tidak boleh bocor dari mock (§7)
    assert po.ApprovalStatus is None
    assert po.FiscalYear is None
    assert po.CompanyCode is None

    # dibaca balik lewat filter po_number dan supplier
    back = contract_provider.get_purchase_orders(po_number=po.PurchaseOrder)
    assert len(back) == 1
    _assert_same_except_document_date(back[0], po)
    assert contract_provider.get_purchase_orders(supplier=supplier) == back

    # nomor PO naik, PO kedua ikut tersimpan
    po2 = contract_provider.create_purchase_order(_request(Supplier=supplier))
    assert po2.PurchaseOrder == "4500000002"
    assert len(contract_provider.get_purchase_orders()) == 2


def test_decision_reference_is_mock_bookkeeping(mock_provider):
    """Tautan PO <-> keputusan tidak ada di SAP asli: ia bookkeeping internal kita.

    Karena itu tidak diuji di kontrak bersama — store memory menyimpan string bebas, sedangkan store
    Postgres menyimpannya di kolom UUID ber-FK ke `decisions.id` (docs/Schema.md §4).
    """
    po = mock_provider.create_purchase_order(_request(DecisionReference="dec-002"))

    assert mock_provider.get_purchase_orders(decision_reference="dec-002") == [po]
    assert mock_provider.get_purchase_orders(decision_reference="dec-999") == []


def test_purchase_order_status_can_be_draft(contract_provider):
    supplier = _first_supplier(contract_provider)
    po = contract_provider.create_purchase_order(_request(Supplier=supplier, Status="draft"))

    assert po.Status == "draft"


@pytest.mark.parametrize(
    "overrides,pesan",
    [
        ({"Supplier": "SUP-Z"}, "(?i)business partner"),
        ({"MaterialNumber": "TIDAK-ADA"}, "(?i)material"),
        ({"OrderQuantity": Decimal("0")}, "OrderQuantity"),
        ({"OrderQuantity": Decimal("-5")}, "OrderQuantity"),
        ({"NetPriceAmount": Decimal("-1")}, "NetPriceAmount"),
        ({"Status": "selesai"}, "Status"),
    ],
)
def test_purchase_order_validation_rejects_bad_input(contract_provider, overrides, pesan):
    base = {"Supplier": _first_supplier(contract_provider)}
    base.update(overrides)

    with pytest.raises(SAPProviderError, match=pesan):
        contract_provider.create_purchase_order(_request(**base))


class TestRouter:
    """Switch per kapabilitas (docs/Architecture.md §9.2)."""

    def test_defaults_to_mock_everywhere(self):
        router = get_sap_provider(env={})
        assert router.data_source is DataSource.MOCK
        assert router.is_mixed is False
        assert set(router.describe()) == {cap.value for cap in CAPABILITY_ENV_VAR}
        assert all(entry["mode"] == "mock" for entry in router.describe().values())

    def test_mock_router_serves_seeded_data(self):
        router = get_sap_provider(env={})
        assert {(r.Plant): r.MatlStkQty for r in router.get_material_stock()} == {
            "CJ01": Decimal("1400.00"),
            "JK01": Decimal("300.00"),
        }

    def test_switch_is_per_capability_not_global(self):
        router = get_sap_provider(env={"SAP_MATERIAL_STOCK_MODE": "odata"})

        assert router.mode_for(SAPCapability.MATERIAL_STOCK) is SAPMode.ODATA
        assert router.data_source_for(SAPCapability.MATERIAL_STOCK) is DataSource.SAP
        assert router.is_mixed is True
        # konservatif: sebagian nyata => belum boleh dilabeli SAP penuh
        assert router.data_source is DataSource.MOCK

        # kapabilitas yang di-switch benar-benar berpindah ke stub (raise), yang lain tetap mock
        with pytest.raises(SAPProviderError):
            router.get_material_stock()
        assert router.get_business_partner()[0].BusinessPartner == "SUP-A"

    def test_supported_capabilities_reflect_implementation(self):
        mock_router = get_sap_provider(env={})
        assert mock_router.supported_capabilities() == frozenset(
            {
                SAPCapability.MATERIAL_STOCK,
                SAPCapability.PURCHASE_ORDER,
                SAPCapability.BUSINESS_PARTNER,
                SAPCapability.PRODUCT_MASTER,
            }
        )
        assert SAPCapability.MATERIAL_DOCUMENT not in mock_router.supported_capabilities()

        stub_router = get_sap_provider(env={"SAP_PURCHASE_ORDER_MODE": "aws_mcp"})
        assert SAPCapability.PURCHASE_ORDER not in stub_router.supported_capabilities()

    @pytest.mark.parametrize("value", ["banana", "", "aws-mcp "])
    def test_unknown_mode_is_rejected(self, value):
        with pytest.raises(SAPProviderError):
            get_sap_provider(env={"SAP_PURCHASE_ORDER_MODE": value})

    def test_mode_value_is_case_insensitive(self):
        router = get_sap_provider(env={"SAP_PURCHASE_ORDER_MODE": " AWS_MCP "})
        assert router.mode_for(SAPCapability.PURCHASE_ORDER) is SAPMode.AWS_MCP


# --- 3. jalur nyata harus jujur soal statusnya ------------------------------------------


def test_real_path_providers_are_explicit_stubs(real_provider_stubs):
    for provider in real_provider_stubs:
        assert isinstance(provider, SAPDataProvider)
        assert provider.data_source is DataSource.SAP
        assert provider.supported_capabilities() == frozenset()
        for call in (
            lambda p=provider: p.get_material_stock(),
            lambda p=provider: p.get_purchase_orders(),
            lambda p=provider: p.create_purchase_order(_request()),
            lambda p=provider: p.get_business_partner(),
            lambda p=provider: p.get_product_master(),
        ):
            with pytest.raises(SAPProviderError, match="belum diimplementasikan"):
                call()
