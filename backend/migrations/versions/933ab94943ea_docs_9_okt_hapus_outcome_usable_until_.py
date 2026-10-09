"""docs 9 Okt: hapus outcome/usable_until/approver_role, expires_at NOT NULL, price_signals.supplier_id

Revision ID: 933ab94943ea
Revises: feb7e554fd31
Create Date: 2026-10-09 21:03:39.797472

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '933ab94943ea'
down_revision: Union[str, Sequence[str], None] = 'feb7e554fd31'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD_STATUS_CHECK = (
    "status IN ('proposed','verifier_flagged','verifier_unavailable','pending_approval',"
    "'approved','rejected','executed','expired')"
)
NEW_STATUS_CHECK = (
    "status IN ('proposed','verifier_flagged','pending_approval',"
    "'approved','rejected','executed')"
)


def upgrade() -> None:
    """Upgrade schema."""
    # 1. decisions: buang status yang tidak dipakai lagi, isi expires_at yang kosong, lalu NOT NULL.
    op.execute(
        "UPDATE decisions SET expires_at = created_at + INTERVAL '48 hours' "
        "WHERE expires_at IS NULL"
    )
    op.alter_column(
        "decisions", "expires_at", existing_type=sa.DateTime(timezone=True), nullable=False
    )
    op.drop_constraint("decisions_status_check", "decisions", type_="check")
    op.create_check_constraint("decisions_status_check", "decisions", NEW_STATUS_CHECK)
    op.drop_constraint("decisions_outcome_check", "decisions", type_="check")
    op.drop_column("decisions", "outcome")

    # 2. approvals: snapshot peran + unique index dilepas (aturan "satu orang sekali" ada di domain).
    op.drop_index("uq_approvals_decision_user", table_name="approvals")
    op.drop_constraint("approvals_role_check", "approvals", type_="check")
    op.drop_column("approvals", "approver_role")

    # 3. batches: batas layak pakai diturunkan, bukan disimpan.
    op.drop_column("batches", "usable_until")

    # 4. price_signals: identitas pemasok di kolom sendiri + invariannya ditegakkan database.
    op.add_column("price_signals", sa.Column("supplier_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "price_signals_supplier_id_fkey", "price_signals", "suppliers", ["supplier_id"], ["id"]
    )
    op.execute(
        "UPDATE price_signals ps SET supplier_id = ("
        "SELECT s.id FROM suppliers s WHERE s.location_id = ps.location_id ORDER BY s.name LIMIT 1"
        ") WHERE ps.source = 'supplier_quote' AND ps.supplier_id IS NULL"
    )
    # Baris kuotasi di lokasi yang belum punya pemasok tidak bisa memenuhi invarian baru: turunkan
    # saja jadi harga acuan pasar (PIHPS) daripada gagal migrasi atau menaruh pemasok sembarangan.
    op.execute(
        "UPDATE price_signals SET source = 'pihps_reference' "
        "WHERE source = 'supplier_quote' AND supplier_id IS NULL"
    )
    op.create_check_constraint(
        "price_signals_source_check",
        "price_signals",
        "source IN ('pihps_reference', 'supplier_quote')",
    )
    op.create_check_constraint(
        "price_signals_supplier_check",
        "price_signals",
        "(source = 'supplier_quote' AND supplier_id IS NOT NULL) "
        "OR (source = 'pihps_reference' AND supplier_id IS NULL)",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        "price_signals_supplier_check", "price_signals", type_="check"
    )
    op.drop_constraint("price_signals_source_check", "price_signals", type_="check")
    op.drop_constraint("price_signals_supplier_id_fkey", "price_signals", type_="foreignkey")
    op.drop_column("price_signals", "supplier_id")

    op.add_column("batches", sa.Column("usable_until", sa.DateTime(timezone=True), nullable=True))
    op.execute(
        "UPDATE batches SET usable_until = harvested_at + INTERVAL '72 hours' "
        "WHERE usable_until IS NULL"
    )

    op.add_column("approvals", sa.Column("approver_role", sa.Text(), nullable=True))
    op.execute(
        "UPDATE approvals SET approver_role = COALESCE("
        "(SELECT role FROM users WHERE users.id = approvals.approved_by), 'sppg_head')"
    )
    op.alter_column("approvals", "approver_role", existing_type=sa.Text(), nullable=False)
    op.create_check_constraint(
        "approvals_role_check", "approvals", "approver_role IN ('sppg_head','sppg_nutritionist')"
    )
    op.create_index(
        "uq_approvals_decision_user", "approvals", ["decision_id", "approved_by"], unique=True
    )

    op.add_column("decisions", sa.Column("outcome", sa.Text(), nullable=True))
    op.create_check_constraint(
        "decisions_outcome_check",
        "decisions",
        "outcome IS NULL OR outcome IN ('pending','success','failure')",
    )
    op.drop_constraint("decisions_status_check", "decisions", type_="check")
    op.create_check_constraint("decisions_status_check", "decisions", OLD_STATUS_CHECK)
    op.alter_column(
        "decisions", "expires_at", existing_type=sa.DateTime(timezone=True), nullable=True
    )
