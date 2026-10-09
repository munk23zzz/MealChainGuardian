import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DEMO_STEPS } from "@/lib/demo";

/**
 * Halaman Tentang & Batasan — daftar jujur apa yang sudah nyata dan apa yang
 * masih disimulasikan, ditambah ringkasan skenario demo. Sengaja tanpa angka
 * baru: semua yang ditulis di sini merujuk ke ambang resmi atau ke halaman
 * Sumber Data.
 */
export default function AboutPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="animate-fade-up flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-navy-900">
          Tentang &amp; Batasan
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Halaman ini menyatakan terus terang apa yang sudah nyata dan apa yang
          masih disimulasikan, supaya tidak ada klaim yang berlebihan.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Apa yang nyata dan apa yang disimulasikan</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-muted-foreground">
          <p>
            <strong className="text-navy-900">Disimulasikan.</strong> Data
            keputusan, lokasi, dan pemasok di aplikasi ini masih berupa simulasi
            karena backend belum ada. Datanya lengkap untuk memperagakan alur,
            tetapi belum berasal dari sistem produksi.
          </p>
          <p>
            <strong className="text-navy-900">Nyata — dari acuan resmi.</strong>{" "}
            Ambang keamanan pangan seperti suhu penyimpanan dan penyajian, batas
            maksimal 4 jam dari masak ke konsumsi, serta kewajiban bank sampel
            diambil dari acuan resmi Kemenkes dan BGN, bukan angka karangan
            aplikasi.
          </p>
          <p>
            <strong className="text-navy-900">Dikutip.</strong> Angka dampak
            nasional (kasus KLB, jumlah korban, food loss &amp; waste, biaya bahan
            baku) berasal dari sumber yang tercantum di halaman Sumber Data,
            lengkap dengan label tingkat kepercayaannya.
          </p>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-navy-900">Skenario demo</h2>
        <p className="text-muted-foreground">
          Satu hari di SPPG, dari bahan datang sampai batas 4 jam.
        </p>
        <div className="flex flex-col gap-3">
          {DEMO_STEPS.map((step) => (
            <Card key={step.id}>
              <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:gap-4">
                <Badge tone="info" className="h-fit w-fit shrink-0">
                  <span className="tabular-nums">{step.clock}</span>
                </Badge>
                <div className="flex flex-col gap-1">
                  <h3 className="font-medium text-navy-900">{step.title}</h3>
                  <p className="text-muted-foreground">{step.detail}</p>
                  <p className="text-xs text-muted-foreground">
                    Sumber: {step.source}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <p className="rounded-lg border border-border bg-card p-4 text-navy-900">
        Prinsip yang tidak kami langgar: agen tidak pernah mengeksekusi aksi
        berisiko tanpa persetujuan manusia, dan setiap bukti selalu tercatat.
      </p>
    </div>
  );
}
