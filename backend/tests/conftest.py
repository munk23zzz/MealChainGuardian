"""Fixtures + registry provider untuk contract test SAP.

Fixtures di sini juga dipakai `test_actions_api.py` (client + database test), supaya jalur
transaksi yang diuji di test sama dengan yang dipakai di produksi.

Cara menambah provider baru supaya otomatis ikut SELURUH contract test: daftarkan di
`CONTRACT_PROVIDER_FACTORIES`. Tidak ada test yang perlu diubah.
"""

from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db_seed import seed_demo_data
from app.sap_integration.aws_mcp_provider import AWSforSAPMCPProvider
from app.sap_integration.mock_provider import MockSAPProvider
from app.sap_integration.odata_provider import ODataSAPProvider

import pg_support

# provider baru = satu baris di sini; contract test berjalan sendiri untuknya.
# `mock_sql` = provider mock yang sama, tapi datanya di tabel Postgres (docs/Schema.md §4).
CONTRACT_PROVIDER_FACTORIES: dict[str, Callable[[], object]] = {
    "mock": MockSAPProvider,
    "mock_sql": pg_support.build_sql_mock_provider,
}


@pytest.fixture(scope="module")
def pg_engine():
    """Engine database test; seluruh suite di-skip kalau Postgres tidak tersedia."""
    try:
        return pg_support.engine()
    except pg_support.StoreUnavailable as exc:
        pytest.skip(str(exc))


@pytest.fixture
def db_factory(pg_engine):
    return pg_support.session_factory()


@pytest.fixture
def client(db_factory):
    """TestClient dengan session database test dan provider mock ber-store Postgres.

    Store meminjam session request (bukan membuka session sendiri), persis seperti di produksi —
    jadi test ini juga menguji jalur transaksi yang dipakai `execute`.
    """
    from app.api.deps import get_session
    from app.api.supply import get_provider
    from app.main import app
    from app.sap_integration.mock_provider import MockSAPProvider
    from app.sap_integration.sql_mock_store import SqlSapMockStore

    with db_factory() as session:
        pg_support.reset_dynamic_tables(session)
        seed_demo_data(session)

    def override_session():
        with db_factory() as session:
            yield session

    def override_provider(session: Session = Depends(get_session)):
        # PENTING: depend pada `get_session` ASLI, bukan pada `override_session` lokal. FastAPI
        # men-cache dependency per callable, jadi dengan kunci yang sama endpoint dan provider
        # benar-benar memakai SATU session untuk request ini — persis seperti produksi. Kalau di
        # sini dibuat session sendiri, PO akan ter-flush di session lain dan tidak pernah ter-commit
        # (bug yang pernah tertangkap justru oleh test jalur aksi `execute`).
        provider = MockSAPProvider(store=SqlSapMockStore(session=session))
        try:
            yield provider
        finally:
            provider.close()

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_provider] = override_provider
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def supplier_id(db_factory) -> str:
    """`suppliers.id` domain (UUID) — nilai yang memang dikirim ke API.

    Kode SAP (`SUP-A`) sengaja TIDAK dipakai di sini: API berbicara dalam istilah domain, dan
    penerjemahan ke kode business partner terjadi di dalam `app/api/actions.py`. Dulu fixture ini
    mengambil BusinessPartner dari provider, sehingga nilainya bergantung mode store — justru
    inkonsistensi yang sekarang ditutup.
    """
    from sqlalchemy import select

    from app.models import Supplier

    with db_factory() as session:
        value = session.scalar(select(Supplier.id).order_by(Supplier.name).limit(1))
    assert value is not None, "pemasok demo tidak ada di seed"
    return str(value)


@pytest.fixture(params=sorted(CONTRACT_PROVIDER_FACTORIES))
def contract_provider(request: pytest.FixtureRequest):
    """Instance provider segar per test, untuk SETIAP provider yang terdaftar.

    Provider yang butuh Postgres di-skip (bukan gagal) kalau database tidak tersedia, supaya suite
    tetap berguna di mesin tanpa Docker.
    """
    factory = CONTRACT_PROVIDER_FACTORIES[request.param]
    try:
        provider = factory()
    except pg_support.StoreUnavailable as exc:
        pytest.skip(f"[{request.param}] {exc}")

    yield provider

    close = getattr(provider, "close", None)
    if callable(close):
        close()


@pytest.fixture
def mock_provider() -> MockSAPProvider:
    return MockSAPProvider()


@pytest.fixture
def real_provider_stubs() -> list[object]:
    """Provider jalur nyata yang masih stub (belum ada tenant)."""
    return [AWSforSAPMCPProvider(), ODataSAPProvider()]
