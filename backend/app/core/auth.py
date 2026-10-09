"""Auth demo: hash password + token JWT HS256 — **stdlib saja** (tanpa dependensi tambahan).

Kenapa ditulis sendiri dan bukan pakai PyJWT: ketergantungan tambahan di mesin lomba adalah risiko
yang tidak perlu untuk kebutuhan sekecil ini, dan formatnya sederhana. Yang WAJIB sama dengan
frontend: token berbentuk `header.payload.signature` (base64url) dan payload memuat klaim yang dibaca
`frontend/lib/auth.ts` tanpa verifikasi (`sub`, `role`, `locationId`, `region`, `canApprove`, `exp`).

Modul ini murni: tidak tahu database, tidak tahu HTTP, tidak membaca env (secret dilempar pemanggil).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

PASSWORD_ALGORITHM = "pbkdf2_sha256"
PASSWORD_ITERATIONS = 390_000
SALT_BYTES = 16
JWT_ALGORITHM = "HS256"
DEFAULT_TTL = timedelta(hours=8)


class InvalidTokenError(RuntimeError):
    """Token tidak sah: format salah, tanda tangan tidak cocok, kedaluwarsa, atau klaim kurang."""


@dataclass(frozen=True, slots=True)
class TokenClaims:
    user_id: str
    role: str
    location_id: str | None
    region: str | None
    name: str | None
    can_approve: bool
    expires_at: datetime


# --- password -------------------------------------------------------------------------


def hash_password(password: str, *, salt: bytes | None = None, iterations: int = PASSWORD_ITERATIONS) -> str:
    """Hash password dengan PBKDF2-SHA256. Format: `pbkdf2_sha256$<iterasi>$<salt_hex>$<hash_hex>`."""
    salt = salt if salt is not None else os.urandom(SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return f"{PASSWORD_ALGORITHM}${iterations}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Cek password terhadap hash tersimpan.

    Format yang tidak dikenal (mis. placeholder seed lama) mengembalikan False, bukan melempar —
    supaya akun tanpa kredensial sah tidak pernah bisa login, tapi juga tidak merusak endpoint.
    """
    try:
        algorithm, iterations_text, salt_hex, digest_hex = stored.split("$")
        if algorithm != PASSWORD_ALGORITHM:
            return False
        iterations = int(iterations_text)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except (AttributeError, TypeError, ValueError):
        return False

    candidate = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return hmac.compare_digest(candidate, expected)


# --- token ----------------------------------------------------------------------------


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64url_decode(text: str) -> bytes:
    padded = text + "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(padded.encode())


def _signature(secret: str, signing_input: str) -> str:
    return _b64url_encode(hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest())


def create_token(
    *,
    user_id: str,
    role: str,
    location_id: str | None,
    region: str | None,
    name: str | None,
    can_approve: bool,
    secret: str,
    issued_at: datetime | None = None,
    ttl: timedelta = DEFAULT_TTL,
) -> str:
    issued_at = issued_at or datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "role": role,
        "name": name,
        "locationId": location_id,
        "region": region,
        "canApprove": can_approve,
        "iat": int(issued_at.timestamp()),
        "exp": int((issued_at + ttl).timestamp()),
    }
    header = {"alg": JWT_ALGORITHM, "typ": "JWT"}
    signing_input = f"{_b64url_encode(json.dumps(header, separators=(',', ':')).encode())}." f"{_b64url_encode(json.dumps(payload, separators=(',', ':')).encode())}"
    return f"{signing_input}.{_signature(secret, signing_input)}"


def decode_unverified_payload(token: str) -> dict:
    """Baca payload tanpa verifikasi — hanya untuk test/diagnostik, JANGAN untuk otorisasi."""
    parts = token.split(".")
    if len(parts) != 3:
        raise InvalidTokenError(f"Format token tidak dikenal: {token[:12]!r}")
    try:
        payload = json.loads(_b64url_decode(parts[1]))
    except (ValueError, TypeError) as exc:
        raise InvalidTokenError("Payload token bukan JSON base64url yang sah.") from exc
    if not isinstance(payload, dict):
        raise InvalidTokenError("Payload token bukan objek JSON.")
    return payload


def read_token(token: str, *, secret: str, now: datetime | None = None) -> TokenClaims:
    """Verifikasi tanda tangan + masa berlaku, lalu kembalikan klaimnya.

    Urutan pemeriksaan sengaja: format -> tanda tangan -> klaim -> kedaluwarsa. Tanda tangan
    diperiksa SEBELUM membaca klaim, supaya payload yang diubah tidak pernah dipercaya.
    """
    parts = token.split(".")
    if len(parts) != 3 or not all(parts):
        raise InvalidTokenError(f"Format token tidak dikenal: {token[:12]!r}")

    header_text, payload_text, signature = parts
    expected_signature = _signature(secret, f"{header_text}.{payload_text}")
    if not hmac.compare_digest(signature, expected_signature):
        raise InvalidTokenError("Tanda tangan token tidak cocok.")

    try:
        header = json.loads(_b64url_decode(header_text))
        payload = json.loads(_b64url_decode(payload_text))
    except (ValueError, TypeError) as exc:
        raise InvalidTokenError("Token berisi JSON base64url yang tidak sah.") from exc
    if not isinstance(header, dict) or not isinstance(payload, dict):
        raise InvalidTokenError("Header/payload token bukan objek JSON.")
    if header.get("alg") != JWT_ALGORITHM:
        raise InvalidTokenError(f"Algoritma token tidak didukung: {header.get('alg')!r}")

    user_id = payload.get("sub")
    if not user_id:
        raise InvalidTokenError("Token tidak memuat klaim `sub`.")
    role = payload.get("role")
    if not role:
        raise InvalidTokenError("Token tidak memuat klaim `role`.")

    expires_at = payload.get("exp")
    if not isinstance(expires_at, int):
        raise InvalidTokenError("Token tidak memuat klaim `exp` yang sah.")
    now = now or datetime.now(timezone.utc)
    expires_at_dt = datetime.fromtimestamp(expires_at, tz=timezone.utc)
    if expires_at_dt <= now:
        raise InvalidTokenError(f"Token sudah kedaluwarsa pada {expires_at_dt.isoformat()}.")

    return TokenClaims(
        user_id=str(user_id),
        role=str(role),
        location_id=payload.get("locationId"),
        region=payload.get("region"),
        name=payload.get("name"),
        can_approve=bool(payload.get("canApprove", False)),
        expires_at=expires_at_dt,
    )
