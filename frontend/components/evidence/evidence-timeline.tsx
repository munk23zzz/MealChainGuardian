import {
  ClipboardCheck,
  FileCheck2,
  MapPin,
  Thermometer,
  Tag,
} from "lucide-react";
import { StatusBadge } from "@/components/status/status-badge";
import { EVIDENCE_TYPE_LABELS, summarizeEvidenceConsistency } from "@/lib/evidence";
import { formatDateTime } from "@/lib/format";
import type { EvidenceItem, EvidenceType } from "@/lib/api/schema";

const EVIDENCE_ICONS: Record<EvidenceType, typeof FileCheck2> = {
  sap_purchase_order: FileCheck2,
  sap_goods_receipt: FileCheck2,
  gps: MapPin,
  temperature: Thermometer,
  human_inspection: ClipboardCheck,
  market_price: Tag,
};

/**
 * EvidenceTimeline (design.md §3.3): tiap bukti dengan sumber & timestamp,
 * ditandai konsisten/tidak konsisten. Bukti yang belum diuji ditandai netral —
 * jangan sampai terlihat "aman" padahal belum diperiksa.
 */
export function EvidenceTimeline({ items }: { items: EvidenceItem[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-navy-100 px-4 py-6 text-center text-muted-foreground">
        Bukti untuk keputusan ini belum dilaporkan. Evidence Fusion belum
        mengumpulkan data SAP/IoT/inspeksi.
      </p>
    );
  }

  const summary = summarizeEvidenceConsistency(items);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground">
        {summary.consistent} konsisten · {summary.inconsistent} tidak konsisten ·{" "}
        {summary.unknown} belum diuji
      </p>

      <ol className="flex flex-col">
        {items.map((item, index) => {
          const Icon = EVIDENCE_ICONS[item.type];
          return (
            <li
              key={item.id ?? `${item.type}-${index}`}
              className="flex gap-3 border-l border-border pb-4 pl-4 last:pb-0"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-navy-700" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-navy-900">
                    {EVIDENCE_TYPE_LABELS[item.type]}
                  </span>
                  <StatusBadge kind="evidence" value={item.isConsistent} />
                </div>
                <p className="mt-0.5 truncate text-muted-foreground">
                  {item.source} · {formatDateTime(item.recordedAt)}
                </p>
                {item.summary && <p className="mt-1">{item.summary}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
