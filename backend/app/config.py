"""Konfigurasi runtime backend.

Sumber kebenaran env: file `.env` di root repo (lihat `.env.example`). Kalau file itu ada, isinya
dimuat otomatis; variabel environment yang sudah di-set tetap menang (dotenv tidak menimpa).
"""

from __future__ import annotations

import os
from decimal import Decimal, InvalidOperation
from pathlib import Path

from dotenv import load_dotenv

# backend/app/config.py -> backend/app -> backend -> root repo
REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = REPO_ROOT / ".env"
BACKEND_ROOT = Path(__file__).resolve().parents[1]

if ENV_FILE.exists():  # pragma: no cover - efek samping impor, sengaja
    load_dotenv(ENV_FILE, override=False)

DEFAULT_DATABASE_URL = "postgresql+psycopg://mealchain:mealchain@localhost:55432/mealchain"
DEFAULT_MOCK_STORE = "memory"


def database_url() -> str:
    """URL SQLAlchemy. Default menunjuk Postgres docker compose di port 55432 (lihat .env.example)."""
    return os.environ.get("DATABASE_URL", "").strip() or DEFAULT_DATABASE_URL


def mock_store_kind() -> str:
    """Dari mana MockSAPProvider membaca: `memory` | `postgres`.

    Default `memory` supaya backend tetap bisa dijalankan & dites tanpa Postgres; `.env.example`
    menyalakan `postgres` untuk kerja sehari-hari.
    """
    return os.environ.get("SAP_MOCK_STORE", "").strip().lower() or DEFAULT_MOCK_STORE


# Ambang gerbang kesegaran (`docs/Skill.md` §3: "default 0.6, taruh di config, jangan hardcode").
# Skor kesegaran di bawah ambang = batch tidak layak jadi kandidat alokasi, seperti batch gagal aman.
DEFAULT_FRESHNESS_GATE_THRESHOLD = "0.60"


def freshness_gate_threshold() -> Decimal:
    """Ambang kesegaran dari env `FRESHNESS_GATE_THRESHOLD`.

    Nilai yang bukan angka atau di luar 0..1 diabaikan (kembali ke default): gerbang 7.5 atau -1
    akan membalik arti keputusan secara diam-diam, dan itu lebih berbahaya daripada salah eja env.
    """
    raw = os.environ.get("FRESHNESS_GATE_THRESHOLD", "").strip()
    if not raw:
        return Decimal(DEFAULT_FRESHNESS_GATE_THRESHOLD)
    try:
        value = Decimal(raw)
    except InvalidOperation:
        return Decimal(DEFAULT_FRESHNESS_GATE_THRESHOLD)
    if not Decimal(0) <= value <= Decimal(1):
        return Decimal(DEFAULT_FRESHNESS_GATE_THRESHOLD)
    return value


# Nilai cadangan HANYA untuk pengembangan lokal: token demo jadi bisa dipalsukan siapa pun yang tahu
# nilai ini. Di lingkungan lomba/produksi, set APP_SECRET_KEY di `.env` (dan jangan commit nilainya).
DEV_SECRET_KEY = "dev-secret-mealchain-ubah-di-env"


def secret_key() -> str:
    """Kunci tanda tangan token demo. Diisi dari env `APP_SECRET_KEY`."""
    return os.environ.get("APP_SECRET_KEY", "").strip() or DEV_SECRET_KEY


def using_dev_secret() -> bool:
    """True kalau kunci tanda tangan masih nilai pengembangan (dipakai untuk peringatan di /health)."""
    return secret_key() == DEV_SECRET_KEY


# Origin yang boleh memanggil API ini dari peramban. Default = dev lokal: `next dev` di :3000.
# Tanpa ini, fetch dari UI ke :8000 diblokir CORS di peramban (server tetap 200, browser yang
# menolak) — dan gejalanya membingungkan karena `curl` tetap berhasil.
DEV_CORS_ORIGINS = ("http://localhost:3000", "http://127.0.0.1:3000")


def cors_origins() -> list[str]:
    """Daftar origin yang diizinkan, dari env `APP_CORS_ORIGINS` (dipisah koma).

    Tambahkan origin lain saat perlu (mis. situs demo GitHub Pages atau IP VPS). Jangan pakai
    `*`: API ini memakai header Authorization, dan `*` tidak boleh dipasangkan dengan credential.
    """
    raw = os.environ.get("APP_CORS_ORIGINS", "").strip()
    if not raw:
        return list(DEV_CORS_ORIGINS)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]
