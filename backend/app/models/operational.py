"""Data operasional — `docs/Schema.md` §2."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Numeric, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedAt, UuidPk

SAFETY_STATUSES = ("pending", "pass", "fail", "needs_verification")
CERTIFICATION_STATUSES = ("none", "hygiene", "haccp")
SUPPLY_SOURCES = ("mock_sap", "manual", "sensor")
PRICE_SOURCES = ("pihps_reference", "supplier_quote")


class SupplyRecord(Base):
    __tablename__ = "supply_records"
    __table_args__ = (
        CheckConstraint("quantity_kg >= 0", name="supply_records_quantity_check"),
        Index("idx_supply_location_commodity", "location_id", "commodity_id"),
    )

    id: Mapped[UuidPk]
    location_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("locations.id"), nullable=False
    )
    commodity_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("commodities.id"), nullable=False
    )
    quantity_kg: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[CreatedAt]


class DemandRecord(Base):
    __tablename__ = "demand_records"
    __table_args__ = (
        CheckConstraint("quantity_kg >= 0", name="demand_records_quantity_check"),
        Index("idx_demand_location_commodity", "location_id", "commodity_id"),
    )

    id: Mapped[UuidPk]
    location_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("locations.id"), nullable=False
    )
    commodity_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("commodities.id"), nullable=False
    )
    quantity_kg: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    needed_by: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[CreatedAt]


class PriceSignal(Base):
    __tablename__ = "price_signals"
    __table_args__ = (
        CheckConstraint("price_per_kg > 0", name="price_signals_price_check"),
        CheckConstraint(
            "source IN ('pihps_reference', 'supplier_quote')", name="price_signals_source_check"
        ),
        # docs/Schema.md §2 (revisi kedua Roy 2026-10-03): identitas pemasok WAJIB ada saat
        # kuotasi pemasok, dan WAJIB kosong saat barisnya harga acuan pasar (PIHPS).
        CheckConstraint(
            "(source = 'supplier_quote' AND supplier_id IS NOT NULL) "
            "OR (source = 'pihps_reference' AND supplier_id IS NULL)",
            name="price_signals_supplier_check",
        ),
    )

    id: Mapped[UuidPk]
    location_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("locations.id"), nullable=False
    )
    commodity_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("commodities.id"), nullable=False
    )
    price_per_kg: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    # docs/Schema.md §2 (revisi kedua Roy, 2026-10-03): identitas pemasok disimpan di kolom
    # sendiri, BUKAN dienkode ke string `source`. WAJIB terisi saat `source='supplier_quote'`,
    # WAJIB NULL saat `source='pihps_reference'`.
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("suppliers.id"), nullable=True
    )
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[CreatedAt]


class Batch(Base):
    """Unit inti untuk freshness/safety check."""

    __tablename__ = "batches"
    __table_args__ = (
        CheckConstraint(
            "freshness_score IS NULL OR (freshness_score >= 0 AND freshness_score <= 1)",
            name="batches_freshness_check",
        ),
        CheckConstraint(
            "safety_status IN ('pending','pass','fail','needs_verification')",
            name="batches_safety_status_check",
        ),
        Index("idx_batches_safety_status", "safety_status"),
    )

    id: Mapped[UuidPk]
    commodity_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("commodities.id"), nullable=False
    )
    location_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("locations.id"), nullable=False
    )
    supplier_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("suppliers.id"), nullable=False
    )
    quantity_kg: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    harvested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    temperature_log: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    certification_status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="none"
    )
    freshness_score: Mapped[Decimal | None] = mapped_column(Numeric(3, 2), nullable=True)
    safety_status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    # docs/Schema.md §2 (revisi 9 Okt): kolom `usable_until` DIHAPUS. Nilainya diturunkan saat
    # dibutuhkan (`harvested_at` + masa layak komoditas) dan tetap muncul di respons
    # `/freshness/evaluate` (docs/Skill.md §5) tanpa perlu disimpan.
    created_at: Mapped[CreatedAt]
