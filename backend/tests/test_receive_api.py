"""Test inspeksi penerimaan + LEARN — `docs/design.md` §3.5b dan `docs/Skill.md` §10.

Yang diuji: siapa yang boleh mencatat, bagaimana kondisi fisik jadi `decisions.outcome`, dan apakah
angka `reliability_score` benar-benar bergerak sesuai formula dokumen (bukan sekadar "ada endpoint").
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select

from api_support import (
    CIANJUR_NUTRI,
    JAKARTA_HEAD,
    JAKARTA_NUTRI,
    MONITOR,
    approved_decision,
    receive,
    user_headers as _headers,
)
from app.models import AgentTrace, Decision, DecisionEvidence, Supplier


def _score(db_factory, supplier_id: str) -> Decimal:
    with db_factory() as session:
        supplier = session.get(Supplier, uuid.UUID(supplier_id))
    assert supplier is not None
    return Decimal(supplier.reliability_score)


def _executed_decision(client, db_factory, supplier_id: str) -> str:
    """Keputusan yang sudah dieksekusi — syarat barang bisa diterima."""
    return approved_decision(client, _headers(client, JAKARTA_HEAD), supplier_id)


# --- jalur bahagia dan jalur gagal -----------------------------------------------------


def test_successful_receipt_records_evidence_outcome_and_learn_trace(client, db_factory, supplier_id):
    decision_id = _executed_decision(client, db_factory, supplier_id)
    headers = _headers(client, JAKARTA_NUTRI)
    before = _score(db_factory, supplier_id)

    response = receive(
        client,
        headers,
        decision_id,
        condition="baik",
        measured_temperature_c=3.5,
        delivered_quantity_kg=700.0,
        notes="kondisi baik, suhu rantai dingin terjaga",
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["outcome"] == "success"
    assert body["decision"]["outcome"] == "success"
    assert body["supplier_score"]["reliability_score_before"] == float(before)
    assert body["supplier_score"]["considered_outcomes"] == ["success"]

    # semua success -> 0.5 x skor_lama + 0.5 x 1.0
    assert body["supplier_score"]["reliability_score_after"] == 0.90
    assert _score(db_factory, supplier_id) == Decimal("0.90")

    with db_factory() as session:
        evidence = session.execute(
            select(DecisionEvidence).where(DecisionEvidence.decision_id == uuid.UUID(decision_id))
        ).scalars().all()
        traces = session.execute(
            select(AgentTrace).where(AgentTrace.decision_id == uuid.UUID(decision_id))
        ).scalars().all()

    assert sorted(row.evidence_type for row in evidence) == [
        "human_inspection",
        "sap_purchase_order",
    ]
    inspection = next(row for row in evidence if row.evidence_type == "human_inspection")
    payload = inspection.payload
    assert payload["physical_condition"] == "baik"
    assert payload["measured_temperature_c"] == 3.5
    assert payload["recorded_by"] == JAKARTA_NUTRI
    assert payload["recorded_by_role"] == "sppg_nutritionist"
    assert payload["purchase_order"] == "4500000001"

    learn = next(row for row in traces if row.step_name == "LEARN")
    assert learn.tool_called == "core/learn.adjusted_reliability"
    assert learn.output_summary["reliability_score_after"] == 0.9
    assert learn.input_summary["window"] == 5


def test_failed_receipt_lowers_supplier_score(client, db_factory, supplier_id):
    decision_id = _executed_decision(client, db_factory, supplier_id)

    response = receive(
        client, _headers(client, JAKARTA_NUTRI), decision_id, condition="rusak", notes="sebagian pecah"
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["outcome"] == "failure"
    assert body["supplier_score"]["reliability_score_before"] == 0.80
    assert body["supplier_score"]["reliability_score_after"] == 0.40
    assert _score(db_factory, supplier_id) == Decimal("0.40")


def test_history_is_used_so_a_second_failure_compounds(client, db_factory, supplier_id):
    """LEARN memakai histori, bukan hanya kejadian terakhir (docs/Skill.md §10)."""
    first = _executed_decision(client, db_factory, supplier_id)
    headers = _headers(client, JAKARTA_NUTRI)
    assert receive(client, headers, first, condition="rusak").json()["supplier_score"][
        "reliability_score_after"
    ] == 0.40

    second = _executed_decision(client, db_factory, supplier_id)
    response = receive(client, headers, second, condition="rusak_sebagian")

    assert response.json()["supplier_score"]["considered_outcomes"] == ["failure", "failure"]
    # 0.5 x 0.40 + 0.5 x 0 = 0.20
    assert response.json()["supplier_score"]["reliability_score_after"] == 0.20
    assert _score(db_factory, supplier_id) == Decimal("0.20")


def test_success_after_failure_raises_the_score_again(client, db_factory, supplier_id):
    """Skor bisa naik lagi — kalau LEARN hanya jalan saat gagal, angkanya tidak akan pernah pulih."""
    first = _executed_decision(client, db_factory, supplier_id)
    headers = _headers(client, JAKARTA_NUTRI)
    assert receive(client, headers, first, condition="rusak").json()["outcome"] == "failure"

    second = _executed_decision(client, db_factory, supplier_id)
    response = receive(client, headers, second, condition="baik")

    # success_rate 1/2 -> 0.5 x 0.40 + 0.5 x 0.5 = 0.45
    assert response.json()["supplier_score"]["considered_outcomes"] == ["failure", "success"]
    assert response.json()["supplier_score"]["reliability_score_after"] == 0.45


# --- siapa yang boleh mencatat --------------------------------------------------------


def test_head_of_sppg_cannot_record_the_inspection(client, db_factory, supplier_id):
    decision_id = _executed_decision(client, db_factory, supplier_id)

    response = receive(client, _headers(client, JAKARTA_HEAD), decision_id)

    assert response.status_code == 403
    assert response.json()["detail"]["error"] == "recorder_role_not_allowed"


def test_bgn_monitor_cannot_record_the_inspection(client, db_factory, supplier_id):
    decision_id = _executed_decision(client, db_factory, supplier_id)

    response = receive(client, _headers(client, MONITOR), decision_id)

    assert response.status_code == 403
    assert response.json()["detail"]["error"] == "recorder_role_not_allowed"


def test_nutritionist_from_another_sppg_cannot_record(client, db_factory, supplier_id):
    decision_id = _executed_decision(client, db_factory, supplier_id)

    response = receive(client, _headers(client, CIANJUR_NUTRI), decision_id)

    assert response.status_code == 403
    assert response.json()["detail"]["error"] == "recorder_location_mismatch"


# --- kapan boleh mencatat -------------------------------------------------------------


def test_receipt_before_execution_is_refused(client, db_factory, supplier_id):
    """Approved saja belum cukup: barang belum dipesan, jadi belum ada yang diterima."""
    from api_support import approve, propose

    headers = _headers(client, JAKARTA_HEAD)
    decision_id = propose(client, headers).json()["decision"]["id"]
    assert approve(client, headers, decision_id).status_code == 200

    response = receive(client, _headers(client, JAKARTA_NUTRI), decision_id)

    assert response.status_code == 409
    assert response.json()["detail"]["error"] == "decision_not_executed"


def test_decision_cannot_be_received_twice(client, db_factory, supplier_id):
    decision_id = _executed_decision(client, db_factory, supplier_id)
    headers = _headers(client, JAKARTA_NUTRI)
    assert receive(client, headers, decision_id).status_code == 200

    again = receive(client, headers, decision_id)

    assert again.status_code == 409
    assert again.json()["detail"]["error"] == "already_received"

    with db_factory() as session:
        decision = session.get(Decision, uuid.UUID(decision_id))
    assert decision.outcome == "success"


def test_unknown_condition_is_refused_before_touching_the_database(client, db_factory, supplier_id):
    decision_id = _executed_decision(client, db_factory, supplier_id)

    response = receive(client, _headers(client, JAKARTA_NUTRI), decision_id, condition="lumayan")

    # Kondisinya bertipe Literal di skema, jadi FastAPI yang menolak lebih dulu (422) — dan itu
    # memang yang diinginkan: nilai tak dikenal tidak pernah sampai ke database.
    assert response.status_code == 422
    assert "physical_condition" in response.text

    with db_factory() as session:
        evidence = session.execute(
            select(DecisionEvidence).where(
                DecisionEvidence.decision_id == uuid.UUID(decision_id),
                DecisionEvidence.evidence_type == "human_inspection",
            )
        ).scalars().all()
    assert evidence == []
