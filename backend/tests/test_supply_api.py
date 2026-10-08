"""Test endpoint /supply/* — kontrak HTTP + penandaan sumber data.

Menguji lewat TestClient dengan provider dependency dioverride, sehingga tidak butuh Postgres
maupun jaringan.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.api.supply import get_provider
from app.main import app
from app.sap_integration.mock_provider import InMemorySapMockStore, MockSAPProvider
from app.sap_integration.provider_interface import (
    DataSource,
    MaterialStockRecord,
    SAPCapability,
    SAPMode,
    SAPProviderError,
)

SEED_CIANJUR = {"location": "Cianjur", "commodity": "telur", "quantity_kg": 1400.0, "unit": "kg"}
SEED_JAKARTA = {"location": "Jakarta", "commodity": "telur", "quantity_kg": 300.0, "unit": "kg"}


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture(autouse=True)
def _default_provider():
    """Semua test di file ini pakai provider mock segar; override dibersihkan setelah test."""
    app.dependency_overrides[get_provider] = lambda: MockSAPProvider()
    yield
    app.dependency_overrides.clear()


def test_supply_lists_seeded_stock_in_domain_terms(client):
    response = client.get("/supply")

    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 2
    # istilah domain, bukan istilah SAP (tidak ada Plant/MaterialNumber di respons)
    assert {"Cianjur", "Jakarta"} == {r["location"] for r in rows}
    assert {r["commodity"] for r in rows} == {"telur"}
    assert {r["batch"] for r in rows} == {"B-2026-0101", "B-2026-0102"}
    cianjur = next(r for r in rows if r["location"] == "Cianjur")
    jakarta = next(r for r in rows if r["location"] == "Jakarta")
    assert cianjur["quantity_kg"] == SEED_CIANJUR["quantity_kg"]
    assert jakarta["quantity_kg"] == SEED_JAKARTA["quantity_kg"]
    assert "Plant" not in cianjur and "MaterialNumber" not in cianjur


def test_supply_response_is_labelled_as_mock(client):
    response = client.get("/supply")

    # Rules.md: data mock wajib ditandai — di level header
    assert response.headers["X-Data-Source"] == "MOCK"


def test_supply_quantity_is_a_json_number_not_string(client):
    rows = client.get("/supply").json()

    assert isinstance(rows[0]["quantity_kg"], float)


@pytest.mark.parametrize(
    "query,expected_locations",
    [
        ("location=cianjur", ["Cianjur"]),  # case-insensitive
        ("location=Cianjur", ["Cianjur"]),
        ("commodity=telur", ["Cianjur", "Jakarta"]),
        ("location=Bandung", []),
        ("commodity=Beras", []),
    ],
)
def test_supply_filters(client, query, expected_locations):
    response = client.get(f"/supply?{query}")

    assert response.status_code == 200
    assert [r["location"] for r in response.json()] == expected_locations


def test_supply_detail_aggregates_batches(client):
    response = client.get("/supply/cianjur/telur")

    assert response.status_code == 200
    body = response.json()
    assert body["location"] == "Cianjur"
    assert body["commodity"] == "telur"
    assert body["total_quantity_kg"] == 1400.0
    assert len(body["batches"]) == 1
    assert body["batches"][0]["batch"] == "B-2026-0101"
    assert response.headers["X-Data-Source"] == "MOCK"


def test_supply_detail_unknown_combination_is_404(client):
    response = client.get("/supply/bandung/telur")

    assert response.status_code == 404
    assert "bandung" in response.json()["detail"].lower()


# --- jalur gagal: harus jelas, bukan 500 misterius ---------------------------------------


class _UnmappedPlantProvider(MockSAPProvider):
    """Provider yang mengirim plant di luar peta domain kita."""

    def get_material_stock(self, **_kwargs):
        return [
            MaterialStockRecord(
                MaterialNumber="TELUR-01",
                Plant="XX99",
                StorageLocation="SL01",
                Batch="B-2026-9999",
                MatlStkQty=Decimal("10.00"),
                BaseUnit="KG",
            )
        ]


class _UnsupportedUnitProvider(MockSAPProvider):
    def get_material_stock(self, **_kwargs):
        return [
            MaterialStockRecord(
                MaterialNumber="TELUR-01",
                Plant="CJ01",
                StorageLocation="SL01",
                Batch="B-2026-9999",
                MatlStkQty=Decimal("10.00"),
                BaseUnit="CRT",
            )
        ]


class _SapSourcedProvider(MockSAPProvider):
    """Provider yang mengaku bersumber SAP, untuk menguji label header."""

    mode = SAPMode.ODATA

    @property
    def data_source(self) -> DataSource:
        return DataSource.SAP


def test_unmapped_plant_returns_502_with_actionable_message(client):
    app.dependency_overrides[get_provider] = lambda: _UnmappedPlantProvider()

    response = client.get("/supply")

    assert response.status_code == 502
    body = response.json()
    assert body["error"] == "sap_mapping_error"
    assert "XX99" in body["detail"] and "field_mapping.py" in body["detail"]


def test_unsupported_unit_returns_502(client):
    app.dependency_overrides[get_provider] = lambda: _UnsupportedUnitProvider()

    response = client.get("/supply")

    assert response.status_code == 502
    assert "CRT" in response.json()["detail"]


def test_header_follows_the_capability_not_the_global_flag(client):
    """Kalau kapabilitas stok nanti bersumber SAP asli, header harus ikut berubah."""
    app.dependency_overrides[get_provider] = lambda: _SapSourcedProvider()

    assert client.get("/supply").headers["X-Data-Source"] == "SAP"


class _FailingProvider(MockSAPProvider):
    def get_material_stock(self, **_kwargs):
        raise SAPProviderError("provider belum siap")


def test_provider_failure_returns_502_not_500(client):
    app.dependency_overrides[get_provider] = lambda: _FailingProvider()

    response = client.get("/supply")

    assert response.status_code == 502
    assert response.json()["error"] == "sap_provider_error"


def test_store_is_swappable_without_touching_api(client):
    """Bukti klaim docs/Architecture.md §9.2: provider bisa diganti, API tidak tahu.

    Provider di bawah memakai store kosong (tanpa seed) — respons tetap berbentuk sama.
    """
    from app.sap_integration.mock_provider import InMemorySapMockStore

    empty = MockSAPProvider(store=InMemorySapMockStore(material_stock=[], business_partners=[],
                                                      product_master=[]))
    app.dependency_overrides[get_provider] = lambda: empty

    response = client.get("/supply")

    assert response.status_code == 200
    assert response.json() == []
