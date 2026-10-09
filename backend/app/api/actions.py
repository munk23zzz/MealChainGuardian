"""Endpoint aksi — `POST /actions/propose|approve|execute`.

Aturan yang ditegakkan DI SINI (bukan di UI) — `docs/Schema.md` §3 & §6 dan `docs/PRD.md` §5:

1. **Tidak ada auto-execute.** `executed` hanya bisa dicapai kalau sudah ada approval yang sah
   (`decisions.status == 'approved'`). Tidak ada jalur `proposed -> executed`.
2. **Siapa yang sah approve.** Ditegakkan `core/approval_rules.py`: approver harus peran SPPG
   (`sppg_head`/`sppg_nutritionist`) dari SPPG penerima; 1 approval cukup untuk
   `pending_approval`, 2 (head DAN nutritionist) untuk `verifier_flagged`. `bgn_monitor` tidak
   pernah bisa approve.
3. **Masa berlaku.** `decisions.expires_at` WAJIB terisi (`docs/Schema.md` §3, keputusan Roy
   2026-10-05) dan keputusan yang lewat batas itu tidak bisa di-approve maupun dieksekusi.
   Kedaluwarsa bersifat TURUNAN dari waktu — status `expired` sudah dihapus dari kontrak, jadi
   tidak ada penulisan status saat batas terlewat (`docs/Schema.md` §3, revisi 9 Okt).
4. **Eksklusi pemasok lewat approval (`Rules.md` §1.2).** Aksi berisiko tinggi ini tidak punya
   tombol langsung: `POST /actions/propose` dengan `decision_type='supplier_exclusion'` mencatat
   usulan (lokasi asal & tujuan diambil dari SPPG pemasok itu, supaya hanya SPPG-nya yang boleh
   approve), dan `POST /actions/exclude` menulis eksklusinya — hanya kalau statusnya `approved`.
   Alasan eksklusi WAJIB (`app/core/supplier_exclusion.py`).

Inspeksi penerimaan (`/actions/receive`) dan pembaruan `reliability_score` sudah TIDAK ada:
revisi dokumen 9 Okt menghapus `decisions.outcome` dan langkah penerimaan dari desain
(`docs/Skill.md` §5, `docs/design.md` §3).

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
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Annotated, Any, Literal

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
from app.core.supplier_exclusion import ExclusionRuleError, validate_request as validate_exclusion
from app.models import (
    AgentTrace,
    Approval,
    Commodity,
    Decision,
    DecisionEvidence,
    Location,
    Supplier,
)
from app.sap_integration.field_mapping import MATERIAL_NUMBER_BY_COMMODITY
from app.sap_integration.provider_interface import (
    CreatePurchaseOrderRequest,
    PurchaseOrderRecord,
    SAPCapability,
    SAPDataProvider,
)

router = APIRouter(prefix="/actions", tags=["actions"])

# Verifier Agent belum dibangun di repo ini (P2.3). Sampai itu ada, hasil verifikasi diberikan
# pemanggil (Supervisor agent) secara eksplisit; kalau tidak diberikan, keputusan TIDAK dianggap
# terverifikasi dan karena itu tidak bisa di-approve. Status `verifier_unavailable` sudah dihapus
# dari kontrak (docs/Schema.md §3), jadi verifier yang gagal diperlakukan seperti belum
# terverifikasi: keputusan tetap `proposed` dan tidak bisa di-approve.
VERIFIER_RESULT_TO_STATUS: dict[str, str] = {
    "consistent": "pending_approval",
    "flagged": "verifier_flagged",
}

# Batas masa berlaku bawaan kalau pemanggil tidak menyebutkannya. `decisions.expires_at` NOT NULL
# (docs/Schema.md §3), jadi nilai ini WAJIB ada. Angka 48 jam = SLA default; saat kandidat batch
# nyata tersedia, batas sebenarnya adalah min(usable_until batch, SLA) seperti rumus lama
# (`docs/Schema.md` §3 versi lama).
DEFAULT_DECISION_VALIDITY_HOURS = 48

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
    """Kedaluwarsa diturunkan dari `expires_at` (NOT NULL, `docs/Schema.md` §3)."""
    return now >= decision.expires_at


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
    decision_type: Literal[
        "regional_balance", "price_anomaly", "safety_disruption", "supplier_exclusion"
    ]
    # Wajib untuk keputusan pasokan; untuk `supplier_exclusion` diambil dari baris pemasok
    # (lokasi asal & tujuan = SPPG pemasok itu, supaya hanya SPPG-nya yang berhak approve).
    source_location: str | None = None
    target_location: str | None = Field(
        default=None, description="SPPG penerima; hanya SPPG inilah yang boleh approve"
    )
    commodity: str | None = None
    quantity_kg: Decimal | None = Field(default=None, gt=0)
    safe_delivered_cost: Decimal | None = Field(default=None, gt=0)
    cost_breakdown: dict[str, Any] | None = None
    expires_at: datetime | None = None
    verifier_result: Literal["consistent", "flagged"] | None = Field(
        default=None,
        description="Hasil verifikasi. Kosong = belum diverifikasi, keputusan tidak bisa di-approve.",
    )
    verifier_note: str | None = None
    proposed_by: str = "supervisor_agent"
    # Khusus `supplier_exclusion`: pemasok yang diusulkan dikecualikan + alasannya (wajib).
    supplier: str | None = Field(
        default=None, description="id domain pemasok; wajib untuk decision_type='supplier_exclusion'"
    )
    reason: str | None = Field(
        default=None, description="alasan eksklusi (wajib, minimal 10 karakter)"
    )


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

    Dua bentuk:

    * keputusan pasokan (`regional_balance`/`price_anomaly`/`safety_disruption`) — butuh lokasi
      asal, lokasi tujuan, komoditas, dan jumlah;
    * usulan eksklusi pemasok (`supplier_exclusion`) — butuh `supplier` + `reason`; lokasi asal dan
      tujuan diambil dari SPPG pemasok itu supaya hanya SPPG-nya yang berhak approve
      (`Rules.md` §1.2).
    """
    decision = (
        _propose_supplier_exclusion(session, payload, user)
        if payload.decision_type == "supplier_exclusion"
        else _propose_supply_decision(session, payload, user)
    )

    session.commit()
    session.refresh(decision)
    return ProposeResponse(decision=build_decision_out(session, decision))


def _propose_supply_decision(
    session: Session, payload: ProposeRequest, user: CurrentUser
) -> Decision:
    """Bentuk lama: keputusan pasokan dengan lokasi/komoditas/jumlah."""
    missing = [
        name
        for name, value in (
            ("source_location", payload.source_location),
            ("target_location", payload.target_location),
            ("commodity", payload.commodity),
            ("quantity_kg", payload.quantity_kg),
        )
        if value is None or value == ""
    ]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Tipe keputusan {payload.decision_type!r} butuh {', '.join(missing)}; "
                "hanya 'supplier_exclusion' yang boleh mengosongkannya."
            ),
        )
    assert payload.source_location is not None  # sempit untuk tipe checker; dijaga di atas
    assert payload.target_location is not None
    assert payload.commodity is not None
    assert payload.quantity_kg is not None

    source = _resolve_location(session, payload.source_location)
    target = _resolve_location(session, payload.target_location)
    commodity = _resolve_commodity(session, payload.commodity)

    status = (
        VERIFIER_RESULT_TO_STATUS[payload.verifier_result]
        if payload.verifier_result
        else "proposed"
    )

    now = _now()
    decision = Decision(
        decision_type=payload.decision_type,
        status=status,
        # NOT NULL: kalau pemanggil tidak menyebut batasnya, pakai SLA bawaan.
        expires_at=payload.expires_at
        or now + timedelta(hours=DEFAULT_DECISION_VALIDITY_HOURS),
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
    return decision


def _propose_supplier_exclusion(
    session: Session, payload: ProposeRequest, user: CurrentUser
) -> Decision:
    """Usulan eksklusi pemasok — aksi berisiko tinggi, jadi wajib beralasan dan beralur approval.

    Dua hal yang sengaja BEDA dari keputusan pasokan:

    * lokasi asal & tujuan = SPPG tempat pemasok itu terdaftar, sehingga aturan approval yang sudah
      ada ("approver harus dari SPPG penerima") otomatis membatasi siapa yang boleh menyetujui;
    * tanpa Verifier agent, usulan langsung masuk `pending_approval` (bukan `proposed`). Alasannya:
      Verifier agent belum dibangun (P2.3), dan untuk aksi berisiko tinggi approval manusia-lah yang
      memverifikasi. Kalau pemanggil menyatakan verifier `flagged`, statusnya `verifier_flagged`
      seperti biasa (butuh dua approval).
    """
    if not payload.supplier:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "supplier_required",
                "detail": "Usulan eksklusi wajib menyebut pemasoknya (id domain dari /ui/suppliers).",
            },
        )

    supplier = _domain_supplier(session, payload.supplier)
    try:
        validate_exclusion(reason=payload.reason, supplier_status=supplier.status)
    except ExclusionRuleError as exc:
        raise HTTPException(
            status_code=422, detail={"error": exc.code, "detail": exc.message}
        ) from None

    location = session.get(Location, supplier.location_id)
    status = (
        VERIFIER_RESULT_TO_STATUS["flagged"]
        if payload.verifier_result == "flagged"
        else "pending_approval"
    )
    now = _now()
    decision = Decision(
        decision_type="supplier_exclusion",
        status=status,
        expires_at=payload.expires_at or now + timedelta(hours=DEFAULT_DECISION_VALIDITY_HOURS),
        proposed_by=payload.proposed_by,
        verified_by=None,
        verifier_note=payload.verifier_note,
        supplier_id=supplier.id,
        reason=(payload.reason or "").strip(),
        source_location_id=location.id if location is not None else None,
        target_location_id=location.id if location is not None else None,
        commodity_id=None,
        quantity_kg=None,
        safe_delivered_cost=None,
        cost_breakdown=None,
    )
    session.add(decision)
    session.flush()

    _record_trace(
        session,
        decision,
        step_name="DECIDE",
        tool_called="POST /actions/propose",
        input_summary={
            "decision_type": "supplier_exclusion",
            "supplier": supplier.name,
            "reason": decision.reason,
        },
        output_summary={"status": decision.status, "requested_by": user.email},
    )
    return decision


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

    if _is_expired(decision, now) and decision.status not in ("executed", "rejected"):
        raise HTTPException(
            status_code=409,
            detail={
                "error": "decision_expired",
                "detail": f"Keputusan lewat masa berlaku pada {decision.expires_at.isoformat()} dan tidak "
                "bisa di-approve. Kedaluwarsa kini diturunkan dari waktu, bukan status tersimpan "
                "(docs/Schema.md §3) — Supervisor harus mengulang dari DETECT dengan data terbaru.",
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

    # Peran approver TIDAK lagi disimpan di baris approval: kolom `approvals.approver_role` dihapus
    # dari skema (docs/Schema.md §3, revisi 9 Okt). Peran dibaca dari `users.role` saat validasi,
    # dan siapa meng-approve tetap terlacak lewat `approved_by`.
    session.add(
        Approval(
            decision_id=decision.id,
            approved_by=user.id,
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
        raise HTTPException(
            status_code=409,
            detail={
                "error": "decision_expired",
                "detail": "Keputusan lewat masa berlaku; tidak pernah dieksekusi. Kedaluwarsa diturunkan "
                "dari `expires_at`, bukan status tersimpan (docs/Schema.md §3).",
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
                    "(docs/Schema.md §3)."
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
    # `decisions.outcome` sudah dihapus dari skema (docs/Schema.md §3, revisi 9 Okt) — tidak ada
    # lagi pencatatan hasil pengiriman di sisi ini.

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


# --- POST /actions/exclude --------------------------------------------------------------


class ExcludeRequest(BaseModel):
    decision_id: str


class ExcludeResponse(BaseModel):
    decision: DecisionOut
    supplier: dict[str, Any]


@router.post("/exclude")
def exclude_supplier(
    payload: ExcludeRequest,
    session: SessionDep,
    user: CurrentUser,
) -> ExcludeResponse:
    """Menulis eksklusi pemasok — HANYA setelah keputusan `supplier_exclusion` disetujui.

    Ini penegakan `Rules.md` §1.2 ("mengeksklusi supplier WAJIB lewat `approvals` dengan
    `approved = true` dulu"): satu-satunya pintu menuju `suppliers.status='excluded'` adalah
    keputusan berstatus `approved`, dan status itu hanya lahir dari `/actions/approve`. Tidak ada
    pemanggilan langsung dari UI tanpa approval.
    """
    decision = get_decision_or_404(session, payload.decision_id)
    now = _now()

    if decision.decision_type != "supplier_exclusion":
        raise HTTPException(
            status_code=409,
            detail={
                "error": "not_supplier_exclusion",
                "detail": (
                    f"Keputusan ini bertipe {decision.decision_type!r}; endpoint ini hanya untuk "
                    "'supplier_exclusion'. Pembelian dieksekusi lewat /actions/execute."
                ),
            },
        )

    if _is_expired(decision, now) and decision.status not in ("executed", "rejected"):
        raise HTTPException(
            status_code=409,
            detail={
                "error": "decision_expired",
                "detail": "Keputusan lewat masa berlaku, jadi eksklusinya tidak dieksekusi. "
                "Supervisor harus mengusulkan ulang dengan alasan terbaru.",
            },
        )

    if decision.status != "approved":
        raise HTTPException(
            status_code=409,
            detail={
                "error": "no_auto_execute",
                "detail": (
                    f"Keputusan berstatus {decision.status!r} belum boleh dieksekusi. "
                    "Eksklusi pemasok adalah aksi berisiko tinggi: ia hanya boleh ditulis setelah "
                    "approval sah (Rules.md §1.2)."
                ),
            },
        )

    if decision.supplier_id is None:
        # Dijaga CHECK constraint di skema; ini jaring kedua supaya pesannya jelas.
        raise HTTPException(
            status_code=409,
            detail={"error": "supplier_missing", "detail": "Keputusan eksklusi tanpa pemasok."},
        )

    supplier = session.get(Supplier, decision.supplier_id)
    if supplier is None:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "supplier_not_found",
                "detail": "Pemasok di keputusan ini sudah tidak ada di tabel suppliers.",
            },
        )

    if supplier.status == "excluded":
        excluded_at_text = (
            supplier.excluded_at.isoformat() if supplier.excluded_at else "(waktu tidak tercatat)"
        )
        raise HTTPException(
            status_code=409,
            detail={
                "error": "already_excluded",
                "detail": f"Pemasok {supplier.name!r} sudah dikecualikan pada {excluded_at_text}.",
            },
        )

    supplier.status = "excluded"
    supplier.excluded_at = now
    supplier.exclusion_reason = decision.reason
    decision.status = "executed"

    session.add(
        DecisionEvidence(
            decision_id=decision.id,
            evidence_type="supplier_exclusion",
            payload={
                "supplier_id": str(supplier.id),
                "supplier": supplier.name,
                "reason": decision.reason,
                "approved_by": str(user.id),
            },
            is_consistent=None,
            recorded_at=now,
        )
    )
    _record_trace(
        session,
        decision,
        step_name="ACT",
        tool_called="POST /actions/exclude",
        input_summary={"supplier": supplier.name, "reason": decision.reason},
        output_summary={"supplier_status": supplier.status, "decided_by": user.email},
    )

    session.commit()
    session.refresh(decision)
    return ExcludeResponse(
        decision=build_decision_out(session, decision),
        supplier={
            "id": str(supplier.id),
            "name": supplier.name,
            "status": supplier.status,
            "excludedAt": supplier.excluded_at.isoformat() if supplier.excluded_at else None,
            "exclusionReason": supplier.exclusion_reason,
        },
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