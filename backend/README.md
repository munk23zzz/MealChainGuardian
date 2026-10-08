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
| Mapping record OData -> model domain (`sap_integration/mapping.py`) | Selesai (P2.2a) |
| `GET /supply`, `GET /supply/{location}/{commodity}` + header `X-Data-Source` | Selesai (P2.2a) |
| Model SQLAlchemy + migrasi Alembic (`docs/Schema.md` §1-§4, 15 tabel) | Selesai (P2.2b) |
| Store mock SAP di Postgres (`sap_integration/sql_mock_store.py`) | Selesai (P2.2b) |
| Seed data demo + tarikan awal SAP -> `supply_records` (`app/db_seed.py`, `app/ingest.py`) | Selesai (P2.2b) |
| Endpoint `/demand/*`, `/decisions/*`, `/actions/*` (approve -> execute -> PO) | Belum (P2.2c) |
| Frontend dialihkan dari mock browser ke backend | Belum (P2.2d) |

Total: 68 test hijau (`pytest`; naik dari 45 karena contract test kini dijalankan untuk **dua** store —
in-memory dan Postgres — plus test khusus database).

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

## Endpoint yang sudah ada

```
GET /health                              mode SAP per kapabilitas (diagnostik)
GET /supply?location=&commodity=         daftar stok per batch, dalam istilah domain
GET /supply/{location}/{commodity}       total stok satu lokasi+komoditas, dirinci per batch
```

Semua respons stok membawa header sumber data. Contoh nyata (server uvicorn):

```
HTTP/1.1 200 OK
x-data-source: MOCK
[{"location":"Cianjur","commodity":"telur","batch":"B-2026-0101","quantity_kg":1400.0,"unit":"kg","storage_location":"SL01"}]
```

Catatan: nama komoditas dan satuan ditulis huruf kecil (`telur`, `kg`) supaya sama dengan
`docs/Schema.md` §1; sisi SAP tetap memakai kode/huruf besar (`TELUR-01`, `KG`) dan pemetaannya ada
di `field_mapping.py`.

Catatan: di kabel, nama header tampil huruf kecil (`x-data-source`). Itu normal — nama header HTTP
tidak case-sensitive, dan `fetch()` di browser cocok. Yang penting nilainya: `MOCK` atau `SAP`.

Jalur gagal juga dites, supaya tidak ada kegagalan senyap:

| Kondisi | Respons |
|---|---|
| Kombinasi lokasi+komoditas tidak ada | `404` |
| Plant/material SAP di luar peta domain | `502` `sap_mapping_error` + pesan yang menyebut file yang harus diubah |
| Satuan selain KG | `502` (konversi satuan harus eksplisit, tidak diasumsikan) |
| Kapabilitas di-switch ke mode yang belum diimplementasikan | `502` `sap_provider_error` |

## Data & database (P2.2b)

Ada dua mode penyimpanan mock, diatur `SAP_MOCK_STORE`:

| Mode | Isi | Pakai kapan |
|---|---|---|
| `memory` (bawaan) | dict di memori proses | test cepat / mesin tanpa Docker |
| `postgres` | tabel `sap_mock_*` (`docs/Schema.md` §4) | demo & pengembangan, data bertahan |

Menyiapkan database (sekali):

```bash
docker compose up -d --wait          # dari root repo: Postgres 16 di port host 55432
cd backend
.venv/Scripts/alembic.exe upgrade head      # 15 tabel dari docs/Schema.md
.venv/Scripts/python.exe -m app.db_seed     # master data + angka baku docs/Skill.md §11
```

`app.db_seed` juga menjalankan tarikan pertama SAP -> domain (`app/ingest.py`): baris
`sap_mock_material_stock` dipetakan ke `supply_records` dengan `source='mock_sap'`.

Bukti jalur ini nyata, bukan klaim: menambah satu baris di `sap_mock_material_stock` lewat `psql`
langsung membuat `GET /supply/cianjur/telur` berubah dari 1400 kg menjadi 1600 kg, dan kembali 1400
kg setelah baris itu dihapus.

### Test yang butuh Postgres

Database test terpisah (`mealchain_test`, dibuat otomatis) dengan skema dibangun ulang dari
metadata. Kalau Postgres tidak bisa dihubungi, test tersebut **di-skip** dengan alasan yang jelas
(bukan gagal), jadi suite tetap berguna tanpa Docker. Port host `55432` dipakai supaya tidak
bertabrakan dengan container lain di mesin ini (`adaptiv_db` memakai 5433).

Test yang ada sengaja membuktikan hal yang tidak bisa dibuktikan store in-memory: PO benar-benar
tersimpan di baris tabel, penomoran PO bertahan lintas instance provider, kolom `decision_id` ber-FK
menolak nilai bukan UUID, dan `UNIQUE` pada `po_number` ditegakkan oleh database.

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
5. `data_source_for(capability)` ditambahkan ke interface `SAPDataProvider` (default: satu provider =
   satu sumber data). Diperlukan supaya provider tunggal dan router per-kapabilitas bisa dipakai
   bergantian oleh lapisan API tanpa percabangan tipe.
6. Model respons API diletakkan di dalam `app/api/<nama>.py`, bukan direktori `app/schemas/`
   tersendiri (struktur §4 belum menyebutkan direktori skema). Kalau jumlah endpoint bertambah
   banyak, ini layak dipecah.
7. `sap_mock_purchase_orders` tidak punya kolom tanggal dokumen (`docs/Schema.md` §4 hanya
   mencatat `CreatedAt`), jadi PO yang dibaca kembali dari Postgres memakai `created_at.date()`.
   Test kontrak karena itu membandingkan seluruh field **kecuali** tanggal dokumen. Kalau tanggal
   harus utuh, perlu kolom `purchasing_document_date`.
8. Nama komoditas dan satuan mengikuti huruf kecil `docs/Schema.md` §1 (`telur`, `kg`), sedangkan
   sisi SAP tetap huruf besar (`TELUR-01`, `KG`). Sebelumnya API mengembalikan `Telur`/`KG`.

## Langkah berikutnya (P2.2c)

Store dan tabel sudah ada; berikutnya endpoint demo yang menulis — approve -> execute -> purchase
order — di atas tabel `decisions`, `decision_evidence`, `agent_traces`, `approvals` yang sudah
dibuat. Penegakan "tidak ada auto-execute" (PO hanya boleh dikirim setelah `approvals.approved =
true`) rencananya di lapisan `api/`, bukan di provider.

Catatan teknis yang perlu dijawab lebih dulu: `sql_mock_store.add_purchase_order` sekarang menulis
satu PO per transaksi. Alur approve -> execute butuh satu unit-of-work (keputusan, jejak agen,
approval, dan PO masuk bersama atau tidak sama sekali), jadi transaksinya harus dipindahkan ke
lapisan pemanggil.
