"""Engine & session SQLAlchemy.

Satu tempat untuk membuat engine: `api/` dan `sap_integration/` tidak boleh membuat engine sendiri,
supaya penggantian URL (lokal -> VPS) cukup lewat env `DATABASE_URL`.
"""

from __future__ import annotations

from functools import lru_cache

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.config import database_url


def make_engine(url: str | None = None, *, echo: bool = False) -> Engine:
    """Buat engine baru. Dipakai test yang butuh database terpisah."""
    # pool_pre_ping: koneksi ke Postgres (terutama di VPS) bisa mati saat idle.
    return create_engine(url or database_url(), echo=echo, pool_pre_ping=True, future=True)


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    """Engine proses-wide untuk aplikasi."""
    return make_engine()


@lru_cache(maxsize=1)
def get_session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False, future=True)


def ping(url: str | None = None) -> bool:
    """Cek database hidup — dipakai test untuk memutuskan skip, bukan gagal."""
    try:
        engine = make_engine(url)
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        engine.dispose()
        return True
    except Exception:  # pragma: no cover - bergantung lingkungan
        return False
