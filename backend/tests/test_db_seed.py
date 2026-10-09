"""Seed akun demo: email boleh berubah, tetapi BARISNYA tidak boleh hilang.

Mengganti email akun demo harus berupa UPDATE: `approvals.approved_by` (dan riwayat lain) menunjuk
`users.id`, jadi hapus-lalu-buat-ulang akan melanggar FK — atau, kalau dipaksa, membuang riwayat
approval. Dua sisi (UI dan seed) juga harus memakai email yang sama supaya tombol quick-login tidak
gagal diam-diam saat `NEXT_PUBLIC_USE_MOCK=false`.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select

from app.db_seed import DEMO_USERS, RENAMED_DEMO_EMAILS, seed_demo_data
from app.models import Approval, Decision, User


def test_renamed_emails_are_not_seeded_anymore():
    seeded = {spec["email"] for spec in DEMO_USERS}

    assert not seeded & set(RENAMED_DEMO_EMAILS), "email lama tidak boleh ikut di-seed"
    assert set(RENAMED_DEMO_EMAILS.values()) <= seeded, "tujuan rename harus ada di DEMO_USERS"


def test_stale_demo_row_is_renamed_without_losing_its_history(db_factory, monkeypatch):
    """Baris akun lama dipindah ke email baru; id-nya (dan approval yang menunjuknya) tetap."""
    old_email = "kepala.lama@demo.local"
    new_email = "kepala.baru@demo.local"
    monkeypatch.setitem(RENAMED_DEMO_EMAILS, old_email, new_email)

    with db_factory() as session:
        stale = User(name="Kepala SPPG Lama", email=old_email, password_hash="bukan-hash", role="sppg_head")
        session.add(stale)
        # Keputusan dibuat di sini, bukan diasumsikan ada: `reset_dynamic_tables` (fixture) memang
        # mengosongkan `decisions`, jadi seed tidak menjamin barisnya ada saat test ini jalan.
        decision = Decision(decision_type="regional_balance", status="pending_approval")
        session.add(decision)
        session.flush()
        session.add(
            Approval(
                decision_id=decision.id,
                approved_by=stale.id,
                approver_role="sppg_head",
                approved=True,
                approved_at=datetime.now(timezone.utc),
            )
        )
        session.flush()
        stale_id = stale.id
        session.commit()

    with db_factory() as session:
        seed_demo_data(session)
        session.commit()

    with db_factory() as session:
        renamed = session.scalar(select(User).where(User.email == new_email))
        assert renamed is not None, "email baru belum ada setelah seed"
        assert renamed.id == stale_id, "harus baris yang sama, bukan akun baru"
        assert session.scalar(select(User).where(User.email == old_email)) is None
        approved_by = session.scalar(select(Approval.approved_by).where(Approval.approved_by == stale_id))
        assert approved_by == stale_id, "riwayat approval harus tetap menunjuk akun itu"


def test_seed_can_run_twice_without_duplicating_accounts(db_factory):
    with db_factory() as session:
        seed_demo_data(session)
        session.commit()

    with db_factory() as session:
        seed_demo_data(session)
        session.commit()

    with db_factory() as session:
        for spec in DEMO_USERS:
            count = len(session.scalars(select(User.id).where(User.email == spec["email"])).all())
            assert count == 1, f"{spec['email']} muncul {count} kali"
