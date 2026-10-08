"""Fixtures + registry provider untuk contract test SAP.

Cara menambah provider baru supaya otomatis ikut SELURUH contract test: daftarkan di
`CONTRACT_PROVIDER_FACTORIES`. Tidak ada test yang perlu diubah.
"""

from __future__ import annotations

from collections.abc import Callable

import pytest

from app.sap_integration.aws_mcp_provider import AWSforSAPMCPProvider
from app.sap_integration.mock_provider import MockSAPProvider
from app.sap_integration.odata_provider import ODataSAPProvider

# provider baru = satu baris di sini; contract test berjalan sendiri untuknya.
CONTRACT_PROVIDER_FACTORIES: dict[str, Callable[[], object]] = {
    "mock": MockSAPProvider,
}


@pytest.fixture(params=sorted(CONTRACT_PROVIDER_FACTORIES))
def contract_provider(request: pytest.FixtureRequest):
    """Instance provider segar per test, untuk SETIAP provider yang terdaftar."""
    return CONTRACT_PROVIDER_FACTORIES[request.param]()


@pytest.fixture
def mock_provider() -> MockSAPProvider:
    return MockSAPProvider()


@pytest.fixture
def real_provider_stubs() -> list[object]:
    """Provider jalur nyata yang masih stub (belum ada tenant)."""
    return [AWSforSAPMCPProvider(), ODataSAPProvider()]
