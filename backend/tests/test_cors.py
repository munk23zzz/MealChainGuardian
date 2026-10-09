"""CORS — UI di peramban harus boleh memanggil API ini lintas origin.

Kenapa ada test untuk ini: tanpa CORS, `curl` tetap berhasil (server menjawab 200) tetapi PERAMBAN
memblokir responsnya. Gejalanya di UI adalah "login gagal" tanpa pesan apa pun dari backend, dan
`curl` yang hijau justru menyesatkan. Jadi perilakunya dikunci di sini.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import DEV_CORS_ORIGINS, cors_origins
from app.main import app

DEV_ORIGIN = DEV_CORS_ORIGINS[0]


def test_preflight_from_dev_origin_is_allowed():
    with TestClient(app) as client:
        response = client.options(
            "/supply",
            headers={"Origin": DEV_ORIGIN, "Access-Control-Request-Method": "GET"},
        )

    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == DEV_ORIGIN


def test_real_request_carries_allow_origin_header():
    """Header wajib ada di respons biasa, bukan hanya di preflight."""
    with TestClient(app) as client:
        response = client.get("/health", headers={"Origin": DEV_ORIGIN})

    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == DEV_ORIGIN


def test_unknown_origin_is_refused():
    """Origin di luar daftar TIDAK diberi header izin (gagal-tertutup)."""
    with TestClient(app) as client:
        response = client.options(
            "/supply",
            headers={
                "Origin": "https://bukan-asal-kita.example",
                "Access-Control-Request-Method": "GET",
            },
        )

    assert "access-control-allow-origin" not in response.headers


def test_origin_list_defaults_to_local_dev(monkeypatch):
    monkeypatch.delenv("APP_CORS_ORIGINS", raising=False)

    assert cors_origins() == list(DEV_CORS_ORIGINS)


def test_origin_list_can_be_extended_from_env(monkeypatch):
    """Middleware membaca env saat app diimpor, jadi yang diuji di sini adalah pembacaan env-nya."""
    monkeypatch.setenv("APP_CORS_ORIGINS", "https://situs-demo.example, http://localhost:3000")

    assert cors_origins() == ["https://situs-demo.example", "http://localhost:3000"]
