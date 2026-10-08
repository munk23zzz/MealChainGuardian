"""Keputusan & audit trail — `docs/Schema.md` §3.

Status di `decisions` adalah kontrak: safety status tidak pernah di-override, dan keputusan yang
lewat `expires_at` tidak pernah berakhir `executed` (docs/Skill.md §9).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedAt, UuidPk

DECISION_TYPES = ("regional_balance", "price_anomaly", "safety_disruption")
DECISION_STATUSES = (
    "proposed",
    "verifier_flagged",
    "verifier_unavailable",
    "pending_approval",
    "approved",
    "rejected",
    "executed",
    "expired",
)
DECISION_OUTCOMES = ("pending", "success", "failure")
AGENT_STEPS = ("DETECT", "VERIFY", "TRACE", "PREDICT", "OPTIMIZE", "DECIDE", "ACT", "LEARN")
EVIDENCE_TYPES = (
    "sap_purchase_order",
    "sap_goods_receipt",
    "gps",
    "temperature",
    "human_inspection",
    "market_price",
)
APPROVER_ROLES = ("sppg_head", "sppg_nutritionist")


class Decision(Base):
    __tablename__ = "decisions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('proposed','verifier_flagged','verifier_unavailable','pending_approval',"
            "'approved','rejected','executed','expired')",
            name="decisions_status_check",
        ),
        CheckConstraint(
            "outcome IS NULL OR outcome IN ('pending','success','failure')",
            name="decisions_outcome_check",
        ),
        Index("idx_decisions_status", "status"),
    )

    id: Mapped[UuidPk]
    decision_type: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="proposed")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    outcome: Mapped[str | None] = mapped_column(Text, nullable=True)
    proposed_by: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="supervisor_agent"
    )
    verified_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    verifier_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_location_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("locations.id"), nullable=True
    )
    target_location_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("locations.id"), nullable=True
    )
    commodity_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("commodities.id"), nullable=True
    )
    quantity_kg: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    safe_delivered_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    cost_breakdown: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[CreatedAt]


class DecisionEvidence(Base):
    __tablename__ = "decision_evidence"

    id: Mapped[UuidPk]
    decision_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("decisions.id"), nullable=False
    )
    evidence_type: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    is_consistent: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[CreatedAt]


class AgentTrace(Base):
    """Cermin lokal dari AgentCore Observability untuk UI Agent Activity Log."""

    __tablename__ = "agent_traces"
    __table_args__ = (Index("idx_agent_traces_decision", "decision_id", "step_at"),)

    id: Mapped[UuidPk]
    decision_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("decisions.id"), nullable=False
    )
    step_name: Mapped[str] = mapped_column(Text, nullable=False)
    tool_called: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    output_summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    step_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[CreatedAt]


class Approval(Base):
    """`approver_role` = snapshot role saat approve (audit). bgn_monitor tidak pernah di sini."""

    __tablename__ = "approvals"
    __table_args__ = (
        CheckConstraint(
            "approver_role IN ('sppg_head','sppg_nutritionist')", name="approvals_role_check"
        ),
        # docs/Schema.md §5 + §6: satu orang tidak bisa approve dua kali untuk keputusan yang sama.
        Index("uq_approvals_decision_user", "decision_id", "approved_by", unique=True),
    )

    id: Mapped[UuidPk]
    decision_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("decisions.id"), nullable=False
    )
    approved_by: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    approver_role: Mapped[str] = mapped_column(Text, nullable=False)
    approved: Mapped[bool] = mapped_column(Boolean, nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    approved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[CreatedAt]


class KpiSnapshot(Base):
    __tablename__ = "kpi_snapshots"
    __table_args__ = (Index("idx_kpi_name_scope", "kpi_name", "scope", "computed_at"),)

    id: Mapped[UuidPk]
    kpi_name: Mapped[str] = mapped_column(Text, nullable=False)
    scope: Mapped[str] = mapped_column(Text, nullable=False)
    value: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[CreatedAt]
