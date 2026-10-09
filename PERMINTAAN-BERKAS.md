# Permintaan berkas — menyamakan dokumen baru (D:\Downloads\New) dengan kode

Dokumen baru yang dipasang 9 Okt (package dari teman) menggambarkan proyek yang **lebih maju**
dari repo `E:\hackathon\MealchainGuardian` (Sprint 3 DONE, 463 tes backend, Alembic head
`008_rejection_loop`, AgentCore Runtime/Gateway live, rejection loop, Ops Console,
`POST /demo/seed`, rantai model Bedrock + Inferhub). Repo kita: 252 tes backend, 2 migrasi
Alembic, dan **nol** kemunculan `supersedes_id` / `rejection_reason` / `OpsConsole` /
`demo/seed` / `inferhub` / `with_fallback_chain`. SHA yang dikutip TODO baru
(`687e8bd`, `0176540`, `81714c7`, `3fcd920`) **tidak ada** di repo kita — garis keturunan
berbeda, bukan sekadar ketinggalan versi.

Karena itu, sebelum menyentuh kode kita perlu berkas di bawah ini.

## 1. Kode (paling utama)

Kalau ada repo/branch terpisah, **kirim akses repo-nya** (URL + nama branch, atau ZIP).
Kalau dikirim sebagai ZIP, yang kami butuhkan:

| Bagian | Isi yang diminta |
|---|---|
| `backend/` | `app/` (api, core, models, sap_integration), `tests/`, `migrations/versions/` (semua, termasuk `008_rejection_loop`), `alembic.ini`, `openapi.json`, `requirements*.txt`/`pyproject.toml` |
| `agent/` | `supervisor_agent.py`, `verifier_agent.py`, `gateway_config/`, `prompts/` |
| `frontend/` | `app/`, `components/`, `lib/`, `package.json`, `next.config.*`, `tailwind.config.*` |
| `infra/` + akar | `docker-compose.yml`, `.github/workflows/*`, `Makefile` (kalau ada) |
| Konfigurasi | `.env.example` — **nama variabel saja** (jangan kirim `.env` asli atau nilai rahasia) |

Catatan: kalau yang tersedia hanya branch, sebutkan juga **commit HEAD-nya** supaya jelas titik sinkronisasi.

## 2. Dokumen yang dirujuk tulisan tapi tidak ikut disertakan

Semua path di bawah dirujuk oleh dokumen baru, tapi tidak ada di paket maupun di mesin ini:

- `docs/verification/sprint-0-2-cross-sprint-audit.md`
- `docs/verification/sprint-1.md`
- `docs/verification/sprint-2.md`
- `docs/verification/sprint-3.md`
- `docs/verification/sprint-4.md`
- `docs/verification/sprint-4-final-gate.md`
- `docs/superpowers/plans/2026-10-06-sprint3-agent-layer.md` (dan isi folder `docs/superpowers/plans/` lain)

## 3. Rencana kerja (plan) yang dirujuk

- `.hermes/plans/2026-10-05-sprint2-decision-intelligence.md`
- `.hermes/plans/*` lain yang masih relevan

## 4. Pertanyaan keputusan (menentukan arah kode kita)

1. **Penerimaan barang (`/actions/receive`, inspeksi penerimaan) dihapus dari desain?**
   Di paket dokumen baru kata "penerimaan" muncul 0 kali, dan `/actions/receive` hilang dari
   `Architecture.md`. Di repo kita fitur ini sudah jalan + teruji, dan merupakan satu-satunya
   jalur yang mengisi `decisions.outcome`.
2. **LEARN di proyek teman mengambil masukan dari mana?** Di paket baru `decisions.outcome`
   tidak ada, tapi `suppliers.reliability_score` tetap ada. Dari `docs/verification/sprint-3.md`
   kami baca LEARN lewat alasan penolakan + re-propose → mohon konfirmasi jalur resminya.
3. **Ambang freshness final: 0.6/0.4 (kode + mock kita) atau 0.85/0.60 (Skill.md baru, disebut
   "keputusan Roy 2026-10-01")?** Ini mengubah status batch dan kasus merah demo.
4. **Eksklusi supplier otomatis atau wajib approval?** `Rules.md` baru: "…atau mengeksklusi
   supplier WAJIB lewat tabel approvals", sedangkan narasi proposal/PRD menyebut sumber gagal
   dikeluarkan otomatis dari kandidat. Batasan mana yang berlaku?
5. **SAP AI Core / SAP-RPT-1.6 dibuang permanen?** Paket baru menghapus layer itu (Architecture
   §10 lama) dan menyisakan jalur "AWS for SAP MCP Server + `SAP_MODE`". Kalau iya, klaim
   "Technical Execution & Use of AWS/SAP" di `IDEA.md` ikut kami sesuaikan.

## 5. Kontradiksi di paket dokumen yang perlu diklarifikasi penulisnya

- `Skill.md` §5: `freshness.evaluate` mengembalikan `usable_until`, tapi `Schema.md` menghapus
  kolom `batches.usable_until`.
- `Skill.md` sekarang berhenti di §8 — §9 (matriks approval), §10 (LEARN), §11 (angka jangkar
  dataset demo: Cianjur 1.400 kg `B-2026-0101`, Jakarta 300 kg `B-2026-0102`) hilang. Kode kita
  punya 63 kutipan ke bagian-bagian itu.
- `DEMO_MODE` masih disebut 3× padahal dihapus dari glosarium dan dari daftar aturan;
  layar "Login (+ quick-login DEMO_MODE)" dihapus dari `design.md` padahal quick-login tetap ada.
- `design.md` menjanjikan `factory.py` membaca satu `SAP_MODE`, sedangkan kode kita membaca per
  kapabilitas (`SAP_MATERIAL_STOCK_MODE`, `SAP_PURCHASE_ORDER_MODE`, …). Mana yang jadi acuan?
- Bar rehearsal diturunkan: `Roadmap.md` kita "≥9/10 run" → paket baru "3× berturut-turut".

## 6. Yang TIDAK kami minta

- Nilai rahasia apa pun: `.env`, API key, token, password, connection string, ARN pribadi,
  kunci SSH. Cukup **nama** variabelnya lewat `.env.example`.

---

Status saat ini: dokumen baru sudah terpasang sebagai dokumen kanonik; dokumen lama (11 berkas)
dicadangkan di `mealchain-guardian/_backup-docs-lama-20261009-2041`; **kode, database, dan situs
live belum disentuh** menunggu berkas di atas.
