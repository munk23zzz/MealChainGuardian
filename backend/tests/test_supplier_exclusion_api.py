"""Eksklusi pemasok end-to-end (`Rules.md` §1.2): usulan → approval → eksekusi.

Yang dijaga test ini, urut dari yang paling penting:

1. **Tidak ada tombol eksklusi.** Sebelum ada approval, `POST /actions/exclude` menolak dan baris
   pemasok tidak berubah — kalau ini bocor, aturan "aksi berisiko tinggi wajib lewat approvals"
   hanya jadi kalimat di dokumen.
2. **Hanya SPPG pemasok itu yang boleh menyetujui.** Lokasi tujuan keputusan = SPPG pemasok, jadi
   aturan approval yang sudah ada (`core/approval_rules.py`) langsung menggigit.
3. **Eksklusi benar-benar mengubah perilaku pemilihan pemasok** untuk PO berikutnya — kalau tidak,
   status `excluded` cuma hiasan.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from api_support import (
    CIANJUR_HEAD,
    JAKARTA_HEAD,
    JAKARTA_NUTRI,
    MONITOR,
    exclude,
    propose,
    propose_exclusion,
    user_headers,
)
from app.models import Decision, DecisionEvidence, Location, SapMockPurchaseOrder, Supplier

pytestmark = pytest.mark.usefixtures("client")

# Alasan yang lolos aturan minimal (`core/supplier_exclusion.py`).
ALASAN = "Dua pengiriman terakhir gagal inspeksi suhu dan mutu."


@pytest.fixture(autouse=True)
def pemasok_dikembalikan_ke_aktif(db_factory):
    """Kembalikan `suppliers` ke `active` sebelum & sesudah tiap test.

    Fixture `client` hanya me-reset tabel dinamis; `suppliers` termasuk data master yang ikut
    di-seed sekali. Karena eksklusi MENULIS ke tabel itu (dan statusnya menempel ke database test),
    tanpa pembersihan ini test pertama yang mengeksklusi membuat test berikutnya gagal karena
    "sudah dikecualikan" — bukan karena kodenya salah.
    """
    from sqlalchemy import update

    def bersihkan() -> None:
        with db_factory() as session:
            session.execute(
                update(Supplier).values(status="active", excluded_at=None, exclusion_reason=None)
            )
            session.commit()

    bersihkan()
    yield
    bersihkan()


def _supplier(db_factory, name: str):
    with db_factory() as session:
        return session.scalar(select(Supplier).where(Supplier.name == name))


def _supplier_id(db_factory, name: str) -> str:
    row = _supplier(db_factory, name)
    assert row is not None, f"pemasok {name!r} tidak ada di seed"
    return str(row.id)


def _excluded_decision(client, db_factory, *, supplier: str, approver: str) -> str:
    """Usulan + approval oleh `approver` (SPPG pemasok) → id keputusan berstatus `approved`."""
    supplier_id = _supplier_id(db_factory, supplier)
    proposed = propose_exclusion(client, user_headers(client, MONITOR), supplier_id)
    assert proposed.status_code == 201, proposed.text
    decision_id = proposed.json()["decision"]["id"]

    approved = client.post(
        "/actions/approve",
        json={"decision_id": decision_id, "approved": True},
        headers=user_headers(client, approver),
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["decision"]["status"] == "approved"
    return decision_id


# --- 1. aturan approval menggigit ------------------------------------------------------------


def test_usulan_eksklusi_masuk_pending_dan_menunjuk_pemasok(client, db_factory):
    supplier_id = _supplier_id(db_factory, "Supplier C")

    response = propose_exclusion(client, user_headers(client, MONITOR), supplier_id, ALASAN)

    assert response.status_code == 201, response.text
    decision = response.json()["decision"]
    assert decision["decision_type"] == "supplier_exclusion"
    assert decision["status"] == "pending_approval"
    assert decision["supplier"] == "Supplier C"
    assert decision["reason"] == ALASAN
    # Lokasi asal & tujuan = SPPG pemasok, supaya hanya SPPG itu yang berhak approve.
    supplier = _supplier(db_factory, "Supplier C")
    with db_factory() as session:
        stored = session.get(Decision, decision["id"])
        assert stored is not None
        assert stored.target_location_id == supplier.location_id
        assert stored.source_location_id == supplier.location_id


def test_hanya_sppg_pemasok_itu_yang_bisa_menyetujui(client, db_factory):
    supplier_id = _supplier_id(db_factory, "Supplier C")  # Supplier C ada di Jakarta
    decision_id = propose_exclusion(
        client, user_headers(client, MONITOR), supplier_id, ALASAN
    ).json()["decision"]["id"]

    ditolak = client.post(
        "/actions/approve",
        json={"decision_id": decision_id, "approved": True},
        headers=user_headers(client, CIANJUR_HEAD),
    )
    assert ditolak.status_code == 403, ditolak.text
    assert ditolak.json()["detail"]["error"] == "approver_location_mismatch"

    lolos = client.post(
        "/actions/approve",
        json={"decision_id": decision_id, "approved": True},
        headers=user_headers(client, JAKARTA_NUTRI),
    )
    assert lolos.status_code == 200, lolos.text
    assert lolos.json()["decision"]["status"] == "approved"


def test_usulan_tanpa_alasan_yang_berguna_ditolak(client, db_factory):
    supplier_id = _supplier_id(db_factory, "Supplier C")

    response = propose_exclusion(client, user_headers(client, MONITOR), supplier_id, "-")

    assert response.status_code == 422, response.text
    assert response.json()["detail"]["error"] == "exclusion_reason_required"


# --- 2. tidak ada auto-execute ---------------------------------------------------------------


def test_eksklusi_belum_disetujui_tidak_bisa_dieksekusi(client, db_factory):
    supplier_id = _supplier_id(db_factory, "Supplier C")
    decision_id = propose_exclusion(
        client, user_headers(client, MONITOR), supplier_id, ALASAN
    ).json()["decision"]["id"]

    response = exclude(client, user_headers(client, JAKARTA_HEAD), decision_id)

    assert response.status_code == 409, response.text
    assert response.json()["detail"]["error"] == "no_auto_execute"
    # Yang penting: baris pemasoknya TIDAK berubah.
    assert _supplier(db_factory, "Supplier C").status == "active"


def test_endpoint_eksklusi_menolak_keputusan_pembelian(client, db_factory):
    """Keputusan pasokan dieksekusi lewat /actions/execute, bukan lewat pintu eksklusi."""
    headers = user_headers(client, JAKARTA_HEAD)
    decision_id = propose(client, headers).json()["decision"]["id"]

    response = exclude(client, headers, decision_id)

    assert response.status_code == 409
    assert response.json()["detail"]["error"] == "not_supplier_exclusion"


# --- 3. eksekusi menulis keadaan yang benar --------------------------------------------------


def test_eksekusi_eksklusi_menulis_status_alasan_dan_bukti(client, db_factory):
    decision_id = _excluded_decision(
        client, db_factory, supplier="Supplier C", approver=JAKARTA_HEAD
    )

    response = exclude(client, user_headers(client, JAKARTA_HEAD), decision_id)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["decision"]["status"] == "executed"
    assert body["supplier"]["status"] == "excluded"
    assert body["supplier"]["exclusionReason"] == ALASAN
    assert body["supplier"]["excludedAt"] is not None

    supplier = _supplier(db_factory, "Supplier C")
    assert supplier.status == "excluded"
    assert supplier.excluded_at is not None
    assert supplier.exclusion_reason == ALASAN

    with db_factory() as session:
        decision = session.get(Decision, decision_id)
        assert decision is not None and decision.status == "executed"
        evidence = session.scalars(
            select(DecisionEvidence).where(DecisionEvidence.decision_id == decision.id)
        ).all()
        assert [row.evidence_type for row in evidence] == ["supplier_exclusion"]


def test_eksklusi_dua_kali_ditolak(client, db_factory):
    """Dua usulan untuk pemasok yang sama bisa lolos approval; eksekusi keduanya tidak.

    Ini jalur nyata menuju penjaga `already_excluded`: usulan kedua dibuat SELAGI pemasoknya masih
    aktif, jadi keduanya bisa disetujui — lalu eksekusi kedua harus ditolak, bukan menulis ulang
    eksklusi (dan menimpa alasannya).
    """
    supplier_id = _supplier_id(db_factory, "Supplier C")
    headers = user_headers(client, JAKARTA_HEAD)
    ids = []
    for _ in range(2):
        proposed = propose_exclusion(client, user_headers(client, MONITOR), supplier_id, ALASAN)
        assert proposed.status_code == 201, proposed.text
        decision_id = proposed.json()["decision"]["id"]
        assert (
            client.post(
                "/actions/approve", json={"decision_id": decision_id, "approved": True}, headers=headers
            ).status_code
            == 200
        )
        ids.append(decision_id)

    assert exclude(client, headers, ids[0]).status_code == 200

    ulang = exclude(client, headers, ids[1])
    assert ulang.status_code == 409
    assert ulang.json()["detail"]["error"] == "already_excluded"


def test_pemasok_yang_sudah_dikecualikan_tidak_bisa_diusulkan_lagi(client, db_factory):
    decision_id = _excluded_decision(
        client, db_factory, supplier="Supplier C", approver=JAKARTA_HEAD
    )
    assert exclude(client, user_headers(client, JAKARTA_HEAD), decision_id).status_code == 200

    response = propose_exclusion(
        client, user_headers(client, MONITOR), _supplier_id(db_factory, "Supplier C"), ALASAN
    )

    assert response.status_code == 422, response.text
    assert response.json()["detail"]["error"] == "supplier_already_excluded"


# --- 4. eksklusi mengubah perilaku nyata ------------------------------------------------------


def test_pemasok_yang_dikecualikan_tidak_dipilih_untuk_po(client, db_factory):
    """Keputusan dari Jakarta tidak boleh lagi memakai Supplier C (satu-satunya pemasok Jakarta)."""
    supplier = _supplier(db_factory, "Supplier C")
    with db_factory() as session:
        lokasi_pemasok = session.get(Location, supplier.location_id)
        assert lokasi_pemasok is not None
        asal = lokasi_pemasok.name

    decision_id = _excluded_decision(
        client, db_factory, supplier="Supplier C", approver=JAKARTA_HEAD
    )
    assert exclude(client, user_headers(client, JAKARTA_HEAD), decision_id).status_code == 200

    headers = user_headers(client, JAKARTA_HEAD)
    # Tujuan = SPPG penerima yang memang milik approver ("Jakarta"), sumbernya pun Jakarta supaya
    # pemilihan pemasok benar-benar menyentuh Supplier C yang baru dikecualikan.
    beli = propose(client, headers, source_location=asal, target_location="Jakarta")
    assert beli.status_code == 201, beli.text
    buy_id = beli.json()["decision"]["id"]
    assert (
        client.post(
            "/actions/approve",
            json={"decision_id": buy_id, "approved": True},
            headers=headers,
        ).status_code
        == 200
    )
    executed = client.post("/ui/actions/execute", json={"decisionId": buy_id}, headers=headers)
    assert executed.status_code == 200, executed.text

    with db_factory() as session:
        po = session.scalar(
            select(SapMockPurchaseOrder).where(SapMockPurchaseOrder.decision_id == buy_id)
        )
        assert po is not None
        dipakai = session.get(Supplier, po.supplier_id)
    assert dipakai is not None
    # PO harus jatuh ke pemasok yang masih aktif — bukan Supplier C yang baru dikecualikan.
    assert dipakai.name != "Supplier C"
    assert dipakai.status == "active"


# --- 5. jalur UI (camelCase) sama aturannya ---------------------------------------------------


def test_jalur_ui_mengeksklusi_dengan_aturan_yang_sama(client, db_factory):
    """UI memakai `/ui/actions/propose-exclusion` + `/ui/actions/exclude`, bukan jalur langsung."""
    supplier_id = _supplier_id(db_factory, "Supplier A")  # Supplier A ada di Cianjur
    headers = user_headers(client, CIANJUR_HEAD)

    proposed = client.post(
        "/ui/actions/propose-exclusion",
        json={"supplierId": supplier_id, "reason": ALASAN},
        headers=headers,
    )
    assert proposed.status_code == 201, proposed.text
    body = proposed.json()
    assert body["decisionType"] == "supplier_exclusion"
    assert body["supplierId"] == supplier_id
    assert body["exclusionReason"] == ALASAN
    assert body["status"] == "pending_approval"

    # Approver dari SPPG lain ditolak bahkan dari jalur UI.
    ditolak = client.post(
        "/ui/actions/approve",
        json={"decisionId": body["id"]},
        headers=user_headers(client, JAKARTA_HEAD),
    )
    assert ditolak.status_code == 403, ditolak.text

    disetujui = client.post(
        "/ui/actions/approve",
        json={"decisionId": body["id"]},
        headers=headers,
    )
    assert disetujui.status_code == 200, disetujui.text

    dieksekusi = client.post(
        "/ui/actions/exclude", json={"decisionId": body["id"]}, headers=headers
    )
    assert dieksekusi.status_code == 200, dieksekusi.text
    assert dieksekusi.json()["status"] == "executed"
    assert _supplier(db_factory, "Supplier A").status == "excluded"


def test_ui_suppliers_menampilkan_status_eksklusi(client, db_factory):
    sebelum = client.get("/ui/suppliers", headers=user_headers(client, MONITOR)).json()
    assert {row["status"] for row in sebelum} == {"active"}
    assert all(row["excludedAt"] is None for row in sebelum)

    decision_id = _excluded_decision(
        client, db_factory, supplier="Supplier C", approver=JAKARTA_HEAD
    )
    assert exclude(client, user_headers(client, JAKARTA_HEAD), decision_id).status_code == 200

    sesudah = client.get("/ui/suppliers", headers=user_headers(client, MONITOR)).json()
    jakarta = [row for row in sesudah if row["name"] == "Supplier C"][0]
    assert jakarta["status"] == "excluded"
    assert jakarta["exclusionReason"] == ALASAN
    assert jakarta["excludedAt"] is not None
