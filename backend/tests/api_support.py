"""Pembantu test API — dipakai `test_actions_api.py`.

Permintaan-permintaan demo (propose/approve/execute) dan identitas akun demo tinggal di satu
tempat supaya file test tidak menyimpang satu sama lain.
"""

from __future__ import annotations

from typing import Any

from app.db_seed import DEMO_PASSWORD_BY_ROLE, DEMO_USERS


def _demo_email(role: str, location: str | None) -> str:
    """Email akun demo dari seed — test TIDAK boleh menulis email harfiah.

    Sebelumnya konstanta di sini menyalin email seed, sehingga ketika emailnya disamakan dengan
    halaman login UI (`sppg.head@demo.local` dkk) test ikut merah hanya karena salinan yang basi.
    Sumbernya satu: `app/db_seed.py`.
    """
    for spec in DEMO_USERS:
        if spec["role"] == role and spec["location"] == location:
            return str(spec["email"])
    raise AssertionError(f"akun demo {role}/{location} tidak ada di DEMO_USERS")


JAKARTA_HEAD = _demo_email("sppg_head", "Jakarta")
JAKARTA_NUTRI = _demo_email("sppg_nutritionist", "Jakarta")
CIANJUR_HEAD = _demo_email("sppg_head", "Cianjur")
CIANJUR_NUTRI = _demo_email("sppg_nutritionist", "Cianjur")
MONITOR = _demo_email("bgn_monitor", None)

# Satu sumber kebenaran password demo: peta peran di app/db_seed.py.
DEMO_PASSWORD_BY_EMAIL = {
    spec["email"]: DEMO_PASSWORD_BY_ROLE[spec["role"]] for spec in DEMO_USERS
}


# Cache token DIPASANG pada objek TestClient (bukan di modul): fixture `client` membuat database test
# dan TestClient baru per test, jadi id akun demo berubah-ubah dan token lama akan ditolak 401.
def user_headers(client, email: str, *, password: str | None = None) -> dict[str, str]:
    """Header `Authorization: Bearer <token>` untuk satu akun demo.

    Token diambil lewat jalur login yang SAMA dengan UI (`POST /auth/login`), bukan dibuat langsung
    oleh test: kalau login atau tanda tangan token rusak, seluruh test API ikut gagal — itu yang
    diinginkan. Sebelumnya test mengirim header `X-User-Id` yang tidak diverifikasi (deviasi #9).

    `password` hanya perlu diisi untuk akun yang dibuat langsung oleh test (bukan hasil seed).
    """
    cache = client.__dict__.setdefault("_demo_token_cache", {})
    key = f"{email}:{password or ''}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    if password is None:
        password = DEMO_PASSWORD_BY_EMAIL.get(email)
        assert password is not None, f"{email} bukan akun demo yang di-seed"
    response = client.post("/auth/login", json={"username": email, "password": password})
    assert response.status_code == 200, response.text

    headers = {"Authorization": f"Bearer {response.json()['token']}"}
    cache[key] = headers
    return headers


def propose(client, headers, **overrides: Any):
    body: dict[str, Any] = {
        "decision_type": "regional_balance",
        "source_location": "Cianjur",
        "target_location": "Jakarta",
        "commodity": "telur",
        "quantity_kg": 700.0,
        "safe_delivered_cost": 26200.0,
        "verifier_result": "consistent",
    }
    body.update(overrides)
    return client.post("/actions/propose", json=body, headers=headers)


def approve(client, headers, decision_id: str, approved: bool = True, comment: str | None = None):
    return client.post(
        "/actions/approve",
        json={"decision_id": decision_id, "approved": approved, "comment": comment},
        headers=headers,
    )


def execute(client, headers, decision_id: str, supplier: str, net_price: float = 26200.0):
    return client.post(
        "/actions/execute",
        json={
            "decision_id": decision_id,
            "supplier": supplier,
            "net_price_amount": net_price,
        },
        headers=headers,
    )


def propose_exclusion(
    client,
    headers,
    supplier: str,
    reason: str = "Dua pengiriman terakhir gagal inspeksi suhu dan mutu.",
):
    """Usulan eksklusi pemasok (`Rules.md` §1.2) — hanya MENCATAT, belum mengeksklusi."""
    return client.post(
        "/actions/propose",
        json={"decision_type": "supplier_exclusion", "supplier": supplier, "reason": reason},
        headers=headers,
    )


def exclude(client, headers, decision_id: str):
    """Eksekusi eksklusi yang sudah disetujui (menulis `suppliers.status='excluded'`)."""
    return client.post("/actions/exclude", json={"decision_id": decision_id}, headers=headers)


def approved_decision(client, headers, supplier: str, **propose_overrides: Any) -> str:
    """Keputusan yang sudah dieksekusi — titik awal uji jalur aksi (dan pembuatan PO)."""
    decision_id = propose(client, headers, **propose_overrides).json()["decision"]["id"]
    assert approve(client, headers, decision_id).status_code == 200
    response = execute(client, headers, decision_id, supplier)
    assert response.status_code == 200, response.text
    return decision_id
