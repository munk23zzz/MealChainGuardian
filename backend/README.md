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
| Endpoint `/decisions/*` (baca: daftar + detail dengan jejak audit) | Selesai (P2.2c) |
| Endpoint `/actions/propose|approve|execute` + aturan approval (`core/approval_rules.py`) | Selesai (P2.2c) |
| Indeks wajib `docs/Schema.md` §5 (termasuk UNIQUE `(decision_id, approved_by)`) | Selesai (P2.2c) |
| `POST /actions/receive` (inspeksi penerimaan) + LEARN `reliability_score` | Selesai (P2.2c-2) |
| `POST /decisions/evaluate`, `/demand/*`, `/balance/*`, `/cost/*`, `/freshness/*`, `/safety/*`, `/price/*` | Belum (butuh `core/` + agent) |
| Frontend dialihkan dari mock browser ke backend | Belum (P2.2d) |

Total: 142 test hijau (`pytest`; 0 skip, jadi test Postgres benar-benar berjalan).

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
GET  /health                              mode SAP per kapabilitas (diagnostik)
GET  /supply?location=&commodity=         daftar stok per batch, dalam istilah domain
GET  /supply/{location}/{commodity}       total stok satu lokasi+komoditas, dirinci per batch
GET  /decisions?status=                   daftar keputusan (default 50 terbaru)
GET  /decisions/{id}                      satu keputusan + approval, jejak agen, bukti
POST /actions/propose                     catat usulan keputusan (langkah DECIDE)
POST /actions/approve                     satu suara approval (langkah manusia, bukan agen)
POST /actions/execute                     kirim PO ke SAP (mock) — hanya setelah approval sah
POST /actions/receive                     inspeksi penerimaan + isi outcome + LEARN pemasok
```

Endpoint `/actions/*` butuh header `X-User-Id` (id akun demo). `POST /decisions/evaluate` dan
endpoint alat lain (`/demand/*`, `/balance/*`, ...) belum ada — lihat tabel status di atas.

`POST /actions/execute` menerima `supplier` sebagai `suppliers.id` domain (UUID): id itu yang dipakai
UI, dan penerjemahan ke kode business partner SAP (`SUP-A`) terjadi di dalam API (deviasi #15).

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

## Aturan approval (P2.2c) — di server, bukan di UI

`docs/Skill.md` §9 jadi kode di `app/core/approval_rules.py` (tanpa HTTP, tanpa database, 24 test
sendiri) dan ditegakkan di `app/api/actions.py`:

| Status keputusan | Approval yang dibutuhkan | Siapa |
|---|---|---|
| `pending_approval` (verifier konsisten) | 1 | `sppg_head` ATAU `sppg_nutritionist`, dari SPPG penerima |
| `verifier_flagged` | 2 | `sppg_head` DAN `sppg_nutritionist`, SPPG yang sama |
| `verifier_unavailable` | 2 | `sppg_head` DAN `sppg_nutritionist`, SPPG yang sama |
| `proposed` (belum diverifikasi) | — | tidak bisa di-approve sama sekali |

Keputusan desain yang sengaja diambil (dan alasannya):

- **Status keputusan adalah sumber kebenaran jumlah approval.** Approval pertama pada keputusan yang
  butuh dua TIDAK menurunkan statusnya jadi `pending_approval`; kalau diturunkan, syaratnya akan
  salah terbaca sebagai "cukup satu".
- **Dua orang berperan sama ≠ dua approval.** Pada status yang butuh dua, peran yang diminta adalah
  `sppg_head` DAN `sppg_nutritionist`. Dua `sppg_head` tidak memenuhi syarat.
- **Tidak ada auto-execute.** `POST /actions/execute` menolak (`409 no_auto_execute`) selama status
  belum `approved`; tidak ada jalur `proposed -> executed` (`docs/Schema.md` §6).
- **Satu keputusan -> paling banyak satu PO.** Sebelum membuat PO, endpoint memeriksa PO yang sudah
  ada untuk keputusan itu dan mengembalikan `409 already_executed`. Sejak P2.2c-2 PO dan baris domain
  ditulis dalam SATU transaksi (store meminjam session request, satu commit di akhir), jadi jaring
  pengaman ini tinggal untuk permintaan paralel — bukan lagi penambal transaksi yang terbelah.
  Kegagalan di tengah alur diuji dengan sengaja: setelah PO ditulis lalu langkah berikutnya gagal,
  tidak ada baris PO yang tertinggal dan keputusan tetap `approved`.

Jalur gagal yang diuji (bukan hanya jalur bahagia):

| Kondisi | Respons |
|---|---|
| Tanpa header `X-User-Id` / id tidak dikenal | `401` |
| `bgn_monitor` mencoba approve | `403` `approver_role_not_allowed` |
| Approver dari SPPG lain | `403` `approver_location_mismatch` |
| Orang yang sama approve dua kali | `409` (dan UNIQUE index di database menolak baris kedua) |
| Execute sebelum approval | `409` `no_auto_execute` (+ berapa approval kurang) |
| Keputusan lewat `expires_at` | `409` `decision_expired`, status dipindahkan ke `expired` |
| Keputusan ditolak approver | status langsung `rejected` |
| Pemasok/material tidak ada di SAP | `422` (bukan `502` — salahnya di input, bukan di hulu) |

## Penerimaan & LEARN (P2.2c-2)

`POST /actions/receive` = inspeksi penerimaan (`docs/Architecture.md` §4, `design.md` §3.5b).
Aturannya logika murni di `app/core/receiving_rules.py` (tanpa HTTP/DB), diterapkan di
`app/api/actions.py`:

| Kondisi | Respons |
|---|---|
| Keputusan belum `executed` | `409 decision_not_executed` |
| Keputusan sudah punya outcome | `409 already_received` (satu inspeksi per keputusan) |
| Pencatat bukan `sppg_nutritionist` (head / monitor) | `403 recorder_role_not_allowed` |
| Pencatat gizi dari SPPG lain | `403 recorder_location_mismatch` |
| `physical_condition` di luar `baik`/`rusak_sebagian`/`rusak` | `422`, ditolak sebelum menyentuh database |

Kondisi fisik -> `decisions.outcome`: `baik` -> `success`, `rusak_sebagian`/`rusak` -> `failure`
(`docs/Skill.md` §10). Bukti inspeksi ditulis sebagai `decision_evidence` bertipe `human_inspection`
(suhu terukur, kondisi, pelaku, PO tertaut), dan perubahan skor meninggalkan jejak `agent_traces`
langkah `LEARN`.

LEARN (`app/core/learn.py`) adalah aritmetika deterministik — bukan model yang dilatih ulang:

```
skor_baru = 0.5 x skor_lama + 0.5 x success_rate(5 outcome terakhir pemasok itu)
```

hasilnya dibulatkan 2 desimal agar muat kolom `NUMERIC(3,2)`; riwayat dibaca lewat tautan PO
(`sap_mock_purchase_orders.decision_id`) karena `decisions` tidak punya `supplier_id`
(`docs/Schema.md` §3) — lihat deviasi #15.

Bukti end-to-end (uvicorn + Postgres, bukan TestClient): keputusan Cianjur->Jakarta 700 kg melewati
`propose -> approve -> execute` (PO `4500000003`), lalu gizi Jakarta mencatat kondisi `rusak` ->
`decisions.outcome = failure`, `suppliers.reliability_score` Supplier A turun `0.80 -> 0.40`
(dipertimbangkan `['failure']`, window 5), `agent_traces` berisi DECIDE/ACT/LEARN, dan inspeksi kedua
atas keputusan yang sama ditolak `409 already_received`.

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
9. **Identitas dulu lewat header `X-User-Id`** (`app/api/deps.py`). Penegakan peran sudah di server,
   tapi identitasnya belum diautentikasi (tidak ada password/token). Ini mekanisme sementara sampai
   login dikerjakan bersama frontend; jangan dianggap sebagai pengamanan.
10. **Akun demo:** `docs/Skill.md` §9 menyebut pasangan akun Jakarta DAN Bogor. Yang dibuat sekarang:
    Jakarta + Cianjur (masing-masing head & nutritionist) + 2 `bgn_monitor`. Cianjur ditambahkan
    karena ia SPPG asal di dataset §11; **Bogor belum** karena Bogor tidak ada di dataset itu, dan
    membuat lokasi tanpa stok/demand akan tampak seperti data rusak saat demo. Perlu keputusan.
11. **`verifier_result` diberikan pemanggil** (`consistent|flagged|unavailable`) saat `POST
    /actions/propose`, karena Verifier (SAP AI Core, `ai_providers/verifier_client.py`) belum ada
    (P2.3). Kalau tidak diberikan, keputusan berstatus `proposed` dan TIDAK bisa di-approve — jadi
    tidak ada keputusan yang diam-diam dianggap terverifikasi.
12. **`execute` satu transaksi (SELESAI di P2.2c-2).** Dulu PO ditulis `sql_mock_store` dalam
    transaksinya sendiri sementara status keputusan/bukti/jejak ditulis session API. Sekarang store
    bisa meminjam session pemanggil (`SqlSapMockStore(session=...)`, dipakai `get_provider(session)`),
    jadi PO + status + bukti + jejak masuk SATU commit. Diuji dengan menggagalkan langkah setelah PO:
    tidak ada PO yang tertinggal. Catatan terbuka: dua permintaan `execute` paralel masih bisa
    berlomba (jaring pengaman `409 already_executed`), dan itu belum diuji beban.
13. **Dua modul `core/` baru**: `core/learn.py` (LEARN) dan `core/receiving_rules.py` (aturan
    inspeksi). `docs/Architecture.md` §4 belum menyebut keduanya — ditambahkan supaya aturan
    penerimaan/skor tetap logika murni yang bisa diuji tanpa HTTP, seperti `core/approval_rules.py`.
14. **LEARN juga dijalankan saat hasilnya `success`** (`baik`), bukan hanya saat `failure`. Dokumen
    hanya menyebut penyesuaian skor; kalau LEARN hanya turun, `reliability_score` pemasok tidak akan
    pernah pulih lagi dan demonya jadi satu arah. Formula naik/turunnya sama (rata-rata berbobot).
15. **Identitas pemasok: API memakai `suppliers.id` (UUID domain), provider memakai KODE SAP**
    (`SUP-A`, `docs/Skill.md` §11). Penerjemahannya ada di `app/api/actions.py` lewat interface
    provider (cari business partner berdasarkan nama), dan peta kode ada di
    `field_mapping.BUSINESS_PARTNER_BY_SUPPLIER_NAME`. Sebelumnya provider mock Postgres memakai UUID
    sementara provider memory memakai `SUP-A`, sehingga permintaan `execute` yang sah di satu mode
    ditolak di mode lain. Dua hal yang perlu keputusan: (a) pasangan pemasok domain <-> business
    partner sebaiknya datang dari vendor master SAP, bukan nama; (b) `decisions` tidak punya
    `supplier_id`, jadi tautan keputusan<->pemasok untuk LEARN hanya bisa lewat PO.

## Langkah berikutnya

P2.2c-2 selesai (`POST /actions/receive` + LEARN, 142 test hijau, bukti end-to-end di atas).

1. **P2.2d — frontend disambungkan ke backend**: ganti mock di browser dengan panggilan ke API ini,
   termasuk login demo (menutup deviasi #9) dan papan skor pemasok yang angkanya bergerak setelah
   inspeksi. Backend perlu `GET /suppliers` supaya UI bisa memilih pemasok saat `execute`.
2. `POST /decisions/evaluate` + `core/` (`scoring.py`, `safe_delivered_cost.py`, `constraints.py`)
   dan endpoint alat `/balance/*`, `/cost/*` — sebelum agent (Strands/Supervisor) bisa dijalankan,
   karena agent memanggil endpoint ini sebagai tool.
3. Verifier nyata (SAP AI Core, `ai_providers/verifier_client.py`) supaya `verifier_result` tidak lagi
   diberikan pemanggil (deviasi #11).
