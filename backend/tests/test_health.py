"""Smoke test app FastAPI — memastikan /health melaporkan mode SAP dengan benar."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

CAPABILITIES = {
    "MATERIAL_STOCK",
    "PURCHASE_ORDER",
    "BUSINESS_PARTNER",
    "PRODUCT_MASTER",
    "MATERIAL_DOCUMENT",
}


def test_health_reports_mock_mode_by_default(monkeypatch):
    for name in list({"SAP_MATERIAL_STOCK_MODE", "SAP_PURCHASE_ORDER_MODE", "SAP_BUSINESS_PARTNER_MODE",
                      "SAP_PRODUCT_MASTER_MODE", "SAP_MATERIAL_DOCUMENT_MODE"}):
        monkeypatch.delenv(name, raising=False)

    response = TestClient(app).get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"

    sap = body["sap"]
    assert sap["data_source"] == "MOCK"
    assert sap["is_mixed"] is False
    assert set(sap["capabilities"]) == CAPABILITIES
    assert sap["capabilities"]["MATERIAL_STOCK"] == {
        "mode": "mock",
        "data_source": "MOCK",
        "supported": True,
    }
    # MATERIAL_DOCUMENT belum punya implementasi di mana pun — harus jujur "false"
    assert sap["capabilities"]["MATERIAL_DOCUMENT"]["supported"] is False


def test_health_reflects_mixed_mode(monkeypatch):
    monkeypatch.setenv("SAP_MATERIAL_STOCK_MODE", "odata")

    sap = TestClient(app).get("/health").json()["sap"]

    assert sap["is_mixed"] is True
    assert sap["data_source"] == "MOCK"  # konservatif: belum boleh dilabeli SAP penuh
    assert sap["capabilities"]["MATERIAL_STOCK"]["mode"] == "odata"
    assert sap["capabilities"]["BUSINESS_PARTNER"]["mode"] == "mock"
