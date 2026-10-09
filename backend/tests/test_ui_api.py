"""Endpoint baca untuk UI (`app/api/ui.py`) — angka & bentuknya diuji terhadap seed nyata.

Seed demo (docs/Skill.md §11): Cianjur stok 1400 kg / kebutuhan 500 kg, Jakarta stok 300 kg /
kebutuhan 1000 kg. Angka itu yang membuat Cianjur surplus dan Jakarta kekurangan — cerita yang
sama dengan §11, jadi test di sini sekaligus menjaga cerita demo tidak diam-diam berubah.
"""

from __future__ import annotations

import pytest

from api_support import JAKARTA_HEAD, MONITOR, user_headers

pytestmark = pytest.mark.usefixtures("client")


def _by_name(rows: list[dict], name: str) -> dict:
    matched = [row for row in rows if row["name"] == name]
    assert matched, f"lokasi {name!r} tidak ada di respons"
    return matched[0]


def test_locations_use_the_ui_field_names(client):
    headers = user_headers(client, JAKARTA_HEAD)

    response = client.get("/locations", headers=headers)

    assert response.status_code == 200
    rows = response.json()
    assert {row["name"] for row in rows} == {"Cianjur", "Jakarta"}
    location = _by_name(rows, "Jakarta")
    # camelCase + angka, bukan string: kontrak `frontend/lib/api/schema.d.ts`.
    assert set(location) == {"id", "name", "region", "latitude", "longitude", "roleHint", "status"}
    assert isinstance(location["latitude"], float)
    assert location["roleHint"] == "demand_hub"


def test_location_status_follows_stock_versus_demand(client):
    """Jakarta kekurangan (300 < 1000) → merah; Cianjur berlimpah → hijau."""
    rows = client.get("/locations", headers=user_headers(client, JAKARTA_HEAD)).json()

    assert _by_name(rows, "Jakarta")["status"] == "critical"
    assert _by_name(rows, "Cianjur")["status"] == "ok"


def test_commodities_list_seeded_commodity(client):
    response = client.get("/commodities", headers=user_headers(client, JAKARTA_HEAD))

    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    assert rows[0]["name"] == "telur"
    assert rows[0]["unit"] == "kg"
    assert rows[0]["id"]


def test_demand_reports_deficit_and_surplus(client):
    rows = client.get("/demand", headers=user_headers(client, JAKARTA_HEAD)).json()
    locations = {
        row["id"]: row["name"]
        for row in client.get("/locations", headers=user_headers(client, JAKARTA_HEAD)).json()
    }
    by_location = {locations[row["locationId"]]: row for row in rows}

    assert by_location["Jakarta"]["projectedKg"] == 1000.0
    assert by_location["Jakarta"]["deficitKg"] == 700.0  # 1000 kebutuhan - 300 stok
    assert by_location["Jakarta"]["surplusKg"] == 0.0
    assert by_location["Cianjur"]["surplusKg"] == 900.0  # 1400 stok - 500 kebutuhan
    assert by_location["Cianjur"]["deficitKg"] == 0.0


def test_suppliers_use_the_ui_field_names(client):
    rows = client.get("/suppliers", headers=user_headers(client, JAKARTA_HEAD)).json()

    assert len(rows) == 3
    assert {row["name"] for row in rows} == {"Supplier A", "Supplier B", "Supplier C"}
    for row in rows:
        assert set(row) == {"id", "name", "locationId", "reliabilityScore"}
        assert row["reliabilityScore"] == 0.8


def test_read_endpoints_require_a_valid_token(client):
    """Endpoint UI memerlukan identitas: tanpa token jangan menyajikan data (bukan 200 kosong)."""
    for path in ("/locations", "/commodities", "/demand", "/suppliers"):
        assert client.get(path).status_code == 401, path


def test_monitor_can_read_locations(client):
    """bgn_monitor read-only — boleh membaca, tidak boleh approve (batas itu di actions)."""
    response = client.get("/locations", headers=user_headers(client, MONITOR))

    assert response.status_code == 200
    assert len(response.json()) == 2
