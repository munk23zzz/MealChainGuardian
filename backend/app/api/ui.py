"""Endpoint baca untuk UI — SEMUA di bawah `/ui/*`, bentuknya mengikuti `frontend/lib/api/schema.d.ts`.

Kenapa dipisah dari kontrak domain (`/supply`, `/decisions`, `/actions/*`): kontrak domain memakai
istilah + bentuk SAP/agent (snake_case, nama lokasi, batch) dan itulah yang nanti didaftarkan ke
AgentCore Gateway. UI butuh bentuk lain — camelCase, dirujuk lewat **id**, plus angka TURUNAN
(status lokasi, stok terpakai, status pasokan). Menambah endpoint di sini tidak mengubah satu pun
respons lama, jadi integrasi agent tidak ikut berisiko.

Yang dihitung di sini karena hanya backend yang punya datanya (Rules.md: angka tidak dikarang di
frontend):
- stok fisik/terpakai per (lokasi, komoditas) dari `batches` — batch gagal aman dan batch lewat masa
  pakai TIDAK dihitung sebagai stok terpakai (Schema.md §6);
- status lokasi (aturannya di `app/core/location_status.py`, cermin `frontend/lib/status.ts`);
- kebutuhan terbaru per pasangan (bukan jumlah seluruh riwayat);
- bentuk `Recommendation` dari `decisions` + approval + jejak agen + bukti + PO.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated, Literal, cast

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, SessionDep
from app.core.freshness import (
    band as freshness_band,
    is_eligible,
    status_for_ui,
    worst_band,
)
from app.core.location_status import (
    FRESHNESS_WARNING_WINDOW,
    LocationStatus,
    SupplyCondition,
    has_temperature_excursion,
    location_status,
)
from app.models import (
    AgentTrace,
    Approval,
    Batch,
    Commodity,
    Decision,
    DecisionEvidence,
    DemandRecord,
    Location,
    PriceSignal,
    SapMockPurchaseOrder,
    Supplier,
)
from app.api.actions import (
    ApproveRequest,
    ExcludeRequest,
    ExecuteRequest,
    ProposeRequest,
    approve,
    exclude_supplier,
    execute,
    get_decision_or_404,
    propose,
)
from app.api.supply import get_provider
from app.core.kpi import DecisionFact, PriceFact, compute_kpi
from app.core.shelf_life import usable_until as derive_usable_until
from app.sap_integration.field_mapping import PLANT_CODE_BY_LOCATION
from app.sap_integration.provider_interface import SAPDataProvider

router = APIRouter(prefix="/ui", tags=["ui"])

# Nilai yang dipakai UI (lihat `frontend/lib/api/schema.d.ts`). Ditulis sebagai literal supaya
# salah ketik tertangkap type checker, bukan jadi string bebas yang lolos ke frontend.
SafetyStatus = Literal["PASS", "FAIL", "NEEDS_VERIFICATION"]
SupplyStatus = Literal["surplus", "balanced", "deficit"]
FreshnessStatus = Literal["fresh", "approaching_expiry", "expired"]
EvidenceType = Literal[
    "sap_purchase_order",
    "sap_goods_receipt",
    "gps",
    "temperature",
    "human_inspection",
    "market_price",
    "supplier_exclusion",
]
DecisionType = Literal[
    "regional_balance", "price_anomaly", "safety_disruption", "supplier_exclusion"
]

EVIDENCE_LABELS: dict[str, str] = {
    "sap_purchase_order": "SAP — purchase order",
    "sap_goods_receipt": "SAP — goods receipt",
    "gps": "GPS kendaraan",
    "temperature": "Suhu (sensor IoT)",
    "human_inspection": "Inspeksi fisik petugas",
    "market_price": "Harga pasar (referensi)",
    "supplier_exclusion": "Keputusan eksklusi pemasok",
}

# Tiga kanal bukti yang diminta Skill.md §4 untuk KPI kelengkapan bukti (SAP + IoT + fisik).
_SAP_EVIDENCE = {"sap_purchase_order", "sap_goods_receipt"}
_IOT_EVIDENCE = {"temperature", "gps"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _decimal(value: object) -> Decimal:
    return Decimal(str(value)) if value is not None else Decimal(0)


# --- Bentuk respons (nama kolom camelCase = kontrak UI) ------------------------------------


class LocationOut(BaseModel):
    """`Location` di `frontend/lib/api/schema.d.ts`."""

    id: str
    name: str
    region: str
    latitude: float
    longitude: float
    role_hint: str | None = Field(default=None, serialization_alias="roleHint")
    status: LocationStatus


class CommodityOut(BaseModel):
    id: str
    name: str
    unit: str


class SupplyOut(BaseModel):
    """`SupplyRecord` — satu baris per (lokasi, komoditas)."""

    location_id: str = Field(serialization_alias="locationId")
    commodity_id: str = Field(serialization_alias="commodityId")
    physical_stock_kg: float = Field(serialization_alias="physicalStockKg")
    usable_stock_kg: float = Field(serialization_alias="usableStockKg")
    batch_count: int = Field(serialization_alias="batchCount")
    status: SupplyStatus
    price_per_kg: float = Field(serialization_alias="pricePerKg")
    freshness_status: FreshnessStatus = Field(serialization_alias="freshnessStatus")
    safety_status: SafetyStatus = Field(serialization_alias="safetyStatus")
    temperature_excursion: bool = Field(
        default=False, serialization_alias="temperatureExcursion"
    )


class DemandOut(BaseModel):
    """`DemandRecord` di `frontend/lib/api/schema.d.ts`."""

    location_id: str = Field(serialization_alias="locationId")
    commodity_id: str = Field(serialization_alias="commodityId")
    projected_kg: float = Field(serialization_alias="projectedKg")
    deficit_kg: float = Field(serialization_alias="deficitKg")
    surplus_kg: float = Field(serialization_alias="surplusKg")


class SupplierOut(BaseModel):
    id: str
    name: str
    location_id: str = Field(serialization_alias="locationId")
    reliability_score: float = Field(serialization_alias="reliabilityScore")
    # Status eksklusi (revisi 9 Okt). Pemasok `excluded` tidak boleh dipilih untuk PO lagi, dan UI
    # menampilkannya sebagai penanda — bukan disembunyikan, supaya keputusan itu tetap bisa diaudit.
    status: str = "active"
    excluded_at: datetime | None = Field(default=None, serialization_alias="excludedAt")
    exclusion_reason: str | None = Field(default=None, serialization_alias="exclusionReason")


class SupplierBatchOut(BaseModel):
    """Satu batch dari pemasok ini (`batches`, docs/Schema.md §2) — apa adanya dari baris tersimpan."""

    id: str
    commodity_id: str = Field(serialization_alias="commodityId")
    location_id: str = Field(serialization_alias="locationId")
    quantity_kg: float = Field(serialization_alias="quantityKg")
    harvested_at: datetime = Field(serialization_alias="harvestedAt")
    usable_until: datetime = Field(
        serialization_alias="usableUntil",
        description="panen + masa layak komoditas (core/shelf_life.py); kolomnya memang tidak ada di DB",
    )
    freshness_score: float | None = Field(default=None, serialization_alias="freshnessScore")
    freshness_status: str | None = Field(
        default=None,
        serialization_alias="freshnessStatus",
        description="pita dokumen fresh/approaching_expiry/expired (core/freshness.py), sama dengan /ui/supply",
    )
    safety_status: str = Field(serialization_alias="safetyStatus")
    certification_status: str = Field(serialization_alias="certificationStatus")
    temperature_readings: int = Field(
        default=0, serialization_alias="temperatureReadings"
    )
    temperature_excursion: bool = Field(
        default=False, serialization_alias="temperatureExcursion"
    )


class SupplierPriceOut(BaseModel):
    """Kuotasi harga dari pemasok ini (`price_signals`, docs/Schema.md §2)."""

    commodity_id: str = Field(serialization_alias="commodityId")
    price_per_kg: float = Field(serialization_alias="pricePerKg")
    source: str
    recorded_at: datetime = Field(serialization_alias="recordedAt")


class SupplierPurchaseOrderOut(BaseModel):
    """Purchase order SAP (mock) yang pernah diterbitkan ke pemasok ini."""

    po_number: str = Field(serialization_alias="poNumber")
    material_number: str = Field(serialization_alias="materialNumber")
    ordered_quantity_kg: float = Field(serialization_alias="orderedQuantityKg")
    price: float
    status: str
    decision_id: str | None = Field(default=None, serialization_alias="decisionId")
    created_at: datetime = Field(serialization_alias="createdAt")


class SupplierExclusionDecisionOut(BaseModel):
    """Riwayat usulan eksklusi pemasok ini (`decisions`, Rules.md §1.2) — termasuk yang ditolak."""

    decision_id: str = Field(serialization_alias="decisionId")
    status: str
    reason: str | None = None
    created_at: datetime = Field(serialization_alias="createdAt")


class SupplierDetailOut(BaseModel):
    """Detail satu pemasok — supaya UI tidak perlu membuka tabel lain per pemasok."""

    supplier: SupplierOut
    batches: list[SupplierBatchOut]
    price_signals: list[SupplierPriceOut] = Field(serialization_alias="priceSignals")
    purchase_orders: list[SupplierPurchaseOrderOut] = Field(serialization_alias="purchaseOrders")
    exclusion_decisions: list[SupplierExclusionDecisionOut] = Field(
        serialization_alias="exclusionDecisions"
    )


class CostCandidateOut(BaseModel):
    """`CandidateCostBreakdown` — diteruskan apa adanya dari `decisions.cost_breakdown`."""

    candidate_id: str = Field(serialization_alias="candidateId")
    supplier_id: str = Field(serialization_alias="supplierId")
    price_per_kg: float = Field(serialization_alias="pricePerKg")
    transport_cost_per_kg: float = Field(serialization_alias="transportCostPerKg")
    handling_cost_per_kg: float = Field(serialization_alias="handlingCostPerKg")
    spoilage_risk_cost_per_kg: float = Field(serialization_alias="spoilageRiskCostPerKg")
    freshness_risk_cost_per_kg: float | None = Field(
        default=None, serialization_alias="freshnessRiskCostPerKg"
    )
    safety_penalty_per_kg: float = Field(serialization_alias="safetyPenaltyPerKg")
    total_safe_delivered_cost_per_kg: float = Field(
        serialization_alias="totalSafeDeliveredCostPerKg"
    )
    distance_km: float = Field(serialization_alias="distanceKm")
    eta_minutes: float = Field(serialization_alias="etaMinutes")
    evidence_completeness: float = Field(serialization_alias="evidenceCompleteness")


class InconsistencyOut(BaseModel):
    description: str


class EvidenceSummaryOut(BaseModel):
    """`EvidenceSummary` — ringkasan tiga kanal bukti yang diminta Skill.md §4."""

    sap: bool
    iot: bool
    physical: bool
    completeness_percent: float = Field(serialization_alias="completenessPercent")
    inconsistencies: list[InconsistencyOut] = []


class EvidenceItemOut(BaseModel):
    id: str | None = None
    type: EvidenceType
    source: str
    summary: str | None = None
    recorded_at: datetime = Field(serialization_alias="recordedAt")
    is_consistent: bool | None = Field(serialization_alias="isConsistent")


class ConstraintCheckOut(BaseModel):
    name: str
    passed: bool
    detail: str | None = None


class AgentStepOut(BaseModel):
    step: str
    tool: str | None = None
    timestamp: datetime
    input_summary: str | None = Field(default=None, serialization_alias="inputSummary")
    output_summary: str | None = Field(default=None, serialization_alias="outputSummary")
    duration_ms: int | None = Field(default=None, serialization_alias="durationMs")
    step_at: datetime | None = Field(default=None, serialization_alias="stepAt")


class SapPurchaseOrderOut(BaseModel):
    po_number: str = Field(serialization_alias="poNumber")
    plant: str
    ordered_quantity_kg: float = Field(serialization_alias="orderedQuantityKg")
    status: str


class KpiSnapshotOut(BaseModel):
    """`KpiSnapshot` di `frontend/lib/api/schema.d.ts` — HANYA KPI yang sumber datanya ada.

    Field yang tidak bisa dihitung sengaja tidak dikirim (bukan 0, yang terbaca seperti "nol
    kejadian") dan alasannya ikut di `unavailable`, supaya UI menampilkan "—" dan juri bisa melihat
    apa yang memang belum tersimpan di skema.

    `alias` (bukan cuma serialization_alias) dipakai karena `compute_kpi` mengembalikan kunci
    camelCase persis seperti kontrak UI; tanpa itu Pydantic membuang kuncinya tanpa suara dan semua
    KPI hilang dari respons.
    """

    model_config = ConfigDict(populate_by_name=True)

    meal_continuity_rate: float | None = Field(default=None, alias="mealContinuityRate")
    avoidable_food_loss_kg: float | None = Field(default=None, alias="avoidableFoodLossKg")
    avoidable_food_loss_rp: float | None = Field(default=None, alias="avoidableFoodLossRp")
    regional_imbalance_resolution_rate: float | None = Field(
        default=None, alias="regionalImbalanceResolutionRate"
    )
    average_safe_delivered_cost_per_kg: float | None = Field(
        default=None, alias="averageSafeDeliveredCostPerKg"
    )
    average_procurement_price_deviation_percent: float | None = Field(
        default=None, alias="averageProcurementPriceDeviationPercent"
    )
    average_decision_time_minutes: float | None = Field(
        default=None, alias="averageDecisionTimeMinutes"
    )
    evidence_completeness_percent: float | None = Field(
        default=None, alias="evidenceCompletenessPercent"
    )
    unavailable: dict[str, str] = Field(default_factory=dict)


class RecommendationOut(BaseModel):
    """`Recommendation` di `frontend/lib/api/schema.d.ts`."""

    id: str
    status: str
    decision_type: DecisionType = Field(serialization_alias="decisionType")
    source_location_id: str = Field(serialization_alias="sourceLocationId")
    target_location_id: str = Field(serialization_alias="targetLocationId")
    commodity_id: str = Field(serialization_alias="commodityId")
    quantity_kg: float = Field(serialization_alias="quantityKg")
    safe_delivered_cost_breakdown: list[CostCandidateOut] = Field(
        default=[], serialization_alias="safeDeliveredCostBreakdown"
    )
    evidence: EvidenceSummaryOut
    evidence_items: list[EvidenceItemOut] = Field(default=[], serialization_alias="evidenceItems")
    constraints: list[ConstraintCheckOut] | None = None
    verifier_note: str | None = Field(default=None, serialization_alias="verifierNote")
    verified_by: str | None = Field(default=None, serialization_alias="verifiedBy")
    safety_check: SafetyStatus = Field(serialization_alias="safetyCheck")
    reason: str
    created_at: datetime = Field(serialization_alias="createdAt")
    approved_at: datetime | None = Field(default=None, serialization_alias="approvedAt")
    expires_at: datetime | None = Field(default=None, serialization_alias="expiresAt")
    executed_at: datetime | None = Field(default=None, serialization_alias="executedAt")
    sap_purchase_order: SapPurchaseOrderOut | None = Field(
        default=None, serialization_alias="sapPurchaseOrder"
    )
    # Eksklusi pemasok (revisi 9 Okt): hanya terisi untuk `decisionType == "supplier_exclusion"`,
    # supaya UI bisa menampilkan pemasok + alasannya tanpa membuka tabel lain.
    supplier_id: str | None = Field(default=None, serialization_alias="supplierId")
    supplier_name: str | None = Field(default=None, serialization_alias="supplierName")
    exclusion_reason: str | None = Field(default=None, serialization_alias="exclusionReason")
    agent_trace: list[AgentStepOut] = Field(default=[], serialization_alias="agentTrace")


# --- Turunan dari tabel domain --------------------------------------------------------------


@dataclass(frozen=True)
class PairSupply:
    """Kondisi satu pasangan (lokasi, komoditas) dari batch-nya."""

    physical_kg: Decimal
    usable_kg: Decimal
    batch_count: int
    safety_status: SafetyStatus
    freshness_status: FreshnessStatus
    has_temperature_excursion: bool

    @property
    def has_safety_fail(self) -> bool:
        return self.safety_status == "FAIL"

    @property
    def has_needs_verification(self) -> bool:
        return self.safety_status == "NEEDS_VERIFICATION"

    @property
    def has_freshness_risk(self) -> bool:
        return self.freshness_status != "fresh"


@dataclass(frozen=True)
class PriceLookup:
    """Harga per pasangan + acuan per komoditas (cadangan), lihat `_price_lookup`."""

    by_pair: dict[tuple[uuid.UUID, uuid.UUID], Decimal]
    by_commodity: dict[uuid.UUID, Decimal]

    def price_for(self, location_id: uuid.UUID, commodity_id: uuid.UUID) -> Decimal:
        return self.by_pair.get(
            (location_id, commodity_id), self.by_commodity.get(commodity_id, Decimal(0))
        )


def _worst_safety(statuses: list[str]) -> SafetyStatus:
    """Keparahan tertinggi: FAIL > NEEDS_VERIFICATION > PASS (mock UI memakai urutan ini)."""
    if "fail" in statuses:
        return "FAIL"
    if "needs_verification" in statuses:
        return "NEEDS_VERIFICATION"
    return "PASS"


def _freshness(earliest_usable_until: datetime | None, now: datetime) -> FreshnessStatus:
    """Kesegaran satu pasokan dari masa pakai TERPENDEK (cadangan saat skor belum ada).

    `usable_until` kosong = freshness belum dievaluasi (`/freshness/evaluate` belum jalan), jadi
    dilaporkan `fresh` — bukan `expired` yang akan menuduh data yang memang belum ada.
    """
    if earliest_usable_until is None:
        return "fresh"
    if earliest_usable_until <= now:
        return "expired"
    if earliest_usable_until <= now + FRESHNESS_WARNING_WINDOW:
        return "approaching_expiry"
    return "fresh"


def _freshness_status(
    bands: list[object], earliest_usable_until: datetime | None, now: datetime
) -> FreshnessStatus:
    """Status kesegaran satu pasokan: pita dokumen lebih dulu, masa simpan sebagai cadangan.

    `docs/Skill.md` §3 menetapkan pita `freshness_score` (0.85 / 0.60) sebagai acuan final, jadi
    pita TERBURUK dari batch pasangan itu yang dipakai (`core/freshness.py`). Kalau tidak satu batch
    pun punya skor — `/freshness/evaluate` belum jalan — baru jatuh ke hitungan masa simpan, supaya
    lokasi tidak ditandai bermasalah dari data yang memang belum ada.
    """
    mapped = status_for_ui(worst_band(bands))  # type: ignore[arg-type]
    if mapped is not None:
        return mapped
    return _freshness(earliest_usable_until, now)


def _supply_by_pair(session: Session, now: datetime) -> dict[tuple[uuid.UUID, uuid.UUID], PairSupply]:
    """Stok fisik/terpakai + status kesegaran/keamanan per (lokasi, komoditas), dari `batches`.

    Aturan yang dipegang di sini:
    - batch `safety_status='fail'` TIDAK menambah stok terpakai (Schema.md §6: batch gagal aman
      tidak boleh jadi kandidat alokasi), dan batch yang `usable_until`-nya sudah lewat juga tidak;
      menganggap keduanya tersedia akan membuat lokasi kekurangan tampak hijau;
    - batch yang `freshness_score`-nya DI BAWAH gerbang kesegaran (`core/freshness.py`,
      `docs/Skill.md` §3) juga tidak menambah stok terpakai — ambang di dokumen kini punya wujud di
      kode. Skor yang belum ada (NULL) TIDAK dihukum: itu data yang belum dievaluasi;
    - status kesegaran memakai pita dokumen (0.85 / 0.60) bila ada skornya; masa simpan hanya
      cadangan (`_freshness_status`);
    - stok FISIK tetap dihitung apa adanya (termasuk batch gagal) — itu yang dilihat petugas di rak;
    - tanda bahayanya tetap dihitung walau stoknya dibuang — justru itu yang membuat lokasi
      bermasalah terlihat di peta.
    """
    rows = session.execute(
        select(
            Batch.location_id,
            Batch.commodity_id,
            Batch.quantity_kg,
            Batch.safety_status,
            Batch.temperature_log,
            Batch.harvested_at,
            Batch.freshness_score,
        )
    ).all()

    # `batches.usable_until` dihapus dari skema (9 Okt); batas layak pakai diturunkan dari
    # waktu panen + masa layak komoditas (`core/shelf_life.py`).
    commodity_names = {
        row.id: row.name for row in session.scalars(select(Commodity)).all()
    }

    physical: dict[tuple[uuid.UUID, uuid.UUID], Decimal] = {}
    usable: dict[tuple[uuid.UUID, uuid.UUID], Decimal] = {}
    counts: dict[tuple[uuid.UUID, uuid.UUID], int] = {}
    statuses: dict[tuple[uuid.UUID, uuid.UUID], list[str]] = {}
    earliest: dict[tuple[uuid.UUID, uuid.UUID], datetime | None] = {}
    excursion: dict[tuple[uuid.UUID, uuid.UUID], bool] = {}
    bands: dict[tuple[uuid.UUID, uuid.UUID], list[object]] = {}

    for (
        location_id,
        commodity_id,
        quantity_kg,
        safety_status,
        temperature_log,
        harvested_at,
        freshness_score,
    ) in rows:
        key = (location_id, commodity_id)
        quantity = _decimal(quantity_kg)
        batch_usable_until = derive_usable_until(harvested_at, commodity_names.get(commodity_id))
        expired = batch_usable_until <= now

        physical[key] = physical.get(key, Decimal(0)) + quantity
        usable.setdefault(key, Decimal(0))
        counts[key] = counts.get(key, 0) + 1
        statuses.setdefault(key, []).append(safety_status)
        bands.setdefault(key, []).append(freshness_band(freshness_score))

        current_earliest = earliest.get(key)
        if current_earliest is None or batch_usable_until < current_earliest:
            earliest[key] = batch_usable_until
        if has_temperature_excursion(temperature_log):
            excursion[key] = True

        if safety_status != "fail" and not expired and is_eligible(freshness_score):
            usable[key] += quantity

    return {
        key: PairSupply(
            physical_kg=physical[key],
            usable_kg=usable[key],
            batch_count=counts[key],
            safety_status=_worst_safety(statuses[key]),
            freshness_status=_freshness_status(bands.get(key, []), earliest.get(key), now),
            has_temperature_excursion=excursion.get(key, False),
        )
        for key in physical
    }


def _supply_status(usable_kg: Decimal, demand_kg: Decimal) -> SupplyStatus:
    """Status pasokan satu baris: bandingkan stok terpakai dengan kebutuhan.

    Tidak ada baris kebutuhan untuk pasangan itu = tidak ada kekurangan, jadi `surplus` (bukan
    `deficit` yang akan menuduh tanpa dasar). Bandingannya memakai angka yang SAMA dengan
    `/ui/demand`, supaya stok dan kebutuhan tidak pernah bertentangan di layar.
    """
    if demand_kg > usable_kg:
        return "deficit"
    if usable_kg > demand_kg:
        return "surplus"
    return "balanced"


def _latest_demand(session: Session) -> dict[tuple[uuid.UUID, uuid.UUID], Decimal]:
    """Kebutuhan TERBARU per (lokasi, komoditas).

    Yang dipakai baris terbaru, bukan jumlah seluruh riwayat: `demand_records` bersifat
    time-series (Schema.md §2), jadi menjumlahkan baris lama akan menggelembungkan kebutuhan
    setiap kali seed atau forecast berjalan.
    """
    rows = (
        session.execute(
            select(DemandRecord).order_by(
                DemandRecord.recorded_at.desc(), DemandRecord.created_at.desc()
            )
        )
        .scalars()
        .all()
    )
    latest: dict[tuple[uuid.UUID, uuid.UUID], Decimal] = {}
    for row in rows:
        latest.setdefault((row.location_id, row.commodity_id), _decimal(row.quantity_kg))
    return latest


def _price_lookup(session: Session) -> PriceLookup:
    """Harga terbaru per (lokasi, komoditas) + acuan per komoditas sebagai cadangan.

    `price_signals` bersifat time-series (Schema.md §2), jadi yang dipakai sinyal TERBARU. Kalau satu
    pasangan belum punya sinyal harga sendiri, harga referensi komoditas yang sama dipakai supaya UI
    menampilkan acuan pasar — bukan 0 yang terbaca seperti "gratis".
    """
    rows = (
        session.execute(
            select(PriceSignal).order_by(
                PriceSignal.recorded_at.desc(), PriceSignal.created_at.desc()
            )
        )
        .scalars()
        .all()
    )
    by_pair: dict[tuple[uuid.UUID, uuid.UUID], Decimal] = {}
    by_commodity: dict[uuid.UUID, Decimal] = {}
    for row in rows:
        by_pair.setdefault((row.location_id, row.commodity_id), _decimal(row.price_per_kg))
        by_commodity.setdefault(row.commodity_id, _decimal(row.price_per_kg))
    return PriceLookup(by_pair=by_pair, by_commodity=by_commodity)


# --- Endpoint -------------------------------------------------------------------------------


@router.get("/locations", response_model=list[LocationOut])
def list_locations(session: SessionDep, _user: CurrentUser) -> list[LocationOut]:
    """Lokasi + statusnya, untuk peta dan daftar di UI."""
    now = _now()
    supplies = _supply_by_pair(session, now)
    demand = _latest_demand(session)

    conditions: dict[uuid.UUID, list[SupplyCondition]] = {}
    for (location_id, commodity_id), pair in supplies.items():
        demand_kg = demand.get((location_id, commodity_id), Decimal(0))
        conditions.setdefault(location_id, []).append(
            SupplyCondition(
                has_safety_fail=pair.has_safety_fail,
                has_temperature_excursion=pair.has_temperature_excursion,
                has_needs_verification=pair.has_needs_verification,
                has_deficit=demand_kg > pair.usable_kg,
                has_freshness_risk=pair.has_freshness_risk,
            )
        )

    rows = session.scalars(select(Location).order_by(Location.name)).all()
    return [
        LocationOut(
            id=str(row.id),
            name=row.name,
            region=row.region,
            latitude=float(row.latitude),
            longitude=float(row.longitude),
            role_hint=row.role_hint,
            status=location_status(conditions.get(row.id, [])),
        )
        for row in rows
    ]


@router.get("/commodities", response_model=list[CommodityOut])
def list_commodities(session: SessionDep, _user: CurrentUser) -> list[CommodityOut]:
    """Komoditas yang dipantau (Schema.md §1 `commodities`)."""
    rows = session.scalars(select(Commodity).order_by(Commodity.name)).all()
    return [CommodityOut(id=str(row.id), name=row.name, unit=row.unit) for row in rows]


@router.get("/supply", response_model=list[SupplyOut])
def list_supply(session: SessionDep, _user: CurrentUser) -> list[SupplyOut]:
    """Stok per (lokasi, komoditas) dalam bentuk UI: fisik, terpakai, batch, kesegaran, keamanan.

    Ini pengganti `/supply` domain untuk UI: `/supply` tetap menyajikan per-batch dalam istilah SAP
    (nama lokasi, kode batch) karena itu yang dipakai agent & test integrasi SAP.
    """
    now = _now()
    supplies = _supply_by_pair(session, now)
    demand = _latest_demand(session)
    prices = _price_lookup(session)

    out: list[SupplyOut] = []
    for (location_id, commodity_id), pair in sorted(
        supplies.items(), key=lambda item: (str(item[0][0]), str(item[0][1]))
    ):
        demand_kg = demand.get((location_id, commodity_id), Decimal(0))
        out.append(
            SupplyOut(
                location_id=str(location_id),
                commodity_id=str(commodity_id),
                physical_stock_kg=float(pair.physical_kg),
                usable_stock_kg=float(pair.usable_kg),
                batch_count=pair.batch_count,
                status=_supply_status(pair.usable_kg, demand_kg),
                price_per_kg=float(prices.price_for(location_id, commodity_id)),
                freshness_status=pair.freshness_status,
                safety_status=pair.safety_status,
                temperature_excursion=pair.has_temperature_excursion,
            )
        )
    return out


@router.get("/demand", response_model=list[DemandOut])
def list_demand(session: SessionDep, _user: CurrentUser) -> list[DemandOut]:
    """Kebutuhan per lokasi+komoditas, dengan selisih terhadap stok yang masih boleh dipakai."""
    supplies = _supply_by_pair(session, _now())

    out: list[DemandOut] = []
    for (location_id, commodity_id), projected in sorted(
        _latest_demand(session).items(), key=lambda item: (str(item[0][0]), str(item[0][1]))
    ):
        pair = supplies.get((location_id, commodity_id))
        stock = pair.usable_kg if pair is not None else Decimal(0)
        out.append(
            DemandOut(
                location_id=str(location_id),
                commodity_id=str(commodity_id),
                projected_kg=float(projected),
                deficit_kg=float(max(projected - stock, Decimal(0))),
                surplus_kg=float(max(stock - projected, Decimal(0))),
            )
        )
    return out


@router.get("/suppliers", response_model=list[SupplierOut])
def list_suppliers(session: SessionDep, _user: CurrentUser) -> list[SupplierOut]:
    """Pemasok + skor kepercayaan (`suppliers.reliability_score`, docs/Schema.md §1).

    Skor TIDAK lagi dihitung ulang dari riwayat pengiriman — mekanisme LEARN dihapus bersama
    `decisions.outcome` (revisi dokumen 9 Okt), jadi nilainya statis dari seed.
    """
    rows = session.scalars(select(Supplier).order_by(Supplier.name)).all()
    return [_supplier_out(row) for row in rows]


def _supplier_out(row: Supplier) -> SupplierOut:
    """Serialisasi satu pemasok — dipakai daftar DAN detail supaya bentuknya tak bisa berbeda."""
    return SupplierOut(
        id=str(row.id),
        name=row.name,
        location_id=str(row.location_id),
        reliability_score=float(row.reliability_score),
        status=row.status,
        excluded_at=row.excluded_at,
        exclusion_reason=row.exclusion_reason,
    )


def _supplier_or_404(session: Session, supplier_id: str) -> Supplier:
    """Pemasok dari id domain; id tak sah atau barisnya tidak ada = 404 biasa, bukan 500."""
    try:
        key = uuid.UUID(supplier_id)
    except ValueError:
        raise HTTPException(
            status_code=404, detail=f"Pemasok {supplier_id!r} tidak ditemukan."
        ) from None
    row = session.get(Supplier, key)
    if row is None:
        raise HTTPException(status_code=404, detail=f"Pemasok {supplier_id!r} tidak ditemukan.")
    return row


@router.get("/suppliers/{supplier_id}", response_model=SupplierDetailOut)
def get_supplier_detail(
    supplier_id: str, session: SessionDep, _user: CurrentUser
) -> SupplierDetailOut:
    """Detail satu pemasok: batch, kuotasi harga, purchase order, dan riwayat usulan eksklusi.

    Yang ditampilkan hanya baris yang memang tersimpan — tidak ada angka yang diarang di lapisan
    baca. Dua nilai turunan tetap jujur karena dihitung dari data, bukan ditebak: `usableUntil`
    (`harvested_at` + masa layak komoditas, `core/shelf_life.py`) dan `freshnessStatus` (pita
    dokumen, `core/freshness.py`) — dua-duanya sama dengan yang dipakai `/ui/supply`, jadi batch
    yang sama tidak bisa tampil beda kesegaran di dua halaman.

    Riwayat eksklusi sengaja memuat usulan yang DITOLAK juga: halaman ini tempat menilai pemasok,
    dan menyembunyikan usulan yang gagal akan membuat riwayatnya terlihat lebih bersih dari kenyataan.
    """
    supplier = _supplier_or_404(session, supplier_id)

    commodity_names = {str(row.id): row.name for row in session.scalars(select(Commodity)).all()}

    batch_rows = session.scalars(
        select(Batch)
        .where(Batch.supplier_id == supplier.id)
        .order_by(Batch.harvested_at.desc(), Batch.created_at.desc())
    ).all()
    price_rows = session.scalars(
        select(PriceSignal)
        .where(PriceSignal.supplier_id == supplier.id)
        .order_by(PriceSignal.recorded_at.desc())
    ).all()
    po_rows = session.scalars(
        select(SapMockPurchaseOrder)
        .where(SapMockPurchaseOrder.supplier_id == supplier.id)
        .order_by(SapMockPurchaseOrder.created_at.desc())
    ).all()
    exclusion_rows = session.scalars(
        select(Decision)
        .where(Decision.supplier_id == supplier.id)
        .where(Decision.decision_type == "supplier_exclusion")
        .order_by(Decision.created_at.desc())
    ).all()

    return SupplierDetailOut(
        supplier=_supplier_out(supplier),
        batches=[
            SupplierBatchOut(
                id=str(row.id),
                commodity_id=str(row.commodity_id),
                location_id=str(row.location_id),
                quantity_kg=float(row.quantity_kg),
                harvested_at=row.harvested_at,
                usable_until=derive_usable_until(
                    row.harvested_at, commodity_names.get(str(row.commodity_id))
                ),
                freshness_score=(
                    float(row.freshness_score) if row.freshness_score is not None else None
                ),
                freshness_status=status_for_ui(freshness_band(row.freshness_score)),
                safety_status=row.safety_status,
                certification_status=row.certification_status,
                temperature_readings=len(row.temperature_log or []),
                temperature_excursion=has_temperature_excursion(row.temperature_log or []),
            )
            for row in batch_rows
        ],
        price_signals=[
            SupplierPriceOut(
                commodity_id=str(row.commodity_id),
                price_per_kg=float(row.price_per_kg),
                source=row.source,
                recorded_at=row.recorded_at,
            )
            for row in price_rows
        ],
        purchase_orders=[
            SupplierPurchaseOrderOut(
                po_number=row.po_number,
                material_number=row.material_number,
                ordered_quantity_kg=float(row.ordered_quantity),
                price=float(row.price),
                status=row.status,
                decision_id=str(row.decision_id) if row.decision_id else None,
                created_at=row.created_at,
            )
            for row in po_rows
        ],
        exclusion_decisions=[
            SupplierExclusionDecisionOut(
                decision_id=str(row.id),
                status=row.status,
                reason=row.reason,
                created_at=row.created_at,
            )
            for row in exclusion_rows
        ],
    )


# --- Keputusan: bentuk `Recommendation` yang dibaca UI -----------------------------------------


def _json_summary(payload: object) -> str | None:
    """Ringkasan JSON singkat untuk langkah agen (kolomnya JSONB, UI menampilkan teks)."""
    if not isinstance(payload, dict) or not payload:
        return None
    text = json.dumps(payload, ensure_ascii=False, default=str)
    return text if len(text) <= 200 else f"{text[:197]}..."


def _number(item: dict, *keys: str) -> float:
    """Ambil angka pertama yang ada dari beberapa kemungkinan nama kunci (snake/camel)."""
    for key in keys:
        if item.get(key) is not None:
            return float(item[key])
    return 0.0


def _optional_number(item: dict, *keys: str) -> float | None:
    for key in keys:
        if item.get(key) is not None:
            return float(item[key])
    return None


def _cost_candidates(decision: Decision) -> list[CostCandidateOut]:
    """Kandidat Safe Delivered Cost dari `decisions.cost_breakdown` (JSONB, Schema.md §3).

    Kolom itu belum diisi penulisnya (agent `/cost/safe-delivered` belum ada), jadi hasilnya memang
    daftar kosong — bukan angka 0 yang dikarang supaya grafik terlihat hidup. Bentuk yang diterima:
    daftar dict, atau dict dengan kunci `candidates`/`breakdown`.
    """
    raw = decision.cost_breakdown
    if isinstance(raw, dict):
        raw = raw.get("candidates") or raw.get("breakdown") or []
    if not isinstance(raw, list):
        return []

    out: list[CostCandidateOut] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        out.append(
            CostCandidateOut(
                candidate_id=str(item.get("candidate_id") or item.get("candidateId") or ""),
                supplier_id=str(item.get("supplier_id") or item.get("supplierId") or ""),
                price_per_kg=_number(item, "price_per_kg", "pricePerKg"),
                transport_cost_per_kg=_number(
                    item, "transport_cost_per_kg", "transportCostPerKg"
                ),
                handling_cost_per_kg=_number(item, "handling_cost_per_kg", "handlingCostPerKg"),
                spoilage_risk_cost_per_kg=_number(
                    item, "spoilage_risk_cost_per_kg", "spoilageRiskCostPerKg"
                ),
                freshness_risk_cost_per_kg=_optional_number(
                    item, "freshness_risk_cost_per_kg", "freshnessRiskCostPerKg"
                ),
                safety_penalty_per_kg=_number(item, "safety_penalty_per_kg", "safetyPenaltyPerKg"),
                total_safe_delivered_cost_per_kg=_number(
                    item, "total_safe_delivered_cost_per_kg", "totalSafeDeliveredCostPerKg"
                ),
                distance_km=_number(item, "distance_km", "distanceKm"),
                eta_minutes=_number(item, "eta_minutes", "etaMinutes"),
                evidence_completeness=_number(
                    item, "evidence_completeness", "evidenceCompleteness"
                ),
            )
        )
    return out


def _evidence_source(kind: str, payload: dict) -> str:
    """Sumber bukti yang bisa ditelusuri (design.md §3.3), dibaca dari payload yang tersimpan."""
    if kind.startswith("sap_") and payload.get("purchase_order"):
        return f"SAP PO {payload['purchase_order']}"
    if kind == "temperature" and payload.get("celsius") is not None:
        return f"Sensor suhu {payload['celsius']} °C"
    if kind == "market_price":
        return "Referensi harga pasar"
    return EVIDENCE_LABELS.get(kind, kind)


def _inconsistency_description(item: DecisionEvidence) -> str:
    payload = item.payload if isinstance(item.payload, dict) else {}
    note = payload.get("note") or payload.get("detail")
    if note:
        return str(note)
    label = EVIDENCE_LABELS.get(item.evidence_type, item.evidence_type)
    return f"Bukti {label} ditandai tidak konsisten"


def _evidence_summary(items: list[DecisionEvidence]) -> EvidenceSummaryOut:
    """Ringkasan tiga kanal bukti yang diminta Skill.md §4 (SAP + IoT + fisik)."""
    kinds = {item.evidence_type for item in items}
    sap = bool(kinds & _SAP_EVIDENCE)
    iot = bool(kinds & _IOT_EVIDENCE)
    physical = "human_inspection" in kinds
    return EvidenceSummaryOut(
        sap=sap,
        iot=iot,
        physical=physical,
        completeness_percent=round(sum((sap, iot, physical)) / 3 * 100, 1),
        inconsistencies=[
            InconsistencyOut(description=_inconsistency_description(item))
            for item in items
            if item.is_consistent is False
        ],
    )


def _safety_check(session: Session, decision: Decision) -> SafetyStatus:
    """Keamanan pangan keputusan = batch komoditas itu di lokasi TUJUAN (kalau ada), lalu asal.

    `decisions` tidak punya kolom safety (Schema.md §3); hasil evaluasi tersimpan di
    `batches.safety_status`. Yang dilaporkan kondisi terburuk, karena satu batch gagal aman sudah
    cukup untuk menahan keputusan.
    """
    if decision.commodity_id is None:
        return "PASS"

    for location_id in (decision.target_location_id, decision.source_location_id):
        if location_id is None:
            continue
        statuses = list(
            session.scalars(
                select(Batch.safety_status).where(
                    Batch.location_id == location_id,
                    Batch.commodity_id == decision.commodity_id,
                )
            ).all()
        )
        if statuses:
            return _worst_safety(statuses)
    return "PASS"


def _purchase_order(session: Session, decision: Decision) -> SapPurchaseOrderOut | None:
    """PO SAP (mock) yang lahir dari keputusan ini (`sap_mock_purchase_orders.decision_id`)."""
    order = session.scalar(
        select(SapMockPurchaseOrder).where(SapMockPurchaseOrder.decision_id == decision.id)
    )
    if order is None:
        return None

    target = session.get(Location, decision.target_location_id) if decision.target_location_id else None
    plant = PLANT_CODE_BY_LOCATION.get(target.name if target else "", "")
    return SapPurchaseOrderOut(
        po_number=order.po_number,
        plant=plant,
        ordered_quantity_kg=float(order.ordered_quantity),
        status=order.status,
    )


def _supplier_name(session: Session, decision: Decision) -> str | None:
    """Nama pemasok yang diusulkan dikecualikan (`supplier_exclusion`), kalau keputusannya begitu."""
    if decision.decision_type != "supplier_exclusion" or decision.supplier_id is None:
        return None
    supplier = session.get(Supplier, decision.supplier_id)
    return supplier.name if supplier is not None else None


def _reason(
    session: Session,
    decision: Decision,
    demand: dict[tuple[uuid.UUID, uuid.UUID], Decimal],
    supplies: dict[tuple[uuid.UUID, uuid.UUID], PairSupply],
) -> str:
    """Kalimat alasan untuk kartu keputusan — DITURUNKAN dari angka, bukan kolom dokumen.

    `decisions` (Schema.md §3) tidak punya kolom alasan; yang disimpan adalah usulan agent dan
    catatan Verifier. Karena itu kalimatnya dibangun dari defisit/surplus pasangan yang
    bersangkutan, dan kalau tidak ada angkanya dipakai nama jenis keputusan apa adanya.
    """
    if decision.verifier_note:
        return decision.verifier_note

    # Usulan eksklusi pemasok tidak punya komoditas/kuantitas, jadi kalimatnya dari baris pemasok
    # itu sendiri — bukan dari defisit/surplus yang tidak relevan.
    if decision.decision_type == "supplier_exclusion":
        supplier = session.get(Supplier, decision.supplier_id) if decision.supplier_id else None
        name = supplier.name if supplier else "pemasok"
        if decision.reason:
            return f"Usulan eksklusi {name}: {decision.reason}"
        return f"Usulan eksklusi {name}"

    commodity_row = session.get(Commodity, decision.commodity_id) if decision.commodity_id else None
    commodity = commodity_row.name if commodity_row else "komoditas"
    target = session.get(Location, decision.target_location_id) if decision.target_location_id else None
    if target is not None and decision.commodity_id is not None:
        pair = supplies.get((target.id, decision.commodity_id))
        need = demand.get((target.id, decision.commodity_id), Decimal(0))
        shortage = need - (pair.usable_kg if pair else Decimal(0))
        if shortage > 0:
            return f"Defisit {shortage:.0f} kg {commodity} di {target.name}"

    source = session.get(Location, decision.source_location_id) if decision.source_location_id else None
    if source is not None and decision.commodity_id is not None:
        pair = supplies.get((source.id, decision.commodity_id))
        if pair is not None and pair.usable_kg > 0:
            return f"Surplus {pair.usable_kg:.0f} kg {commodity} di {source.name}"

    return {
        "regional_balance": "Ketidakseimbangan pasokan antar wilayah",
        "price_anomaly": "Harga di luar rentang acuan pasar",
        "safety_disruption": "Gangguan keamanan pangan terdeteksi",
    }.get(decision.decision_type, "Menunggu penilaian")


def build_recommendation(
    session: Session,
    decision: Decision,
    now: datetime,
    demand: dict[tuple[uuid.UUID, uuid.UUID], Decimal] | None = None,
    supplies: dict[tuple[uuid.UUID, uuid.UUID], PairSupply] | None = None,
) -> RecommendationOut:
    """Petakan satu baris `decisions` (+ jejak auditnya) ke bentuk `Recommendation` UI."""
    demand = _latest_demand(session) if demand is None else demand
    supplies = _supply_by_pair(session, now) if supplies is None else supplies

    approvals = session.execute(
        select(Approval).where(Approval.decision_id == decision.id).order_by(Approval.approved_at)
    ).scalars().all()
    traces = session.execute(
        select(AgentTrace).where(AgentTrace.decision_id == decision.id).order_by(AgentTrace.step_at)
    ).scalars().all()
    evidence = session.execute(
        select(DecisionEvidence)
        .where(DecisionEvidence.decision_id == decision.id)
        .order_by(DecisionEvidence.recorded_at)
    ).scalars().all()

    approved_at = max((row.approved_at for row in approvals if row.approved), default=None)
    # Waktu eksekusi diambil dari langkah ACT — kolomnya tidak ada, tapi langkahnya ada.
    act_step = next((row.step_at for row in reversed(traces) if row.step_name == "ACT"), None)
    executed_at = act_step if decision.status == "executed" else None

    return RecommendationOut(
        id=str(decision.id),
        status=decision.status,
        decision_type=cast(DecisionType, decision.decision_type),
        source_location_id=str(decision.source_location_id or ""),
        target_location_id=str(decision.target_location_id or ""),
        commodity_id=str(decision.commodity_id or ""),
        quantity_kg=float(decision.quantity_kg or 0),
        safe_delivered_cost_breakdown=_cost_candidates(decision),
        evidence=_evidence_summary(list(evidence)),
        evidence_items=[
            EvidenceItemOut(
                id=str(item.id),
                type=item.evidence_type,  # type: ignore[arg-type]
                source=_evidence_source(
                    item.evidence_type, item.payload if isinstance(item.payload, dict) else {}
                ),
                summary=_json_summary(item.payload),
                recorded_at=item.recorded_at,
                is_consistent=item.is_consistent,
            )
            for item in evidence
        ],
        verifier_note=decision.verifier_note,
        verified_by=decision.verified_by,
        safety_check=_safety_check(session, decision),
        reason=_reason(session, decision, demand, supplies),
        created_at=decision.created_at,
        approved_at=approved_at,
        expires_at=decision.expires_at,
        executed_at=executed_at,
        sap_purchase_order=_purchase_order(session, decision),
        supplier_id=str(decision.supplier_id) if decision.supplier_id else None,
        supplier_name=_supplier_name(session, decision),
        exclusion_reason=decision.reason if decision.decision_type == "supplier_exclusion" else None,
        agent_trace=[
            AgentStepOut(
                step=row.step_name,
                tool=row.tool_called,
                timestamp=row.step_at,
                input_summary=_json_summary(row.input_summary),
                output_summary=_json_summary(row.output_summary),
                duration_ms=row.duration_ms,
                step_at=row.step_at,
            )
            for row in traces
        ],
    )


@router.get("/decisions", response_model=list[RecommendationOut])
def list_decisions(
    session: SessionDep,
    _user: CurrentUser,
    limit: int = 50,
) -> list[RecommendationOut]:
    """Daftar keputusan dalam bentuk yang dibaca UI (terbaru dulu)."""
    now = _now()
    demand = _latest_demand(session)
    supplies = _supply_by_pair(session, now)
    rows = session.scalars(
        select(Decision).order_by(Decision.created_at.desc()).limit(limit)
    ).all()
    return [build_recommendation(session, row, now, demand, supplies) for row in rows]


@router.get("/decisions/{decision_id}", response_model=RecommendationOut)
def get_decision(session: SessionDep, _user: CurrentUser, decision_id: str) -> RecommendationOut:
    """Satu keputusan lengkap dengan bukti, approval, dan jejak agennya."""
    try:
        parsed = uuid.UUID(decision_id)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"id keputusan bukan UUID: {decision_id!r}") from None

    decision = session.get(Decision, parsed)
    if decision is None:
        raise HTTPException(status_code=404, detail=f"Keputusan tidak ditemukan: {decision_id}")
    return build_recommendation(session, decision, _now())


# --- KPI (Skill.md §4) -------------------------------------------------------------------------


def _evidence_channel(kind: str) -> str:
    """Kanal bukti untuk hitungan kelengkapan: SAP, IoT, atau fisik."""
    if kind in _SAP_EVIDENCE:
        return "sap"
    if kind in _IOT_EVIDENCE:
        return "iot"
    if kind == "human_inspection":
        return "physical"
    return kind


@router.get("/kpi", response_model=KpiSnapshotOut, response_model_exclude_none=True)
def get_kpi(session: SessionDep, _user: CurrentUser) -> KpiSnapshotOut:
    """KPI dari tabel operasional + alasan KPI yang tidak bisa dihitung (Skill.md §4).

    Dihitung saat dibaca dari keputusan, bukti, jejak agen, dan sinyal harga. Belum ditulis ke
    `kpi_snapshots` (job KPI belum ada), jadi tidak ada pembanding periode sebelumnya — itu sebabnya
    `previous` tidak dikirim dan UI menampilkan "tanpa histori", bukan trend karangan.
    """
    decisions = list(session.scalars(select(Decision)))
    traces = list(session.scalars(select(AgentTrace)))
    evidence = list(session.scalars(select(DecisionEvidence)))
    prices = list(session.scalars(select(PriceSignal)))

    channels: dict[uuid.UUID, set[str]] = {}
    for item in evidence:
        channels.setdefault(item.decision_id, set()).add(_evidence_channel(item.evidence_type))
    decide_duration: dict[uuid.UUID, int] = {
        trace.decision_id: trace.duration_ms
        for trace in traces
        if trace.step_name == "DECIDE" and trace.duration_ms is not None
    }

    facts = [
        DecisionFact(
            decision_type=decision.decision_type,
            status=decision.status,
            safe_delivered_cost=(
                _decimal(decision.safe_delivered_cost)
                if decision.safe_delivered_cost is not None
                else None
            ),
            evidence_channels=len(channels.get(decision.id, ())),
            decide_duration_ms=decide_duration.get(decision.id),
        )
        for decision in decisions
    ]
    price_facts = [
        PriceFact(
            commodity_id=row.commodity_id,
            price_per_kg=_decimal(row.price_per_kg),
            source=row.source,
        )
        for row in prices
    ]

    values, unavailable = compute_kpi(facts, price_facts)
    return KpiSnapshotOut(**values, unavailable=unavailable)


# --- Aksi dari UI: kontrak tulis versi UI ------------------------------------------------------
#
# Kenapa ada jalur tulis terpisah: UI mengirim camelCase dan tanpa pemilih pemasok (`{decisionId}`
# saja), sedangkan `/actions/*` domain memakai snake_case dan menuntut `supplier` +
# `net_price_amount`. Endpoint di bawah meneruskan ke fungsi domain yang SAMA (aturan approval dan
# aturan penerimaan tidak diduplikasi), jadi `openapi.json` domain tetap utuh untuk AgentCore
# Gateway dan tidak ada dua sumber aturan.


class UiDecisionRequest(BaseModel):
    """Body minimal UI: hanya id keputusan (dipakai approve/execute)."""

    model_config = ConfigDict(populate_by_name=True)

    decision_id: str = Field(alias="decisionId")


class UiRejectRequest(UiDecisionRequest):
    """Penolakan = satu suara `approved=False` + alasan sebagai komentar audit."""

    reason: str | None = None


class UiExclusionRequest(BaseModel):
    """Body UI untuk MENGUSULKAN eksklusi pemasok (halaman `/suppliers`)."""

    model_config = ConfigDict(populate_by_name=True)

    supplier_id: str = Field(alias="supplierId")
    reason: str = Field(description="alasan eksklusi; wajib, diperiksa core/supplier_exclusion.py")
    note: str | None = Field(default=None, description="catatan tambahan untuk approver")


def _execute_defaults(session: Session, decision: Decision) -> tuple[str, Decimal]:
    """Pemasok + harga total PO untuk jalur UI — keduanya diambil dari data nyata.

    UI tidak punya pemilih pemasok di kartu eksekusi (mock memang tidak pernah memilih), jadi
    jalur ini memakai aturan yang jelas dan bisa diperiksa:

    * pemasok = skor kepercayaan TERTINGGI di lokasi asal keputusan; kalau tidak ada pemasok di
      sana, tertinggi keseluruhan. Pemasok yang SUDAH dikecualikan (`suppliers.status='excluded'`)
      tidak pernah dipilih — aturan eksklusi hanya bermakna kalau pemilihannya menghormatinya
      (`app/core/supplier_exclusion.py`, `Rules.md` §1.2);
    * harga total = harga terbaru komoditas itu di lokasi asal x kuantitas keputusan; kalau belum
      ada sinyal harga, pakai `safe_delivered_cost` keputusan apa adanya.

    Ini bukan pemilihan ala agen (Safe Delivered Cost per kandidat, S3-03) — itu belum ada, dan
    angka contoh tidak boleh dikarang. Yang dipakai di sini semuanya baris yang memang tersimpan.
    """
    supplier = session.scalar(
        select(Supplier)
        .where(Supplier.location_id == decision.source_location_id)
        .where(Supplier.status == "active")
        .order_by(Supplier.reliability_score.desc(), Supplier.name)
    )
    if supplier is None:
        supplier = session.scalar(
            select(Supplier)
            .where(Supplier.status == "active")
            .order_by(Supplier.reliability_score.desc(), Supplier.name)
        )
    if supplier is None:
        raise HTTPException(
            status_code=409,
            detail=(
                "Tidak ada pemasok aktif di basis data, jadi PO tidak bisa dibuat. "
                "Pemasok yang dikecualikan sengaja tidak dipakai."
            ),
        )

    price = session.scalar(
        select(PriceSignal.price_per_kg)
        .where(PriceSignal.location_id == decision.source_location_id)
        .where(PriceSignal.commodity_id == decision.commodity_id)
        .order_by(PriceSignal.recorded_at.desc())
    )
    quantity = _decimal(decision.quantity_kg or 0)
    if price is not None and quantity > 0:
        total = (_decimal(price) * quantity).quantize(Decimal("0.01"))
    elif decision.safe_delivered_cost is not None:
        total = _decimal(decision.safe_delivered_cost)
    else:
        raise HTTPException(
            status_code=409,
            detail=(
                "Harga pasokan dan safe delivered cost keputusan ini belum ada, "
                "jadi nilai PO tidak bisa ditentukan."
            ),
        )

    if total <= 0:
        raise HTTPException(status_code=409, detail=f"Nilai PO tidak masuk akal: {total}.")
    return str(supplier.id), total


@router.post("/actions/approve", response_model=RecommendationOut)
def ui_approve(
    payload: UiDecisionRequest, session: SessionDep, user: CurrentUser
) -> RecommendationOut:
    """Setujui keputusan dari UI; aturan approval tetap milik `core/approval_rules.py`."""
    approve(ApproveRequest(decision_id=payload.decision_id, approved=True), session, user)
    return build_recommendation(
        session, get_decision_or_404(session, payload.decision_id), _now()
    )


@router.post("/actions/reject", response_model=RecommendationOut)
def ui_reject(
    payload: UiRejectRequest, session: SessionDep, user: CurrentUser
) -> RecommendationOut:
    """Tolak keputusan dari UI — satu suara `approved=False`, alasan disimpan sebagai komentar."""
    approve(
        ApproveRequest(
            decision_id=payload.decision_id, approved=False, comment=payload.reason
        ),
        session,
        user,
    )
    return build_recommendation(
        session, get_decision_or_404(session, payload.decision_id), _now()
    )


@router.post("/actions/propose-exclusion", response_model=RecommendationOut, status_code=201)
def ui_propose_exclusion(
    payload: UiExclusionRequest, session: SessionDep, user: CurrentUser
) -> RecommendationOut:
    """Ajukan eksklusi pemasok dari UI (halaman `/suppliers`) — hanya MENCATAT usulan.

    Belum ada penulisan ke `suppliers` di sini: eksklusi baru berlaku setelah approver SPPG pemasok
    itu menyetujui (`/ui/actions/approve`) dan keputusannya dieksekusi (`/ui/actions/exclude`) —
    `Rules.md` §1.2. Endpoint ini hanya meneruskan ke `POST /actions/propose` domain, jadi aturan
    alasan & status tetap satu tempat.
    """
    response = propose(
        ProposeRequest(
            decision_type="supplier_exclusion",
            supplier=payload.supplier_id,
            reason=payload.reason,
            proposed_by=user.email,
            verifier_note=payload.note,
        ),
        session,
        user,
    )
    return build_recommendation(session, get_decision_or_404(session, str(response.decision.id)), _now())


@router.post("/actions/exclude", response_model=RecommendationOut)
def ui_exclude(
    payload: UiDecisionRequest, session: SessionDep, user: CurrentUser
) -> RecommendationOut:
    """Eksekusi eksklusi yang SUDAH disetujui (menulis `suppliers.status='excluded'`).

    Meneruskan ke `POST /actions/exclude` domain — penjaga "tidak ada auto-execute" ada di sana,
    bukan diduplikasi di sini.
    """
    exclude_supplier(ExcludeRequest(decision_id=payload.decision_id), session, user)
    return build_recommendation(
        session, get_decision_or_404(session, payload.decision_id), _now()
    )


@router.post("/actions/execute", response_model=RecommendationOut)
def ui_execute(
    payload: UiDecisionRequest,
    session: SessionDep,
    user: CurrentUser,
    provider: Annotated[SAPDataProvider, Depends(get_provider)],
) -> RecommendationOut:
    """Eksekusi keputusan dari UI; pemasok & nilai PO diambil `_execute_defaults`."""
    decision = get_decision_or_404(session, payload.decision_id)
    supplier, net_price = _execute_defaults(session, decision)
    execute(
        ExecuteRequest(
            decision_id=payload.decision_id, supplier=supplier, net_price_amount=net_price
        ),
        session,
        user,
        provider,
    )
    return build_recommendation(
        session, get_decision_or_404(session, payload.decision_id), _now()
    )
