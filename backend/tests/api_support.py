"""Pembantu test API — dipakai `test_actions_api.py` dan `test_receive_api.py`.

Permintaan-permintaan demo (propose/approve/execute/receive) dan identitas akun demo tinggal di
satu tempat supaya kedua file test tidak menyimpang satu sama lain.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from app.models import User

JAKARTA_HEAD = "kepala.jakarta@demo.local"
JAKARTA_NUTRI = "gizi.jakarta@demo.local"
CIANJUR_HEAD = "kepala.cianjur@demo.local"
CIANJUR_NUTRI = "gizi.cianjur@demo.local"
MONITOR = "monitor1@demo.local"


def user_headers(db_factory, email: str) -> dict[str, str]:
    """Header `X-User-Id` untuk satu akun demo (lihat deviasi #9: identitas belum diautentikasi)."""
    with db_factory() as session:
        user_id = session.scalar(select(User.id).where(User.email == email))
    assert user_id is not None, f"akun demo {email} tidak ada di seed"
    return {"X-User-Id": str(user_id)}


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


def receive(client, headers, decision_id: str, condition: str = "baik", **extra: Any):
    body: dict[str, Any] = {
        "decision_id": decision_id,
        "physical_condition": condition,
        "measured_temperature_c": 4.0,
    }
    body.update(extra)
    return client.post("/actions/receive", json=body, headers=headers)


def approved_decision(client, headers, supplier: str, **propose_overrides: Any) -> str:
    """Keputusan yang sudah dieksekusi — titik awal yang dibutuhkan inspeksi penerimaan."""
    decision_id = propose(client, headers, **propose_overrides).json()["decision"]["id"]
    assert approve(client, headers, decision_id).status_code == 200
    response = execute(client, headers, decision_id, supplier)
    assert response.status_code == 200, response.text
    return decision_id
