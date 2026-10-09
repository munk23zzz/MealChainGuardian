"""Test endpoint auth (`POST /auth/login`, `GET /auth/me`) di atas Postgres nyata.

Yang dibuktikan: password benar-benar diverifikasi (bukan dibandingkan sebagai string), pesan gagal
tidak membocorkan email mana yang terdaftar, dan token yang dipalsukan/kedaluwarsa/milik akun yang
sudah dihapus ditolak 401.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import delete

from api_support import JAKARTA_HEAD, MONITOR, user_headers
from app.config import secret_key
from app.core.auth import create_token, decode_unverified_payload
from app.db_seed import DEMO_PASSWORD_BY_ROLE, DEMO_USERS
from app.models import User

WRONG_PASSWORD_MESSAGE = "Email atau password salah."


def test_login_turns_email_and_password_into_a_token(client):
    response = client.post(
        "/auth/login",
        json={"username": JAKARTA_HEAD, "password": DEMO_PASSWORD_BY_ROLE["sppg_head"]},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["user"]["role"] == "sppg_head"
    assert body["user"]["name"] == "Kepala SPPG Jakarta"
    assert body["user"]["location_id"] is not None
    assert body["user"]["region"] == "West"
    assert body["user"]["can_approve"] is True

    # payload harus bisa dibaca klien tanpa verifikasi (frontend/lib/auth.ts)
    payload = decode_unverified_payload(body["token"])
    assert payload["role"] == "sppg_head"
    assert payload["canApprove"] is True
    assert payload["sub"] == body["user"]["id"]
    assert payload["exp"] > payload["iat"]


def test_login_rejects_wrong_password(client):
    response = client.post(
        "/auth/login", json={"username": JAKARTA_HEAD, "password": "password-salah"}
    )

    assert response.status_code == 401
    assert response.json()["detail"] == WRONG_PASSWORD_MESSAGE


def test_login_does_not_reveal_whether_the_email_exists(client):
    unknown = client.post(
        "/auth/login", json={"username": "tidak.ada@demo.local", "password": "apa saja"}
    )

    assert unknown.status_code == 401
    assert unknown.json()["detail"] == WRONG_PASSWORD_MESSAGE


def test_monitor_login_is_read_only(client):
    response = client.post(
        "/auth/login", json={"username": MONITOR, "password": DEMO_PASSWORD_BY_ROLE["bgn_monitor"]}
    )

    assert response.status_code == 200, response.text
    assert response.json()["user"]["can_approve"] is False


def test_every_seeded_demo_account_can_login(client):
    for spec in DEMO_USERS:
        response = client.post(
            "/auth/login",
            json={"username": spec["email"], "password": DEMO_PASSWORD_BY_ROLE[spec["role"]]},
        )
        assert response.status_code == 200, f"{spec['email']}: {response.text}"
        assert response.json()["user"]["role"] == spec["role"]


def test_me_returns_the_owner_of_the_token(client):
    headers = user_headers(client, JAKARTA_HEAD)

    response = client.get("/auth/me", headers=headers)

    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Kepala SPPG Jakarta"
    assert response.json()["role"] == "sppg_head"


def test_me_without_token_is_rejected(client):
    response = client.get("/auth/me")

    assert response.status_code == 401
    assert "Authorization" in response.json()["detail"]
    assert response.headers.get("www-authenticate") == "Bearer"


def test_a_token_signed_with_another_secret_is_rejected(client):
    forged = create_token(
        user_id="91e5696a-da4a-4e17-b5bb-9fa63aead63a",
        role="sppg_head",
        location_id=None,
        region="West",
        name="Penyusup",
        can_approve=True,
        secret="kunci-yang-bukan-milik-server",
    )

    response = client.get("/auth/me", headers={"Authorization": f"Bearer {forged}"})

    assert response.status_code == 401
    assert "tanda tangan" in response.json()["detail"].lower()


def test_expired_token_is_rejected(client):
    expired = create_token(
        user_id="91e5696a-da4a-4e17-b5bb-9fa63aead63a",
        role="sppg_head",
        location_id=None,
        region="West",
        name="Kepala SPPG Jakarta",
        can_approve=True,
        secret=secret_key(),
        ttl=timedelta(minutes=-5),
    )

    response = client.get("/auth/me", headers={"Authorization": f"Bearer {expired}"})

    assert response.status_code == 401
    assert "kedaluwarsa" in response.json()["detail"].lower()


def test_token_of_a_deleted_account_is_rejected(client, db_factory):
    headers = user_headers(client, JAKARTA_HEAD)
    assert client.get("/auth/me", headers=headers).status_code == 200

    with db_factory() as session:
        session.execute(delete(User).where(User.email == JAKARTA_HEAD))
        session.commit()

    response = client.get("/auth/me", headers=headers)

    assert response.status_code == 401
    assert "tidak ada" in response.json()["detail"].lower()


def test_malformed_authorization_header_is_rejected(client):
    response = client.get("/auth/me", headers={"Authorization": "Token abc"})

    assert response.status_code == 401
    assert "Bearer" in response.json()["detail"]
