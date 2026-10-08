"""Dependency bersama router: session database dan identitas pemanggil."""

from __future__ import annotations

import uuid
from typing import Annotated, Iterator

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.db import get_session_factory
from app.models import User


def get_session() -> Iterator[Session]:
    """Satu session database per request; ditutup setelah respons dikirim."""
    with get_session_factory()() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]


def get_current_user(
    session: SessionDep,
    x_user_id: Annotated[str | None, Header()] = None,
) -> User:
    """Identitas pemanggil dari header `X-User-Id`.

    Ini mekanisme ANTARA untuk demo, bukan autentikasi: identitas belum diverifikasi (tidak ada
    password/token), jadi nilainya hanya sekuat header. Yang tidak ditawar dan tetap di server:
    penegakan peran — siapa yang boleh approve apa (`docs/Skill.md` §9) — bukan di UI.
    Autentikasi sungguhan menyusul bersama frontend (P2.2d).
    """
    if not x_user_id:
        raise HTTPException(
            status_code=401,
            detail="Header X-User-Id wajib diisi dengan id akun demo (lihat app/db_seed.py).",
        )
    try:
        user_id = uuid.UUID(x_user_id)
    except ValueError:
        raise HTTPException(
            status_code=401, detail=f"X-User-Id bukan UUID: {x_user_id!r}"
        ) from None

    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail=f"Akun demo tidak dikenal: {user_id}")

    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
