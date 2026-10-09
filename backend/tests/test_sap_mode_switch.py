"""Saklar SAP global `SAP_MODE` + urutan menang env per kapabilitas (`docs/Architecture.md` §9).

Dokumen §9 menjanjikan perpindahan mock → jalur nyata sebagai "perubahan konfigurasi satu baris".
Kode sebelum ini hanya punya lima variabel per kapabilitas, jadi janji itu tidak benar-benar berlaku:
`SAP_MODE=aws_mcp` yang tertulis di dokumen justru TIDAK berpengaruh apa pun (diam-diam semua tetap
mock — kegagalan yang paling sulit terlihat saat demo).
"""

from __future__ import annotations

import pytest

from app.sap_integration.factory import (
    CAPABILITY_ENV_VAR,
    GLOBAL_ENV_VAR,
    get_sap_provider,
    resolve_mode,
)
from app.sap_integration.provider_interface import SAPCapability, SAPMode, SAPProviderError


def _modes(env: dict[str, str]) -> dict[str, str]:
    router = get_sap_provider(env)
    return {cap.value: router.mode_for(cap).value for cap in CAPABILITY_ENV_VAR}


def test_tanpa_env_semua_mock():
    assert set(_modes({}).values()) == {"mock"}


def test_satu_baris_menyalakan_semua_ke_aws_mcp():
    """Inti janji dokumen §9: `SAP_MODE=...` menggantikan lima variabel per kapabilitas."""
    assert set(_modes({GLOBAL_ENV_VAR: "aws_mcp"}).values()) == {"aws_mcp"}


def test_mode_odata_juga_dikenal():
    assert set(_modes({GLOBAL_ENV_VAR: "odata"}).values()) == {"odata"}


def test_env_per_kapabilitas_menang_atas_saklar_global():
    """Naik bertahap harus tetap bisa: satu kapabilitas tetap mock saat sisanya aws_mcp."""
    modes = _modes({GLOBAL_ENV_VAR: "aws_mcp", "SAP_PURCHASE_ORDER_MODE": "mock"})

    assert modes["PURCHASE_ORDER"] == "mock"
    assert set(modes.values()) == {"mock", "aws_mcp"}
    assert get_sap_provider({GLOBAL_ENV_VAR: "aws_mcp", "SAP_PURCHASE_ORDER_MODE": "mock"}).is_mixed


def test_saklar_global_kosong_ditolak_seperti_env_per_kapabilitas():
    """Kontrak lama dipertahankan: variabel mode yang ADA tapi kosong = salah konfigurasi, bukan default."""
    with pytest.raises(SAPProviderError) as excinfo:
        get_sap_provider({GLOBAL_ENV_VAR: ""})

    assert GLOBAL_ENV_VAR in str(excinfo.value)


def test_saklar_global_ngawur_ditolak_bukan_diam_diam_mock():
    with pytest.raises(SAPProviderError) as excinfo:
        get_sap_provider({GLOBAL_ENV_VAR: "aws_mcptypo"})

    assert GLOBAL_ENV_VAR in str(excinfo.value)


def test_env_per_kapabilitas_ngawur_tetap_ditolak():
    with pytest.raises(SAPProviderError) as excinfo:
        get_sap_provider({"SAP_MATERIAL_STOCK_MODE": "sap-nyata"})

    assert "SAP_MATERIAL_STOCK_MODE" in str(excinfo.value)


def test_resolve_mode_menerima_environment_asli(monkeypatch):
    """Pemakaian sungguhan: `get_sap_provider()` tanpa argumen membaca `os.environ`."""
    monkeypatch.setenv(GLOBAL_ENV_VAR, "odata")
    monkeypatch.delenv("SAP_PURCHASE_ORDER_MODE", raising=False)

    assert resolve_mode(SAPCapability.MATERIAL_STOCK, {"SAP_MODE": "odata"}) is SAPMode.ODATA
    assert get_sap_provider().mode_for(SAPCapability.PURCHASE_ORDER) is SAPMode.ODATA
