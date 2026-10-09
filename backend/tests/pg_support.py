"""Utilitas Postgres untuk test.

Test yang butuh Postgres di-SKIP (bukan gagal) kalau database tidak bisa dihubungi, supaya pytest
tetap berguna di mesin tanpa Docker. Database test terpisah dari database aplikasi:
`mealchain_test` (bukan `mealchain`), dibuat otomatis kalau belum ada.
"""

from __future__ import annotations

import os
from functools import lru_cache

from sqlalchemy import Engine, create_engine, delete, text, update
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.db_seed import SUPPLIERS, seed_demo_data
from app.models import (
    AgentTrace,
    Approval,
    Base,
    Decision,
    DecisionEvidence,
    SapMockMaterialStock,
    SapMockPurchaseOrder,
    Supplier,
    SupplyRecord,
)
from app.sap_integration.mock_provider import MockSAPProvider
from app.sap_integration.sql_mock_store import SqlSapMockStore

DEFAULT_TEST_DATABASE_URL = (
    "postgresql+psycopg://mealchain:mealchain@localhost:55432/mealchain_test?connect_timeout=2"
)
# Database bawaan container, dipakai hanya untuk membuat database test.
ADMIN_DATABASE = "mealchain"


class StoreUnavailable(RuntimeError):
    """Postgres test tidak tersedia (mis. Docker Desktop belum jalan)."""


def test_database_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", "").strip() or DEFAULT_TEST_DATABASE_URL


def _admin_url(url: str) -> str:
    """URL ke database bawaan container, untuk membuat database test.

    Query string WAJIB ikut terbawa: dialah yang membawa `connect_timeout`. Kalau hilang, koneksi
    ke Postgres yang tidak jalan TIDAK gagal cepat — ia menggantung sekitar dua menit sampai
    timeout TCP sistem, dan seluruh suite jadi lambat sekali di mesin tanpa Docker.
    """
    return make_url(url).set(database=ADMIN_DATABASE).render_as_string(hide_password=False)


def _ensure_database(url: str) -> None:
    name = make_url(url).database
    admin = create_engine(_admin_url(url), isolation_level="AUTOCOMMIT", future=True)
    try:
        with admin.connect() as connection:
            exists = connection.execute(
                text("select 1 from pg_database where datname = :name"), {"name": name}
            ).first()
            if exists is None:
                connection.execute(text(f'CREATE DATABASE "{name}"'))
    finally:
        admin.dispose()


@lru_cache(maxsize=1)
def engine() -> Engine:
    """Engine ke database test, dengan skema dibuat ulang dari metadata (cermin Schema.md)."""
    url = test_database_url()
    try:
        _ensure_database(url)
        engine_ = create_engine(url, future=True, pool_pre_ping=True)
        Base.metadata.drop_all(engine_)
        Base.metadata.create_all(engine_)
    except (SQLAlchemyError, OSError) as exc:
        raise StoreUnavailable(f"Postgres test tidak tersedia di {url}: {exc}") from exc
    return engine_


def session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=engine(), expire_on_commit=False, future=True)


def reset_dynamic_tables(session: Session) -> None:
    """Kosongkan tabel yang ditulis provider, seed, dan endpoint aksi.

    Urutannya penting: tabel anak dulu (FK), baru induknya — `decisions` menjadi induk bagi
    `approvals`, `decision_evidence`, dan `agent_traces`. `suppliers.reliability_score` juga
    dikembalikan ke angka seed karena alur LEARN menulis ke master data; tanpa ini test saling
    mewarisi skor yang sudah bergerak.
    """
    for model in (
        Approval,
        DecisionEvidence,
        AgentTrace,
        # PO mock mereferensikan decisions.decision_id -> harus dihapus sebelum decisions
        SapMockPurchaseOrder,
        Decision,
        SapMockMaterialStock,
        SupplyRecord,
    ):
        session.execute(delete(model))
    for spec in SUPPLIERS:
        session.execute(
            update(Supplier)
            .where(Supplier.name == spec["name"])
            .values(reliability_score=spec["reliability_score"])
        )
    session.commit()


def build_sql_mock_provider(*, reset: bool = True, seed: bool = True) -> MockSAPProvider:
    """Provider mock yang datanya benar-benar di Postgres (tabel `sap_mock_*`).

    `reset=True` mengosongkan tabel mock dulu (bawaan untuk test yang butuh mulai dari nol).
    `reset=False` dipakai kalau test justru ingin melihat data yang sudah ada.
    """
    factory = session_factory()
    with factory() as session:
        if reset:
            reset_dynamic_tables(session)
        if seed:
            seed_demo_data(session)
    return MockSAPProvider(store=SqlSapMockStore(factory))
