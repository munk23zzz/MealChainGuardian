"""Endpoint aksi — `POST /actions/propose|approve|execute`.

Aturan yang ditegakkan DI SINI (bukan di UI) — `docs/Skill.md` §9 dan `docs/Schema.md` §6:

1. **Tidak ada auto-execute.** `executed` hanya bisa dicapai kalau sudah ada approval yang sah
   (`decisions.status == 'approved'`). Tidak ada jalur `proposed -> executed`.
2. **Siapa yang sah approve berapa kali** ditentukan `core/approval_rules.py`: 1 approval untuk
   `pending_approval`, 2 (head DAN nutritionist dari SPPG penerima) untuk `verifier_flagged` /
   `verifier_unavailable`. `bgn_monitor` tidak pernah bisa approve.
3. **Masa berlaku.** Keputusan yang lewat `expires_at` tidak bisa di-approve maupun dieksekusi;
   statusnya dipindahkan ke `expired` saat itu terdeteksi.

`POST /actions/receive` (inspeksi penerimaan + LEARN, `docs/Architecture.md` §4) belum ada di sini —
itu langkah berikutnya, bersama pembaruan `reliability_score` (`docs/Skill.md` §10).

Batasan yang diketahui (dinyatakan, bukan disembunyikan):

- Identitas pemanggil dari header `X-User-Id` (lihat `app/api/deps.py`) — penegakan peran sudah di
  server, tapi identitasnya belum diautentikasi.
- `execute` menyentuh dua penyimpanan (tabel SAP mock dan tabel domain) tanpa satu transaksi —
  `sql_mock_store` menulis PO dalam transaksinya sendiri. Jaring pengamannya: sebelum membuat PO,
  endpoint memeriksa apakah keputusan ini sudah punya PO, jadi percobaan ulang mengembalikan 409
  (dengan nomor PO yang sudah ada) alih-alih membuat PO kedua.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated, Any, Iterator, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.decisions import (
    DecisionOut,
    approval_summary,
    approval_votes,
    build_decision_out,
    get_decision_or_404,
)
from app.api.deps import CurrentUser, SessionDep
from app.api.supply import get_provider
from app.api.types import Quantity
from app.core.approval_rules import (
    ApprovalRuleError,
    ApprovalVote,
    decision_status_after,
    is_satisfied,
    required_approvals,
    validate_vote,
)
from app.core.learn import LEARN_WINDOW, adjusted_reliability
from app.core.receiving_rules import (
    ReceivingRuleError,
    outcome_for_condition,
    validate_receiving,
)
from app.models import (
    AgentTrace,
    Approval,
    Commodity,
    Decision,
    DecisionEvidence,
    Location,
    SapMockPurchaseOrder,
    Supplier,
    User,
)
from app.sap_integration.field_mapping import MATERIAL_NUMBER_BY_COMMODITY
from app.sap_integration.provider_interface import (
    CreatePurchaseOrderRequest,
    PurchaseOrderRecord,
    SAPCapability,
    SAPDataProvider,
)

router = APIRouter(prefix="/actions", tags=["actions"])

# Verifier belum diimplementasikan (SAP AI Core, P2.3). Sampai itu ada, hasil verifikasi diberikan
# pemanggil (Supervisor agent) secara eksplisit; kalau tidak diberikan, keputusan TIDAK dianggap
# terverifikasi dan karena itu tidak bisa di-approve.
VERIFIER_RESULT_TO_STATUS: dict[str, str] = {
    "consistent": "pending_approval",
    "flagged": "verifier_flagged",
    "unavailable": "verifier_unavailable",
}

# Aturan approval -> kode HTTP. 403 = kamu bukan approver yang sah; 409 = status keputusannya tidak
# memungkinkan; 422 = data keputusan tidak lengkap untuk aturan ini.
RULE_ERROR_TO_HTTP: dict[str, int] = {
    "approver_role_not_allowed": 403,
    "approver_location_mismatch": 403,
    "duplicate_approver": 409,
    "decision_not_approvable": 409,
    "decision_expired": 409,
    "decision_rejected": 409,
    "decision_target_missing": 422,
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _is_expired(decision: Decision, now: datetime) -> bool:
    return decision.expires_at is not None and now >= decision.expires_at


def _rule_error(exc: ApprovalRuleError) -> HTTPException:
    return HTTPException(
        status_code=RULE_ERROR_TO_HTTP.get(exc.code, 409),
        detail={"error": exc.code, "detail": exc.message},
    )


def _resolve_location(session: Session, name: str) -> Location:
    location = session.execute(select(Location).where(Location.name == name)).scalar_one_or_none()
    if location is None:
        known = session.execute(select(Location.name).order_by(Location.name)).scalars().all()
        raise HTTPException(
            status_code=404,
            detail=f"Lokasi tidak dikenal: {name!r}. Yang ada: {', '.join(known)}",
        )
    return location


def _resolve_commodity(session: Session, name: str) -> Commodity:
    commodity = session.execute(
        select(Commodity).where(Commodity.name == name)
    ).scalar_one_or_none()
    if commodity is None:
        known = session.execute(select(Commodity.name).order_by(Commodity.name)).scalars().all()
        raise HTTPException(
            status_code=404,
            detail=f"Komoditas tidak dikenal: {name!r}. Yang ada: {', '.join(known)}",
        )
    return commodity


def _record_trace(
    session: Session,
    decision: Decision,
    *,
    step_name: str,
    tool_called: str,
    input_summary: dict[str, Any] | None = None,
    output_summary: dict[str, Any] | None = None,
) -> None:
    session.add(
        AgentTrace(
            decision_id=decision.id,
            step_name=step_name,
            tool_called=tool_called,
            input_summary=input_summary,
            output_summary=output_summary,
            step_at=_now(),
        )
    )


# --- POST /actions/propose ---------------------------------------------------------------


class ProposeRequest(BaseModel):
    decision_type: Literal["regional_balance", "price_anomaly", "safety_disruption"]
    source_location: str
    target_location: str = Field(description="SPPG penerima; hanya SPPG inilah yang boleh approve")
    commodity: str
    quantity_kg: Decimal = Field(gt=0)
    safe_delivered_cost: Decimal | None = Field(default=None, gt=0)
    cost_breakdown: dict[str, Any] | None = None
    expires_at: datetime | None = None
    verifier_result: Literal["consistent", "flagged", "unavailable"] | None = Field(
        default=None,
        description="Hasil verifikasi. Kosong = belum diverifikasi, keputusan tidak bisa di-approve.",
    )
    verifier_note: str | None = None
    proposed_by: str = "supervisor_agent"


class ProposeResponse(BaseModel):
    decision: DecisionOut


@router.post("/propose", status_code=201)
def propose(
    payload: ProposeRequest,
    session: SessionDep,
    user: CurrentUser,
) -> ProposeResponse:
    """Mencatat satu usulan keputusan (langkah DECIDE).

    Belum menghitung apa pun: perhitungan kandidat/ongkos ada di `core/` + `/balance/*` +
    `/cost/*` yang belum dibangun. Endpoint ini mencatat keputusan yang sudah dihitung agent.
    """
    source = _resolve_location(session, payload.source_location)
    target = _resolve_location(session, payload.target_location)
    commodity = _resolve_commodity(session, payload.commodity)

    status = (
        VERIFIER_RESULT_TO_STATUS[payload.verifier_result]
        if payload.verifier_result
        else "proposed"
    )

    decision = Decision(
        decision_type=payload.decision_type,
        status=status,
        expires_at=payload.expires_at,
        proposed_by=payload.proposed_by,
        verified_by=payload.proposed_by if payload.verifier_result else None,
        verifier_note=payload.verifier_note,
        source_location_id=source.id,
        target_location_id=target.id,
        commodity_id=commodity.id,
        quantity_kg=payload.quantity_kg,
        safe_delivered_cost=payload.safe_delivered_cost,
        cost_breakdown=payload.cost_breakdown,
    )
    session.add(decision)
    session.flush()

    _record_trace(
        session,
        decision,
        step_name="DECIDE",
        tool_called="POST /actions/propose",
        input_summary={
            "decision_type": payload.decision_type,
            "source_location": source.name,
            "target_location": target.name,
            "commodity": commodity.name,
            "quantity_kg": float(payload.quantity_kg),
            "verifier_result": payload.verifier_result,
        },
        output_summary={"status": decision.status, "requested_by": user.email},
    )

    session.commit()
    session.refresh(decision)
    return ProposeResponse(decision=build_decision_out(session, decision))


# --- POST /actions/approve ---------------------------------------------------------------


class ApproveRequest(BaseModel):
    decision_id: str
    approved: bool
    comment: str | None = None


class ApproveResponse(BaseModel):
    decision: DecisionOut
    approval: dict[str, Any]


@router.post("/approve")
def approve(
    payload: ApproveRequest,
    session: SessionDep,
    user: CurrentUser,
) -> ApproveResponse:
    """Satu suara approval dari pemanggil (`X-User-Id`).

    Semua penolakan aturan datang dari `core/approval_rules.py` supaya logikanya satu tempat dan
    bisa diuji tanpa HTTP. Nilai yang dikembalikan: keputusan terbaru + ringkasan approval.
    """
    decision = get_decision_or_404(session, payload.decision_id)
    now = _now()

    if _is_expired(decision, now) and decision.status not in ("executed", "rejected", "expired"):
        decision.status = "expired"
        session.commit()
        raise HTTPException(
            status_code=409,
            detail={
                "error": "decision_expired",
                "detail": f"Keputusan lewat masa berlaku pada {decision.expires_at}. Status dipindahkan "
                "ke 'expired'; Supervisor harus mengulang dari DETECT (docs/Skill.md §9).",
            },
        )

    votes = approval_votes(session, decision.id)

    try:
        validate_vote(
            status=decision.status,
            expired=_is_expired(decision, now),
            approver_id=user.id,
            approver_role=user.role,
            approver_location_id=user.location_id,
            target_location_id=decision.target_location_id,
            votes=votes,
        )
    except ApprovalRuleError as exc:
        raise _rule_error(exc) from None

    # Peran approver diambil dari user yang sedang login (bukan dari payload) — dia snapshot untuk
    # audit, dan `approvals_role_check` di database menolak nilai di luar daftar.
    session.add(
        Approval(
            decision_id=decision.id,
            approved_by=user.id,
            approver_role=user.role,
            approved=payload.approved,
            comment=payload.comment,
            approved_at=now,
        )
    )
    session.flush()

    new_votes = votes + [
        ApprovalVote(approver_id=user.id, role=user.role, approved=payload.approved)
    ]
    decision.status = decision_status_after(decision.status, new_votes)
    session.commit()
    session.refresh(decision)

    return ApproveResponse(
        decision=build_decision_out(session, decision),
        approval=approval_summary(decision, new_votes),
    )


# --- POST /actions/execute ---------------------------------------------------------------


class ExecuteRequest(BaseModel):
    decision_id: str
    supplier: str = Field(description="Business partner id dari provider SAP (lihat GET /supply)")
    order_quantity_kg: Decimal | None = Field(default=None, gt=0)
    net_price_amount: Decimal = Field(gt=0, description="Harga total PO")

    model_config = {"json_schema_extra": {"example": {"decision_id": "<uuid>", "supplier": "<id>",
                                                      "net_price_amount": 26200.00}}}


class PurchaseOrderOut(BaseModel):
    purchase_order: str
    supplier: str
    material_number: str
    order_quantity: Quantity
    net_price_amount: Quantity
    purchasing_document_date: str
    status: str | None
    data_source: str


class ExecuteResponse(BaseModel):
    purchase_order: PurchaseOrderOut
    decision: DecisionOut


def _purchase_order_data_source(provider: SAPDataProvider) -> str:
    """Sumber data untuk kapabilitas PO — label jujur, diambil dari provider yang benar-benar jalan."""
    return provider.data_source_for(SAPCapability.PURCHASE_ORDER).value


def _serialize_purchase_order(po: PurchaseOrderRecord, provider: SAPDataProvider) -> PurchaseOrderOut:
    return PurchaseOrderOut(
        purchase_order=po.PurchaseOrder,
        supplier=po.Supplier,
        material_number=po.MaterialNumber,
        order_quantity=po.OrderQuantity,
        net_price_amount=po.NetPriceAmount,
        purchasing_document_date=po.PurchasingDocumentDate.isoformat(),
        status=po.Status,
        data_source=_purchase_order_data_source(provider),
    )


@router.post("/execute")
def execute(
    payload: ExecuteRequest,
    session: SessionDep,
    user: CurrentUser,
    provider: Annotated[SAPDataProvider, Depends(get_provider)],
) -> ExecuteResponse:
    """Kirim purchase order ke SAP (mock) — HANYA setelah approval sah.

    Ini penegakan "tidak ada auto-execute" (`Rules.md` §1.2, `docs/Schema.md` §6): satu-satunya
    pintu menuju `executed` adalah status `approved`, dan status itu hanya bisa lahir dari
    approval di `/actions/approve`.
    """
    decision = get_decision_or_404(session, payload.decision_id)
    now = _now()

    if _is_expired(decision, now):
        if decision.status not in ("executed", "rejected", "expired"):
            decision.status = "expired"
            session.commit()
        raise HTTPException(
            status_code=409,
            detail={
                "error": "decision_expired",
                "detail": "Keputusan lewat masa berlaku; tidak pernah dieksekusi (docs/Skill.md §9).",
            },
        )

    if decision.status != "approved":
        votes = approval_votes(session, decision.id)
        needed = None
        try:
            needed = required_approvals(decision.status)
        except ApprovalRuleError:
            needed = None

        raise HTTPException(
            status_code=409,
            detail={
                "error": "no_auto_execute",
                "detail": (
                    f"Keputusan berstatus {decision.status!r} belum boleh dieksekusi. "
                    "Tidak ada auto-execute: PO hanya boleh dikirim setelah approval sah "
                    "(docs/Skill.md §9)."
                ),
                "required_approvals": needed,
                "approved_count": sum(1 for vote in votes if vote.approved),
                "satisfied": is_satisfied(decision.status, votes),
            },
        )

    # Jaring pengaman idempotensi: satu keputusan -> paling banyak satu PO.
    existing = provider.get_purchase_orders(decision_reference=str(decision.id))
    if existing:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "already_executed",
                "detail": f"Keputusan ini sudah punya purchase order {existing[0].PurchaseOrder}.",
                "purchase_order": existing[0].PurchaseOrder,
            },
        )

    material_number = _material_for(session, provider, decision)
    # Batas lapisan: api/ berbicara dalam istilah domain (`suppliers.id`), provider dalam kode SAP.
    # Kode dicari lewat interface provider (sama seperti `_material_for`), bukan konstanta SAP di api/.
    supplier = _domain_supplier(session, payload.supplier)
    partner_code = _business_partner_for(provider, supplier)

    quantity = payload.order_quantity_kg or decision.quantity_kg
    if quantity is None:
        raise HTTPException(
            status_code=422,
            detail="Jumlah tidak ada di keputusan maupun di permintaan, jadi PO tidak bisa dibuat.",
        )

    po = provider.create_purchase_order(
        CreatePurchaseOrderRequest(
            Supplier=partner_code,
            MaterialNumber=material_number,
            OrderQuantity=Decimal(quantity),
            NetPriceAmount=payload.net_price_amount,
            PurchasingDocumentDate=now.date(),
            DecisionReference=str(decision.id),
            Status="submitted",
        )
    )

    decision.status = "executed"
    decision.outcome = "pending"

    session.add(
        DecisionEvidence(
            decision_id=decision.id,
            evidence_type="sap_purchase_order",
            payload={
                "purchase_order": po.PurchaseOrder,
                "supplier": po.Supplier,
                "material_number": po.MaterialNumber,
                "order_quantity": float(po.OrderQuantity),
                "net_price_amount": float(po.NetPriceAmount),
                "status": po.Status,
                "data_source": _purchase_order_data_source(provider),
            },
            is_consistent=None,
            recorded_at=now,
        )
    )
    _record_trace(
        session,
        decision,
        step_name="ACT",
        tool_called="SAPDataProvider.create_purchase_order",
        input_summary={
            "supplier": payload.supplier,
            "material_number": material_number,
            "order_quantity": float(quantity),
        },
        output_summary={"purchase_order": po.PurchaseOrder, "status": po.Status},
    )

    # SATU commit di akhir: PO (ditulis oleh store yang meminjam session request ini) dan baris
    # domain masuk bersama. Kalau ada yang gagal di tengah, dependency session menutup session
    # tanpa commit sehingga semuanya dibatalkan — tidak ada PO "yatim" tanpa status keputusan.
    try:
        session.commit()
    except Exception:
        session.rollback()
        raise
    session.refresh(decision)

    return ExecuteResponse(
        purchase_order=_serialize_purchase_order(po, provider),
        decision=build_decision_out(session, decision),
    )


# --- POST /actions/receive (Receiving Inspection, design.md §3.5b) -------------------------


class ReceiveRequest(BaseModel):
    decision_id: str
    physical_condition: Literal["baik", "rusak_sebagian", "rusak"] = Field(
        description="Kondisi fisik barang saat diterima; menentukan decisions.outcome"
    )
    measured_temperature_c: Decimal | None = Field(default=None, description="Suhu terukur (°C)")
    delivered_quantity_kg: Decimal | None = Field(default=None, gt=0)
    notes: str | None = None


class SupplierScoreOut(BaseModel):
    supplier: str
    supplier_name: str
    reliability_score_before: Quantity
    reliability_score_after: Quantity
    changed: bool
    window: int
    considered_outcomes: list[str]


class ReceiveResponse(BaseModel):
    decision: DecisionOut
    outcome: str
    supplier_score: SupplierScoreOut | None


# Aturan penerimaan -> kode HTTP. 403 = bukan orang yang berhak mencatat; 409 = status keputusan
# tidak memungkinkan; 422 = data keputusan tidak lengkap.
RECEIVING_ERROR_TO_HTTP: dict[str, int] = {
    "recorder_role_not_allowed": 403,
    "recorder_location_mismatch": 403,
    "decision_not_executed": 409,
    "already_received": 409,
    "decision_target_missing": 422,
}


def _receiving_error(exc: ReceivingRuleError) -> HTTPException:
    return HTTPException(
        status_code=RECEIVING_ERROR_TO_HTTP.get(exc.code, 409),
        detail={"error": exc.code, "detail": exc.message},
    )


def _supplier_outcomes(session: Session, supplier_id: uuid.UUID) -> list[str | None]:
    """Riwayat `outcome` keputusan yang PO-nya ke pemasok ini, urut lama -> baru.

    Kenapa lewat PO: `decisions` tidak punya kolom `supplier_id` (`docs/Schema.md` §3), sedangkan
    `sap_mock_purchase_orders` punya `supplier_id` DAN `decision_id` (§4). Jadi tautan
    keputusan<->pemasok hanya ada di sisi SAP, dan LEARN membacanya dari sana.
    """
    rows = session.execute(
        select(Decision.outcome)
        .join(SapMockPurchaseOrder, SapMockPurchaseOrder.decision_id == Decision.id)
        .where(SapMockPurchaseOrder.supplier_id == supplier_id, Decision.outcome.is_not(None))
        .order_by(Decision.created_at)
    ).scalars().all()
    return list(rows)


def _apply_learn(
    session: Session,
    *,
    supplier_id: str,
) -> tuple[SupplierScoreOut, int, list[str]]:
    """Jalankan LEARN untuk satu pemasok. Mengembalikan ringkasan perubahan skor."""
    try:
        supplier_uuid = uuid.UUID(supplier_id)
    except ValueError:
        raise HTTPException(
            status_code=409,
            detail=f"Pemasok pada PO bukan UUID yang dikenal: {supplier_id!r}",
        ) from None

    supplier = session.get(Supplier, supplier_uuid)
    if supplier is None:
        raise HTTPException(
            status_code=409, detail=f"Pemasok {supplier_id} tidak ada di tabel suppliers."
        )

    outcomes = _supplier_outcomes(session, supplier_uuid)
    decided = [outcome for outcome in outcomes if outcome in ("success", "failure")]
    before = Decimal(supplier.reliability_score)
    after = adjusted_reliability(before, outcomes)

    supplier.reliability_score = after

    summary = SupplierScoreOut(
        supplier=supplier_id,
        supplier_name=supplier.name,
        reliability_score_before=before,
        reliability_score_after=after,
        changed=after != before,
        window=LEARN_WINDOW,
        considered_outcomes=decided[-LEARN_WINDOW:],
    )
    return summary, len(decided), decided[-LEARN_WINDOW:]


def _linked_purchase_order(provider: SAPDataProvider, decision: Decision) -> PurchaseOrderRecord:
    """PO yang lahir dari keputusan ini. Tanpa PO, tidak ada pemasok yang bisa dinilai LEARN."""
    linked = provider.get_purchase_orders(decision_reference=str(decision.id))
    if not linked:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "purchase_order_missing",
                "detail": (
                    f"Keputusan {decision.id} berstatus executed tapi tidak punya purchase order "
                    "tertaut, jadi pemasok penerima tidak bisa ditentukan untuk LEARN. Ini "
                    "inkonsistensi data — periksa sap_mock_purchase_orders.decision_id."
                ),
            },
        )
    return linked[0]


@router.post("/receive")
def receive(
    payload: ReceiveRequest,
    session: SessionDep,
    user: CurrentUser,
    provider: Annotated[SAPDataProvider, Depends(get_provider)],
) -> ReceiveResponse:
    """Catat inspeksi penerimaan: bukti `human_inspection`, isi `decisions.outcome`, lalu LEARN.

    LEARN dijalankan lewat `core/learn.py` (formula `docs/Skill.md` §10) — aritmetika deterministik,
    bukan model yang dilatih ulang. Skor yang berubah hanya dipakai keputusan BERIKUTNYA; keputusan
    yang sudah lewat tidak diubah (§10 poin 3).
    """
    decision = get_decision_or_404(session, payload.decision_id)
    now = _now()

    try:
        outcome = outcome_for_condition(payload.physical_condition)
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail={"error": "unknown_condition", "detail": str(exc)}
        ) from None

    try:
        validate_receiving(
            decision_status=decision.status,
            current_outcome=decision.outcome,
            recorder_role=user.role,
            recorder_location_id=user.location_id,
            target_location_id=decision.target_location_id,
        )
    except ReceivingRuleError as exc:
        raise _receiving_error(exc) from None

    po = _linked_purchase_order(provider, decision)

    session.add(
        DecisionEvidence(
            decision_id=decision.id,
            evidence_type="human_inspection",
            payload={
                "physical_condition": payload.physical_condition,
                "measured_temperature_c": float(payload.measured_temperature_c)
                if payload.measured_temperature_c is not None
                else None,
                "delivered_quantity_kg": float(payload.delivered_quantity_kg)
                if payload.delivered_quantity_kg is not None
                else None,
                "outcome": outcome,
                "notes": payload.notes,
                "recorded_by": user.email,
                "recorded_by_role": user.role,
                "purchase_order": po.PurchaseOrder,
            },
            is_consistent=None,
            recorded_at=now,
        )
    )
    decision.outcome = outcome

    supplier_score, considered_count, considered = _apply_learn(
        session,
        supplier_id=str(_domain_supplier_from_partner(session, provider, po.Supplier).id),
    )

    # Jejak LEARN ditulis supaya perubahan skor bisa diaudit dari UI (design.md §3.9c).
    # Tanpa suffix [primary]/[fallback_n]: aturan suffix itu untuk panggilan model AI
    # (docs/Schema.md §6), sedangkan LEARN bukan panggilan model.
    _record_trace(
        session,
        decision,
        step_name="LEARN",
        tool_called="core/learn.adjusted_reliability",
        input_summary={
            "supplier": supplier_score.supplier,
            "reliability_score_before": float(supplier_score.reliability_score_before),
            "outcomes_considered": considered,
            "window": supplier_score.window,
            "total_decided_outcomes": considered_count,
        },
        output_summary={
            "reliability_score_after": float(supplier_score.reliability_score_after),
            "changed": supplier_score.changed,
        },
    )

    try:
        session.commit()
    except Exception:
        session.rollback()
        raise
    session.refresh(decision)

    return ReceiveResponse(
        decision=build_decision_out(session, decision),
        outcome=outcome,
        supplier_score=supplier_score,
    )


def _material_for(session: Session, provider: SAPDataProvider, decision: Decision) -> str:
    """Material SAP untuk komoditas keputusan — lewat peta domain, bukan tebakan.

    Provider tidak boleh dipanggil dengan kode karangan: kalau komoditasnya tidak ada di peta
    (`sap_integration/field_mapping.py`), lebih baik gagal jelas daripada membuat PO ke material
    yang salah.
    """
    commodity = session.get(Commodity, decision.commodity_id)
    if commodity is None:
        raise HTTPException(status_code=422, detail="Keputusan tidak punya komoditas.")

    material_number = MATERIAL_NUMBER_BY_COMMODITY.get(commodity.name)
    if material_number is None:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Komoditas {commodity.name!r} belum ada di peta material "
                f"(sap_integration/field_mapping.py). Yang ada: "
                f"{', '.join(sorted(MATERIAL_NUMBER_BY_COMMODITY))}"
            ),
        )

    known = {record.MaterialNumber for record in provider.get_product_master()}
    if material_number not in known:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Komoditas {commodity.name!r} dipetakan ke material {material_number!r} yang tidak ada "
                f"di SAP. Material yang ada: {', '.join(sorted(known))}"
            ),
        )
    return material_number


def _domain_supplier(session: Session, supplier_id: str) -> Supplier:
    """Pemasok domain dari id yang dikirim pemanggil.

    API ini berbicara dalam istilah domain: pemanggil mengirim `suppliers.id` (UUID), bukan kode SAP.
    Id yang bukan UUID atau tidak ada di tabel ditolak 422 dengan daftar pemasok yang benar — bukan
    dibiarkan jadi PO ke pemasok yang salah.
    """
    try:
        key = uuid.UUID(supplier_id)
    except ValueError:
        known = session.scalars(select(Supplier.name).order_by(Supplier.name)).all()
        raise HTTPException(
            status_code=422,
            detail=(
                f"Pemasok {supplier_id!r} bukan id pemasok domain (UUID). Yang ada: "
                f"{', '.join(known)}"
            ),
        ) from None

    supplier = session.get(Supplier, key)
    if supplier is None:
        known = session.scalars(select(Supplier.name).order_by(Supplier.name)).all()
        raise HTTPException(
            status_code=422,
            detail=f"Pemasok {supplier_id!r} tidak ada di tabel suppliers. Yang ada: {', '.join(known)}",
        )
    return supplier


def _business_partner_for(provider: SAPDataProvider, supplier: Supplier) -> str:
    """Kode business partner SAP untuk pemasok domain, dicari lewat interface provider.

    Dokumen SAP memuat kode (`SUP-A`), tabel domain memuat UUID. Pasangan kode <-> pemasok dicari
    lewat nama dari `get_business_partner()`, sehingga api/ tidak perlu tahu konstanta SAP apa pun.

    Asumsi yang perlu dikonfirmasi: mock memasangkan pemasok domain dan business partner lewat NAMA.
    Di produksi pasangan ini harus datang dari vendor master SAP (deviasi #15).
    """
    partners = list(provider.get_business_partner())
    for partner in partners:
        if partner.BusinessPartnerName == supplier.name:
            return partner.BusinessPartner

    known = ", ".join(sorted(partner.BusinessPartnerName for partner in partners)) or "(kosong)"
    raise HTTPException(
        status_code=422,
        detail=(
            f"Pemasok {supplier.name!r} tidak terdaftar sebagai business partner di provider SAP "
            f"yang aktif. Nama yang ada: {known}"
        ),
    )


def _domain_supplier_from_partner(
    session: Session, provider: SAPDataProvider, business_partner: str
) -> Supplier:
    """Kebalikan `_business_partner_for`: kode business partner pada dokumen -> pemasok domain.

    Dokumen SAP (PO) memuat KODE; LEARN butuh baris `suppliers` domain. Pasangannya dicari lewat
    interface provider (kode -> nama), sehingga api/ tetap tanpa konstanta SAP.
    """
    for partner in provider.get_business_partner():
        if partner.BusinessPartner == business_partner:
            supplier = session.scalar(
                select(Supplier).where(Supplier.name == partner.BusinessPartnerName)
            )
            if supplier is None:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Business partner {business_partner!r} memakai nama "
                        f"{partner.BusinessPartnerName!r} yang tidak ada di tabel suppliers, jadi "
                        "pemasok penerima tidak bisa ditentukan untuk LEARN."
                    ),
                )
            return supplier

    raise HTTPException(
        status_code=409,
        detail=(
            f"Kode pemasok {business_partner!r} pada purchase order tidak ada di daftar business "
            "partner provider SAP yang aktif, jadi pemasok penerima tidak bisa ditentukan untuk LEARN."
        ),
    )
