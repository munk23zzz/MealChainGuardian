"""Master data — `docs/Schema.md` §1."""

from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import CheckConstraint, ForeignKey, Numeric, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedAt, UuidPk

USER_ROLES = ("sppg_head", "sppg_nutritionist", "bgn_monitor")


class Location(Base):
    __tablename__ = "locations"

    id: Mapped[UuidPk]
    name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    region: Mapped[str] = mapped_column(Text, nullable=False)
    latitude: Mapped[Decimal] = mapped_column(Numeric(9, 6), nullable=False)
    longitude: Mapped[Decimal] = mapped_column(Numeric(9, 6), nullable=False)
    role_hint: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[CreatedAt]


class Commodity(Base):
    __tablename__ = "commodities"

    id: Mapped[UuidPk]
    name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    unit: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[CreatedAt]


class User(Base):
    """Akun demo. `location_id` NULL = akses semua lokasi (khusus bgn_monitor)."""

    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "role IN ('sppg_head','sppg_nutritionist','bgn_monitor')", name="users_role_check"
        ),
    )

    id: Mapped[UuidPk]
    name: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("locations.id"), nullable=True
    )
    created_at: Mapped[CreatedAt]


class Supplier(Base):
    __tablename__ = "suppliers"
    __table_args__ = (
        CheckConstraint(
            "reliability_score >= 0 AND reliability_score <= 1", name="suppliers_reliability_check"
        ),
    )

    id: Mapped[UuidPk]
    name: Mapped[str] = mapped_column(Text, nullable=False)
    location_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("locations.id"), nullable=False
    )
    reliability_score: Mapped[Decimal] = mapped_column(
        Numeric(3, 2), nullable=False, server_default="0.80"
    )
    created_at: Mapped[CreatedAt]
