"""Endpoint auth demo: `POST /auth/login` dan `GET /auth/me`.

Token = JWT HS256 dari `app/core/auth.py`, ditandatangani `APP_SECRET_KEY` (lihat `app/config.py`).
Bentuknya sengaja sama dengan yang sudah dibaca frontend (`frontend/lib/auth.ts` men-decode payload),
jadi UI tidak perlu tahu apa pun soal cara token dibuat.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import CurrentUser, SessionDep
from app.config import secret_key
from app.core.auth import create_token, verify_password
from app.models import Location, User
from app.models.decisions import APPROVER_ROLES

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    # Frontend mengirim `username`; backend mencocokkannya ke `users.email` (satu sumber kebenaran:
    # akun demo di app/db_seed.py).
    username: str = Field(min_length=1, description="Email akun demo")
    password: str = Field(min_length=1)

    model_config = {
        "json_schema_extra": {
            "example": {"username": "kepala.jakarta@demo.local", "password": "<password demo>"}
        }
    }


class UserOut(BaseModel):
    id: str
    name: str
    role: str
    location_id: str | None
    region: str | None
    can_approve: bool


class LoginResponse(BaseModel):
    token: str
    user: UserOut


def _region_for(session: SessionDep, user: User) -> str | None:
    """Wilayah lokasi SPPG user — dipakai UI untuk scope approval (lihat catatan deviasi #16)."""
    if user.location_id is None:
        return None
    location = session.get(Location, user.location_id)
    return location.region if location else None


def build_user_out(session: SessionDep, user: User) -> UserOut:
    return UserOut(
        id=str(user.id),
        name=user.name,
        role=user.role,
        location_id=str(user.location_id) if user.location_id else None,
        region=_region_for(session, user),
        can_approve=user.role in APPROVER_ROLES,
    )


def _token_for(session: SessionDep, user: User) -> str:
    return create_token(
        user_id=str(user.id),
        role=user.role,
        location_id=str(user.location_id) if user.location_id else None,
        region=_region_for(session, user),
        name=user.name,
        can_approve=user.role in APPROVER_ROLES,
        secret=secret_key(),
    )


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, session: SessionDep) -> LoginResponse:
    """Tukar email+password demo dengan token.

    Pesan gagalnya sengaja seragam untuk akun tidak ada DAN password salah, supaya endpoint ini tidak
    bisa dipakai menebak email mana yang terdaftar.
    """
    user = session.scalar(select(User).where(User.email == payload.username.strip().lower()))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email atau password salah.")

    return LoginResponse(token=_token_for(session, user), user=build_user_out(session, user))


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser, session: SessionDep) -> UserOut:
    """Profil pemilik token — dipakai UI untuk memastikan token masih sah."""
    return build_user_out(session, user)
