"""Test endpoint aksi — siklus usul -> approve -> execute di atas Postgres nyata.

Yang diuji di sini bukan "endpoint mengembalikan 200", melainkan aturan yang tertulis di dokumen:
tidak ada auto-execute, siapa yang sah approve berapa kali, masa berlaku, dan jejak audit yang
benar-benar tersimpan sebagai baris tabel.

Fixture `client`, `db_factory`, dan `supplier_id` ada di `tests/conftest.py`; permintaan demo dan
identitas akun ada di `tests/api_support.py`.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from api_support import (
    CIANJUR_HEAD,
    JAKARTA_HEAD,
    JAKARTA_NUTRI,
    MONITOR,
    approve,
    execute,
    propose,
    user_headers as _headers,
)
from app.models import AgentTrace, Approval, Decision, DecisionEvidence, SapMockPurchaseOrder, User


# --- propose ---------------------------------------------------------------------------


def test_propose_records_decision_and_shows_up_in_read_endpoint(client, db_factory):
    headers = _headers(db_factory, JAKARTA_HEAD)

    response = propose(client, headers)

    assert response.status_code == 201, response.text
    decision = response.json()["decision"]
    assert decision["status"] == "pending_approval"
    assert decision["source_location"] == "Cianjur"
    assert decision["target_location"] == "Jakarta"
    assert decision["commodity"] == "telur"
    assert decision["quantity_kg"] == 700.0
    assert decision["missing_approval_roles"] == []
    assert [trace["step_name"] for trace in decision["agent_traces"]] == ["DECIDE"]

    # benar-benar tersimpan sebagai baris tabel, bukan hanya di respons
    with db_factory() as session:
        stored = session.scalar(select(Decision).where(Decision.id == decision["id"]))
        assert stored is not None
        assert stored.status == "pending_approval"

    listed = client.get("/decisions?status=pending_approval")
    assert [row["id"] for row in listed.json()] == [decision["id"]]


def test_propose_without_verifier_result_is_not_approvable(client, db_factory):
    headers = _headers(db_factory, JAKARTA_HEAD)

    decision = propose(client, headers, verifier_result=None).json()["decision"]
    assert decision["status"] == "proposed"
    assert decision["verified_by"] is None

    response = approve(client, headers, decision["id"])

    assert response.status_code == 409
    assert response.json()["detail"]["error"] == "decision_not_approvable"


def test_propose_rejects_unknown_location(client, db_factory):
    headers = _headers(db_factory, JAKARTA_HEAD)

    response = propose(client, headers, target_location="Bandung")

    assert response.status_code == 404
    assert "Bandung" in response.json()["detail"]


def test_actions_require_an_identity(client, db_factory):
    response = client.post(
        "/actions/propose",
        json={
            "decision_type": "regional_balance",
            "source_location": "Cianjur",
            "target_location": "Jakarta",
            "commodity": "telur",
            "quantity_kg": 1.0,
        },
    )

    assert response.status_code == 401
    assert "X-User-Id" in response.json()["detail"]


# --- approve: siapa yang sah ----------------------------------------------------------


def test_bgn_monitor_cannot_approve(client, db_factory):
    decision = propose(client, _headers(db_factory, JAKARTA_HEAD)).json()["decision"]

    response = approve(client, _headers(db_factory, MONITOR), decision["id"])

    assert response.status_code == 403
    assert response.json()["detail"]["error"] == "approver_role_not_allowed"


def test_approver_from_another_sppg_is_rejected(client, db_factory):
    decision = propose(client, _headers(db_factory, JAKARTA_HEAD)).json()["decision"]

    response = approve(client, _headers(db_factory, CIANJUR_HEAD), decision["id"])

    assert response.status_code == 403
    assert response.json()["detail"]["error"] == "approver_location_mismatch"


def test_same_person_cannot_approve_twice(client, db_factory):
    headers = _headers(db_factory, JAKARTA_HEAD)
    decision = propose(client, headers).json()["decision"]

    assert approve(client, headers, decision["id"]).status_code == 200
    again = approve(client, headers, decision["id"])

    assert again.status_code == 409
    assert again.json()["detail"]["error"] == "decision_not_approvable"


def test_unique_index_blocks_a_second_vote_from_the_same_person_in_the_database(
    client, db_factory
):
    """Aturan yang sama juga ditegakkan database, bukan hanya kode Python (defense in depth)."""
    from sqlalchemy.exc import IntegrityError

    headers = _headers(db_factory, JAKARTA_HEAD)
    decision_id = propose(client, headers).json()["decision"]["id"]
    assert approve(client, headers, decision_id).status_code == 200

    with db_factory() as session:
        session.add(
            Approval(
                decision_id=decision_id,
                approved_by=session.scalar(select(User.id).where(User.email == JAKARTA_HEAD)),
                approver_role="sppg_head",
                approved=True,
                approved_at=datetime.now(timezone.utc),
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


# --- approve: berapa approval ---------------------------------------------------------


def test_one_approval_is_enough_when_verifier_is_consistent(client, db_factory):
    decision = propose(client, _headers(db_factory, JAKARTA_HEAD)).json()["decision"]

    response = approve(client, _headers(db_factory, JAKARTA_HEAD), decision["id"])

    assert response.status_code == 200, response.text
    assert response.json()["decision"]["status"] == "approved"
    assert response.json()["approval"] == {
        "status": "approved",
        "approved": 1,
        "rejected": 0,
        "missing_roles": [],
    }


def test_flagged_decision_needs_head_and_nutritionist(client, db_factory):
    decision = propose(client, _headers(db_factory, JAKARTA_HEAD), verifier_result="flagged").json()[
        "decision"
    ]

    first = approve(client, _headers(db_factory, JAKARTA_HEAD), decision["id"])
    assert first.status_code == 200
    assert first.json()["decision"]["status"] == "verifier_flagged"
    assert first.json()["decision"]["missing_approval_roles"] == ["sppg_nutritionist"]

    second = approve(client, _headers(db_factory, JAKARTA_NUTRI), decision["id"])
    assert second.status_code == 200
    assert second.json()["decision"]["status"] == "approved"


def test_two_heads_do_not_satisfy_a_flagged_decision(client, db_factory):
    """Dua orang berbeda berperan sama bukan dua approval yang diminta dokumen."""
    decision_id = propose(
        client, _headers(db_factory, JAKARTA_HEAD), verifier_result="flagged"
    ).json()["decision"]["id"]

    with db_factory() as session:
        session.add(
            User(
                name="Kepala SPPG Jakarta (cadangan)",
                email="kepala2.jakarta@demo.local",
                password_hash="!dev-placeholder-bukan-kredensial",
                role="sppg_head",
                location_id=session.scalar(select(User.location_id).where(User.email == JAKARTA_HEAD)),
            )
        )
        session.commit()

    assert approve(client, _headers(db_factory, JAKARTA_HEAD), decision_id).status_code == 200
    second = approve(client, _headers(db_factory, "kepala2.jakarta@demo.local"), decision_id)

    assert second.status_code == 200
    assert second.json()["decision"]["status"] == "verifier_flagged"
    assert second.json()["decision"]["missing_approval_roles"] == ["sppg_nutritionist"]


def test_rejection_rejects_the_decision_immediately(client, db_factory):
    decision = propose(client, _headers(db_factory, JAKARTA_HEAD), verifier_result="flagged").json()[
        "decision"
    ]

    response = approve(
        client, _headers(db_factory, JAKARTA_NUTRI), decision["id"], approved=False, comment="stok meragukan"
    )

    assert response.status_code == 200
    assert response.json()["decision"]["status"] == "rejected"
    assert response.json()["decision"]["approvals"][0]["comment"] == "stok meragukan"


# --- execute -------------------------------------------------------------------------


def test_execute_without_approval_is_refused(client, db_factory, supplier_id):
    decision = propose(client, _headers(db_factory, JAKARTA_HEAD)).json()["decision"]

    response = execute(client, _headers(db_factory, JAKARTA_HEAD), decision["id"], supplier_id)

    assert response.status_code == 409
    body = response.json()["detail"]
    assert body["error"] == "no_auto_execute"
    assert body["approved_count"] == 0
    assert body["required_approvals"] == 1


def test_execute_after_approval_creates_purchase_order_and_trace(client, db_factory, supplier_id):
    headers = _headers(db_factory, JAKARTA_HEAD)
    decision_id = propose(client, headers).json()["decision"]["id"]
    assert approve(client, _headers(db_factory, JAKARTA_NUTRI), decision_id).status_code == 200

    response = execute(client, headers, decision_id, supplier_id)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["purchase_order"]["purchase_order"] == "4500000001"
    assert body["purchase_order"]["status"] == "submitted"
    assert body["purchase_order"]["material_number"] == "TELUR-01"
    assert body["purchase_order"]["data_source"] == "MOCK"
    # angka harus JSON number, bukan string "700.00" — bug yang tertangkap saat verifikasi manual
    assert isinstance(body["purchase_order"]["order_quantity"], (int, float))
    assert isinstance(body["purchase_order"]["net_price_amount"], (int, float))
    assert body["decision"]["status"] == "executed"
    assert body["decision"]["outcome"] == "pending"

    with db_factory() as session:
        evidence = session.execute(
            select(DecisionEvidence).where(DecisionEvidence.decision_id == decision_id)
        ).scalars().all()
        traces = session.execute(
            select(AgentTrace).where(AgentTrace.decision_id == decision_id)
        ).scalars().all()

    assert [row.evidence_type for row in evidence] == ["sap_purchase_order"]
    assert evidence[0].payload["purchase_order"] == "4500000001"
    assert {row.step_name for row in traces} == {"DECIDE", "ACT"}

    # PO benar-benar ada sebagai baris tabel, bukan hanya di dalam respons (bug nyata yang pernah
    # lolos: PO ter-flush di session lain dan tidak pernah ter-commit).
    with db_factory() as session:
        stored = session.execute(select(SapMockPurchaseOrder)).scalars().all()
    assert [row.po_number for row in stored] == ["4500000001"]
    assert str(stored[0].decision_id) == decision_id


def test_execute_twice_does_not_create_a_second_purchase_order(client, db_factory, supplier_id):
    headers = _headers(db_factory, JAKARTA_HEAD)
    decision_id = propose(client, headers).json()["decision"]["id"]
    assert approve(client, headers, decision_id).status_code == 200
    assert execute(client, headers, decision_id, supplier_id).status_code == 200

    again = execute(client, headers, decision_id, supplier_id)

    assert again.status_code == 409
    detail = again.json()["detail"]
    assert detail["error"] in {"already_executed", "no_auto_execute"}
    if detail["error"] == "already_executed":
        assert detail["purchase_order"] == "4500000001"


def test_execute_rejects_unknown_supplier(client, db_factory, supplier_id):
    headers = _headers(db_factory, JAKARTA_HEAD)
    decision_id = propose(client, headers).json()["decision"]["id"]
    assert approve(client, headers, decision_id).status_code == 200

    response = execute(client, headers, decision_id, "SUP-TIDAK-ADA")

    assert response.status_code == 422
    assert "SUP-TIDAK-ADA" in response.json()["detail"]


# --- masa berlaku ---------------------------------------------------------------------


def test_expired_decision_cannot_be_approved_or_executed(client, db_factory, supplier_id):
    headers = _headers(db_factory, JAKARTA_HEAD)
    past = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    decision_id = propose(client, headers, expires_at=past).json()["decision"]["id"]

    approve_response = approve(client, headers, decision_id)
    assert approve_response.status_code == 409
    assert approve_response.json()["detail"]["error"] == "decision_expired"

    # status benar-benar dipindahkan, bukan hanya ditolak di permukaan
    after = client.get(f"/decisions/{decision_id}").json()
    assert after["status"] == "expired"

    execute_response = execute(client, headers, decision_id, supplier_id)
    assert execute_response.status_code == 409
    assert execute_response.json()["detail"]["error"] == "decision_expired"


# --- atomisitas: satu transaksi untuk PO + baris domain (menutup deviasi #12) ----------


def test_execute_is_atomic_when_something_fails_after_the_purchase_order(
    client, db_factory, supplier_id, monkeypatch
):
    """Gagal di tengah alur -> tidak ada PO "yatim" dan keputusan tidak jadi `executed`.

    Diuji dengan sengaja menggagalkan langkah setelah PO ditulis. Karena store meminjam session
    request dan hanya ada SATU commit di akhir, pemeriksaan dari session lain di bawah ini tidak
    boleh melihat apa pun.
    """
    headers = _headers(db_factory, JAKARTA_HEAD)
    decision_id = propose(client, headers).json()["decision"]["id"]
    assert approve(client, headers, decision_id).status_code == 200

    from app.api import actions as actions_module

    def boom(*args, **kwargs):
        raise RuntimeError("kegagalan buatan setelah PO ditulis")

    monkeypatch.setattr(actions_module, "_record_trace", boom)

    with pytest.raises(RuntimeError):
        execute(client, headers, decision_id, supplier_id)

    monkeypatch.undo()

    with db_factory() as session:
        assert session.execute(select(SapMockPurchaseOrder)).scalars().all() == []
        assert session.execute(select(DecisionEvidence)).scalars().all() == []
        decision = session.get(Decision, uuid.UUID(decision_id))
        assert decision.status == "approved"

    # alur yang sama tetap bisa diselesaikan setelah kegagalan itu (tidak ada state rusak)
    retry = execute(client, headers, decision_id, supplier_id)
    assert retry.status_code == 200
    assert retry.json()["purchase_order"]["purchase_order"] == "4500000001"
