"""Tabel mock SAP — `docs/Schema.md` §4.

Meniru struktur OData asli, supaya pemetaan field (`docs/Skill.md` §7) bisa diuji nyata di database,
bukan hanya di objek Python.

Catatan: Schema.md §4 tidak menuliskan kolom constraint, jadi kolom-kolom di sini saya buat NOT NULL
(kecuali `decision_id` yang memang nullable) karena baris tanpa nilainya tidak berarti apa-apa.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import CheckConstraint, ForeignKey, Numeric, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedAt, UuidPk

PO_STATUSES = ("draft", "submitted", "confirmed")


class SapMockMaterialStock(Base):
    """≈ API_MATERIAL_STOCK."""

    __tablename__ = "sap_mock_material_stock"

    id: Mapped[UuidPk]
    material_number: Mapped[str] = mapped_column(Text, nullable=False)
    plant: Mapped[str] = mapped_column(Text, nullable=False)
    storage_location: Mapped[str] = mapped_column(Text, nullable=False)
    batch: Mapped[str] = mapped_column(Text, nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    unit: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[CreatedAt]


class SapMockPurchaseOrder(Base):
    """≈ API_PURCHASEORDER_PROCESS_SRV.

    `decision_id` = tautan balik ke keputusan pemicu (bookkeeping internal kita, bukan field SAP).
    """

    __tablename__ = "sap_mock_purchase_orders"
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft','submitted','confirmed')", name="sap_mock_po_status_check"
        ),
    )

    id: Mapped[UuidPk]
    po_number: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    supplier_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("suppliers.id"), nullable=False
    )
    material_number: Mapped[str] = mapped_column(Text, nullable=False)
    ordered_quantity: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    decision_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("decisions.id"), nullable=True
    )
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="submitted")
    created_at: Mapped[CreatedAt]
