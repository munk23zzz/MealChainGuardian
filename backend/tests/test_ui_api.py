"""Endpoint baca untuk UI (`app/api/ui.py`) — bentuk & angkanya diuji terhadap seed nyata.

Dua jangkar:

* `docs/Skill.md` §11 — Cianjur 1.400 kg stok / 500 kg kebutuhan (surplus 900), Jakarta 300 / 1.000
  (defisit 700). Cerita demo itu tidak boleh diam-diam berubah.
* Aturan status lokasi = cermin `frontend/lib/status.ts`: KRITIS hanya kalau ada batch gagal aman
  atau suhu menyimpang; defisit / kesegaran menipis / perlu verifikasi = warning. Jadi Jakarta yang
  hanya kekurangan bahan berwarna KUNING, bukan merah — itu memang aturan yang dipakai UI hari ini.
"""

from __future__ import annotations

import pytest

from api_support import JAKARTA_HEAD, MONITOR, user_headers

pytestmark = pytest.mark.usefixtures("client")

# 10 titik: Cianjur + Jakarta (angka §11) + 8 SPPG dari dataset mock UI.
LOCATION_COUNT = 10
COMMODITY_NAMES = {"telur", "ayam", "wortel"}


def _by_name(rows: list[dict], name: str) -> dict:
    matched = [row for row in rows if row["name"] == name]
    assert matched, f"lokasi {name!r} tidak ada di respons"
    return matched[0]


def _locations(client, who=JAKARTA_HEAD) -> list[dict]:
    response = client.get("/locations", headers=user_headers(client, who))
    assert response.status_code == 200
    return response.json()


def _location_names(client) -> dict[str, str]:
    return {row["id"]: row["name"] for row in _locations(client)}


def _demand_by_pair(client) -> dict[tuple[str, str], dict]:
    locations = _location_names(client)
    commodities = {
        row["id"]: row["name"]
        for row in client.get("/commodities", headers=user_headers(client, JAKARTA_HEAD)).json()
    }
    rows = client.get("/demand", headers=user_headers(client, JAKARTA_HEAD)).json()
    return {(locations[row["locationId"]], commodities[row["commodityId"]]): row for row in rows}


def test_locations_cover_the_whole_demo_dataset(client):
    rows = _locations(client)

    assert len(rows) == LOCATION_COUNT
    assert {"Cianjur", "Jakarta", "SPPG Jakarta Selatan", "SPPG Bekasi"} <= {
        row["name"] for row in rows
    }


def test_locations_use_the_ui_field_names(client):
    location = _by_name(_locations(client), "Jakarta")

    # camelCase + angka, bukan string: kontrak `frontend/lib/api/schema.d.ts`.
    assert set(location) == {"id", "name", "region", "latitude", "longitude", "roleHint", "status"}
    assert isinstance(location["latitude"], float)
    assert location["roleHint"] == "demand_hub"


def test_location_status_mirrors_the_ui_rule(client):
    """Status dari API harus sama dengan yang akan dihitung UI dari `lib/status.ts`."""
    rows = {row["name"]: row for row in _locations(client)}

    # Berlimpah dan tanpa tanda bahaya -> hijau.
    assert rows["Cianjur"]["status"] == "ok"
    # Kekurangan bahan saja -> kuning (defisit BUKAN kritis menurut lib/status.ts).
    assert rows["Jakarta"]["status"] == "warning"
    # Batch ayam gagal aman (safety_status='fail') -> merah.
    assert rows["SPPG Jakarta Selatan"]["status"] == "critical"
    # Suhu 12,5 °C di atas ambang rantai dingin 4 °C -> merah.
    assert rows["SPPG Jakarta Utara"]["status"] == "critical"


def test_commodities_list_seeded_commodities(client):
    response = client.get("/commodities", headers=user_headers(client, JAKARTA_HEAD))

    assert response.status_code == 200
    rows = response.json()
    assert {row["name"] for row in rows} == COMMODITY_NAMES
    assert {row["unit"] for row in rows} == {"kg"}
    assert all(row["id"] for row in rows)


def test_demand_reports_deficit_and_surplus(client):
    by_pair = _demand_by_pair(client)

    # §11: Cianjur surplus 900 kg (1.400 stok - 500 kebutuhan), Jakarta defisit 700 kg.
    assert by_pair[("Cianjur", "telur")]["projectedKg"] == 500.0
    assert by_pair[("Cianjur", "telur")]["surplusKg"] == 900.0
    assert by_pair[("Cianjur", "telur")]["deficitKg"] == 0.0
    assert by_pair[("Jakarta", "telur")]["projectedKg"] == 1000.0
    assert by_pair[("Jakarta", "telur")]["deficitKg"] == 700.0
    assert by_pair[("Jakarta", "telur")]["surplusKg"] == 0.0

    # Titik tambahan ikut terbaca lengkap (240 kg stok vs 400 kg kebutuhan).
    assert by_pair[("SPPG Bekasi", "telur")]["deficitKg"] == 160.0


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
    assert len(_locations(client, MONITOR)) == LOCATION_COUNT
