import { MOCK_DECISIONS } from "@/lib/mock-data";

import DecisionDetail from "./decision-detail";

/**
 * Pembungkus server untuk halaman detail keputusan.
 *
 * Kenapa dipisah dari `decision-detail.tsx`: ekspor statis (GitHub Pages) tidak punya server,
 * jadi Next harus tahu SEMUA nilai `[id]` saat build. `generateStaticParams` hanya boleh
 * diekspor dari server component, sedangkan halaman detailnya client component (butuh
 * `useParams`, `useAuth`, store lokal) — jadi isinya dipindah ke file terpisah dan file ini
 * hanya bertugas "mencetak" tiap halaman.
 *
 * Sumber id-nya `MOCK_DECISIONS`, bukan daftar terpisah: situs statis memang jalan di mode
 * mock, dan daftar terpisah pasti akan basi begitu keputusan demo berubah.
 */
export const dynamicParams = false;

export function generateStaticParams(): { id: string }[] {
  return MOCK_DECISIONS.map((decision) => ({ id: decision.id }));
}

export default function DecisionDetailPage() {
  return <DecisionDetail />;
}
