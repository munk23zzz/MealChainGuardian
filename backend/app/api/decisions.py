"""Endpoint keputusan (baca) — `GET /decisions`, `GET /decisions/{id}`.

`POST /decisions/evaluate` (docs/Architecture.md §4) belum ada: ia butuh `/balance/analyze` dan
`/cost/safe-delivered` yang belum dibangun. Yang sudah ada di sini adalah pembacaan keputusan
beserta jejak auditnya, dipakai UI untuk menampilkan alasan, bukti, dan siapa yang sudah approve.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import SessionDep
from app.api.types import Quantity
from app.core.approval_rules import ApprovalVote, missing_roles
from app.models import Approval, AgentTrace, Decision, DecisionEvidence
from app.models.decisions import APPROVER_ROLES

router = APIRouter(prefix="/decisions", tags=["decisions"])


class ApprovalOut(BaseModel):
    id: str
    approved_by: str
    approver_role: str
    approved: bool
    comment: str | None
    approved_at: datetime


class TraceOut(BaseModel):
    id: str
    step_name: str
    tool_called: str | None
    input_summary: dict | None
    output_summary: dict | None
    duration_ms: int | None
    step_at: datetime


class EvidenceOut(BaseModel):
    id: str
    evidence_type: str
    payload: dict
    is_consistent: bool | None
    recorded_at: datetime


class DecisionOut(BaseModel):
    id: str
    decision_type: str
    status: str
    outcome: str | None
    proposed_by: str
    verified_by: str | None
    verifier_note: str | None
    source_location: str | None
    target_location: str | None
    commodity: str | None
    quantity_kg: Quantity | None
    safe_delivered_cost: Quantity | None
    cost_breakdown: dict | None
    expires_at: datetime | None
    created_at: datetime
    approvals: list[ApprovalOut]
    missing_approval_roles: list[str]
    agent_traces: list[TraceOut]
    evidence: list[EvidenceOut]


def _location_name(session: Session, location_id: uuid.UUID | None) -> str | None:
    if location_id is None:
        return None
    from app.models import Location

    location = session.get(Location, location_id)
    return location.name if location else None


def _commodity_name(session: Session, commodity_id: uuid.UUID | None) -> str | None:
    if commodity_id is None:
        return None
    from app.models import Commodity

    commodity = session.get(Commodity, commodity_id)
    return commodity.name if commodity else None


def approval_votes(session: Session, decision_id: uuid.UUID) -> list[ApprovalVote]:
    """Approval tersimpan, dalam bentuk yang dipahami `core/approval_rules.py`."""
    rows = session.execute(
        select(Approval).where(Approval.decision_id == decision_id).order_by(Approval.approved_at)
    ).scalars().all()
    return [
        ApprovalVote(approver_id=row.approved_by, role=row.approver_role, approved=row.approved)
        for row in rows
    ]


def build_decision_out(session: Session, decision: Decision) -> DecisionOut:
    """Serialisasi keputusan + jejak auditnya. Dipakai juga oleh `api/actions.py`."""
    approvals = session.execute(
        select(Approval).where(Approval.decision_id == decision.id).order_by(Approval.approved_at)
    ).scalars().all()
    traces = session.execute(
        select(AgentTrace)
        .where(AgentTrace.decision_id == decision.id)
        .order_by(AgentTrace.step_at)
    ).scalars().all()
    evidence = session.execute(
        select(DecisionEvidence)
        .where(DecisionEvidence.decision_id == decision.id)
        .order_by(DecisionEvidence.recorded_at)
    ).scalars().all()

    votes = [
        ApprovalVote(approver_id=row.approved_by, role=row.approver_role, approved=row.approved)
        for row in approvals
    ]

    return DecisionOut(
        id=str(decision.id),
        decision_type=decision.decision_type,
        status=decision.status,
        outcome=decision.outcome,
        proposed_by=decision.proposed_by,
        verified_by=decision.verified_by,
        verifier_note=decision.verifier_note,
        source_location=_location_name(session, decision.source_location_id),
        target_location=_location_name(session, decision.target_location_id),
        commodity=_commodity_name(session, decision.commodity_id),
        quantity_kg=decision.quantity_kg,
        safe_delivered_cost=decision.safe_delivered_cost,
        cost_breakdown=decision.cost_breakdown,
        expires_at=decision.expires_at,
        created_at=decision.created_at,
        approvals=[
            ApprovalOut(
                id=str(row.id),
                approved_by=str(row.approved_by),
                approver_role=row.approver_role,
                approved=row.approved,
                comment=row.comment,
                approved_at=row.approved_at,
            )
            for row in approvals
        ],
        missing_approval_roles=sorted(missing_roles(decision.status, votes)),
        agent_traces=[
            TraceOut(
                id=str(row.id),
                step_name=row.step_name,
                tool_called=row.tool_called,
                input_summary=row.input_summary,
                output_summary=row.output_summary,
                duration_ms=row.duration_ms,
                step_at=row.step_at,
            )
            for row in traces
        ],
        evidence=[
            EvidenceOut(
                id=str(row.id),
                evidence_type=row.evidence_type,
                payload=row.payload,
                is_consistent=row.is_consistent,
                recorded_at=row.recorded_at,
            )
            for row in evidence
        ],
    )


def get_decision_or_404(session: Session, decision_id: str) -> Decision:
    try:
        parsed = uuid.UUID(decision_id)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"id keputusan bukan UUID: {decision_id!r}") from None

    decision = session.get(Decision, parsed)
    if decision is None:
        raise HTTPException(status_code=404, detail=f"Keputusan tidak ditemukan: {decision_id}")
    return decision


@router.get("")
def list_decisions(
    session: SessionDep,
    status: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[DecisionOut]:
    """Daftar keputusan terbaru, opsional disaring per status."""
    statement = select(Decision).order_by(Decision.created_at.desc()).limit(limit)
    if status:
        statement = statement.where(Decision.status == status)

    return [build_decision_out(session, row) for row in session.execute(statement).scalars().all()]


@router.get("/{decision_id}")
def get_decision(session: SessionDep, decision_id: str) -> DecisionOut:
    """Satu keputusan lengkap dengan approval, jejak agen, dan bukti."""
    return build_decision_out(session, get_decision_or_404(session, decision_id))


# Peran yang boleh meng-approve, dipakai UI untuk menyembunyikan tombol yang akan ditolak server.
# Penegakannya tetap di server (docs/Skill.md §9), ini hanya kenyamanan tampilan.
APPROVER_ROLES_FOR_DISPLAY: tuple[str, ...] = APPROVER_ROLES


def approval_summary(decision: Decision, votes: list[ApprovalVote]) -> dict[str, Any]:
    """Ringkasan approval untuk header respons `actions` (bukan kontrak endpoint baca)."""
    return {
        "status": decision.status,
        "approved": sum(1 for vote in votes if vote.approved),
        "rejected": sum(1 for vote in votes if not vote.approved),
        "missing_roles": sorted(missing_roles(decision.status, votes)),
    }
