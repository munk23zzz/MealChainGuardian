"""Endpoint baca untuk UI (`app/api/ui.py`) — bentuk & angkanya diuji terhadap seed nyata.

Dua jangkar:

* `docs/Skill.md` §11 — Cianjur 1.400 kg stok / 500 kg kebutuhan (surplus 900), Jakarta 300 / 1.000
  (defisit 700). Cerita demo itu tidak boleh diam-diam berubah.
* Aturan status lokasi = cermin `frontend/lib/status.ts`: KRITIS hanya kalau ada batch gagal aman
  atau suhu menyimpang; defisit / kesegaran menipis / perlu verifikasi = warning. Jadi Jakarta yang
  hanya kekurangan bahan berwarna KUNING, bukan merah — itu memang aturan yang dipakai UI hari ini.

Semua endpoint UI ada di bawah `/ui/*` supaya kontrak domain (`/supply`, `/decisions`,
`/actions/*`) tetap utuh untuk agent & AgentCore Gateway.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select

from api_support import (
    JAKARTA_HEAD,
    MONITOR,
    approved_decision,
    propose,
    user_headers,
)
from app.models import Batch, Commodity, Location

pytestmark = pytest.mark.usefixtures("client")

# 10 titik Jabodetabek x 3 komoditas — sama dengan dokumen ide (`docs/PRD.md`, `docs/Schema.md`).
LOCATION_COUNT = 10
COMMODITY_NAMES = {"telur", "ayam", "wortel"}
SUPPLY_COUNT = 20  # satu baris per (lokasi, komoditas) di SUPPLY_ROWS


def _by_name(rows: list[dict], name: str) -> dict:
    matched = [row for row in rows if row["name"] == name]
    assert matched, f"lokasi {name!r} tidak ada di respons"
    return matched[0]


def _get(client, path: str, who: str = JAKARTA_HEAD) -> list[dict] | dict:
    response = client.get(path, headers=user_headers(client, who))
    assert response.status_code == 200, f"{path} -> {response.status_code}: {response.text[:200]}"
    return response.json()


def _locations(client, who: str = JAKARTA_HEAD) -> list[dict]:
    return _get(client, "/ui/locations", who)  # type: ignore[return-value]


def _location_names(client) -> dict[str, str]:
    return {row["id"]: row["name"] for row in _locations(client)}


def _commodity_names(client) -> dict[str, str]:
    return {
        row["id"]: row["name"]
        for row in _get(client, "/ui/commodities")  # type: ignore[union-attr]
    }


def _supply_by_pair(client) -> dict[tuple[str, str], dict]:
    locations = _location_names(client)
    commodities = _commodity_names(client)
    rows = _get(client, "/ui/supply")
    return {
        (locations[row["locationId"]], commodities[row["commodityId"]]): row
        for row in rows  # type: ignore[union-attr]
    }


# --- Lokasi, komoditas, kebutuhan, pemasok ---------------------------------------------------


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
    rows = _get(client, "/ui/commodities")

    assert {row["name"] for row in rows} == COMMODITY_NAMES  # type: ignore[union-attr]
    assert {row["unit"] for row in rows} == {"kg"}  # type: ignore[union-attr]
    assert all(row["id"] for row in rows)  # type: ignore[union-attr]


def test_demand_reports_deficit_and_surplus(client):
    locations = _location_names(client)
    commodities = _commodity_names(client)
    rows = _get(client, "/ui/demand")
    by_pair = {
        (locations[row["locationId"]], commodities[row["commodityId"]]): row
        for row in rows  # type: ignore[union-attr]
    }

    # §11: Cianjur surplus 900 kg (1.400 stok - 500 kebutuhan), Jakarta defisit 700 kg.
    assert by_pair[("Cianjur", "telur")]["projectedKg"] == 500.0
    assert by_pair[("Cianjur", "telur")]["surplusKg"] == 900.0
    assert by_pair[("Cianjur", "telur")]["deficitKg"] == 0.0
    assert by_pair[("Jakarta", "telur")]["projectedKg"] == 1000.0
    assert by_pair[("Jakarta", "telur")]["deficitKg"] == 700.0

    # Titik tambahan ikut terbaca lengkap (240 kg stok vs 400 kg kebutuhan).
    assert by_pair[("SPPG Bekasi", "telur")]["deficitKg"] == 160.0


def test_suppliers_use_the_ui_field_names(client):
    rows = _get(client, "/ui/suppliers")

    assert len(rows) == 3  # type: ignore[arg-type]
    assert {row["name"] for row in rows} == {"Supplier A", "Supplier B", "Supplier C"}  # type: ignore[union-attr]
    for row in rows:  # type: ignore[union-attr]
        assert set(row) == {
            "id",
            "name",
            "locationId",
            "reliabilityScore",
            "status",
            "excludedAt",
            "exclusionReason",
        }
        assert row["reliabilityScore"] == 0.8
        # Pemasok seed semuanya aktif; eksklusi hanya lewat approval (test_supplier_exclusion_api.py).
        assert row["status"] == "active"
        assert row["excludedAt"] is None
        assert row["exclusionReason"] is None


# --- Pasokan (bentuk SupplyRecord) -----------------------------------------------------------


def test_supply_has_one_row_per_pair_with_ui_fields(client):
    rows = _get(client, "/ui/supply")

    assert len(rows) == SUPPLY_COUNT  # type: ignore[arg-type]
    for row in rows:  # type: ignore[union-attr]
        assert set(row) == {
            "locationId",
            "commodityId",
            "physicalStockKg",
            "usableStockKg",
            "batchCount",
            "status",
            "pricePerKg",
            "freshnessStatus",
            "safetyStatus",
            "temperatureExcursion",
        }
        assert row["batchCount"] >= 1
        assert row["physicalStockKg"] >= row["usableStockKg"]


def test_supply_keeps_the_documented_numbers(client):
    by_pair = _supply_by_pair(client)

    cianjur = by_pair[("Cianjur", "telur")]
    assert cianjur["physicalStockKg"] == 1400.0
    assert cianjur["usableStockKg"] == 1400.0
    assert cianjur["batchCount"] == 1
    assert cianjur["status"] == "surplus"  # 1.400 stok vs 500 kebutuhan
    assert cianjur["pricePerKg"] == 26500.0  # harga referensi §11
    assert cianjur["safetyStatus"] == "PASS"
    assert cianjur["freshnessStatus"] == "fresh"
    assert cianjur["temperatureExcursion"] is False

    jakarta = by_pair[("Jakarta", "telur")]
    assert jakarta["usableStockKg"] == 300.0
    assert jakarta["status"] == "deficit"  # 300 stok vs 1.000 kebutuhan


def test_supply_reports_failed_expired_and_excursing_batches(client):
    """Tiga kondisi yang membuat lokasi merah/kuning harus terbaca dari pasokan, bukan dari mock."""
    by_pair = _supply_by_pair(client)

    # Batch ayam gagal aman: stok fisik masih ada di rak, tapi TIDAK boleh dipakai (Schema.md §6).
    jakarta_selatan = by_pair[("SPPG Jakarta Selatan", "ayam")]
    assert jakarta_selatan["safetyStatus"] == "FAIL"
    assert jakarta_selatan["physicalStockKg"] == 50.0
    assert jakarta_selatan["usableStockKg"] == 0.0
    assert jakarta_selatan["freshnessStatus"] == "expired"
    assert jakarta_selatan["status"] == "deficit"

    # Suhu 12,5 °C > ambang rantai dingin 4 °C + kesegaran menipis.
    jakarta_utara = by_pair[("SPPG Jakarta Utara", "telur")]
    assert jakarta_utara["safetyStatus"] == "NEEDS_VERIFICATION"
    assert jakarta_utara["temperatureExcursion"] is True
    assert jakarta_utara["freshnessStatus"] == "approaching_expiry"
    assert jakarta_utara["batchCount"] == 2

    # Pasokan sehat tetap hijau.
    assert by_pair[("SPPG Jakarta Barat", "telur")]["safetyStatus"] == "PASS"
    assert by_pair[("SPPG Jakarta Barat", "telur")]["freshnessStatus"] == "fresh"


# --- Gerbang kesegaran (`app/core/freshness.py`, docs/Skill.md §3) -----------------------------


def _add_batch(
    db_factory,
    supplier_id: str,
    *,
    location: str,
    commodity: str,
    quantity: str,
    freshness_score: Decimal | None,
    harvested_at: datetime | None = None,
    safety: str = "pass",
) -> None:
    """Sisipkan satu batch ke DB test — menguji gerbang kesegaran tanpa mengubah seed.

    Pasangan (lokasi, komoditas) yang dipakai test di bawah sengaja yang BELUM ada di seed, supaya
    angka jangkar `test_supply_keeps_the_documented_numbers` tidak tersentuh.
    """
    with db_factory() as session:
        location_row = session.scalar(select(Location).where(Location.name == location))
        commodity_row = session.scalar(select(Commodity).where(Commodity.name == commodity))
        assert location_row is not None and commodity_row is not None
        session.add(
            Batch(
                location_id=location_row.id,
                commodity_id=commodity_row.id,
                supplier_id=uuid.UUID(supplier_id),
                quantity_kg=Decimal(quantity),
                harvested_at=harvested_at or datetime.now(timezone.utc),
                temperature_log=[],
                safety_status=safety,
                freshness_score=freshness_score,
            )
        )
        session.commit()


def test_skor_di_bawah_gerbang_tidak_dihitung_sebagai_stok_terpakai(client, db_factory, supplier_id):
    """`freshness_score < 0.60` = tidak layak: stok fisik tetap terlihat, terpakai 0.

    Dulu ambang itu hanya ada di dokumen (kolom `freshness_score` ditulis seed lalu tidak dibaca
    siapa pun), jadi batch basi tetap ikut dihitung sebagai stok siap pakai.
    """
    _add_batch(
        db_factory,
        supplier_id,
        location="SPPG Bekasi",
        commodity="wortel",
        quantity="500.00",
        freshness_score=Decimal("0.50"),
    )

    row = _supply_by_pair(client)[("SPPG Bekasi", "wortel")]
    assert row["physicalStockKg"] == 500.0
    assert row["usableStockKg"] == 0.0  # <-- gerbang kesegaran menggigit di sini
    assert row["freshnessStatus"] == "expired"
    assert row["safetyStatus"] == "PASS"  # bukan karena keamanan — murni kesegaran


def test_pita_needs_verification_tetap_layak_dipakai(client, db_factory, supplier_id):
    """`0.60 <= skor < 0.85` = `needs_verification`, BUKAN gagal: stoknya masih boleh dipakai."""
    _add_batch(
        db_factory,
        supplier_id,
        location="SPPG Depok",
        commodity="ayam",
        quantity="300.00",
        freshness_score=Decimal("0.70"),
    )

    row = _supply_by_pair(client)[("SPPG Depok", "ayam")]
    assert row["usableStockKg"] == 300.0
    assert row["freshnessStatus"] == "approaching_expiry"
    assert row["safetyStatus"] == "PASS"


def test_skor_belum_ada_tidak_dihukum(client, db_factory, supplier_id):
    """Tanpa skor, status jatuh ke hitungan masa simpan (panen baru = `fresh`) dan stok tetap dipakai."""
    _add_batch(
        db_factory,
        supplier_id,
        location="SPPG Tangerang",
        commodity="wortel",
        quantity="220.00",
        freshness_score=None,
    )

    row = _supply_by_pair(client)[("SPPG Tangerang", "wortel")]
    assert row["usableStockKg"] == 220.0
    assert row["freshnessStatus"] == "fresh"


def test_gerbang_bisa_digeser_lewat_env(client, db_factory, supplier_id, monkeypatch):
    """Ambang ada di config (docs/Skill.md §3: "taruh di config, jangan hardcode")."""
    monkeypatch.setenv("FRESHNESS_GATE_THRESHOLD", "0.75")
    _add_batch(
        db_factory,
        supplier_id,
        location="SPPG Jakarta Timur",
        commodity="ayam",
        quantity="150.00",
        freshness_score=Decimal("0.70"),
    )

    row = _supply_by_pair(client)[("SPPG Jakarta Timur", "ayam")]
    assert row["usableStockKg"] == 0.0  # 0.70 < gerbang 0.75 → tidak layak
    assert row["freshnessStatus"] == "approaching_expiry"  # pita dokumen tetap needs_verification


# --- Keputusan (bentuk Recommendation) -------------------------------------------------------


def _decisions(client) -> list[dict]:
    return _get(client, "/ui/decisions")  # type: ignore[return-value]


def test_decisions_are_not_invented_by_the_seed(client):
    """Seed tidak mengarang keputusan: tanpa usulan, daftarnya kosong (bukan data palsu)."""
    assert _decisions(client) == []


def test_decision_uses_the_recommendation_shape(client):
    headers = user_headers(client, JAKARTA_HEAD)
    propose(client, headers)

    rows = _decisions(client)

    assert len(rows) == 1
    row = rows[0]
    assert set(row) == {
        "id",
        "status",
        "decisionType",
        "sourceLocationId",
        "targetLocationId",
        "commodityId",
        "quantityKg",
        "safeDeliveredCostBreakdown",
        "evidence",
        "evidenceItems",
        "constraints",
        "verifierNote",
        "verifiedBy",
        "safetyCheck",
        "reason",
        "createdAt",
        "approvedAt",
        "expiresAt",
        "executedAt",
        "sapPurchaseOrder",
        "supplierId",
        "supplierName",
        "exclusionReason",
        "agentTrace",
    }
    # Rujukan lokasi/komoditas harus ID (UI mencocokkan lewat id, bukan nama).
    locations = _location_names(client)
    commodities = _commodity_names(client)
    assert locations[row["sourceLocationId"]] == "Cianjur"
    assert locations[row["targetLocationId"]] == "Jakarta"
    assert commodities[row["commodityId"]] == "telur"
    assert row["quantityKg"] == 700.0
    assert row["status"] == "pending_approval"
    # Belum ada bukti apa pun -> 0%, bukan angka yang dilebihkan.
    assert row["evidence"]["completenessPercent"] == 0.0
    # `cost_breakdown` belum diisi penulisnya (`/cost/safe-delivered` belum ada).
    assert row["safeDeliveredCostBreakdown"] == []


def test_decision_reason_is_derived_from_the_real_deficit(client):
    """Alasan diturunkan dari angka nyata: defisit telur Jakarta = 1.000 - 300 = 700 kg."""
    propose(client, user_headers(client, JAKARTA_HEAD))

    reason = _decisions(client)[0]["reason"]

    assert "Defisit" in reason and "700" in reason and "Jakarta" in reason


def test_executed_decision_carries_purchase_order_evidence_and_trace(client, supplier_id):
    headers = user_headers(client, JAKARTA_HEAD)
    decision_id = approved_decision(client, headers, supplier_id)

    row = client.get(f"/ui/decisions/{decision_id}", headers=headers).json()

    order = row["sapPurchaseOrder"]
    assert order is not None
    assert order["poNumber"].startswith("4500")
    assert order["orderedQuantityKg"] == 700.0
    # Plant mengikuti lokasi TUJUAN (Jakarta -> JK01), bukan lokasi asal (Cianjur -> CJ01).
    assert order["plant"] == "JK01"

    steps = [step["step"] for step in row["agentTrace"]]
    assert "DECIDE" in steps and "ACT" in steps
    assert all(step["timestamp"] for step in row["agentTrace"])

    assert row["evidence"]["sap"] is True
    assert row["evidence"]["completenessPercent"] == pytest.approx(33.3, abs=0.1)
    assert row["evidenceItems"][0]["source"].startswith("SAP PO ")
    assert row["status"] == "executed"
    assert row["executedAt"] is not None


def test_decision_expiry_is_always_set_by_propose(client):
    """`expires_at` NOT NULL sejak revisi 9 Okt (docs/Schema.md §3): `/actions/propose` mengisi SLA
    bawaan kalau pemanggil tidak menyebut batas waktu, jadi UI tidak pernah menerima null."""
    propose(client, user_headers(client, JAKARTA_HEAD))

    expires_at = _decisions(client)[0]["expiresAt"]
    assert expires_at is not None
    assert datetime.fromisoformat(expires_at) > datetime.now(timezone.utc)


def test_decision_detail_and_not_found(client):
    headers = user_headers(client, JAKARTA_HEAD)
    propose(client, headers)
    decision_id = _decisions(client)[0]["id"]

    detail = client.get(f"/ui/decisions/{decision_id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["id"] == decision_id

    assert client.get("/ui/decisions/bukan-uuid", headers=headers).status_code == 404
    unknown = "00000000-0000-4000-8000-000000000000"
    assert client.get(f"/ui/decisions/{unknown}", headers=headers).status_code == 404


# --- Batas akses -----------------------------------------------------------------------------


def test_read_endpoints_require_a_valid_token(client):
    """Endpoint UI memerlukan identitas: tanpa token jangan menyajikan data (bukan 200 kosong)."""
    for path in (
        "/ui/locations",
        "/ui/commodities",
        "/ui/supply",
        "/ui/demand",
        "/ui/suppliers",
        "/ui/decisions",
        "/ui/kpi",
    ):
        assert client.get(path).status_code == 401, path


def test_monitor_can_read_locations(client):
    """bgn_monitor read-only — boleh membaca, tidak boleh approve (batas itu di actions)."""
    assert len(_locations(client, MONITOR)) == LOCATION_COUNT


# --- KPI ---------------------------------------------------------------------------------------


def test_kpi_is_computed_from_seeded_data_and_never_pads_missing_metrics(client, supplier_id):
    headers = user_headers(client, JAKARTA_HEAD)
    approved_decision(client, headers, supplier_id)

    kpi = client.get("/ui/kpi", headers=headers).json()

    # Sudah dieksekusi -> 1/1 keputusan regional tuntas; bukti SAP saja = 1 dari 3 kanal.
    assert kpi["regionalImbalanceResolutionRate"] == 100.0
    assert kpi["evidenceCompletenessPercent"] == pytest.approx(33.3, abs=0.1)
    assert kpi["averageSafeDeliveredCostPerKg"] == 26200.0
    # Kuotasi telur diuji terhadap harga acuan PIHPS -> angkanya ada dan masuk akal (0-100%).
    assert 0 < kpi["averageProcurementPriceDeviationPercent"] < 100

    # KPI yang bahannya tidak ada di skema TIDAK dikirim sebagai 0 — UI menampilkan "—".
    for key in ("mealContinuityRate", "avoidableFoodLossKg", "avoidableFoodLossRp"):
        assert key not in kpi, f"{key} tidak punya sumber data, jangan diisi 0"
        assert "skema" in kpi["unavailable"][key]

    # Histori periode sebelumnya memang belum ada (job KPI belum menulis `kpi_snapshots`).
    assert "previous" not in kpi


def test_kpi_explains_what_it_cannot_compute_yet(client):
    """Tanpa keputusan sama sekali, semua KPI berbasis keputusan absen + ada alasannya."""
    kpi = client.get("/ui/kpi", headers=user_headers(client, JAKARTA_HEAD)).json()

    for key in (
        "evidenceCompletenessPercent",
        "averageSafeDeliveredCostPerKg",
        "regionalImbalanceResolutionRate",
        "averageDecisionTimeMinutes",
    ):
        assert key not in kpi
        assert kpi["unavailable"][key]


# --- Aksi dari UI (kontrak tulis versi UI) -----------------------------------------------------
#
# UI mengirim camelCase dan tanpa pemilih pemasok, sedangkan `/actions/*` domain menuntut
# snake_case + `supplier` + `net_price_amount`. Yang diuji di sini: jalur UI bisa dipakai
# ujung-ke-ujung TANPA melemahkan aturan domain (tidak ada auto-execute, penerimaan tetap hanya
# boleh dicatat Ahli Gizi SPPG tujuan).


def test_ui_approve_then_execute_creates_the_purchase_order(client):
    headers = user_headers(client, JAKARTA_HEAD)
    decision_id = propose(client, headers).json()["decision"]["id"]

    approved = client.post(
        "/ui/actions/approve", json={"decisionId": decision_id}, headers=headers
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
    assert approved.json()["approvedAt"] is not None

    executed = client.post(
        "/ui/actions/execute", json={"decisionId": decision_id}, headers=headers
    )
    assert executed.status_code == 200, executed.text
    body = executed.json()

    assert body["status"] == "executed"
    assert body["executedAt"] is not None
    order = body["sapPurchaseOrder"]
    assert order["poNumber"].startswith("4500")
    assert order["orderedQuantityKg"] == 700.0
    assert order["plant"] == "JK01"  # lokasi tujuan Jakarta


def test_ui_execute_still_refuses_an_unapproved_decision(client):
    """Jalur UI tidak boleh jadi pintu belakang `no_auto_execute` (Rules.md §1.2)."""
    headers = user_headers(client, JAKARTA_HEAD)
    decision_id = propose(client, headers).json()["decision"]["id"]

    response = client.post(
        "/ui/actions/execute", json={"decisionId": decision_id}, headers=headers
    )

    assert response.status_code == 409
    assert response.json()["detail"]["error"] == "no_auto_execute"


def test_ui_reject_records_the_reason(client):
    headers = user_headers(client, JAKARTA_HEAD)
    decision_id = propose(client, headers).json()["decision"]["id"]

    response = client.post(
        "/ui/actions/reject",
        json={"decisionId": decision_id, "reason": "stok pasar masih cukup"},
        headers=headers,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "rejected"
    assert body["id"] == decision_id


def test_ui_write_endpoints_require_a_token(client):
    for path, body in (
        ("/ui/actions/approve", {"decisionId": "x"}),
        ("/ui/actions/reject", {"decisionId": "x", "reason": "x"}),
        ("/ui/actions/execute", {"decisionId": "x"}),
    ):
        assert client.post(path, json=body).status_code == 401, path