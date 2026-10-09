"""eksklusi pemasok: kolom status/excluded_at/reason + tipe supplier_exclusion

Ditambahkan mengikuti keputusan proyek 9 Okt untuk menunaikan `Rules.md` §1.2 ("mengeksklusi
supplier WAJIB lewat tabel `approvals` dengan `approved = true` dulu"):

* `suppliers.status` + `excluded_at` + `exclusion_reason` — wujud nyata "dikecualikan", dengan
  CHECK `status IN ('active','excluded')` dan `status <> 'excluded' OR excluded_at IS NOT NULL`
  supaya eksklusi tanpa waktu (yang tidak bisa diaudit) tidak mungkin tersimpan.
* `decisions.supplier_id` + `decisions.reason` — usulan eksklusi memakai tabel keputusan & approval
  yang sudah ada, bukan tombol langsung. CHECK memastikan tipe `supplier_exclusion` selalu menunjuk
  pemasok.

Tidak ada backfill: `suppliers.status` diberi default `active` (semua pemasok lama tetap aktif),
kolom baru lainnya NULL.

Revision ID: 5709e8c40911
Revises: 933ab94943ea
Create Date: 2026-10-09

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "5709e8c40911"
down_revision: Union[str, Sequence[str], None] = "933ab94943ea"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # --- suppliers: wujud nyata "dikecualikan" -------------------------------------------
    op.add_column(
        "suppliers",
        sa.Column("status", sa.Text(), nullable=False, server_default="active"),
    )
    op.add_column("suppliers", sa.Column("excluded_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("suppliers", sa.Column("exclusion_reason", sa.Text(), nullable=True))
    op.create_check_constraint(
        "suppliers_status_check", "suppliers", "status IN ('active','excluded')"
    )
    op.create_check_constraint(
        "suppliers_excluded_at_check",
        "suppliers",
        "status <> 'excluded' OR excluded_at IS NOT NULL",
    )

    # --- decisions: usulan eksklusi memakai jalur keputusan/approval yang sudah ada -------
    op.add_column(
        "decisions",
        sa.Column("supplier_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column("decisions", sa.Column("reason", sa.Text(), nullable=True))
    op.create_foreign_key(
        "decisions_supplier_id_fkey", "decisions", "suppliers", ["supplier_id"], ["id"]
    )
    op.create_check_constraint(
        "decisions_exclusion_supplier_check",
        "decisions",
        "decision_type <> 'supplier_exclusion' OR supplier_id IS NOT NULL",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("decisions_exclusion_supplier_check", "decisions", type_="check")
    op.drop_constraint("decisions_supplier_id_fkey", "decisions", type_="foreignkey")
    op.drop_column("decisions", "reason")
    op.drop_column("decisions", "supplier_id")

    op.drop_constraint("suppliers_excluded_at_check", "suppliers", type_="check")
    op.drop_constraint("suppliers_status_check", "suppliers", type_="check")
    op.drop_column("suppliers", "exclusion_reason")
    op.drop_column("suppliers", "excluded_at")
    op.drop_column("suppliers", "status")
