"""Pemilihan store untuk MockSAPProvider.

Dua mode, diatur env `SAP_MOCK_STORE`:
  * `memory`   — data di memori proses. Bawaan, supaya backend & test jalan tanpa Postgres.
  * `postgres` — data di tabel `sap_mock_*` (docs/Schema.md §4). Ini mode kerja sehari-hari
                 dan yang dipakai demo, karena datanya bertahan dan bisa diaudit.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.config import mock_store_kind
from app.db import get_session_factory

from .mock_provider import InMemorySapMockStore, SapMockStore
from .provider_interface import SAPProviderError
from .sql_mock_store import SqlSapMockStore

VALID_STORES = ("memory", "postgres")


def get_mock_store(session: Session | None = None) -> SapMockStore:
    """Store untuk `MockSAPProvider`.

    `session` (opsional) membuat store memakai session milik pemanggil, sehingga tulis PO ikut
    transaksi pemanggil — inilah yang membuat `execute` atomik (PO + status keputusan + bukti +
    jejak agen masuk bersama, atau tidak sama sekali). Tanpa `session`, store berdiri sendiri
    seperti sebelumnya.
    """
    kind = mock_store_kind()
    if kind == "memory":
        return InMemorySapMockStore()
    if kind == "postgres":
        if session is not None:
            return SqlSapMockStore(session=session)
        return SqlSapMockStore(get_session_factory())
    raise SAPProviderError(
        f"SAP_MOCK_STORE={kind!r} tidak dikenal (pilihan: {', '.join(VALID_STORES)})"
    )
