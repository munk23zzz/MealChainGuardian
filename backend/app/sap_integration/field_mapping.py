"""Pemetaan field SAP <-> model domain kita, sebagai kode.

Sumber: docs/Skill.md §7. Tabel ini adalah kontrak: kalau sap_integration berubah, tabel ini ikut
berubah, dan tests/test_sap_integration_contract.py akan gagal kalau keduanya tidak sinkron.

Aturan docs/Skill.md §7:
  * field wajib tambahan dari SAP asli (approval status, fiscal year, company code) diisi default
    DI DALAM provider — tidak boleh bocor ke core/ atau agent.
  * model domain kita (kolom kiri) tidak boleh berubah.
"""

from __future__ import annotations

from typing import Final

# (field domain kita, field SAP, API asal) — urutan mengikuti docs/Skill.md §7.
FIELD_MAPPING: Final[tuple[tuple[str, str, str], ...]] = (
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

# Field SAP yang tidak ada di mock; provider SAP asli mengisi default di dalam provider (§7).
SAP_ONLY_PURCHASE_ORDER_FIELDS: Final[tuple[str, ...]] = (
    "ApprovalStatus",
    "FiscalYear",
    "CompanyCode",
)

# Kode SAP untuk angka baku demo (docs/Skill.md §11). SAP asli memakai kode, bukan nama —
# jadi mock juga memakai kode supaya bentuknya identik. Nama tampilan dipetakan di sini.
# KEPUTUSAN YANG PERLU DIKONFIRMASI: apakah demo memakai kode plant (CJ01/JK01) atau nama.
PLANT_CODE_BY_LOCATION: Final[dict[str, str]] = {
    "Cianjur": "CJ01",
    "Jakarta": "JK01",
}

# Nama komoditas mengikuti `docs/Schema.md` §1 (`commodities.name`: "telur", huruf kecil) —
# dokumen adalah kontrak, jadi istilah tampilan pun ikut huruf kecil.
MATERIAL_NUMBER_BY_COMMODITY: Final[dict[str, str]] = {
    "telur": "TELUR-01",
}

DEFAULT_STORAGE_LOCATION: Final[str] = "SL01"
DEFAULT_PURCHASING_ORGANIZATION: Final[str] = "PO01"

# Satuan domain (docs/Schema.md §1: `commodities.unit` = "kg"). SAP mengirim "KG".
DOMAIN_UNIT_BY_SAP_UNIT: Final[dict[str, str]] = {"KG": "kg"}
