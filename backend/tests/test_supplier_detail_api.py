"""Detail pemasok (`GET /ui/suppliers/{id}`).

Yang dijaga test ini:

1. **Angka detail = angka halaman lain.** Jumlah batch yang dipasok pemasok itu harus sama dengan
   `physicalStockKg` di `/ui/supply` untuk pasangan lokasi×komoditas yang sama — kalau tidak, panel
   detail dan halaman Pasokan bisa bercerita beda tentang batch yang sama.
2. **Nilai turunan tetap dari aturan yang sama.** `usableUntil` dan `freshnessStatus` dihitung modul
   `core/` yang sama dengan `/ui/supply`; test menolak nilai yang kosong/karangan.
3. **Riwayat eksklusi tidak dipoles.** Usulan yang masih `pending_approval` (dan yang ditolak) tetap
   muncul di detail, bukan cuma yang sukses.
"""

from __future__ import annotations

from collections import defaultdict

import pytest
from sqlalchemy import select

from api_support import (
    JAKARTA_HEAD,
    MONITOR,
    exclude,
    propose,
    propose_exclusion,
    user_headers,
)
from app.models import Supplier

pytestmark = pytest.mark.usefixtures("client")

ALASAN = "Dua pengiriman terakhir gagal inspeksi suhu dan mutu."
FRESHNESS_WORDS = {"fresh", "approaching_expiry", "expired"}


def _supplier_by_name(db_factory, name: str) -> Supplier:
    with db_factory() as session:
        row = session.scalar(select(Supplier).where(Supplier.name == name))
    assert row is not None, f"pemasok {name!r} tidak ada di seed"
    return row


def _detail(client, headers, supplier_id: str) -> dict:
    response = client.get(f"/ui/suppliers/{supplier_id}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_bentuk_respons_camelcase(client, supplier_id):
    detail = _detail(client, user_headers(client, MONITOR), supplier_id)

    assert set(detail) == {
        "supplier",
        "batches",
        "priceSignals",
        "purchaseOrders",
        "exclusionDecisions",
    }
    assert set(detail["supplier"]) == {
        "id",
        "name",
        "locationId",
        "reliabilityScore",
        "status",
        "excludedAt",
        "exclusionReason",
    }


def test_batch_pemasok_sama_dengan_angka_halaman_pasokan(client, supplier_id):
    headers = user_headers(client, MONITOR)
    detail = _detail(client, headers, supplier_id)
    lokasi = detail["supplier"]["locationId"]

    supply = [
        row
        for row in client.get("/ui/supply", headers=headers).json()
        if row["locationId"] == lokasi
    ]
    assert supply, "lokasi pemasok harus punya baris pasokan"

    total_detail: dict[str, float] = defaultdict(float)
    for batch in detail["batches"]:
        total_detail[batch["commodityId"]] += batch["quantityKg"]

    for row in supply:
        assert total_detail[row["commodityId"]] == pytest.approx(row["physicalStockKg"])


def test_nilai_turunan_batch_dihitung_bukan_dikosongkan(client, supplier_id):
    detail = _detail(client, user_headers(client, MONITOR), supplier_id)

    assert detail["batches"], "pemasok seed punya batch"
    for batch in detail["batches"]:
        assert batch["usableUntil"] > batch["harvestedAt"]  # panen + masa layak, bukan salinan
        assert batch["freshnessStatus"] in FRESHNESS_WORDS
        assert batch["safetyStatus"] in {"pending", "pass", "fail", "needs_verification"}
        assert batch["temperatureReadings"] >= 0


def test_kuotasi_harga_apa_adanya(client):
    """`price_signals` hanya berisi kuotasi pemasok (CHECK DB), jadi tak ada baris acuan pasar."""
    headers = user_headers(client, MONITOR)
    suppliers = client.get("/ui/suppliers", headers=headers).json()

    ada_kuotasi = False
    for row in suppliers:
        detail = _detail(client, headers, row["id"])
        for signal in detail["priceSignals"]:
            ada_kuotasi = True
            assert signal["source"] == "supplier_quote"
            assert signal["pricePerKg"] > 0
            assert signal["recordedAt"]

    assert ada_kuotasi, "seed mengisi kuotasi pemasok, jadi kolom ini tidak boleh selalu kosong"


def test_id_tidak_dikenal_dan_bukan_uuid_menjawab_404(client):
    headers = user_headers(client, MONITOR)

    assert (
        client.get("/ui/suppliers/00000000-0000-0000-0000-000000000000", headers=headers).status_code
        == 404
    )
    # Bukan UUID: harus 404 yang sopan, bukan 500 dari Postgres.
    assert client.get("/ui/suppliers/bukan-uuid", headers=headers).status_code == 404


def test_tanpa_token_ditolak(client, supplier_id):
    assert client.get(f"/ui/suppliers/{supplier_id}").status_code == 401


def test_riwayat_eksklusi_termasuk_yang_belum_disetujui(client, db_factory):
    supplier = _supplier_by_name(db_factory, "Supplier C")
    headers = user_headers(client, JAKARTA_HEAD)

    proposed = propose_exclusion(client, user_headers(client, MONITOR), str(supplier.id), ALASAN)
    assert proposed.status_code == 201, proposed.text
    decision_id = proposed.json()["decision"]["id"]

    belum = _detail(client, headers, str(supplier.id))
    assert belum["supplier"]["status"] == "active"
    assert [(row["decisionId"], row["status"]) for row in belum["exclusionDecisions"]] == [
        (decision_id, "pending_approval")
    ]
    assert belum["exclusionDecisions"][0]["reason"] == ALASAN

    assert (
        client.post(
            "/ui/actions/approve", json={"decisionId": decision_id}, headers=headers
        ).status_code
        == 200
    )
    assert exclude(client, headers, decision_id).status_code == 200

    sesudah = _detail(client, headers, str(supplier.id))
    assert sesudah["supplier"]["status"] == "excluded"
    assert sesudah["supplier"]["exclusionReason"] == ALASAN
    assert sesudah["exclusionDecisions"][0]["status"] == "executed"


def test_purchase_order_muncul_di_detail_pemasok(client, db_factory):
    """PO yang terbit dari keputusan bersumber Cianjur harus terlihat di pemasok Cianjur."""
    supplier = _supplier_by_name(db_factory, "Supplier A")
    headers = user_headers(client, JAKARTA_HEAD)

    beli = propose(client, headers, source_location="Cianjur", target_location="Jakarta")
    assert beli.status_code == 201, beli.text
    buy_id = beli.json()["decision"]["id"]
    assert (
        client.post(
            "/ui/actions/approve", json={"decisionId": buy_id}, headers=headers
        ).status_code
        == 200
    )
    assert (
        client.post("/ui/actions/execute", json={"decisionId": buy_id}, headers=headers).status_code
        == 200
    )

    detail = _detail(client, headers, str(supplier.id))
    assert [po["decisionId"] for po in detail["purchaseOrders"]] == [buy_id]
    assert detail["purchaseOrders"][0]["orderedQuantityKg"] == 700.0
