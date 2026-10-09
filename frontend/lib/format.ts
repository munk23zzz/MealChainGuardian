/**
 * Format helpers murni (pure functions) — tidak ada side effect, tidak fetch.
 * Konvensi Indonesia: titik untuk pemisah ribuan, koma untuk desimal.
 */

/** Format angka sebagai rupiah, tanpa desimal. */
export function formatRupiah(value: number): string {
  const rounded = Math.round(value);
  const withSeparators = rounded
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `Rp ${withSeparators}`;
}

/** Format angka sebagai kilogram, dengan pemisah ribuan (titik) dan koma desimal. */
export function formatKg(value: number): string {
  const [intPart, decPart] = value.toString().split(".");
  const withSeparators = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const result = decPart !== undefined ? `${withSeparators},${decPart}` : withSeparators;
  return `${result} kg`;
}

/** Format angka sebagai persen (bulat jika utuh, satu desimal jika tidak). */
export function formatPercent(value: number): string {
  return Number.isInteger(value) ? `${value}%` : `${value}%`.replace(".", ",");
}

/**
 * Skor 0–1 dengan desimal koma (kebiasaan Indonesia, sama seperti copy design.md: "DEFAULT 0,80").
 * Dipakai untuk skor kepercayaan & kesegaran supaya satu layar tidak mencampur "0.80" dan "0,85".
 */
export function formatScore(value: number, digits = 2): string {
  return value.toFixed(digits).replace(".", ",");
}

/** Format menit sebagai menit atau jam. */
export function formatMinutes(value: number): string {
  if (value < 1) {
    return `${value.toString().replace(".", ",")} menit`;
  }
  if (value >= 60) {
    const hours = value / 60;
    const hoursStr = Number.isInteger(hours)
      ? hours.toString()
      : hours.toString().replace(".", ",");
    return `${hoursStr} jam`;
  }
  return `${value.toString().replace(".", ",")} menit`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

/** Format tanggal ISO menjadi format Indonesia singkat, mis. "1 Sep 2026". */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Waktu lokal WIB (UTC+7) — dipakai timeline Agent Activity Log.
 * Sengaja tidak memakai zona waktu mesin: demo dijalankan dari zona berbeda
 * (mis. juri/CI di UTC) tapi trace harus tetap terbaca dalam waktu Indonesia.
 */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const hh = wib.getUTCHours().toString().padStart(2, "0");
  const mm = wib.getUTCMinutes().toString().padStart(2, "0");
  return `${hh}:${mm} WIB`;
}

/** Tanggal + waktu WIB, mis. "24 Sep 2026 10:59 WIB". */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return `${wib.getUTCDate()} ${MONTHS[wib.getUTCMonth()]} ${wib.getUTCFullYear()} ${formatTime(iso)}`;
}

/** Durasi step agent: milidetik di bawah 1 detik, detik di atasnya. */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  const str = Number.isInteger(seconds)
    ? seconds.toString()
    : seconds.toFixed(1).replace(".", ",");
  return `${str} s`;
}
