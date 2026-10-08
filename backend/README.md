# MealChain Guardian — backend

FastAPI backend + adapter SAP. Struktur mengikuti `docs/Architecture.md` §4.

## Cara menjalankan test

```bash
cd backend
uv venv --python 3.12        # sekali saja
uv pip install fastapi "uvicorn[standard]" pytest httpx
.venv/Scripts/python.exe -m pytest
```

## Status

| Bagian | Status |
|---|---|
| `app/sap_integration/` (interface, mock, stub nyata, factory switch per kapabilitas) | Selesai (P2.1) |
| Contract test SAP (`tests/test_sap_integration_contract.py`) | Selesai (P2.1) |
| `GET /health` (diagnostik mode SAP) | Selesai (P2.1) |
| Endpoint domain `/supply/*`, `/demand/*`, `/decisions/*`, `/actions/*` | Belum (P2.2) |
| Store Postgres `sap_mock_*` (menggantikan store in-memory) | Belum (P2.2) |
| Mapping record SAP -> model domain | Belum (P2.2) |

## Cara kerja adapter SAP

Satu interface, banyak implementasi. `core/`, `api/`, dan `agent/` tidak pernah memanggil SAP
langsung — selalu lewat `SAPDataProvider`. Pergantian implementasi tidak menyentuh kode selain
provider.

```
api/ ──> core/ (logika deterministik) ──> SAPDataProvider (interface)
                                             ├── MockSAPProvider        (mode=mock, default)
                                             ├── AWSforSAPMCPProvider   (mode=aws_mcp, stub)
                                             └── ODataSAPProvider       (mode=odata, stub)
```

Switch per kapabilitas, bukan satu saklar global (`docs/Architecture.md` §9.2):

```
SAP_MATERIAL_STOCK_MODE=mock|aws_mcp|odata
SAP_PURCHASE_ORDER_MODE=mock|aws_mcp|odata
SAP_BUSINESS_PARTNER_MODE=mock|aws_mcp|odata
SAP_PRODUCT_MASTER_MODE=mock|aws_mcp|odata
SAP_MATERIAL_DOCUMENT_MODE=mock|aws_mcp|odata
```

Default semuanya `mock`. Cek mode yang benar-benar aktif: `GET /health`.

### Menambah provider nyata

1. Implementasikan `SAPDataProvider` (mis. mengisi `odata_provider.py`).
2. Daftarkan di `tests/conftest.py` → `CONTRACT_PROVIDER_FACTORIES`.
3. Jalankan pytest. Kalau kontraknya belum identik dengan mock, test gagal — itu memang tujuannya.

Tidak ada perubahan yang diperlukan di `core/`, `api/`, atau `agent/`.

## Aturan yang dikodekan di sini

- **Tidak ada auto-execute.** Aksi tulis ke SAP (PO) hanya boleh dipanggil setelah
  `approvals.approved = true` — penegakannya ada di lapisan API (P2.2), bukan di provider.
- **Data mock wajib ditandai.** Header `X-Data-Source: MOCK` dan badge "Data Simulasi"
  (`docs/Skill.md` §6, `Rules.md`). Router menyediakan `data_source_for(capability)` supaya label
  per-respons mengikuti provider yang benar-benar menghasilkan data; `data_source` router bersifat
  konservatif (SAP hanya kalau semua kapabilitas bersumber SAP).
- **Field aneh SAP tidak boleh bocor.** Field wajib SAP asli (`ApprovalStatus`, `FiscalYear`,
  `CompanyCode`) diserap di dalam provider; untuk mock ketiganya `None`.

## Deviasi dari dokumen yang perlu persetujuan Roy

Semuanya additive — field/aturan yang sudah tertulis tidak diubah:

1. `PurchaseOrderRecord.Status` — `docs/Skill.md` §6 tidak menyebut status, tapi `docs/Schema.md`
   §4 (tabel `sap_mock_purchase_orders`) dan UI membutuhkannya.
2. `ProductMasterRecord` (`MaterialNumber`, `ProductDescription`, `BaseUnit`) — §6 belum mendaftar
   field mock untuk API_PRODUCT_SRV.
3. `odata_provider.py` — file yang tidak ada di struktur `docs/Architecture.md` §4. Alasannya: §9.2
   baru merencanakan mode `mock|aws_mcp`, padahal tenant yang benar-benar tersedia untuk proyek ini
   adalah appliance S/4HANA (SAP Cloud Appliance Library) yang diakses lewat OData + basic auth,
   bukan lewat AWS for SAP MCP Server.
4. Kode plant (`CJ01` Cianjur, `JK01` Jakarta) dan material (`TELUR-01`) dipakai di sisi SAP karena
   SAP asli memakai kode, bukan nama. Pemetaan ada di `field_mapping.py`.
