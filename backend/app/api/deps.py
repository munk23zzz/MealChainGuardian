"""Dependency bersama router: session database dan identitas pemanggil."""

from __future__ import annotations

import uuid
from typing import Annotated, Iterator

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.config import secret_key
from app.core.auth import InvalidTokenError, read_token
from app.db import get_session_factory
from app.models import User


def get_session() -> Iterator[Session]:
    """Satu session database per request; ditutup setelah respons dikirim."""
    with get_session_factory()() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]


def get_current_user(
    session: SessionDep,
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    """Identitas pemanggil dari `Authorization: Bearer <token>`.

    Token dibuat `POST /auth/login` (JWT HS256, `app/core/auth.py`) dan WAJIB bertanda tangan sah
    serta belum kedaluwarsa. Sebelumnya identitas datang dari header `X-User-Id` yang tidak
    diverifikasi (deviasi #9) — jalur itu sudah dihapus supaya tidak ada cara menyamar.

    Yang tetap ditegakkan di lapisan ini juga: peran & lokasi approver (`docs/Skill.md` §9), bukan di UI.
    """
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail="Header `Authorization: Bearer <token>` wajib diisi. Token didapat dari POST /auth/login.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(
            status_code=401, detail="Format header Authorization harus `Bearer <token>`."
        )

    try:
        claims = read_token(token.strip(), secret=secret_key())
    except InvalidTokenError as exc:
        raise HTTPException(
            status_code=401,
            detail=f"Token tidak sah: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None

    try:
        user_id = uuid.UUID(claims.user_id)
    except ValueError:
        raise HTTPException(
            status_code=401, detail=f"Token memuat id akun yang bukan UUID: {claims.user_id!r}"
        ) from None

    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=401, detail=f"Akun di dalam token sudah tidak ada: {claims.user_id}"
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
