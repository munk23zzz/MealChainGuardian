"""MealChain Guardian — backend FastAPI (docs/Architecture.md §4).

Status P2.1: baru `/health` (diagnostik mode SAP). Endpoint domain (/supply/*, /demand/*,
/decisions/*, /actions/*) menyusul di P2.2, di atas provider yang sama.
"""

from __future__ import annotations

from fastapi import FastAPI

from app.sap_integration.factory import get_sap_provider

app = FastAPI(title="MealChain Guardian — backend", version="0.1.0")


@app.get("/health")
def health() -> dict:
    """Status layanan + mode SAP per kapabilitas.

    Dipakai untuk memastikan mode mana yang benar-benar aktif sebelum demo, dan untuk mencegah
    salah label: `data_source` di sini konservatif (SAP hanya kalau semua kapabilitas bersumber SAP).
    """
    provider = get_sap_provider()
    return {
        "status": "ok",
        "sap": {
            "data_source": provider.data_source.value,
            "is_mixed": provider.is_mixed,
            "capabilities": provider.describe(),
        },
    }
