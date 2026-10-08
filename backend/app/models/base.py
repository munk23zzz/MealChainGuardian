"""Base & tipe bersama untuk model SQLAlchemy — cermin `docs/Schema.md`.

Aturan Schema.md: semua tabel memakai `id UUID DEFAULT gen_random_uuid()` sebagai PK dan punya
`created_at TIMESTAMPTZ DEFAULT now()`, kecuali disebutkan lain. Tipe-tipe di bawah menjaga aturan
itu tetap terlihat di setiap model, bukan disalin ulang 15 kali.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated

from sqlalchemy import DateTime, Numeric, func, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, mapped_column

UuidPk = Annotated[
    uuid.UUID,
    mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    ),
]

CreatedAt = Annotated[
    datetime, mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
]

Quantity = Annotated[Decimal, mapped_column(Numeric(10, 2))]


class Base(DeclarativeBase):
    """Base deklaratif bersama."""
