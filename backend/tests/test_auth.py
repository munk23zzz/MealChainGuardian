"""Test modul auth murni (`app/core/auth.py`) — hash password + token JWT.

Tanpa HTTP dan tanpa database: yang diuji aritmeka kriptografinya, termasuk jalur gagal yang paling
mudah salah (token kedaluwarsa, tanda tangan diubah, format hash rusak). Token harus tetap bisa
dibaca klien (`frontend/lib/auth.ts` men-decode payload base64url tanpa verifikasi).
"""

from __future__ import annotations

import base64
import hashlib
import json
from datetime import datetime, timedelta, timezone
from hmac import new as hmac_new

import pytest

from app.core.auth import (
    InvalidTokenError,
    TokenClaims,
    create_token,
    decode_unverified_payload,
    hash_password,
    read_token,
    verify_password,
)

SECRET = "rahasia-uji"
NOW = datetime(2026, 10, 8, 12, 0, tzinfo=timezone.utc)
TTL = timedelta(hours=8)


def _token(**overrides) -> str:
    kwargs = {
        "user_id": "u-1",
        "role": "sppg_head",
        "location_id": "loc-1",
        "region": "West",
        "name": "Kepala SPPG Jakarta",
        "can_approve": True,
        "secret": SECRET,
        "issued_at": NOW,
        "ttl": TTL,
    }
    kwargs.update(overrides)
    return create_token(**kwargs)


# --- password -------------------------------------------------------------------------


def test_password_roundtrip():
    stored = hash_password("Demo#SPPG2026")

    assert stored.startswith("pbkdf2_sha256$")
    assert "Demo#SPPG2026" not in stored
    assert verify_password("Demo#SPPG2026", stored)


def test_wrong_password_is_rejected():
    stored = hash_password("benar")

    assert not verify_password("salah", stored)


def test_same_password_hashes_differently_because_of_the_salt():
    assert hash_password("sama") != hash_password("sama")


@pytest.mark.parametrize(
    "stored",
    [
        "!dev-placeholder-bukan-kredensial",  # placeholder seed lama, bukan hash
        "",
        "pbkdf2_sha256$abc$def",
        "pbkdf2_sha256$390000$zz$zz",
        "md5$1$aa$bb",
    ],
)
def test_broken_hash_is_rejected_without_crashing(stored):
    assert not verify_password("apa saja", stored)


# --- token ----------------------------------------------------------------------------


def test_token_roundtrip_carries_the_claims_the_frontend_reads():
    claims = read_token(_token(), secret=SECRET, now=NOW)

    assert claims == TokenClaims(
        user_id="u-1",
        role="sppg_head",
        location_id="loc-1",
        region="West",
        name="Kepala SPPG Jakarta",
        can_approve=True,
        expires_at=NOW + TTL,
    )


def test_payload_is_readable_by_the_client_without_verifying():
    """`frontend/lib/auth.ts` men-decode payload base64url; bentuknya harus tetap 3 bagian."""
    token = _token()
    assert len(token.split(".")) == 3

    payload = decode_unverified_payload(token)

    assert payload["sub"] == "u-1"
    assert payload["role"] == "sppg_head"
    assert payload["locationId"] == "loc-1"
    assert payload["region"] == "West"
    assert payload["canApprove"] is True
    assert payload["exp"] == int((NOW + TTL).timestamp())
    assert payload["iat"] == int(NOW.timestamp())


def test_monitor_token_carries_can_approve_false():
    token = _token(role="bgn_monitor", location_id=None, region=None, can_approve=False)

    claims = read_token(token, secret=SECRET, now=NOW)

    assert claims.can_approve is False
    assert claims.location_id is None
    assert claims.region is None


def test_expired_token_is_rejected():
    token = _token(ttl=timedelta(minutes=1))

    with pytest.raises(InvalidTokenError, match="(?i)kedaluwarsa"):
        read_token(token, secret=SECRET, now=NOW + timedelta(minutes=2))


def test_token_is_still_valid_one_second_before_expiry():
    token = _token(ttl=timedelta(minutes=1))

    assert read_token(token, secret=SECRET, now=NOW + timedelta(seconds=59)).user_id == "u-1"


def test_tampered_payload_is_rejected():
    header, payload, signature = _token().split(".")
    forged_payload = base64.urlsafe_b64encode(
        json.dumps({"sub": "u-1", "role": "bgn_monitor", "exp": int((NOW + TTL).timestamp())}).encode()
    ).decode().rstrip("=")

    with pytest.raises(InvalidTokenError, match="(?i)tanda tangan"):
        read_token(f"{header}.{forged_payload}.{signature}", secret=SECRET, now=NOW)


def test_wrong_secret_is_rejected():
    with pytest.raises(InvalidTokenError, match="(?i)tanda tangan"):
        read_token(_token(), secret="rahasia-lain", now=NOW)


def test_unsigned_token_is_rejected():
    """Percobaan `alg: none` tidak boleh lolos."""
    header = base64.urlsafe_b64encode(json.dumps({"alg": "none", "typ": "JWT"}).encode()).decode().rstrip("=")
    payload = base64.urlsafe_b64encode(
        json.dumps({"sub": "u-1", "role": "sppg_head", "exp": int((NOW + TTL).timestamp())}).encode()
    ).decode().rstrip("=")

    with pytest.raises(InvalidTokenError):
        read_token(f"{header}.{payload}.", secret=SECRET, now=NOW)


@pytest.mark.parametrize("token", ["", "bukan-token", "a.b", "a.b.c.d"])
def test_malformed_token_is_rejected(token):
    with pytest.raises(InvalidTokenError, match="(?i)format"):
        read_token(token, secret=SECRET, now=NOW)


def _sign(header: dict, payload: dict) -> str:
    """Tanda tangani header+payload sendiri, untuk menguji klaim yang kurang tapi tanda tangannya sah."""

    def enc(raw: bytes) -> str:
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    signing_input = (
        f"{enc(json.dumps(header, separators=(',', ':')).encode())}."
        f"{enc(json.dumps(payload, separators=(',', ':')).encode())}"
    )
    signature = enc(hmac_new(SECRET.encode(), signing_input.encode(), hashlib.sha256).digest())
    return f"{signing_input}.{signature}"


def test_token_without_subject_is_rejected():
    token = _sign(
        {"alg": "HS256", "typ": "JWT"},
        {"role": "sppg_head", "exp": int((NOW + TTL).timestamp())},
    )

    with pytest.raises(InvalidTokenError, match="(?i)sub"):
        read_token(token, secret=SECRET, now=NOW)
