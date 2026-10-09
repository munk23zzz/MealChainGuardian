import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  HAZARDS,
  prioritizeCommodities,
  riskMatrix,
  type CommodityRisk,
} from "@/lib/hazards";

const RISK_TONE: Record<CommodityRisk["level"], "danger" | "warning" | "safe"> = {
  tinggi: "danger",
  sedang: "warning",
  rendah: "safe",
};

const RISK_BADGE: Record<
  CommodityRisk["level"],
  "danger" | "warning" | "neutral"
> = {
  tinggi: "danger",
  sedang: "warning",
  rendah: "neutral",
};

/**
 * Matriks komoditas × bahaya biologis. Sumber temuan dari lib/hazards.ts
 * (BGN/Kemenkes/lab UGM) — komponen tidak mengarang bahaya atau level.
 */
export function HazardMatrix({ commodities }: { commodities: string[] }) {
  const prioritized = prioritizeCommodities(commodities);
  const keys = new Set(commodities.map((item) => item.toLowerCase().trim()));
  const matrix = riskMatrix().map(({ hazard, rows }) => ({
    hazard,
    rows: rows.filter((row) => keys.has(row.commodity.toLowerCase().trim())),
  }));

  return (
    <Card>
      <CardHeader className="space-y-0">
        <CardTitle>Matriks komoditas × bahaya</CardTitle>
        <p className="text-muted-foreground">
          Prioritas inspeksi dari temuan resmi BGN/Kemenkes/lab UGM — komoditas
          berisiko tinggi diperiksa lebih dulu.
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <div>
          <h3 className="text-sm font-medium text-navy-900">
            Prioritas komoditas menu ini
          </h3>
          <ul className="mt-2 flex flex-col gap-2">
            {prioritized.map((item) => (
              <li
                key={item.commodity}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2.5"
              >
                <span className="font-medium text-navy-900">
                  {item.commodity}
                </span>
                <Badge tone={RISK_BADGE[item.level]}>risiko {item.level}</Badge>
                <span className="text-xs text-grey-500">
                  {item.hazards.length > 0
                    ? item.hazards.map((hazard) => hazard.name).join(", ")
                    : "Belum ada catatan bahaya"}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {matrix.map(({ hazard, rows }) => (
            <div key={hazard.id} className="rounded-md border border-border p-3">
              <p className="font-medium text-navy-900">{hazard.name}</p>
              <p className="mt-1 text-xs text-grey-500">{hazard.note}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {rows.length > 0 ? (
                  rows.map((row) => (
                    <Badge
                      key={`${hazard.id}-${row.commodity}`}
                      tone={RISK_TONE[row.level]}
                    >
                      {row.commodity}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Tidak terkait komoditas menu ini
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div>
          <h3 className="text-sm font-medium text-navy-900">Catatan sumber</h3>
          <ul className="mt-2 flex flex-col gap-1 text-xs text-grey-500">
            {HAZARDS.map((hazard) => (
              <li key={hazard.id}>
                <span className="font-medium text-navy-900">
                  {hazard.name}:
                </span>{" "}
                {hazard.note}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
