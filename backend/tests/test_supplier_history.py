"""Riwayat skor pemasok (design.md §3.9c).

Dua lapis diuji:
* `app/core/learn.py::replay_reliability` — murni, tanpa DB, harus sama dengan
  `frontend/lib/reliability.ts` (beda satu hal: backend membulatkan tiap langkah ke 2 desimal,
  karena kolom `suppliers.reliability_score` bertipe NUMERIC(3,2) — Schema.md §1).
* `GET /ui/suppliers/{id}/history` — deret itu dibangun dari penerimaan NYATA (PO + bukti
  inspeksi), dan titik terakhirnya wajib sama dengan skor tersimpan. Kalau berbeda, berarti ada
  kejadian yang tidak tercatat PO-nya.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from api_support import (
    JAKARTA_HEAD,
    JAKARTA_NUTRI,
    approved_decision,
    receive,
    user_headers,
)
from app.core.learn import DeliveryEvent, replay_reliability

pytestmark = pytest.mark.usefixtures("client")

NOW = datetime(2026, 10, 8, 9, 0, tzinfo=timezone.utc)
BASE = Decimal("0.80")


def _event(minutes: int, outcome: str, decision: str = "d-1") -> DeliveryEvent:
    return DeliveryEvent(
        at=NOW + timedelta(minutes=minutes), outcome=outcome, decision_id=decision
    )


# --- Replay murni ------------------------------------------------------------------------------


def test_replay_without_deliveries_is_a_single_base_point():
    points = replay_reliability(BASE, [])

    assert len(points) == 1
    assert points[0].at is None
    assert points[0].score == Decimal("0.80")
    assert points[0].outcome is None
    assert points[0].is_incident is False


def test_replay_follows_the_documented_formula():
    """0,5 x skor lama + 0,5 x success_rate window (Skill.md §10)."""
    points = replay_reliability(
        BASE,
        [_event(0, "failure"), _event(10, "success"), _event(20, "success")],
    )

    # 0,80 → gagal 0,40 → sukses (1/2) 0,45 → sukses (2/3) 0,56
    assert [str(point.score) for point in points] == ["0.80", "0.40", "0.45", "0.56"]
    assert points[1].is_incident is True  # pengiriman gagal
    assert points[2].is_incident is False  # skor naik, bukan insiden
    assert [point.outcome for point in points] == [None, "failure", "success", "success"]


def test_replay_orders_events_by_time_not_by_input_order():
    points = replay_reliability(
        BASE,
        [_event(20, "success", "ketiga"), _event(0, "success", "pertama"), _event(10, "failure", "kedua")],
    )

    assert [point.decision_id for point in points[1:]] == ["pertama", "kedua", "ketiga"]
    assert [point.outcome for point in points[1:]] == ["success", "failure", "success"]


def test_replay_marks_a_score_drop_as_an_incident_even_when_no_delivery_failed():
    """Insiden = gagal ATAU skor turun: pulih lalu gagal lagi tetap harus terlihat di grafik."""
    points = replay_reliability(BASE, [_event(0, "failure"), _event(10, "success")])

    assert points[1].is_incident is True
    assert points[2].is_incident is False
    assert points[2].score > points[1].score


def test_replay_never_leaves_the_zero_one_range():
    points = replay_reliability(Decimal("0.05"), [_event(0, "failure"), _event(5, "failure")])

    assert all(Decimal("0") <= point.score <= Decimal("1") for point in points)


# --- Endpoint ----------------------------------------------------------------------------------


def _history(client, headers, supplier_id: str) -> dict:
    response = client.get(f"/ui/suppliers/{supplier_id}/history", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_history_of_a_supplier_without_deliveries_is_just_the_base_score(client):
    headers = user_headers(client, JAKARTA_HEAD)
    supplier_id = client.get("/ui/suppliers", headers=headers).json()[0]["id"]

    body = _history(client, headers, supplier_id)

    assert body["supplierId"] == supplier_id
    assert body["points"] == [
        {"at": None, "score": 0.8, "outcome": None, "isIncident": False, "decisionId": None}
    ]
    assert body["events"] == []
    assert body["currentScore"] == 0.8


def test_history_after_a_failed_receiving_lowers_the_score(client, supplier_id):
    headers = user_headers(client, JAKARTA_HEAD)
    decision_id = approved_decision(client, headers, supplier_id)
    # Inspeksi penerimaan dicatat Ahli Gizi SPPG tujuan, bukan Kepala SPPG (design.md §3.5b).
    nutri = user_headers(client, JAKARTA_NUTRI)
    assert receive(client, nutri, decision_id, condition="rusak").status_code == 200

    body = _history(client, headers, supplier_id)

    assert [point["score"] for point in body["points"]] == [0.8, 0.4]
    assert body["points"][-1]["isIncident"] is True
    assert body["points"][-1]["outcome"] == "failure"
    assert body["points"][-1]["decisionId"] == decision_id
    # Skor tersimpan = titik terakhir replay (bukti tidak ada kejadian yang hilang).
    assert body["currentScore"] == 0.4 == body["points"][-1]["score"]

    assert len(body["events"]) == 1
    event = body["events"][0]
    assert event["decisionId"] == decision_id
    assert event["outcome"] == "failure"
    assert event["quantityKg"] == 700.0
    assert event["commodityId"]
    assert event["at"]


def test_history_after_a_good_receiving_raises_the_score(client, supplier_id):
    headers = user_headers(client, JAKARTA_HEAD)
    decision_id = approved_decision(client, headers, supplier_id)
    nutri = user_headers(client, JAKARTA_NUTRI)
    assert receive(client, nutri, decision_id, condition="baik").status_code == 200

    body = _history(client, headers, supplier_id)

    # 0,5 x 0,80 + 0,5 x 1,00 = 0,90
    assert [point["score"] for point in body["points"]] == [0.8, 0.9]
    assert body["points"][-1]["isIncident"] is False
    assert body["currentScore"] == 0.9


def test_history_ignores_deliveries_still_pending(client, supplier_id):
    """Baru dieksekusi, belum diterima: belum ada hasil, jadi belum ada yang dipelajari."""
    headers = user_headers(client, JAKARTA_HEAD)
    approved_decision(client, headers, supplier_id)

    body = _history(client, headers, supplier_id)

    assert body["events"] == []
    assert body["currentScore"] == 0.8


def test_history_unknown_supplier_is_not_found(client):
    headers = user_headers(client, JAKARTA_HEAD)

    assert client.get("/ui/suppliers/bukan-uuid/history", headers=headers).status_code == 404
    unknown = "00000000-0000-4000-8000-000000000000"
    assert client.get(f"/ui/suppliers/{unknown}/history", headers=headers).status_code == 404
