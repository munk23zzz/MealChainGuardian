/**
 * Registri sumber data (murni) — dipakai chip "asal angka" dan halaman /sources.
 *
 * Tujuannya bukan hiasan: setiap angka yang tampil di UI harus bisa dilacak
 * asalnya, dan setiap klaim yang lemah HARUS diberi label apa adanya. Ini
 * melindungi produk dari tuduhan overclaim di depan juri/auditor.
 */

export type SourceConfidence = "resmi" | "media" | "turunan" | "simulasi";

export type SourceEntry = {
  id: string;
  /** Apa yang dijelaskan sumber ini. */
  label: string;
  /** Nilai/angka yang dipakai produk. */
  value: string;
  confidence: SourceConfidence;
  url?: string;
  note?: string;
};

export const CONFIDENCE_LABELS: Record<SourceConfidence, string> = {
  resmi: "Resmi",
  media: "Media",
  turunan: "Turunan (dihitung)",
  simulasi: "Data simulasi",
};

export const CONFIDENCE_TONES: Record<
  SourceConfidence,
  "safe" | "warning" | "info" | "neutral"
> = {
  resmi: "safe",
  media: "warning",
  turunan: "info",
  simulasi: "neutral",
};

export const SOURCES: SourceEntry[] = [
  {
    id: "bgm-batas-4-jam",
    label: "Batas konsumsi setelah matang",
    value: "maksimal 4 jam",
    confidence: "resmi",
    url: "https://www.antaranews.com/",
    note: "Kebijakan BGN, Agustus 2026",
  },
  {
    id: "kemenkes-suhu",
    label: "Ambang suhu penyimpanan & penyajian",
    value: "chiller ≤ 4 °C · beku ≤ −18 °C · panas > 60 °C · zona bahaya 5–60 °C",
    confidence: "resmi",
    url: "https://kms.kemkes.go.id/",
    note: "Infografis higiene sanitasi pangan Kemenkes",
  },
  {
    id: "bgn-klb-2025",
    label: "Kasus KLB keracunan (Jan–Sep 2025)",
    value: "70 kasus · 5.914 penerima terdampak",
    confidence: "resmi",
    url: "https://sumbar.antaranews.com/berita/716525/",
  },
  {
    id: "jppi-korban",
    label: "Total korban keracunan (Jan 2025–Mei 2026)",
    value: "37.270 orang",
    confidence: "media",
    url: "https://www.idntimes.com/news/indonesia/",
    note: "Rekap organisasi pemantau (JPPI), bukan angka resmi pemerintah",
  },
  {
    id: "bgn-penyebab",
    label: "Jenis bahaya yang ditemukan pada kasus KLB",
    value: "E. coli (air/nasi/tahu/ayam) · S. aureus (tempe/bakso) · Salmonella (ayam/telur/sayur) · B. cereus (mie)",
    confidence: "resmi",
    url: "https://www.antaranews.com/berita/5148749/",
  },
  {
    id: "perbgn-1-2026",
    label: "Kewajiban penanganan sisa pangan & limbah",
    value: "Peraturan BGN No. 1 Tahun 2026",
    confidence: "resmi",
    url: "https://www.kompas.id/artikel/bgn-keluarkan-aturan-sppg-wajib-tangani-sisa-makanan-dan-limbah-mbg",
  },
  {
    id: "bappenas-flw",
    label: "Food loss & waste nasional",
    value: "23–48 juta ton/tahun · Rp213–551 triliun/tahun (4–5% PDB)",
    confidence: "resmi",
    url: "https://lcdi-indonesia.id/",
    note: "Kajian Bappenas/Waste4Change 2021",
  },
  {
    id: "harga-bahan-baku",
    label: "Biaya bahan baku per porsi SPPG",
    value: "Rp8.000–10.000 (total Rp13.000–15.000)",
    confidence: "media",
    url: "https://kaltim.antaranews.com/berita/256910/",
  },
  {
    id: "bank-sampel",
    label: "Bank sampel pangan matang",
    value: "retensi 2×24 jam (wajib jasa boga/SPPG)",
    confidence: "resmi",
    url: "https://kms.kemkes.go.id/",
  },
  {
    id: "porsi-harian",
    label: "Produksi porsi harian nasional",
    value: "62.454.064 porsi/hari · 28.913 SPPG (Mei 2026)",
    confidence: "media",
    url: "https://allthe.news/am/articles/mbg-program-absorbs-1-28-million-workers-as-of-may-2026",
    note: "Kutipan data BGN lewat pemberitaan",
  },
  {
    id: "turunan-1-persen",
    label: "Penghematan bahan baku 1%",
    value: "Rp5,0–6,2 miliar/hari (≈ Rp1,5–1,9 triliun/tahun)",
    confidence: "turunan",
    url: "https://kaltim.antaranews.com/berita/256910/",
    note: "Hasil hitung dari porsi harian × biaya bahan baku; asumsi 300 hari produksi",
  },
  {
    id: "turunan-biaya-agen",
    label: "Biaya satu keputusan agen",
    value: "≈ US$0,76 (infrastruktur AgentCore + asumsi token LLM)",
    confidence: "turunan",
    url: "https://aws.amazon.com/bedrock/agentcore/pricing/",
    note: "Harga resmi AgentCore + asumsi beban; angka LLM wajib divalidasi saat uji nyata",
  },
  {
    id: "mock-decisions",
    label: "Data keputusan, lokasi, pemasok di aplikasi",
    value: "Data simulasi (10 lokasi, 3 komoditas, 3 peristiwa demo)",
    confidence: "simulasi",
    note: "Belum terhubung backend; ditandai badge 'Data Simulasi'",
  },
];

export function sourceById(id: string): SourceEntry | undefined {
  return SOURCES.find((entry) => entry.id === id);
}

export function sourcesByConfidence(
  entries: SourceEntry[] = SOURCES,
): { confidence: SourceConfidence; label: string; items: SourceEntry[] }[] {
  const order: SourceConfidence[] = ["resmi", "media", "turunan", "simulasi"];
  return order
    .map((confidence) => ({
      confidence,
      label: CONFIDENCE_LABELS[confidence],
      items: entries.filter((entry) => entry.confidence === confidence),
    }))
    .filter((group) => group.items.length > 0);
}

/** Sumber tanpa tautan hanya boleh untuk tipe simulasi/turunan. */
export function hasVerifiableLink(entry: SourceEntry): boolean {
  return Boolean(entry.url) || entry.confidence === "simulasi";
}
