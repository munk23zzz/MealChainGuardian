"""MealChain Guardian — backend FastAPI (docs/Architecture.md §4).

Sudah ada: `/health`, `/supply/*` (P2.2a), lapisan data + migrasi (P2.2b), dan siklus
usul -> approve -> execute dengan aturan approval di server (P2.2c). Belum ada: `/actions/receive`
(LEARN), `/decisions/evaluate`, dan endpoint alat lain (`/demand/*`, `/balance/*`, `/cost/*`, ...).
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api import actions, decisions, supply
from app.sap_integration.factory import get_sap_provider
from app.sap_integration.mapping import UnmappedSapValueError
from app.sap_integration.provider_interface import SAPProviderError

app = FastAPI(title="MealChain Guardian — backend", version="0.1.0")

app.include_router(supply.router)
app.include_router(decisions.router)
app.include_router(actions.router)


@app.exception_handler(UnmappedSapValueError)
def handle_unmapped_sap_value(_: Request, exc: UnmappedSapValueError) -> JSONResponse:
    """Nilai SAP yang tak dikenal = bug konfigurasi, bukan 500 misterius.

    502 dipilih karena masalahnya di hulu (sumber data), bukan di permintaan klien.
    """
    return JSONResponse(status_code=502, content={"detail": str(exc), "error": "sap_mapping_error"})


@app.exception_handler(SAPProviderError)
def handle_sap_provider_error(_: Request, exc: SAPProviderError) -> JSONResponse:
    """Provider SAP gagal / mode belum tersedia (mis. stub aws_mcp atau odata sedang aktif)."""
    return JSONResponse(
        status_code=502, content={"detail": str(exc), "error": "sap_provider_error"}
    )


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
